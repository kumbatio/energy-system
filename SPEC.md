# The Energy Model — Specification

**Version 1 · normative · language-independent**

This document specifies the energy model: what an energy state is, how two of
them are ordered when they meet, and what each of the five levels means for the
behaviors built on top. `@kumbatio/energy-system` is the reference
implementation, not the definition. Anything that implements what is written
here — in Swift, Kotlin, Rust, Python, Go, or another JavaScript library — is an
implementation of the same model, and states produced by one may be read by
another.

There is a machine-readable half. [`conformance.json`](./conformance.json) ships
in this package and encodes every table and every decision below as vectors.
Load it, replay it, and you have a conformance suite without writing one. It is
generated from the built library, so the vectors and the reference
implementation cannot disagree.

Key words follow RFC 2119: **MUST**, **MUST NOT**, **SHOULD**, **MAY**.

---

## 1. Why this exists as a spec at all

The claim the model makes is not "here is a nice API". It is that **capacity is
first-class application state** — as real as the current user or the current
document, and as deserving of a stable representation.

That claim only pays off if one person's energy state can be shared by
everything they use: a mail client, a writing tool, a coordination app, a phone.
Sharing state across processes and languages is an interchange problem, and
interchange needs a specification rather than a port. Five hand-written ports of
the same tables will drift within two releases, and on the day they disagree the
promise quietly becomes false.

So the portable artifact is this document plus the vectors. An implementation is
then a small amount of local code around a shared, checkable definition.

---

## 2. Levels

The model has exactly **five** levels, and they are discrete.

| Value | Key      | Label  | Meaning                                                    |
| ----- | -------- | ------ | ---------------------------------------------------------- |
| `100` | `peak`   | Peak   | High capacity. Planning, complex decisions, creative work. |
| `75`  | `active` | Active | Good capacity. Focused execution, problem-solving.         |
| `50`  | `steady` | Steady | Moderate capacity. Routine tasks, familiar work.           |
| `25`  | `low`    | Low    | Limited capacity. Simple tasks, review, light work.        |
| `0`   | `rest`   | Rest   | Depleted. Consumption only — reading, reflecting.          |

An implementation **MUST** use exactly these five values and **MUST NOT** admit
intermediate ones. This is a design commitment, not an arbitrary limit: a
continuous slider asks for precision nobody has about their own state, and it
turns a one-second act into a judgement call at exactly the moment judgement is
expensive. Five is also few enough to cycle through with one key.

Each level carries a **cognitive profile** — `decisionCapacity`,
`focusDuration`, `taskComplexity`, `interruptionTolerance` — enumerated in the
vectors under `levels`. Implementations **MUST** reproduce these values;
consumers branch on them.

**Cycling** is `100 → 75 → 50 → 25 → 0 → 100`. Downward by default, because the
common act is admitting depletion, and the wrap gives one control both
directions. See `cycle` in the vectors.

### 2.1 What the levels are not

They are not a scale of worth, and an implementation **SHOULD NOT** present them
as a score, a streak, or something to optimise. Rest is a valid state to be in
and the interface **SHOULD** be usable there. An implementation **MUST NOT**
make Rest a degraded or punitive mode.

---

## 3. Energy state

The unit of interchange is an **energy state**: one producer's point-in-time
claim about a person's capacity. Its serialized form is specified by
[`spec/energy-state.schema.json`](./spec/energy-state.schema.json).

| Field       | Type                              | Role                                         |
| ----------- | --------------------------------- | -------------------------------------------- |
| `level`     | `0 \| 25 \| 50 \| 75 \| 100`      | The declared capacity.                       |
| `timestamp` | integer, epoch milliseconds       | When it was produced. Primary ordering key.  |
| `source`    | `manual \| scheduled \| inferred` | How it was arrived at.                       |
| `revision`  | non-negative safe integer         | Sequence among states sharing one timestamp. |
| `origin`    | non-empty string                  | Stable identity of the producer.             |

A state **MUST** be immutable once produced. Implementations **SHOULD** enforce
this with whatever their language offers.

### 3.1 Source

`source` is not decoration; §4 gives it authority.

- `manual` — the person set it. **The default, and the trust anchor.**
- `scheduled` — a rule the person configured applied it (a calendar, a time of day).
- `inferred` — the system worked it out from behavior.

An implementation **MUST** support `manual`. Inference **MAY** be offered but
**MUST** be opt-in, and a system that infers **SHOULD** present the result as a
suggestion the person confirms rather than applying it silently. A model of
someone's capacity that overrides what they said about it recreates the loss of
control the model exists to answer.

### 3.2 The unproduced sentinel

An implementation needs a state before anyone has set one. That default **MUST**
be distinguishable from a real state, because "nobody has chosen yet" and
"someone chose Peak" are different facts and only the second should survive
reconciliation.

The sentinel is `timestamp = 0` together with `origin = "0-initial"`. Both sort
below any real value, so §4 replaces the default unconditionally.

Producing the sentinel **MUST NOT** require reading the clock or a random
source. This is not a micro-optimisation: constructing a state during a
server-side render otherwise bakes an unstable value into static output, which
some frameworks fail the build on outright.

### 3.3 Rejecting implausible states

An implementation that accepts states from outside itself **SHOULD** reject any
whose `timestamp` exceeds local time by more than a bounded skew budget. Without
it, one context with a badly-set clock wins every comparison until real time
catches up to its timestamp — which may be years.

The reference default is **5 minutes**. The budget **SHOULD** be configurable,
including "accept anything finite" for controlled environments.

---

## 4. Reconciliation

> This is the section to get right. Everything else is a table.

Two states for the same person meet constantly: a second tab writes shared
storage, two windows each hold a producer, a sync layer returns what another
device recorded. Every path needs the same answer to _which of these is
current_, and the answer **MUST** be a deterministic function of the two states
alone. "Last write wins by arrival order" is not acceptable: it converges on
different values depending on timing, so two contexts disagree permanently.

Given a `candidate` and a `current`, the candidate replaces the current if and
only if the first differing key below favours it:

1. **`timestamp`** — greater wins.
2. **`revision`** — greater wins.
3. **`source`** — `manual` (3) > `scheduled` (2) > `inferred` (1).
4. **`origin`** — greater by lexicographic comparison of the string.

If all four are equal, the states are equal: the candidate **MUST NOT** replace
the current, and no change **MUST** be reported.

Key 4 is arbitrary and deliberately so. When two producers write the same
instant, the same revision, and the same class of source, there is no principled
winner — and an arbitrary rule every context computes _identically_ beats a coin
flip each context tosses separately. Convergence is the property that matters.

An implementation **MUST** additionally treat a `level` difference as a
tiebreaker below key 4 (greater wins). This is unreachable for conforming
producers, since it requires one `origin` to have produced two different states
with identical timestamps and revisions. It exists so a buggy producer causes a
wrong answer rather than an oscillation.

**Antisymmetry is required.** For any two states, both directions **MUST NOT**
report "preferred". Two contexts observing each other would otherwise swap
states forever. The vectors assert both directions of every pair for this
reason.

Reference: `isPreferredEnergyState`; vectors under `reconciliation`.

---

## 5. Adaptation strategies

A **strategy** is a pure total function from level to a configuration value. It
**MUST** be free of side effects, **MUST** be defined for all five levels, and
**MUST** return the same value for the same level every time.

The distinction that keeps the model honest is **strategies describe, runtimes
enforce**. A strategy says "at Steady, notifications batch every five minutes";
something else does the batching. Keeping the description pure is what makes it
portable, testable, and readable by a person deciding whether to trust it.

Seven strategies are specified. Their complete per-level tables are in the
vectors under `strategies`; they are not reproduced here, because a table
duplicated in prose is a table that will disagree with itself.

| Name                      | Governs                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `ui-visibility`           | Which chrome is shown, its opacity, content width and font scale.  |
| `notifications`           | Channels, batching interval, and minimum priority.                 |
| `task-complexity`         | Ceiling on surfaced task complexity; break cadence.                |
| `interaction-forgiveness` | Undo window, destructive-action confirmation, autosave cadence.    |
| `deferral`                | Ordering of "not now" presets, and the one-tap default.            |
| `autonomy`                | What automation may do unattended (§7).                            |
| `demand-admission`        | What happens to an arrival that asks something of the person (§8). |

An implementation **MUST** provide `ui-visibility`, `notifications`, and
`interaction-forgiveness` to claim conformance; the rest are **SHOULD**, since
not every host has deferral or automation. Whatever it provides **MUST** match
the vectors exactly.

Implementations **MAY** ship additional strategies and **SHOULD** allow
consumers to supply their own — the type is a contract, not a closed set.

### 5.1 Human-readable descriptions

The reference implementation pairs each strategy with a `describe(level)`
returning English prose. This is **NOT** normative and conformance does not
check it. Wording is a product and localisation decision.

---

## 6. Direction

Two rules constrain every table, and an implementation adding a strategy
**SHOULD** obey them:

1. **Lower energy means less demanded of the person, not less capability.**
   Chrome recedes, notifications batch, defaults lengthen. Features are not
   removed as punishment. The one exception is destructive capability, which
   §5's forgiveness table deliberately makes _harder_ to reach.
2. **Protection scales inversely with capacity.** Undo windows widen,
   confirmations appear, autosave quickens as energy falls. Slower error
   detection is met with more room to catch errors.

---

## 7. Autonomy

`autonomy` governs what automated systems may do on the person's behalf without
being asked. It is the mirror of interaction forgiveness: forgiveness protects
against the _person's_ mistakes at low energy, autonomy against the _agent's_.

Three fields: `confidenceThreshold` (0–1, the minimum confidence to act
unattended), `allowGeneratedContent` (whether wording may be composed or must
come from fixed templates), and `maxUnattendedSteps` (how many automated steps
may chain before control returns).

The rule the numbers encode: **what narrows as energy falls is discretion, not
action.** At Rest the threshold is `1`, admitting only certainty — rule-based
decisions, never judgement calls — with one step and no composition. Automation
**MAY** still take a single certain templated action there; an out-of-office
reply is exactly that shape, and it is _safest_ at Rest precisely because it has
stopped improvising.

A comparison against the threshold **MUST** admit equality: confidence `0.8` at
a threshold of `0.8` acts. Vectors sample every threshold boundary for this
reason.

---

## 8. Inbound demand

**Inbound demand** is anything arriving from outside that asks for the person's
attention or action: an email, a comment, a review request, an assignment, an
invitation.

This is where the model earns its keep. Every triage system in general use is
organised around properties of the _message_ — who sent it, what it claims about
its own urgency, what category it fits. None is organised around the state of
the _recipient_, which is what actually decides whether an arrival is a small
task or a crushing weight.

### 8.1 The decision

Given the level's `demand-admission` config, its `autonomy` config, and an
arrival described by `originatorTier` (`exempt` / `known` / `unknown`),
`bearsObligation`, and `confidence` (default `1`), the outcome **MUST** be
computed in this order:

1. `originatorTier` is `exempt` → **live**, no acknowledgment. Unconditional, at
   every level.
2. The tier passes the level's `originatorThreshold` → **live**.
3. `bearsObligation` is false → **live**. Informational arrivals ask nothing;
   whether they should _interrupt_ is the notification question, not this one.
4. The level does not acknowledge → **silent** (captured, no acknowledgment).
5. `confidence` is below the autonomy threshold → **silent**.
6. Otherwise → **acknowledge**, at the level's detail, composed only if autonomy
   permits generated content.

Reference: `resolveDemandOutcome`; 180 vectors under `decisions.demand`.

### 8.2 Invariants for anything acting on the decision

The decision is pure. Acting on it is not, and four rules bound what acting may
look like. An implementation performing these effects **MUST** observe them.

1. **Acknowledgment and capture are one act.** An acknowledgment without a
   captured obligation is a promise nobody kept — strictly worse than silence,
   because it converts ambient guilt into explicit written debt. A capture
   without an acknowledgment leaves the originator in silence, which is the
   problem being solved. Where the two cannot be made atomic — and across a
   network they cannot — the capture **MUST** be performed first, because it is
   the reversible half, and **MUST** be rolled back if the acknowledgment fails.
2. **Acknowledgments state, never promise.** "Received and queued, current
   response horizon Thursday" is a fact. "I'll get back to you soon" is a
   commitment the person's Tuesday self has to keep. Implementations **MUST
   NOT** emit commitments. The horizon **SHOULD** come from the deferral
   strategy, so the queue and the acknowledgment cannot disagree.
3. **Automated action toward a third party MUST be disclosed as automated.** The
   medium decides the mechanism — `Auto-Submitted: auto-replied` on email
   (RFC 3834, which also prevents responder loops), a system-attributed badge in
   an app. Undisclosed automation speaking in a person's name is the failure
   this design exists to avoid.
4. **At most once per originator, per window.** Five arrivals from one sender
   while someone is depleted are one social debt, not five. Answering each is
   the volume asymmetry the model is trying to correct.

### 8.3 Tiers

Tier assignment is the host's: an approved-senders list, a contacts database, an
org chart. The model consumes the tier and does not compute it.

The exempt tier is also what defuses the obvious gaming risk. An originator who
learns that an acknowledgment means "deprioritised" and escalates through
another channel only succeeds if their escalation is one the person cannot
ignore — which is what would have made them exempt in the first place.

---

## 9. Runtime invariants

Some requirements cannot be expressed as a vector, because they are about
sequences rather than functions. They are normative regardless, and they are the
requirements most often got wrong — each is here because it was observed failing
in a shipped product.

### 9.1 Notification gating

An implementation that gates notifications by level **MUST NOT** silently drop
one. Anything not deliverable now is **deferred** and released when the level
rises, suppression lifts, or the gate is torn down. A gate being disposed
**MUST** surface what it still holds.

_Why:_ a field client's scheduler destroyed reminders that came due while
suppressed. From the user's side that is indistinguishable from the app losing
their data, and it is the fastest way to lose trust in adaptive behavior
entirely.

### 9.2 Time-boxed suppression

Any suppression window **MUST** expire on its own. Expiry **MUST** be an emitted
event, not a condition the host is expected to poll, and suppression **MUST** be
lifted _before_ the end-of-window event is emitted — otherwise the window
swallows its own completion notice.

_Why:_ focus modes that suppress until manually cleared strand the person on
exactly the day they forget, and the cost lands on someone who already had none.

### 9.3 Deferral

Deferral presets **MUST** compute in the person's local time — "tomorrow
morning" means their morning. The ordering **SHOULD** follow the level: at low
capacity the one-tap default resurfaces work _later_, not in an hour, because
resurfacing into the same depletion helps nobody.

Because presets are local-time, conformance vectors for them are generated under
UTC and an implementation replaying them **MUST** do the same.

### 9.4 Persistence

Persisted state **MUST** round-trip verbatim — every field, not just the level.
An implementation that stores only the level and rebuilds the rest on read
produces a new `timestamp` and `origin` on every load, which reads as a fresh
write to §4 and causes contexts to fight.

---

## 10. Accessibility requirements

Adaptive interfaces can fail people in ways static ones cannot. These are
requirements, not suggestions.

1. **Hiding MUST remove from the accessibility tree.** A level-hidden element
   **MUST NOT** remain focusable or reachable by assistive technology. Visual
   hiding alone leaves a keyboard trap into content that isn't there.
2. **Focus MUST survive a level change.** If the focused element is hidden by a
   transition, focus **MUST** be moved somewhere sensible and **MUST NOT** be
   left on a removed node.
3. **Faded chrome MUST reveal on focus, not only on hover.** A control at 10%
   opacity that a keyboard user can tab into but cannot see fails WCAG 2.4.7.
   Every hover-reveal rule **MUST** have a `:focus-within` twin.
4. **Level transitions MUST be announceable.** A person using a screen reader
   **MUST** have some way to know the interface changed. The host chooses the
   mechanism; silence is not an option.
5. **Reduced motion MUST be honored.** Transitions between levels **MUST** be
   suppressed under `prefers-reduced-motion: reduce`.
6. **Contrast obligations are the host's and MUST be reachable.** The reference
   opacity values are a design default, not a conformance claim: at Low and Rest
   the resting chrome opacity does not meet WCAG 1.4.11 for non-text contrast.
   An implementation **MUST** make these values overridable and **SHOULD**
   raise them under `prefers-contrast: more`.

---

## 11. Conformance

An implementation conforms if:

1. It represents state per §3 and serializes per the schema.
2. It reconciles per §4, including antisymmetry.
3. It provides at least the required strategies of §5, matching the vectors exactly.
4. It observes the runtime invariants of §9 for whichever runtimes it provides.
5. It meets §10 for whichever surfaces it renders.

The vectors are the mechanical part. Load `conformance.json`, replay each
section against your implementation, and compare. The reference implementation
does exactly this in `test/conformance.test.ts`, which is a reasonable model for
a port's own suite.

Vector sections: `levels`, `cycle`, `strategies`, `presence`,
`decisions.notification`, `decisions.demand`, `deferral`, `reconciliation`,
`metrics`, `externalLevelMapping`.

### 11.1 Versioning

The vectors carry the reference implementation's version. Within a major
version, existing vectors **MUST NOT** change meaning; sections and vectors
**MAY** be added. A change to a shipped table's values is a breaking change to
this specification, not just to the library.

---

## 12. What is deliberately not specified

- **Wording.** Every user-facing string is a product decision.
- **Visual design.** The reference stylesheet is one interpretation.
- **How a level is chosen.** A dial, a keystroke, a menu — the model requires
  only that the person can set it directly.
- **Classification.** How a host decides that an arrival bears an obligation, or
  what tier an originator is in, is the host's problem entirely. The model
  consumes the answer and the confidence attached to it.
- **Transport.** How states reach each other — shared storage, IPC, a sync
  server — is out of scope. The schema and §4 are what make any transport work.

# @kumbatio/energy-system

Framework-agnostic TypeScript library for building **energy-aware applications**.

Instead of adapting software to clock time, adapt behavior to current cognitive capacity.
`energy-system` models energy as explicit state and resolves strategies from that state.

## At a glance

A library about low capacity should be readable at low capacity. Everything you
need to use it is here; the rest of this file is reference.

```bash
pnpm add @kumbatio/energy-system
```

```ts
import { createEnergyEngine, uiVisibilityStrategy } from '@kumbatio/energy-system'

const engine = createEnergyEngine({ initialLevel: 75 })

engine.setLevel(25) // the person says they are running low
engine.resolve(uiVisibilityStrategy) // -> what the UI should do about it
```

React:

```tsx
import { EnergyProvider, useEnergy } from '@kumbatio/energy-system/react'

const { state, setLevel } = useEnergy()
```

| If you want to                     | Go to                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Set and read energy                | [Quick start (core)](#quick-start-core)                                                     |
| Use it in React                    | [Quick start (React)](#quick-start-react)                                                   |
| Style by level in CSS              | [CSS usage](#css-usage)                                                                     |
| Show or hide by level              | [Presence annotation](#presence-annotation-which-energy-states-does-this-element-belong-to) |
| Time-box work, hold notifications  | [Focus sessions and the notification gate](#focus-sessions-and-the-notification-gate)       |
| Offer "not now"                    | [Deferral](#deferral-not-now)                                                               |
| Decide what may interrupt          | [Inbound demand and autonomy](#inbound-demand-and-autonomy)                                 |
| Keep state across reloads and tabs | [Persistence and reconciliation](#persistence-and-reconciliation)                           |
| Look up an export                  | [API map](#api-map)                                                                         |
| Port this to another language      | [Specification and conformance](#specification-and-conformance)                             |

Five levels, and they never change: `100` Peak, `75` Active, `50` Steady,
`25` Low, `0` Rest.

## Why this exists

Most tooling assumes equal capacity across a day. Real-world cognitive energy is variable and non-linear.

The core model is:

- **Work Hours (wh):** total time present
- **Productive Hours (ph):** focused subset of that time
- **Stuff Done (sd):** measurable output

And the constraint is always `ph ≤ wh`.

In other words: extending time does not linearly increase productive output.
This library gives applications a structured way to adapt to energy state instead of raw time.

## Features

- 5-level energy model: `100 | 75 | 50 | 25 | 0`
- Rich immutable state object: `level`, `timestamp`, `source`, `revision`, `origin`
- Framework-agnostic core engine
- Strategy system for behavior adaptation
- Built-in strategies:
  - UI visibility
  - Notification filtering
  - Task complexity guidance
  - Interaction forgiveness (undo windows, destructive-action confirmation)
  - Energy-aware deferral ordering
  - Autonomy (how much automation may do unattended)
- **Inbound demand admission**: an energy-resolved policy for arrivals that ask
  something of the user — reach them now, acknowledge and queue, or queue
  silently (`demandAdmissionStrategy`, `resolveDemandOutcome`)
- **Presence annotation**: declare which energy levels a component/view belongs
  to (`defineEnergyPresence`, `presenceAtOrAbove`, `<EnergyGate>`, `data-energy-min`)
- **Focus sessions**: time-boxed suppression windows with auto-expiry and break nudges
- **Notification gate**: a runtime that enforces `NotificationConfig`
  (threshold, batching, defer-not-drop) instead of leaving it as guidance
- **Deferral presets**: pure "not now" (`snooze`) computations with
  energy-aware default ordering
- DOM adapter (`data-energy-level` + CSS variables)
- React provider, hooks, and headless render components
- Persistence adapters (`localStorage`, in-memory)
- Deterministic clock and timer support for testing/simulation
- Optional external persistence observation (`observe`)
- Derived metrics helper (`getEnergyMetrics`)
- Compatibility helpers for non-native external level models

## Installation

```bash
pnpm add @kumbatio/energy-system
```

React integration is optional and provided via `@kumbatio/energy-system/react`.

## Quick start (core)

```ts
import {
  createEnergyEngine,
  uiVisibilityStrategy,
  notificationStrategy,
} from '@kumbatio/energy-system'
import { localStoragePersistence } from '@kumbatio/energy-system/persistence'

const engine = createEnergyEngine({
  initialLevel: 75,
  persistence: localStoragePersistence(),
})

engine.setLevel(50)
await engine.flush() // optional durable acknowledgement

const uiConfig = engine.resolve(uiVisibilityStrategy)
const notifConfig = engine.resolve(notificationStrategy)
```

## Quick start (React)

```tsx
import {
  EnergyProvider,
  useEnergyLevel,
  useEnergyState,
  useStrategy,
} from '@kumbatio/energy-system/react'
import { uiVisibilityStrategy } from '@kumbatio/energy-system'

function Screen() {
  const [level, setLevel] = useEnergyLevel()
  const state = useEnergyState()
  const ui = useStrategy(uiVisibilityStrategy)

  return (
    <div>
      <button onClick={() => setLevel(level === 100 ? 75 : 100)}>
        Energy: {state.level}
      </button>
      {ui.sidebar && <aside>Sidebar</aside>}
    </div>
  )
}

export function App() {
  return (
    <EnergyProvider defaultLevel={100}>
      <Screen />
    </EnergyProvider>
  )
}
```

## Presence annotation (which energy states does this element belong to?)

Every component/view can declare the energy levels it participates in. The
declaration is a plain typed object — one presence (`'visible' | 'muted' |
'hidden'`) per level — so the same annotation drives React, the engine, or
plain CSS.

```ts
import {
  defineEnergyPresence,
  presenceAtOrAbove,
  presenceAtOrBelow,
  createPresenceStrategy,
  resolveEnergyPresence,
} from '@kumbatio/energy-system'

// Explicit map: hide the AI chat at 50 and below, mute it at 75
const aiChatPresence = defineEnergyPresence({
  default: 'visible',
  75: 'muted',
  50: 'hidden',
  25: 'hidden',
  0: 'hidden',
})

// Shorthands
const composerTools = presenceAtOrAbove(50) // hidden at 25 and 0
const recoveryHint = presenceAtOrBelow(25) // low-energy-only affordance

// Resolve anywhere
resolveEnergyPresence(aiChatPresence, 50) // 'hidden'

// Or lift into a strategy and resolve through the engine
const aiChat = createPresenceStrategy('ai-chat', aiChatPresence)
engine.resolve(aiChat) // 'visible' | 'muted' | 'hidden'
```

In React, `<EnergyGate>` applies a presence declaration to a subtree:

```tsx
import { EnergyGate } from '@kumbatio/energy-system/react'

// Shorthand: needs at least 75 energy
<EnergyGate min={75}>
  <AiChatPanel />
</EnergyGate>

// Full map; function children receive the resolved presence so 'muted'
// can style itself
<EnergyGate presence={aiChatPresence} fallback={<QuietPlaceholder />}>
  {(presence) => <AiChatPanel muted={presence === 'muted'} />}
</EnergyGate>
```

Hidden subtrees keep their state. Energy moves up and down, so a gate that
destroyed its children would throw away a half-written message every time
capacity dipped. `<EnergyGate>` hides through React 19.2's `<Activity>`:
component state, DOM and scroll position survive, effects are torn down while
hidden and re-run on reveal, and hidden content is not server-rendered.

Opt out for subtrees whose cost is worth reclaiming — media, canvases, live
connections:

```tsx
<EnergyGate min={75} whenHidden="unmount">
  <VideoWall />
</EnergyGate>
```

CSS-only path — annotate elements with the range they belong to and the
stylesheet handles hiding as `data-energy-level` changes:

```html
<div data-energy-min="75">AI chat — needs 75+ energy</div>
<div data-energy-max="25">Recovery hint — low energy only</div>
```

## Focus sessions and the notification gate

These are the runtime half of the model: strategies _describe_ behavior,
the gate and session controller _enforce_ it.

```ts
import {
  createEnergyEngine,
  createNotificationGate,
  createFocusSessionController,
} from '@kumbatio/energy-system'

const engine = createEnergyEngine({ initialLevel: 75 })

// The gate enforces notificationStrategy: at 50 it batches every 5 minutes
// and only lets 'high'+ through; at 0 everything is deferred, not dropped.
const gate = createNotificationGate(engine, {
  onDeliver({ notifications, reason, channels }) {
    if (channels.visual) showToast(notifications, reason)
  },
})

gate.publish({ priority: 'high', payload: { title: 'Build finished' } })

// Focus sessions: time-boxed, auto-expiring suppression windows.
const focus = createFocusSessionController({ engine, gate })
focus.subscribe((event, session) => {
  if (event === 'break') showBreakNudge()
  if (event === 'end') showSessionSummary(session)
})

// Session length + break cadence default from the current energy level
// (expected productivity window / task-complexity guidance).
focus.start()
```

Two invariants are guaranteed by construction:

1. **Nothing is silently dropped.** A notification the current level does not
   admit is deferred and released when energy rises, suppression lifts, or the
   gate is disposed.
2. **Sessions always end.** Expiry is an emitted event (never a predicate you
   must poll), and suppression is lifted _before_ the end event fires, so an
   end-of-session notification can never be swallowed by the session itself.

## Deferral ("not now")

Deferring is an energy statement. Presets are pure `(now) => Date` functions;
`deferralStrategy` orders them by level so the one-tap default matches
capacity — at low energy the default is "tomorrow morning", not "in 1 hour".

```ts
import {
  createDeferralPresets,
  deferralStrategy,
  resolveDeferral,
  DEFERRAL_PRESET_IDS,
} from '@kumbatio/energy-system'

const presets = createDeferralPresets({ morningHour: 9, eveningHour: 18 })
const { defaultPresetId, orderedPresetIds } = engine.resolve(deferralStrategy)

const resurfaceAt = resolveDeferral(presets, defaultPresetId) // epoch ms
```

## Inbound demand and autonomy

**Inbound demand** is anything arriving from outside that asks for the user's
attention or action: an email, a document comment, a review request, a task
assignment, a collaboration invite.

Every triage system in general use is organised around properties of the
_message_ — who sent it, how urgent it claims to be, what category it fits.
None is organised around the state of the _recipient_, which is the thing that
actually decides whether an arrival is a small task or a crushing weight. This
is that variable, applied to the queue.

`demandAdmissionStrategy` resolves the policy; `resolveDemandOutcome` applies
it. Both are pure. The library performs no effects here — acknowledging an
originator means sending mail, posting a comment, or updating a status chip
depending on the app, and those are irreversible in ways an in-process runtime
cannot make transactional. The orchestration, with its ordering, retries, and
deduplication, belongs to the app.

```ts
import {
  autonomyStrategy,
  deferralStrategy,
  demandAdmissionStrategy,
  resolveDemandOutcome,
} from '@kumbatio/energy-system'

const outcome = resolveDemandOutcome(
  engine.resolve(demandAdmissionStrategy),
  engine.resolve(autonomyStrategy),
  {
    originatorTier: 'unknown', // 'exempt' | 'known' | 'unknown', assigned by your app
    bearsObligation: true, // does this ask something of the user?
    confidence: 0.9, // how sure are you? a deterministic rule reports 1
  },
)

switch (outcome.admission) {
  case 'live':
    return inbox.deliver(message)
  case 'acknowledge':
    // One act, never two. An acknowledgment without a capture is a promise
    // nobody kept; a capture without an acknowledgment leaves the originator in
    // silence. Capture first — it is the reversible half.
    await tasks.capture(message, engine.resolve(deferralStrategy).defaultPresetId)
    return replies.acknowledge(message, outcome.acknowledgment)
  case 'silent':
    return tasks.capture(message, engine.resolve(deferralStrategy).defaultPresetId)
}
```

Two rules are worth stating outright, because each blocks a specific failure:

1. **The exempt tier is never handled by machine.** At every level, an exempt
   originator is admitted live. This is also what defuses the gaming risk: an
   originator who learns an acknowledgment means "deprioritised" and escalates
   elsewhere only succeeds if their escalation is one the user cannot ignore —
   which is what makes them exempt.
2. **Acknowledgments report state, never intent.** "Received and queued,
   current response horizon early next week" is a fact. "I'll get back to you
   soon" is a promise the user's Tuesday self has to keep. The horizon comes
   from `deferralStrategy`, so the queue and the acknowledgment cannot disagree.

Disclosure is the app's job in the app's own medium — an `Auto-Submitted:
auto-replied` header, an "auto-queued" badge, a system-attributed status. An
automated action toward a third party must be identifiable as automated.

### Autonomy

`autonomyStrategy` is the mirror of `interactionForgivenessStrategy`:
forgiveness protects against the _user's_ mistakes at low energy, autonomy
against the _agent's_. It is useful to any consumer with agentic surfaces, with
or without demand admission.

```ts
const { confidenceThreshold, allowGeneratedContent, maxUnattendedSteps } =
  engine.resolve(autonomyStrategy)
```

What narrows as energy falls is _discretion_, not action. At rest the
confidence threshold is `1`, which admits only certainty — rule-based actions,
never a judgment call — and `maxUnattendedSteps` is `1`. Automation may still
take a single, certain, template-only step, which is exactly the shape of an
out-of-office reply. It may not chain steps or improvise wording. The system
acts for the user precisely when they are least able to supervise it, so the
worst day is the wrong day for it to get creative.

## Quick start (DOM)

```ts
import {
  applyEnergyLevel,
  observeEnergyLevel,
} from '@kumbatio/energy-system/dom'

applyEnergyLevel(50)

const cleanup = observeEnergyLevel((state, prev) => {
  console.log(`Energy: ${prev.level} -> ${state.level}`)
})
```

## CSS usage

Import the reference stylesheet:

```ts
import '@kumbatio/energy-system/css'
```

Then use classes like:

- `.energy-chrome`
- `.energy-sidebar`
- `.energy-tab-bar`
- `.energy-status-bar`
- `.energy-toolbar`
- `.energy-content`

And presence attributes:

- `data-energy-min="75"` — element hides whenever the current level is below 75
- `data-energy-max="25"` — element hides whenever the current level is above 25
- `data-energy-presence="muted" | "hidden"` — hooks for JS-resolved presence
  (`--energy-muted-opacity` controls the muted treatment)

The stylesheet honours `prefers-reduced-motion` for its own transitions; apps
animating presence changes should do the same.

## API map

### Core package

- `createEnergyEngine(options?)`
- `getEnergyLevels()`, `getEnergyLevel(level)`
- `cycleEnergyLevel(level)`, `isEnergyLevel(value)`, `isEnergySource(value)`
- `createExternalLevelCompatibility(options)`
- `cycleDiscreteLevel(current, levels, fallback)`
- `mapToNearestDiscreteLevel(value, levels, fallback)`
- `mapToNearestEnergyLevel(value)`
- Strategies: `uiVisibilityStrategy`, `notificationStrategy`,
  `taskComplexityStrategy`, `interactionForgivenessStrategy`, `deferralStrategy`,
  `autonomyStrategy`, `demandAdmissionStrategy`
- Presence: `defineEnergyPresence(spec)`, `presenceAtOrAbove(min, below?)`,
  `presenceAtOrBelow(max, above?)`, `resolveEnergyPresence(map, level)`,
  `isPresenceVisible(presence)`, `isEnergyPresence(value)`,
  `createPresenceStrategy(name, map)`
- Focus sessions: `createFocusSessionController(options?)`,
  `sessionRemainingMs(session, now?)`, `isSessionExpired(session, now?)`
- Notification gate: `createNotificationGate(engine, options)`,
  `resolveNotificationOutcome(config, priority, suppressed)`,
  `isNotificationPriority(value)`
- Deferral: `createDeferralPresets(options?)`, `resolveDeferral(presets, id, now?)`,
  `DEFERRAL_PRESET_IDS`
- Demand admission: `resolveDemandOutcome(config, autonomy, demand)`,
  `isOriginatorTier(value)`
- Types: `EnergyLevel`, `EnergyState`, `EnergyPresence`, `EnergyPresenceMap`,
  `AdaptationStrategy`, `FocusSession`, `NotificationDelivery`, etc.

### `@kumbatio/energy-system/react`

- `EnergyProvider`
- `useEnergyState()`
- `useEnergyLevel()`
- `useEnergyLevelCycler()`
- `useStrategy(strategy)`
- `useEnergyGate(minLevel)`
- `useEnergyPresence(presenceMap)`
- `EnergyGate` (presence-gated subtree: `presence` map or `min`/`max` shorthand;
  `whenHidden` is `'preserve'` by default, `'unmount'` to drop the subtree)
- `EnergyIndicator`

### `@kumbatio/energy-system/persistence`

- `localStoragePersistence(key?)`
- `memoryPersistence(initial?)`

### `@kumbatio/energy-system/dom`

- `applyEnergyLevel(level, root?)`
- `readEnergyLevel(root?)`
- `observeEnergyLevel(listener, root?)`

### Additional APIs

- `createEnergyEngine({ clock })` - inject a deterministic time source
- `createEnergyEngine({ originId })` - inject a deterministic producer identity for tests
- `createEnergyEngine({ onPersistenceError })` - observe failed save attempts before retry
- `createEnergyEngine({ maxFutureSkewMs })` - reject hydrated/observed state stamped further
  ahead of the local clock than this budget (default 5 minutes; `Number.POSITIVE_INFINITY`
  accepts any finite timestamp). Guards reconciliation against contexts with bad clocks.
- `<EnergyProvider domTarget={() => document.documentElement}>` - project the level onto an element
  other than `<body>`, for stylesheets that key off `[data-energy-level]` at the root. The provider
  snapshots the target, layers overlapping providers, and restores the baseline on unmount.
- `createEnergyEngine({ autoStart: false })` + `engine.start()` - construct the engine without
  hydrating or subscribing to cross-context updates, then begin both explicitly. For engines
  built somewhere that may never be committed: `EnergyProvider` constructs during render and
  starts from an effect, so a render React discards leaves no stranded observer behind.
- `engine.flush()` - wait until the current state version is durably persisted; rejects if the
  engine is disposed or an unchanged initial state cannot be safely reconciled after a hydration
  read failure
- `engine.dispose()` - release engine-owned observation/subscription resources
- `EnergyPersistence.observe(onState)` - subscribe to external state changes
- `getEnergyMetrics(state, now?)` - derive productivity/break/task guidance metrics

## Migrating from legacy scales to native package levels

The package model is fixed to `100 | 75 | 50 | 25 | 0`.
If your existing app uses a different discrete scale (for example `100 | 66 | 33 | 0`),
use compatibility helpers during migration.

```ts
import {
  createExternalLevelCompatibility,
  cycleEnergyLevel,
} from '@kumbatio/energy-system'

const legacy = createExternalLevelCompatibility({
  levels: [100, 66, 33, 0] as const,
  toEnergyLevel: {
    100: 100,
    66: 50,
    33: 25,
    0: 0,
  },
  fallbackLevel: 100,
})

// Read legacy persisted values -> native package level
const nativeLevel = legacy.toEnergyLevel(66) // 50

// Keep old control cycle order while internally applying native levels
const nextNativeLevel = legacy.cycleMappedEnergyLevel(33) // maps next legacy level to native

// Once migration is complete, use native cycling directly
const next = cycleEnergyLevel(nativeLevel)
```

Recommended migration sequence:

1. **Read** legacy values through `createExternalLevelCompatibility(...).toEnergyLevel(...)`.
2. **Write** and persist native package levels (`100 | 75 | 50 | 25 | 0`).
3. **Switch UI controls** to native `cycleEnergyLevel`.
4. **Remove compatibility mapping** after persisted data is fully normalized.

## Persistence and reconciliation

Persisted states are validated strictly. A state must contain a legal level and source, a finite
non-negative timestamp, a non-negative integer revision, and a non-empty origin. Invalid records
are ignored rather than repaired into a more authoritative state.

The engine orders concurrent writes by timestamp, logical revision, source priority, and producer
origin. This gives every context the same deterministic winner even when two writes share a wall
clock timestamp. Local writes advance the logical revision when the clock does not advance.

The rule is exported as `isPreferredEnergyState(candidate, current)` and specified normatively in
[SPEC.md §4](./SPEC.md). It is the hardest part of the model to reimplement correctly, so it is
readable, testable, and covered by conformance vectors on its own rather than buried in the engine.

`setLevel()` updates in-memory subscribers synchronously. Persistence runs in the background with
bounded exponential backoff. Call `await engine.flush()` when a workflow must wait for durable
storage before reporting completion. An initial `flush()` waits for hydration before writing the
default state, and rejects rather than overwriting unread storage if that hydration read failed.

## Specification and conformance

The model is specified independently of this implementation.

- **[SPEC.md](./SPEC.md)** — the normative model: levels, state, reconciliation, the strategy
  contract, autonomy, inbound demand, the runtime invariants, and the accessibility requirements.
  Language-independent, RFC 2119 wording.
- **[spec/energy-state.schema.json](./spec/energy-state.schema.json)** — the interchange format, so
  two processes (or two languages) can share one person's energy state.
- **[conformance.json](./conformance.json)** — every table and every decision above, as vectors.
  Ships in the package.
- **[spec/conformance.schema.json](./spec/conformance.schema.json)** — the shape of that vector
  file, so a port can tell a file it can trust from one whose structure moved under it. Ships too,
  and the generator validates its own output against it.

```ts
import conformance from '@kumbatio/energy-system/conformance.json' with { type: 'json' }
```

An implementation in another language passes by loading the vectors and replaying them; this
package's own `test/conformance.test.ts` does exactly that and is a reasonable model to copy.

The file is generated from the built library, so the vectors cannot drift from the behavior they
describe. `pnpm run build` regenerates it; `pnpm test` recomputes it and fails if what is committed
differs, without rewriting anything. The two are deliberately separate — a check that regenerates
first is comparing a file to itself.

Vectors cover the pure surface: tables, and functions of their arguments alone. The stateful
guarantees — defer-never-drop, session auto-expiry, persistence ordering — are normative in SPEC.md
and checked by this package's suite, because no vector can express _and it must never drop one_.

## Stability

The API has been frozen since `1.0.0`. The package follows semver strictly, and for this package
that means more than the type signatures:

- **A shipped strategy table's values are API.** Changing what `notificationStrategy` returns at
  level 50 changes how every consumer behaves, so it is a major-version change — and a change to
  [SPEC.md](./SPEC.md), not just to this library.
- **The reconciliation rule is API.** Two implementations that disagree about it cannot share state.
- **The conformance vectors are the contract in machine-readable form.** Within a major version,
  existing vectors do not change meaning; new sections and new vectors may be added.
- Prose from `describe()` is _not_ covered. Wording is a product decision and may change in a patch.
- Adding a strategy, an option with a default, or a new export is a minor release.

## Development

```bash
pnpm run validate   # format, lint, types, tests, packaging — what CI runs
```

Individually:

```bash
pnpm run check-types
pnpm run lint
pnpm test           # compiles, then CHECKS the generated artifacts
pnpm run build      # compiles, then REGENERATES them
pnpm run pack:dry-run
```

`build` is the only thing that writes `api-surface.json` and `conformance.json`.
If a change to the library moves either, `pnpm test` fails and tells you to run
`pnpm run build` and commit the result — that is the intended loop, not a
warning to work around.

## Notes

This package is framework-agnostic at its core. Platform-specific persistence
adapters (e.g., SQLite-backed desktop stores) should live in consuming apps.

## Who uses this

- **[Anasa](https://anasa.md)** — Kumbatio's local-first writing and thinking workspace, in public alpha. Runs its entire adaptive shell on the engine: custom settings-backed persistence, energy-gated AI surfaces, notification filtering, and task-complexity guidance.
- **[Meltemi](https://meltemi.app)** — an email client in private beta from [entro314 labs](https://github.com/entro314-labs) (the studio behind Kumbatio), built outside the Kumbatio product line. Uses the notification gate (defer, never drop), focus sessions, deferral ordering, interaction forgiveness, and demand admission — integrated without the React adapter. Its demand binding is the reference one: originator tiers come from its VIP list, obligation is classified from RFC 3834 header evidence and its own sender lanes, acknowledgments go out as `Auto-Submitted: auto-replied` auto-replies, and the capture is a snooze to the horizon `deferralStrategy` picked.
- **[kumbat.io](https://kumbat.io)** — the site itself runs on this model; change the energy level there and watch the interface adapt.

The integration patterns these apps proved out are documented in the [Production Patterns guide](https://docs.kumbat.io/docs/energy-system/guides/production-patterns). If you ship something with `energy-system`, tell us: [hello@kumbat.io](mailto:hello@kumbat.io).

## Kumbatio

`energy-system` is the infrastructure layer of [Kumbatio](https://kumbat.io) — an ecosystem of open-source, neuroinclusive software built from lived experience with ADHD and depression. The position behind it, in one line: **energy ≠ time**, and software should adapt to real cognitive capacity instead of assuming a default brain.

- The full argument: [kumbat.io/manifesto](https://kumbat.io/manifesto) — agree? [Sign it](https://kumbat.io/endorse)
- Where this library is going: [ROADMAP.md](./ROADMAP.md)
- How to help: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Live demo: [kumbat.io](https://kumbat.io) adapts its entire interface with this model — move the energy control and watch

## License

[MIT](./LICENSE)

---

_energy-system supports self-management and workflow adaptation. It is not a medical device, diagnosis tool, or treatment._

# Changelog

All notable changes to `@kumbatio/energy-system` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and from `1.0.0` this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For this package, semver covers more than type signatures. **A shipped strategy
table's values are API**: changing what `notificationStrategy` returns at level
50 changes how every consumer behaves, so it is a major-version change — and a
change to [SPEC.md](./SPEC.md), not only to this library. The same is true of the
reconciliation rule, which two implementations must agree on to share state at
all. Prose returned by `describe()` is not covered; wording is a product decision.

## [2.0.0]

Corrections to `1.0.0`. No type signature changed, which is exactly why this is
a major: two of these change runtime behavior and one narrows an install range,
and for this package behavior is API — see the note at the top of this file.

Upgrading from `1.x`: the breaks are `react`/`@types/react` below 19.2 (which
never worked with the React entry point), persisted or exchanged states carrying
properties outside the published schema (previously trimmed in silence, now
rejected), and any code depending on a batched notification being delivered
after suppression started or after energy fell below its threshold.

### Fixed

- **The notification gate re-judges everything it is holding when energy or
  suppression changes.** A notification was classified once, when published,
  and an open batch window was then delivered under whatever policy happened to
  be in force later. So an intent admitted at Steady arrived in the middle of a
  focus session, and one batched at Steady was surfaced at Rest with every
  channel disabled. `flush()` bypassed active suppression the same way.
  Batched intents the current policy no longer admits are now moved to the
  deferred queue instead, and released when something admits them. The batch
  deadline is anchored to when the window opened, so a config change moves the
  deadline rather than restarting the wait.
- **External state is validated against the published JSON Schema exactly.**
  `createEnergyState()` accepted fractional timestamps, which
  [spec/energy-state.schema.json](./spec/energy-state.schema.json) does not
  allow, and persisted state carrying unknown properties was silently trimmed
  to fit rather than rejected — so two implementations could exchange a state
  and disagree about what they had exchanged. Persistence loads, cross-context
  observations and `memoryPersistence` now share one strict boundary parser.
- **A configured `originId` no longer corrupts the unproduced sentinel.**
  Construction stamped the configured producer identity onto the untouched
  default state, which SPEC.md §3.2 requires to stay distinguishable from a
  real one. `isUnproducedState()` returned `false` for it and
  `getEnergyMetrics()` reported an age measured from the epoch. The sentinel is
  now always `origin: "0-initial"`; the configured identity owns the first
  state the engine actually produces.
- **`api-surface.json` includes `EnergyEngine.resolve()`.** The declaration
  parser did not recognise generic members, so a public method was missing from
  the frozen surface — and a method absent from the freeze is a method nobody
  notices removing.

### Changed

- **React peer range is now `>=19.2.0`** for both `react` and `@types/react`.
  The React entry point imports `<Activity>`, added in React 19.2, so the
  previous `>=19` advertised a compatibility that throws on first render under
  19.0 and 19.1.
- **Generated artifacts are checked, not regenerated, during validation.**
  `pnpm test` used to run the full build first, so the drift guard compared
  `conformance.json` against a copy it had just written — it could not fail,
  whatever was committed. Generation now belongs to `pnpm run build`; both
  generators take `--check`, and both artifacts are verified by the suite.

### Added

- **[spec/conformance.schema.json](./spec/conformance.schema.json)** — the
  schema `conformance.json` has always pointed at via `$schema` and which did
  not exist. The generator now validates its own output against it before
  emitting, and it is exported from the package so the relative reference
  resolves for consumers.
- Packaged-consumer tests: the suite packs a tarball, unpacks it, and asserts
  that every `exports` target is present, that all four entry points import,
  that the conformance `$schema` reference resolves from the package root, and
  that the React peer floor matches the APIs the entry point imports.

## [1.0.0]

The API is frozen. Everything below documents what that commitment now covers.

### Added

- **[SPEC.md](./SPEC.md)** — the model specified independently of this
  implementation: levels, energy state, reconciliation, the strategy contract,
  autonomy, inbound demand, the runtime invariants, and the accessibility
  requirements. Language-independent and RFC 2119-worded, so an implementation in
  another language is an implementation of the same model rather than a port of
  this one.
- **[spec/energy-state.schema.json](./spec/energy-state.schema.json)** — the
  interchange format. Sharing one person's energy state across processes or
  languages is a wire-format problem, and this is the wire format.
- **[conformance.json](./conformance.json)** — 252 vectors plus every strategy
  table, generated from the built library on each build and shipped in the
  package. An implementation passes by loading and replaying them; a stale file
  fails this package's own build.
- `isPreferredEnergyState(candidate, current)` — the reconciliation rule, which
  was internal to the engine. It is the hardest part of the model to reimplement
  correctly, so it is now readable, testable, and covered by vectors on its own.
- Accessibility handling in the reference stylesheet for
  `prefers-contrast: more` and `forced-colors: active`. Both declare
  `!important` deliberately: `applyEnergyLevel()` writes the same custom
  properties inline, and a preference the person set must outrank a value the
  program computed.
- Coverage across every one of the 20 level transitions, in both directions, and
  across strategy composition — including the model's directional invariants
  (protection never decreases and automation never gains discretion as capacity
  falls), which a future edit to one table would otherwise break silently.

### Changed

- The reference stylesheet is explicit that its resting chrome opacities at Low
  and Rest do not meet WCAG 1.4.11, that this is a design default rather than a
  conformance claim, and that every value is an overridable custom property.
  Saying so is more useful than quietly shipping numbers that imply otherwise.
- `readOnlyCursor` is documented as a hint that reaches pointer users only, and
  which must be paired with actually disabling controls if "read only" is meant.

## [0.6.0]

### Added

- `autonomyStrategy` / `AutonomyConfig` — what automation may do unattended:
  confidence threshold, whether wording may be composed, and how many steps may
  chain. The mirror of interaction forgiveness, which protects against the
  _user's_ mistakes at low energy where this protects against the _agent's_.
  What narrows as energy falls is discretion, not action: at Rest the threshold
  is 1, admitting only certainty, and a single templated step is still allowed.
- `demandAdmissionStrategy` and the pure `resolveDemandOutcome` — an
  energy-resolved policy for arrivals that ask something of the person: reach
  them now, acknowledge and queue, or queue silently. Originator tiers, the
  exempt-tier invariant, and escalation to silence when a classification is not
  confident enough to speak. Policy only; the effects it implies leave the
  process and cannot be made transactional by an in-process runtime, so the
  orchestration belongs to the consuming app.

## [0.5.4]

### Added

- `createEnergyOrigin` exported from the index.

## [0.4.0]

Patterns studied in a field ADHD app and reimplemented as first-class, tested
primitives — including guarantees against the two failure modes observed in the
wild: suppressed reminders destroyed instead of deferred, and focus suppression
that never auto-expired.

### Added

- Presence annotation: `defineEnergyPresence`, `presenceAtOrAbove`,
  `presenceAtOrBelow`, `createPresenceStrategy`, `useEnergyPresence`,
  `<EnergyGate>`, and the CSS-only `data-energy-min` / `data-energy-max` path.
- Notification gate: runtime enforcement of `NotificationConfig` with a
  defer-not-drop guarantee.
- Focus sessions: time-boxed suppression with auto-expiry events and break nudges.
- Deferral presets with energy-aware ordering (`deferralStrategy`).
- Interaction forgiveness strategy.
- `prefers-reduced-motion` handling for the stylesheet's own transitions.

## [0.1.0]

### Changed

- Renamed to `@kumbatio/energy-system`; the previous package name is deprecated.

## [0.0.x]

Foundations: the 5-level model with immutable revisioned state, the
framework-agnostic engine with strategy resolution, the first three built-in
strategies, the DOM adapter, the React provider and hooks, persistence adapters
with external observation, deterministic clocks, derived metrics, and legacy
level compatibility mapping.

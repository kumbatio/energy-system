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

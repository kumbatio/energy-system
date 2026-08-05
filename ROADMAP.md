# Roadmap

`energy-system` is developed in the open, milestone by milestone. No dates — this project practices what it argues: output is a function of capacity, not calendar. Milestones are ordered; the top unchecked one is what's being worked on now.

## Shipped (v0.0.x)

- [x] 5-level energy model (`100 | 75 | 50 | 25 | 0`) with immutable, revisioned state
- [x] Framework-agnostic core engine with strategy resolution
- [x] Built-in strategies: UI visibility, notification filtering, task complexity guidance
- [x] DOM adapter (`data-energy-level` + CSS variables)
- [x] React provider, hooks, and headless render component
- [x] Persistence adapters (localStorage, in-memory) with external observation
- [x] Deterministic clock for testing/simulation
- [x] Derived metrics helper and legacy-level compatibility mapping
- [x] Published to npm

## M1 — Identity and polish (v0.1)

- [x] Rename package to `@kumbatio/energy-system` in the repo
- [x] Publish `@kumbatio/energy-system` to npm and deprecate the old name
- [x] API review pass: naming consistency, exhaustive level handling, error surfaces
- [x] CI: typecheck, lint, and tests on every PR

## Shipped (v0.4) — Presence annotation and behavioral runtime

Patterns studied in a field ADHD app (an email client that shipped focus
mode, universal snooze, and notification batching) and reimplemented here as
first-class, tested primitives — including guarantees against the two failure
modes observed in the wild (suppressed reminders destroyed instead of
deferred; focus suppression that never auto-expired).

- [x] Presence annotation: `EnergyPresence`/`EnergyPresenceMap` types,
      `defineEnergyPresence`, `presenceAtOrAbove`/`presenceAtOrBelow`,
      `createPresenceStrategy`, `useEnergyPresence`, `<EnergyGate>`, and the
      CSS-only `data-energy-min`/`data-energy-max` path
- [x] Notification gate: runtime enforcement of `NotificationConfig`
      (threshold, batch windows, suppression) with a defer-not-drop guarantee
- [x] Focus sessions: time-boxed suppression with auto-expiry events, break
      nudges, and energy-derived default duration/cadence
- [x] Deferral presets with energy-aware ordering (`deferralStrategy`)
- [x] Interaction forgiveness strategy (undo windows, destructive-action
      confirmation, autosave cadence scaled inversely with energy)
- [x] `prefers-reduced-motion` handling for the stylesheet's own transitions

## Shipped (v0.6) — Autonomy and inbound demand

The recipient's capacity applied to the queue that ignores it. Every triage
system in general use is organised around properties of the message; this is
the same question asked about the receiver. Policy only, and pure: the effects
an acknowledgment implies are irreversible in ways an in-process runtime cannot
make transactional, so the orchestration stays with the consuming app until a
second consumer proves what the shared machinery actually is.

- [x] Autonomy strategy: `AutonomyConfig`/`autonomyStrategy` — confidence
      threshold, generated-content permission, and unattended step budget,
      narrowing as energy falls. The mirror of interaction forgiveness:
      forgiveness protects against the user's errors, autonomy against the
      agent's
- [x] Inbound demand admission: `demandAdmissionStrategy` and the pure
      `resolveDemandOutcome`, with originator tiers, the exempt-tier invariant,
      and rule-4 escalation (an uncertain classification queues silently rather
      than acting)

## M2 — Documentation for real adoption

- [ ] Docs readable at energy `25`: short pages, one concept each, optional depth
- [ ] Example gallery: navbar, dashboard, form, and notification patterns at each level
- [ ] Adaptation strategy authoring guide

## M3 — Reference integration

- [x] Migrate [kumbat.io](https://kumbat.io) from its inline energy provider to this package — the site becomes the living integration test
- [x] Case study: what adaptation strategies survived contact with real use — [Production Patterns](https://docs.kumbat.io/docs/energy-system/guides/production-patterns), drawn from [Anasa](https://anasa.md) (public alpha) and [Meltemi](https://meltemi.app) (private beta, entro314 labs — built outside the Kumbatio product line)

## Shipped (v1.0) — Specification, conformance, and the API freeze

The model is now specified independently of this implementation, so an
implementation in another language is an implementation of the same model rather
than a port of this one. That was the prerequisite for every port anyone might
later want, and it is worth more than any single port would have been.

- [x] [SPEC.md](./SPEC.md): the normative, language-independent model — levels,
      state, reconciliation, the strategy contract, autonomy, inbound demand, the
      runtime invariants, and the accessibility requirements
- [x] [`spec/energy-state.schema.json`](./spec/energy-state.schema.json): the
      interchange format for sharing one person's state across processes/languages
- [x] [`conformance.json`](./conformance.json): 252 vectors + every strategy
      table, generated on each build and shipped in the package; a stale file
      fails the build
- [x] `isPreferredEnergyState` exported — the reconciliation rule was internal,
      and it is the hardest thing to reimplement correctly
- [x] API freeze and semver commitment, in which a shipped table's VALUES are
      API — see the Stability section of the README
- [x] Accessibility review of the shipped patterns: `prefers-contrast: more` and
      `forced-colors: active` handling, honest documentation of where the resting
      opacities stand against WCAG 1.4.11, and the requirements written into
      SPEC.md §10 so they bind ports too
- [x] Coverage across all 20 level transitions in both directions, strategy
      composition, and the model's directional invariants

## M5 — Beyond the current adapters

- [ ] Web-component / vanilla examples
- [ ] Additional framework adapter, chosen by adopter demand — open an issue to vote
- [ ] A first non-JavaScript implementation, when a real consumer needs one. The
      spec and vectors are what make that cheap, and the bet is that the first
      genuine demand is server-side rather than another UI framework — that is
      where the energy models which did NOT adopt this one already live.

## Continuously

- Issues and PRs from adopters take priority over roadmap order when they unblock a real shipped use
- Research translation: mapping the model against cognitive load and occupational health literature, correcting where it oversimplifies

## How to influence this

Open an issue. Adopters shipping real features get the loudest voice; sponsors get roadmap _input_, never veto — the [internal decision filter](https://kumbat.io/manifesto) outranks money.

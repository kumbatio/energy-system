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

## M2 — Documentation for real adoption

- [ ] Docs readable at energy `25`: short pages, one concept each, optional depth
- [ ] Example gallery: navbar, dashboard, form, and notification patterns at each level
- [ ] Adaptation strategy authoring guide

## M3 — Reference integration

- [x] Migrate [kumbat.io](https://kumbat.io) from its inline energy provider to this package — the site becomes the living integration test
- [ ] Case study: what adaptation strategies survived contact with real use

## M4 — v1.0 stable

- [ ] API freeze, semver commitment
- [ ] Accessibility review of shipped patterns (incl. `prefers-reduced-motion` interplay)
- [ ] Test coverage across every level transition and strategy composition

## M5 — Beyond the current adapters

- [ ] Web-component / vanilla examples
- [ ] Additional framework adapter, chosen by adopter demand — open an issue to vote

## Continuously

- Issues and PRs from adopters take priority over roadmap order when they unblock a real shipped use
- Research translation: mapping the model against cognitive load and occupational health literature, correcting where it oversimplifies

## How to influence this

Open an issue. Adopters shipping real features get the loudest voice; sponsors get roadmap _input_, never veto — the [internal decision filter](https://kumbat.io/manifesto) outranks money.

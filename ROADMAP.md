# Roadmap

`energy-system` is developed in the open, milestone by milestone. No dates — this project practices what it argues: output is a function of capacity, not calendar. Milestones are ordered; the top unchecked one is what's being worked on now.

## Shipped (v0.0.x)

- [x] 5-level energy model (`100 | 75 | 50 | 25 | 0`) with immutable state (`level`, `timestamp`, `source`)
- [x] Framework-agnostic core engine with strategy resolution
- [x] Built-in strategies: UI visibility, notification filtering, task complexity guidance
- [x] DOM adapter (`data-energy-level` + CSS variables)
- [x] React provider, hooks, and headless render component
- [x] Persistence adapters (localStorage, in-memory) with external observation
- [x] Deterministic clock for testing/simulation
- [x] Derived metrics helper and legacy-level compatibility mapping
- [x] Published to npm

## M1 — Identity and polish (v0.1)

- [ ] Rename package to `@kumbatio/energy-system` (deprecate the old name on npm)
- [ ] API review pass: naming consistency, exhaustive level handling, error surfaces
- [ ] CI: typecheck, lint, and tests on every PR

## M2 — Documentation for real adoption

- [ ] Docs readable at energy `25`: short pages, one concept each, optional depth
- [ ] Example gallery: navbar, dashboard, form, and notification patterns at each level
- [ ] Adaptation strategy authoring guide

## M3 — Reference integration

- [ ] Migrate [kumbat.io](https://kumbat.io) from its inline energy provider to this package — the site becomes the living integration test
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

Open an issue. Adopters shipping real features get the loudest voice; sponsors get roadmap *input*, never veto — the [internal decision filter](https://kumbat.io/manifesto) outranks money.

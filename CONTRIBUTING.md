# Contributing

Thanks for being here. Contributions of every size are welcome — an issue describing where the model fails you is as valuable as a PR.

## Ground rules

This project is built by and for people with variable cognitive capacity. That shapes how we work:

- **No pressure, no pace-shaming.** Reviews happen when capacity allows — yours and ours. A PR sitting for a week is normal, not neglect.
- **Small contributions are first-class.** A typo fix, one adaptation strategy, one clarified sentence in the docs — all genuinely useful.
- **Say the hard thing kindly.** Direct technical criticism is welcome; judgment of people never is.
- **Disappearing is allowed.** If you start something and life happens, no explanation owed. Someone else can pick it up, or it waits.

## What we need most

1. **Adaptation strategies** — reusable `(level) → config` patterns for common UI situations (forms, dashboards, notifications, onboarding)
2. **Real-world reports** — you tried the SDK in an actual app: what worked, what fought you
3. **Docs written for energy `25`** — if a doc page needed peak capacity to understand, that's a bug; file it
4. **Model criticism** — places where the 5-level model oversimplifies, with the scenario that breaks it

## Process

1. **Bugs / ideas / criticism:** open an issue. Templates keep it short; the minimum viable issue is two sentences.
2. **Code:** fork → branch → PR. For anything bigger than a fix, open an issue first so nobody burns energy on a direction that won't merge.
3. **Every level transition is an edge case.** PRs touching core behavior need tests across all five levels.

## Development setup

```bash
pnpm install
pnpm test
pnpm build
```

## The decision filter

Every feature must pass the same filter the products do:

- Does it reduce cognitive load or add to it?
- Does it improve agency or apply pressure?
- Does it help at low energy, not just at peak?
- Does it work without judging?

If a proposal fails most of these, it won't merge regardless of technical quality — worth knowing before you build it.

## Conduct

Be the kind of contributor this project exists for others to have. Harassment, shame-framing, and gatekeeping get one warning, then removal. Contact: [hello@kumbat.io](mailto:hello@kumbat.io).

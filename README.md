# @kumbatio/energy-system

Framework-agnostic TypeScript library for building **energy-aware applications**.

Instead of adapting software to clock time, adapt behavior to current cognitive capacity.
`energy-system` models energy as explicit state and resolves strategies from that state.

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
- DOM adapter (`data-energy-level` + CSS variables)
- React provider, hooks, and headless render component
- Persistence adapters (`localStorage`, in-memory)
- Deterministic clock support for testing/simulation
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

## API map

### Core package

- `createEnergyEngine(options?)`
- `getEnergyLevels()`, `getEnergyLevel(level)`
- `cycleEnergyLevel(level)`, `isEnergyLevel(value)`, `isEnergySource(value)`
- `createExternalLevelCompatibility(options)`
- `cycleDiscreteLevel(current, levels, fallback)`
- `mapToNearestDiscreteLevel(value, levels, fallback)`
- `mapToNearestEnergyLevel(value)`
- Strategies: `uiVisibilityStrategy`, `notificationStrategy`, `taskComplexityStrategy`
- Types: `EnergyLevel`, `EnergyState`, `AdaptationStrategy`, etc.

### `@kumbatio/energy-system/react`

- `EnergyProvider`
- `useEnergyState()`
- `useEnergyLevel()`
- `useEnergyLevelCycler()`
- `useStrategy(strategy)`
- `useEnergyGate(minLevel)`
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
- `engine.flush()` - wait until the current state version is durably persisted
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

`setLevel()` updates in-memory subscribers synchronously. Persistence runs in the background with
bounded exponential backoff. Call `await engine.flush()` when a workflow must wait for durable
storage before reporting completion.

## Development

```bash
pnpm run check-types
pnpm run lint
pnpm test
pnpm run build
pnpm run pack:dry-run
```

## Notes

This package is framework-agnostic at its core. Platform-specific persistence
adapters (e.g., SQLite-backed desktop stores) should live in consuming apps.

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

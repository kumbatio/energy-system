# @entro314-labs/energy-system

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

For the longer personal background and motivation (including ADHD/depression context), see
`ENERGY_SYSTEM.md`.

## Features

- 5-level energy model: `100 | 75 | 50 | 25 | 0`
- Rich state object: `level`, `timestamp`, `source`
- Framework-agnostic core engine
- Strategy system for behavior adaptation
- Built-in strategies:
  - UI visibility
  - Notification filtering
  - Task complexity guidance
- DOM adapter (`data-energy-level` + CSS variables)
- React provider, hooks, and headless render component
- Persistence adapters (`localStorage`, in-memory)

## Installation

```bash
pnpm add @entro314-labs/energy-system
```

React integration is optional and provided via `@entro314-labs/energy-system/react`.

## Quick start (core)

```ts
import {
  createEnergyEngine,
  uiVisibilityStrategy,
  notificationStrategy,
} from '@entro314-labs/energy-system'
import { localStoragePersistence } from '@entro314-labs/energy-system/persistence'

const engine = createEnergyEngine({
  initialLevel: 75,
  persistence: localStoragePersistence(),
})

engine.setLevel(50)

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
} from '@entro314-labs/energy-system/react'
import { uiVisibilityStrategy } from '@entro314-labs/energy-system'

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
import { applyEnergyLevel, observeEnergyLevel } from '@entro314-labs/energy-system/dom'

applyEnergyLevel(50)

const cleanup = observeEnergyLevel((state, prev) => {
  console.log(`Energy: ${prev.level} -> ${state.level}`)
})
```

## CSS usage

Import the reference stylesheet:

```ts
import '@entro314-labs/energy-system/css'
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
- `cycleEnergyLevel(level)`, `isEnergyLevel(value)`
- Strategies: `uiVisibilityStrategy`, `notificationStrategy`, `taskComplexityStrategy`
- Types: `EnergyLevel`, `EnergyState`, `AdaptationStrategy`, etc.

### `@entro314-labs/energy-system/react`

- `EnergyProvider`
- `useEnergyState()`
- `useEnergyLevel()`
- `useEnergyLevelCycler()`
- `useStrategy(strategy)`
- `useEnergyGate(minLevel)`
- `EnergyIndicator`

### `@entro314-labs/energy-system/persistence`

- `localStoragePersistence(key?)`
- `memoryPersistence(initial?)`

### `@entro314-labs/energy-system/dom`

- `applyEnergyLevel(level, root?)`
- `readEnergyLevel(root?)`
- `observeEnergyLevel(listener, root?)`

## Using this with a 4-level UI model

Some apps use a legacy scale (`100 | 66 | 33 | 0`) for controls like battery widgets.
A practical migration is:

- `100 -> 100`
- `66 -> 75`
- `33 -> 25` or `50` (based on whether your “deep work” mode should be stricter)
- `0 -> 0`

See `ENERGY_SYSTEM.md` for a product-style usage guide and integration framing.

## Development

```bash
pnpm run check-types
pnpm run build
pnpm run pack:dry-run
```

## Specification

Detailed architecture and rationale live in `SPEC.md`.

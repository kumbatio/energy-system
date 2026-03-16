import { createEnergyState, cycleEnergyLevel } from './levels'
import type {
  AdaptationStrategy,
  EnergyChangeListener,
  EnergyLevel,
  EnergyPersistence,
  EnergySource,
  EnergyState,
} from './types'

export interface EnergyEngineOptions {
  initialLevel?: EnergyLevel
  persistence?: EnergyPersistence
  onChange?: EnergyChangeListener
}

export interface EnergyEngine {
  /** Get current energy state */
  getState(): EnergyState
  /** Set energy level with optional source */
  setLevel(level: EnergyLevel, source?: EnergySource): void
  /** Cycle to next energy level */
  cycleLevel(): void
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(listener: EnergyChangeListener): () => void
  /** Resolve a strategy against current energy state */
  resolve<T>(strategy: AdaptationStrategy<T>): T
  /** Load persisted state (called automatically, but can be called manually) */
  hydrate(): Promise<void>
}

export function createEnergyEngine(options: EnergyEngineOptions = {}): EnergyEngine {
  const { initialLevel = 100, persistence, onChange } = options
  const listeners = new Set<EnergyChangeListener>()

  let state: EnergyState = createEnergyState(initialLevel, 'manual')

  function notify(prev: EnergyState): void {
    onChange?.(state, prev)
    for (const listener of listeners) {
      listener(state, prev)
    }
  }

  const engine: EnergyEngine = {
    getState() {
      return state
    },

    setLevel(level, source = 'manual') {
      const prev = state
      state = createEnergyState(level, source)
      void persistence?.save(state)
      notify(prev)
    },

    cycleLevel() {
      engine.setLevel(cycleEnergyLevel(state.level), 'manual')
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    resolve<T>(strategy: AdaptationStrategy<T>): T {
      return strategy.resolve(state.level)
    },

    async hydrate() {
      if (!persistence) return
      const stored = await persistence.load()
      if (stored) {
        const prev = state
        state = stored
        notify(prev)
      }
    },
  }

  // Auto-hydrate from persistence
  if (persistence) {
    void engine.hydrate()
  }

  return engine
}

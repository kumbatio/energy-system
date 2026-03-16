import { createEnergyState, cycleEnergyLevel, isEnergyLevel } from './levels'
import type {
  AdaptationStrategy,
  EnergyClock,
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
  /** Deterministic time source for tests/simulations */
  clock?: EnergyClock | (() => number)
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

function resolveNow(clock?: EnergyEngineOptions['clock']): () => number {
  if (typeof clock === 'function') return clock
  if (clock?.now) return () => clock.now()
  return () => Date.now()
}

function isSameState(a: EnergyState, b: EnergyState): boolean {
  return a.level === b.level && a.timestamp === b.timestamp && a.source === b.source
}

function normalizeState(candidate: EnergyState, now: () => number): EnergyState {
  if (!isEnergyLevel(candidate.level)) {
    throw new Error(`Invalid energy level from persistence: ${String(candidate.level)}`)
  }

  const timestamp = Number.isFinite(candidate.timestamp) ? candidate.timestamp : now()
  const source: EnergySource =
    candidate.source === 'scheduled' || candidate.source === 'inferred' ? candidate.source : 'manual'

  return {
    level: candidate.level,
    timestamp,
    source,
  }
}

export function createEnergyEngine(options: EnergyEngineOptions = {}): EnergyEngine {
  const { initialLevel = 100, persistence, onChange, clock } = options
  const now = resolveNow(clock)
  const listeners = new Set<EnergyChangeListener>()
  let isSaving = false

  let state: EnergyState = createEnergyState(initialLevel, 'manual', now())

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
      const next = createEnergyState(level, source, now())
      if (isSameState(next, state)) return

      const prev = state
      state = next

      if (persistence) {
        isSaving = true
        void persistence
          .save(state)
          .catch((err: unknown) => {
            console.error('[energy-system] Failed to persist energy state', err)
          })
          .finally(() => {
            isSaving = false
          })
      }

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
        const normalized = normalizeState(stored, now)
        if (isSameState(normalized, state)) return

        const prev = state
        state = normalized
        notify(prev)
      }
    },
  }

  // Auto-hydrate from persistence
  if (persistence) {
    void engine.hydrate()
  }

  if (persistence?.observe) {
    persistence.observe((externalState) => {
      if (isSaving) return

      const normalized = normalizeState(externalState, now)
      if (isSameState(normalized, state)) return

      const prev = state
      state = normalized
      notify(prev)
    })
  }

  return engine
}

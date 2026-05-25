import { createEnergyState, cycleEnergyLevel, isEnergyLevel, isEnergySource } from './levels.js'
import type {
  AdaptationStrategy,
  EnergyClock,
  EnergyChangeListener,
  EnergyLevel,
  EnergyPersistence,
  EnergySource,
  EnergyState,
} from './types.js'

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
  /** Release engine-owned subscriptions/resources */
  dispose(): void
}

function logEngineError(message: string, err: unknown): void {
  console.error(`[energy-system] ${message}`, err)
}

function resolveNow(clock?: EnergyEngineOptions['clock']): () => number {
  if (typeof clock === 'function') return clock
  if (clock?.now) return () => clock.now()
  return () => Date.now()
}

function isSameState(a: EnergyState, b: EnergyState): boolean {
  return a.level === b.level && a.timestamp === b.timestamp && a.source === b.source
}

function getSourcePriority(source: EnergySource): number {
  switch (source) {
    case 'manual':
      return 3
    case 'scheduled':
      return 2
    case 'inferred':
      return 1
  }
}

function isPreferredExternalState(candidate: EnergyState, current: EnergyState): boolean {
  if (candidate.timestamp !== current.timestamp) {
    return candidate.timestamp > current.timestamp
  }

  if (candidate.source !== current.source) {
    return getSourcePriority(candidate.source) > getSourcePriority(current.source)
  }

  return false
}

function normalizeState(candidate: EnergyState, now: () => number): EnergyState {
  if (!isEnergyLevel(candidate.level)) {
    throw new Error(`Invalid energy level from persistence: ${String(candidate.level)}`)
  }

  const timestamp = Number.isFinite(candidate.timestamp) ? candidate.timestamp : now()
  const source: EnergySource = isEnergySource(candidate.source) ? candidate.source : 'manual'

  return createEnergyState(candidate.level, source, timestamp)
}

export function createEnergyEngine(options: EnergyEngineOptions = {}): EnergyEngine {
  const { initialLevel = 100, persistence, onChange, clock } = options
  const now = resolveNow(clock)
  const listeners = new Set<EnergyChangeListener>()
  let stateVersion = 0
  let disposed = false

  let state: EnergyState = createEnergyState(initialLevel, 'manual', now())
  let persistedVersion = 0
  let requestedPersistVersion = 0
  let persistTask: Promise<void> | undefined
  let persistRetryTimer: ReturnType<typeof setTimeout> | undefined

  function queuePersist(): void {
    if (!persistence || disposed) return

    requestedPersistVersion = Math.max(requestedPersistVersion, stateVersion)

    if (persistTask) return

    persistTask = (async () => {
      while (!disposed && persistedVersion < requestedPersistVersion) {
        const snapshot = state
        const snapshotVersion = stateVersion

        try {
          await persistence.save(snapshot)
          persistedVersion = Math.max(persistedVersion, snapshotVersion)
        } catch (err: unknown) {
          logEngineError('Failed to persist energy state', err)
          persistTask = undefined

          if (!disposed && !persistRetryTimer && persistedVersion < requestedPersistVersion) {
            persistRetryTimer = setTimeout(() => {
              persistRetryTimer = undefined
              queuePersist()
            }, 250)
          }

          return
        }
      }

      persistTask = undefined

      if (!disposed && persistedVersion < requestedPersistVersion) {
        queuePersist()
      }
    })()
  }

  function notify(prev: EnergyState): void {
    if (onChange) {
      try {
        onChange(state, prev)
      } catch (err: unknown) {
        logEngineError('onChange listener threw', err)
      }
    }

    for (const listener of listeners) {
      try {
        listener(state, prev)
      } catch (err: unknown) {
        logEngineError('Energy subscriber threw', err)
      }
    }
  }

  function applyState(next: EnergyState): boolean {
    if (isSameState(next, state)) return false

    const prev = state
    state = next
    stateVersion += 1
    notify(prev)
    if (persistence) {
      queuePersist()
    }
    return true
  }

  let disposePersistenceObservation = () => {}

  const engine: EnergyEngine = {
    getState() {
      return state
    },

    setLevel(level, source = 'manual') {
      const next = createEnergyState(level, source, now())
      if (!applyState(next)) return
    },

    cycleLevel() {
      engine.setLevel(cycleEnergyLevel(state.level), 'manual')
    },

    subscribe(listener) {
      if (disposed) {
        return () => {}
      }

      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    resolve<T>(strategy: AdaptationStrategy<T>): T {
      return strategy.resolve(state.level)
    },

    async hydrate() {
      if (!persistence || disposed) return

      const hydrateStartVersion = stateVersion
      let stored: EnergyState | null

      try {
        stored = await persistence.load()
      } catch (err: unknown) {
        logEngineError('Failed to load persisted energy state', err)
        return
      }

      if (!stored || disposed) return

      let normalized: EnergyState

      try {
        normalized = normalizeState(stored, now)
      } catch (err: unknown) {
        logEngineError('Ignoring invalid persisted energy state', err)
        return
      }

      if (isSameState(normalized, state)) return

      if (hydrateStartVersion === stateVersion || isPreferredExternalState(normalized, state)) {
        applyState(normalized)
      }
    },

    dispose() {
      if (disposed) return

      disposed = true
      disposePersistenceObservation()
      if (persistRetryTimer) {
        clearTimeout(persistRetryTimer)
        persistRetryTimer = undefined
      }
      listeners.clear()
    },
  }

  // Auto-hydrate from persistence
  if (persistence) {
    void engine.hydrate().catch((err: unknown) => {
      logEngineError('Unexpected hydrate failure', err)
    })
  }

  if (persistence?.observe) {
    try {
      disposePersistenceObservation = persistence.observe((externalState) => {
        if (disposed) return

        let normalized: EnergyState

        try {
          normalized = normalizeState(externalState, now)
        } catch (err: unknown) {
          logEngineError('Ignoring invalid observed energy state', err)
          return
        }

        if (!isPreferredExternalState(normalized, state)) return

        applyState(normalized)
      })
    } catch (err: unknown) {
      logEngineError('Failed to subscribe to persistence observation', err)
    }
  }

  return engine
}

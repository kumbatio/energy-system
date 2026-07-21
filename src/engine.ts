import {
  createEnergyOrigin,
  createEnergyState,
  cycleEnergyLevel,
  isEnergyLevel,
  isEnergySource,
} from './levels.js'
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
  /** Called when a persistence attempt fails before the engine schedules a retry. */
  onPersistenceError?: (error: unknown, state: EnergyState) => void
  /** Deterministic time source for tests/simulations */
  clock?: EnergyClock | (() => number)
  /** Stable producer identity for deterministic reconciliation. Primarily useful in tests. */
  originId?: string
  /**
   * Maximum tolerated future clock skew (ms) for externally supplied state
   * (hydration and cross-context observation). States stamped further ahead of
   * the local clock are rejected so one bad clock cannot win reconciliation
   * until its timestamp passes. Pass Number.POSITIVE_INFINITY to accept any
   * finite timestamp. Default: 5 minutes.
   */
  maxFutureSkewMs?: number
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
  /**
   * Wait until the current state version is durably persisted.
   * Rejects if the engine is disposed or an unchanged initial state cannot be
   * reconciled because its persistence hydration read failed.
   */
  flush(): Promise<void>
  /** Release engine-owned subscriptions/resources */
  dispose(): void
}

function logEngineError(message: string, err: unknown): void {
  console.error(`[energy-system] ${message}`, err)
}

const PERSIST_RETRY_INITIAL_MS = 250
const PERSIST_RETRY_MAX_MS = 30_000
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60_000

function resolveNow(clock?: EnergyEngineOptions['clock']): () => number {
  if (typeof clock === 'function') return clock
  if (clock?.now) return () => clock.now()
  return () => Date.now()
}

function isSameState(a: EnergyState, b: EnergyState): boolean {
  return (
    a.level === b.level &&
    a.timestamp === b.timestamp &&
    a.source === b.source &&
    a.revision === b.revision &&
    a.origin === b.origin
  )
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

  if (candidate.revision !== current.revision) {
    return candidate.revision > current.revision
  }

  if (candidate.source !== current.source) {
    return getSourcePriority(candidate.source) > getSourcePriority(current.source)
  }

  if (candidate.origin !== current.origin) {
    return candidate.origin > current.origin
  }

  // A producer must not reuse an identity for different state. Keep a final
  // deterministic fallback so malformed duplicate identities still converge.
  if (candidate.level !== current.level) {
    return candidate.level > current.level
  }

  return false
}

function normalizeState(
  candidate: EnergyState,
  nowMs: number,
  maxFutureSkewMs: number,
): EnergyState {
  if (!isEnergyLevel(candidate.level)) {
    throw new Error(`Invalid energy level from persistence: ${String(candidate.level)}`)
  }

  if (!isEnergySource(candidate.source)) {
    throw new Error(`Invalid energy source from persistence: ${String(candidate.source)}`)
  }

  if (candidate.timestamp - nowMs > maxFutureSkewMs) {
    throw new Error(
      `Energy state timestamp ${String(candidate.timestamp)} exceeds local clock by more than ${String(maxFutureSkewMs)}ms`,
    )
  }

  return createEnergyState(
    candidate.level,
    candidate.source,
    candidate.timestamp,
    candidate.revision,
    candidate.origin,
  )
}

export function createEnergyEngine(options: EnergyEngineOptions = {}): EnergyEngine {
  const {
    initialLevel = 100,
    persistence,
    onChange,
    onPersistenceError,
    clock,
    originId = createEnergyOrigin(),
    maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
  } = options

  if (
    typeof maxFutureSkewMs !== 'number' ||
    (!Number.isFinite(maxFutureSkewMs) && maxFutureSkewMs !== Number.POSITIVE_INFINITY) ||
    maxFutureSkewMs < 0
  ) {
    throw new Error(`Invalid maxFutureSkewMs: ${String(maxFutureSkewMs)}`)
  }

  const now = resolveNow(clock)
  const listeners = new Set<EnergyChangeListener>()
  const notificationQueue: Array<{ next: EnergyState; prev: EnergyState }> = []
  let stateVersion = 0
  let disposed = false
  let isNotifying = false

  let state: EnergyState = createEnergyState(initialLevel, 'manual', now(), 0, originId)
  // Version 0 is the initial in-memory state, not proof that a persistence
  // adapter has durably stored it. Starting below the version domain keeps
  // flush() honest even before the first state transition.
  let persistedVersion = -1
  let requestedPersistVersion = 0
  let persistTask: Promise<void> | undefined
  let persistRetryTimer: ReturnType<typeof setTimeout> | undefined
  let persistRetryDelayMs = PERSIST_RETRY_INITIAL_MS
  let initialHydrationTask: Promise<void> | undefined
  let hasCompletedPersistenceLoad = false
  let persistenceLoadError: unknown
  const persistWaiters: Array<{
    version: number
    resolve: () => void
    reject: (error: Error) => void
  }> = []

  function resolvePersistWaiters(): void {
    for (let index = persistWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = persistWaiters[index]
      if (waiter && waiter.version <= persistedVersion) {
        persistWaiters.splice(index, 1)
        waiter.resolve()
      }
    }
  }

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
          persistRetryDelayMs = PERSIST_RETRY_INITIAL_MS
          resolvePersistWaiters()
        } catch (err: unknown) {
          logEngineError('Failed to persist energy state', err)
          if (onPersistenceError) {
            try {
              onPersistenceError(err, snapshot)
            } catch (err: unknown) {
              logEngineError('onPersistenceError callback threw', err)
            }
          }
          persistTask = undefined

          if (!disposed && !persistRetryTimer && persistedVersion < requestedPersistVersion) {
            const retryDelayMs = persistRetryDelayMs
            // Exponential backoff so a persistently failing store (e.g. quota
            // exceeded) is not hammered every 250ms forever.
            persistRetryDelayMs = Math.min(persistRetryDelayMs * 2, PERSIST_RETRY_MAX_MS)
            persistRetryTimer = setTimeout(() => {
              persistRetryTimer = undefined
              queuePersist()
            }, retryDelayMs)
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

  function notify(next: EnergyState, prev: EnergyState): void {
    notificationQueue.push({ next, prev })
    if (isNotifying) return

    isNotifying = true
    try {
      while (notificationQueue.length > 0) {
        const transition = notificationQueue.shift()
        if (!transition) continue

        if (onChange) {
          try {
            onChange(transition.next, transition.prev)
          } catch (err: unknown) {
            logEngineError('onChange listener threw', err)
          }
        }

        const transitionListeners = [...listeners]
        for (const listener of transitionListeners) {
          try {
            listener(transition.next, transition.prev)
          } catch (err: unknown) {
            logEngineError('Energy subscriber threw', err)
          }
        }
      }
    } finally {
      isNotifying = false
    }
  }

  function applyState(next: EnergyState): boolean {
    // A disposed engine is inert: it must not mutate state, notify onChange,
    // or schedule persistence after its resources were released.
    if (disposed || isSameState(next, state)) return false

    const prev = state
    state = next
    stateVersion += 1
    notify(next, prev)
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
      if (disposed) return

      const wallTime = now()
      let timestamp = Math.max(wallTime, state.timestamp)
      let revision = 0

      if (timestamp === state.timestamp) {
        if (state.revision === Number.MAX_SAFE_INTEGER) {
          // Preserve a strictly newer ordering key without producing an
          // invalid revision when a deterministic/future clock cannot advance.
          timestamp += 1
        } else {
          revision = state.revision + 1
        }
      }

      applyState(createEnergyState(level, source, timestamp, revision, originId))
    },

    cycleLevel() {
      if (disposed) return
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
        hasCompletedPersistenceLoad = true
        persistenceLoadError = undefined
      } catch (err: unknown) {
        persistenceLoadError = err
        logEngineError('Failed to load persisted energy state', err)
        return
      }

      if (!stored || disposed) return

      let normalized: EnergyState

      try {
        normalized = normalizeState(stored, now(), maxFutureSkewMs)
      } catch (err: unknown) {
        logEngineError('Ignoring invalid persisted energy state', err)
        return
      }

      if (isSameState(normalized, state)) return

      if (hydrateStartVersion === stateVersion || isPreferredExternalState(normalized, state)) {
        applyState(normalized)
      }
    },

    async flush() {
      if (!persistence) return
      if (disposed) {
        throw new Error('Cannot flush a disposed energy engine')
      }

      // Do not persist the default state over an unread stored value. Once a
      // local/external transition exists, that newer intent can persist
      // immediately; an unchanged initial state must wait for auto-hydration.
      if (stateVersion === 0 && initialHydrationTask) {
        await initialHydrationTask
      }

      if (disposed) {
        throw new Error('Cannot flush a disposed energy engine')
      }

      if (stateVersion === 0 && !hasCompletedPersistenceLoad) {
        throw new Error(
          'Cannot flush the initial energy state because persistence hydration did not complete',
          { cause: persistenceLoadError },
        )
      }

      const targetVersion = stateVersion
      if (persistedVersion >= targetVersion) return

      requestedPersistVersion = Math.max(requestedPersistVersion, targetVersion)
      const pending = new Promise<void>((resolve, reject) => {
        persistWaiters.push({ version: targetVersion, resolve, reject })
      })
      queuePersist()
      return pending
    },

    dispose() {
      if (disposed) return

      disposed = true
      try {
        disposePersistenceObservation()
      } catch (err: unknown) {
        logEngineError('Failed to release persistence observation', err)
      }
      if (persistRetryTimer) {
        clearTimeout(persistRetryTimer)
        persistRetryTimer = undefined
      }
      listeners.clear()
      notificationQueue.length = 0
      const disposeError = new Error('Energy engine disposed before persistence completed')
      for (const waiter of persistWaiters.splice(0)) {
        waiter.reject(disposeError)
      }
    },
  }

  // Auto-hydrate from persistence
  if (persistence) {
    initialHydrationTask = engine.hydrate().catch((err: unknown) => {
      logEngineError('Unexpected hydrate failure', err)
    })
  }

  if (persistence?.observe) {
    try {
      disposePersistenceObservation = persistence.observe((externalState) => {
        if (disposed) return

        let normalized: EnergyState

        try {
          normalized = normalizeState(externalState, now(), maxFutureSkewMs)
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

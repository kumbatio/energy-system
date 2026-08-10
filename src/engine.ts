import {
  UNPRODUCED_ORIGIN,
  UNPRODUCED_TIMESTAMP,
  createEnergyOrigin,
  createEnergyState,
  cycleEnergyLevel,
  parseExternalEnergyState,
} from './levels.js'
import { isPreferredEnergyState } from './reconcile.js'
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
  /**
   * Whether construction immediately hydrates from persistence and subscribes
   * to cross-context updates. Default: true.
   *
   * Pass false when the engine is constructed somewhere that may never be
   * committed — a React render, most notably — and call `start()` from a
   * lifecycle that only runs for trees React kept. Without this, a discarded
   * render leaves an engine nobody will ever dispose, holding a live
   * cross-context observer (a `storage` listener, for the localStorage
   * adapter) for the lifetime of the page.
   */
  autoStart?: boolean
}

export interface EnergyEngine {
  /**
   * Begin hydration and cross-context observation. Idempotent, and a no-op on
   * a disposed engine. Only needed when the engine was created with
   * `autoStart: false`.
   */
  start(): void
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

/**
 * Validate state that arrived from outside this engine. `candidate` is typed
 * as `EnergyState`, but it crossed a process, tab or storage boundary to get
 * here, so nothing about its runtime shape is guaranteed — it is parsed
 * against the published schema before anything else looks at it.
 */
function normalizeState(
  candidate: EnergyState,
  nowMs: number,
  maxFutureSkewMs: number,
): EnergyState {
  const parsed = parseExternalEnergyState(candidate)

  if (parsed.timestamp - nowMs > maxFutureSkewMs) {
    throw new Error(
      `Energy state timestamp ${String(parsed.timestamp)} exceeds local clock by more than ${String(maxFutureSkewMs)}ms`,
    )
  }

  return parsed
}

export function createEnergyEngine(options: EnergyEngineOptions = {}): EnergyEngine {
  const {
    initialLevel = 100,
    persistence,
    onChange,
    onPersistenceError,
    clock,
    maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
    autoStart = true,
  } = options

  /*
   * Deferred to the first state this engine actually produces. An explicitly supplied `originId`
   * is honoured immediately, so deterministic callers (tests, simulations) are unaffected.
   */
  let resolvedOriginId = options.originId
  const originIdentity = (): string => {
    resolvedOriginId ??= createEnergyOrigin()
    return resolvedOriginId
  }

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

  /*
   * The untouched default: no clock read and no random read, so constructing an engine during a
   * React render (which is what every provider does) stays prerender-safe. Both sentinels sort
   * below any real value, so the first persisted, observed or user-set state replaces this
   * unconditionally.
   *
   * The origin is ALWAYS the sentinel, never `options.originId`. SPEC.md §3.2 requires the
   * untouched default to stay distinguishable from a real state, and `isUnproducedState()` tests
   * exactly this pair — stamping a configured producer identity here turns "nobody has chosen
   * yet" into a state that looks chosen, which reads downstream as a level set at the epoch.
   * The configured identity belongs to the first state this engine actually produces.
   */
  let state: EnergyState = createEnergyState(
    initialLevel,
    'manual',
    UNPRODUCED_TIMESTAMP,
    0,
    UNPRODUCED_ORIGIN,
  )
  // Version 0 is the initial in-memory state, not proof that a persistence
  // adapter has durably stored it. Starting below the version domain keeps
  // flush() honest even before the first state transition.
  let persistedVersion = -1
  let requestedPersistVersion = 0
  let isPersisting = false
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

  /*
   * `isPersisting` is a plain flag rather than a handle on the in-flight promise.
   * An adapter whose `save()` is not declared `async` can throw synchronously (a
   * quota check on a bare `localStorage.setItem`, say). The drain then finishes
   * before it ever awaits, so anything assigned from the *call site* afterwards
   * would overwrite the cleared state and park the queue permanently: every later
   * write would see work already in flight and return, and `flush()` would never
   * settle. Only the drain itself owns this flag.
   */
  async function drainPersistQueue(store: EnergyPersistence): Promise<void> {
    while (!disposed && persistedVersion < requestedPersistVersion) {
      const snapshot = state
      const snapshotVersion = stateVersion

      try {
        await store.save(snapshot)
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
        isPersisting = false

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

    isPersisting = false

    if (!disposed && persistedVersion < requestedPersistVersion) {
      queuePersist()
    }
  }

  function queuePersist(): void {
    if (!persistence || disposed) return

    requestedPersistVersion = Math.max(requestedPersistVersion, stateVersion)

    if (isPersisting) return

    isPersisting = true
    void drainPersistQueue(persistence)
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
  let started = false

  const engine: EnergyEngine = {
    start() {
      if (started || disposed || !persistence) return
      started = true

      initialHydrationTask = engine.hydrate().catch((err: unknown) => {
        logEngineError('Unexpected hydrate failure', err)
      })

      if (!persistence.observe) return

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

          if (!isPreferredEnergyState(normalized, state)) return

          applyState(normalized)
        })
      } catch (err: unknown) {
        logEngineError('Failed to subscribe to persistence observation', err)
      }
    },

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

      applyState(createEnergyState(level, source, timestamp, revision, originIdentity()))
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

      if (hydrateStartVersion === stateVersion || isPreferredEnergyState(normalized, state)) {
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

  if (autoStart) {
    engine.start()
  }

  return engine
}

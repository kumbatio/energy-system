import type { EnergyEngine, EnergyEngineOptions } from './engine.js'
import type { GateScheduler } from './gate.js'
import { getEnergyMetrics } from './metrics.js'
import { taskComplexityStrategy } from './strategies.js'

/**
 * Focus sessions — time-boxed "one thing at a time" windows layered on top of
 * the energy model. A session is a temporary commitment, not an energy level:
 * it suppresses interruptions for a bounded duration, surfaces break nudges,
 * and ALWAYS ends on time.
 *
 * Two invariants come from field evidence (GingerMail shipped the opposite
 * and both were user-hostile):
 *   1. Sessions auto-expire. Expiry is an emitted event, not a predicate the
 *      app must remember to poll — suppression can never outlive the session.
 *   2. Suppression is lifted BEFORE the end event is emitted, so an
 *      end-of-session notification can never be swallowed by the session's
 *      own suppression.
 */

function logSessionError(message: string, err: unknown): void {
  console.error(`[energy-system] ${message}`, err)
}

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

/** An active focus session snapshot */
export interface FocusSession {
  /** When the session started (epoch ms) */
  readonly startedAt: number
  /** When the session ends (epoch ms). Sessions are always bounded. */
  readonly endsAt: number
  /** Break nudge cadence in ms. 0 = no break nudges. */
  readonly breakIntervalMs: number
}

/**
 * Session lifecycle events:
 * - `start`: a session began
 * - `break`: a break nudge is due (recurring while the session runs)
 * - `end`: the session reached `endsAt` and auto-expired
 * - `stop`: the session was ended manually before `endsAt`
 */
export type FocusSessionEvent = 'start' | 'break' | 'end' | 'stop'

export type FocusSessionListener = (event: FocusSessionEvent, session: FocusSession) => void

/** Milliseconds left in a session (0 when expired) */
export function sessionRemainingMs(session: FocusSession, now = Date.now()): number {
  return Math.max(0, session.endsAt - now)
}

/** True once a session has reached its end time */
export function isSessionExpired(session: FocusSession, now = Date.now()): boolean {
  return now >= session.endsAt
}

/** Anything that can be suppressed for the lifetime of a session */
export interface FocusSuppressible {
  setSuppressed(suppressed: boolean): void
}

export interface FocusSessionControllerOptions {
  /**
   * Engine used for energy-aware defaults: session length from the level's
   * expected productivity window, break cadence from the task-complexity
   * strategy. Optional — without it, defaults are 25 minutes / no breaks.
   */
  engine?: EnergyEngine
  /**
   * Suppression target (typically a NotificationGate). Suppressed on start,
   * released on stop/end/dispose — the controller owns the flag for the
   * session's lifetime, so it can never be left stuck on.
   */
  gate?: FocusSuppressible
  /** Deterministic time source for tests/simulations */
  clock?: EnergyEngineOptions['clock']
  /** Deterministic timer source for tests/simulations */
  scheduler?: GateScheduler
}

export interface StartFocusSessionOptions {
  /** Session length. Default: engine's expected productivity window, else 25. */
  durationMinutes?: number
  /** Break nudge cadence. 0 disables. Default: engine's task-complexity guidance. */
  breakEveryMinutes?: number
}

export interface FocusSessionController {
  /** Start a session (replacing any active one, which is stopped first). */
  start(options?: StartFocusSessionOptions): FocusSession
  /** End the active session early. No-op when idle. */
  stop(): void
  getSession(): FocusSession | null
  /** Milliseconds left in the active session (0 when idle) */
  remainingMs(): number
  /** Subscribe to session lifecycle events. Returns unsubscribe function. */
  subscribe(listener: FocusSessionListener): () => void
  /** Stop any active session and release resources */
  dispose(): void
}

const DEFAULT_SESSION_MINUTES = 25

function resolveNow(clock?: EnergyEngineOptions['clock']): () => number {
  if (typeof clock === 'function') return clock
  if (clock?.now) return () => clock.now()
  return () => Date.now()
}

const defaultScheduler: GateScheduler = {
  setTimeout(callback, ms) {
    return setTimeout(callback, ms)
  },
  clearTimeout(handle) {
    clearTimeout(handle as Parameters<typeof clearTimeout>[0])
  },
}

export function createFocusSessionController(
  options: FocusSessionControllerOptions = {},
): FocusSessionController {
  const { engine, gate, clock, scheduler = defaultScheduler } = options
  const now = resolveNow(clock)
  const listeners = new Set<FocusSessionListener>()

  let session: FocusSession | null = null
  let endTimer: unknown
  let breakTimer: unknown
  let disposed = false

  function emit(event: FocusSessionEvent, snapshot: FocusSession): void {
    // Iterate over a snapshot so listeners that unsubscribe (or subscribe)
    // during emission cannot skew the iteration.
    const emissionListeners = [...listeners]
    for (const listener of emissionListeners) {
      try {
        listener(event, snapshot)
      } catch (err: unknown) {
        logSessionError('Focus session listener threw', err)
      }
    }
  }

  function clearTimers(): void {
    if (endTimer !== undefined) {
      scheduler.clearTimeout(endTimer)
      endTimer = undefined
    }
    if (breakTimer !== undefined) {
      scheduler.clearTimeout(breakTimer)
      breakTimer = undefined
    }
  }

  function releaseSuppression(): void {
    try {
      gate?.setSuppressed(false)
    } catch (err: unknown) {
      logSessionError('Failed to release suppression', err)
    }
  }

  function scheduleNextBreak(active: FocusSession, fromMs: number): void {
    if (active.breakIntervalMs <= 0) return

    const nextBreakAt = fromMs + active.breakIntervalMs
    // A break nudge that would land at (or after) the session end is noise:
    // the end event already tells the user to step away.
    if (nextBreakAt >= active.endsAt) return

    breakTimer = scheduler.setTimeout(() => {
      breakTimer = undefined
      if (session !== active) return
      emit('break', active)
      scheduleNextBreak(active, nextBreakAt)
    }, nextBreakAt - now())
  }

  function endSession(event: 'end' | 'stop'): void {
    const ended = session
    if (!ended) return

    clearTimers()
    session = null
    // Invariant: suppression lifts before the event fires, so end/stop
    // handlers can notify the user without being swallowed.
    releaseSuppression()
    emit(event, ended)
  }

  function defaultDurationMinutes(): number {
    if (!engine) return DEFAULT_SESSION_MINUTES
    const window = getEnergyMetrics(engine.getState(), now()).expectedProductivityWindowMinutes
    // At rest (0) the metrics window is 0 — an explicit session at rest still
    // deserves a real bound rather than an instantly-expiring one.
    return window > 0 ? window : DEFAULT_SESSION_MINUTES
  }

  function defaultBreakMinutes(): number {
    if (!engine) return 0
    const config = taskComplexityStrategy.resolve(engine.getState().level)
    return config.suggestBreaks ? config.breakIntervalMinutes : 0
  }

  return {
    start(startOptions = {}) {
      if (disposed) {
        throw new Error('Cannot start a session on a disposed controller')
      }

      const durationMinutes = startOptions.durationMinutes ?? defaultDurationMinutes()
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        throw new Error(`Invalid session duration: ${String(startOptions.durationMinutes)}`)
      }

      const breakEveryMinutes = startOptions.breakEveryMinutes ?? defaultBreakMinutes()
      if (!Number.isFinite(breakEveryMinutes) || breakEveryMinutes < 0) {
        throw new Error(`Invalid break interval: ${String(startOptions.breakEveryMinutes)}`)
      }

      if (session) {
        endSession('stop')
      }

      const startedAt = now()
      const next: FocusSession = freezeObject({
        startedAt,
        endsAt: startedAt + durationMinutes * 60_000,
        breakIntervalMs: breakEveryMinutes * 60_000,
      })

      session = next
      try {
        gate?.setSuppressed(true)
      } catch (err: unknown) {
        logSessionError('Failed to apply suppression', err)
      }

      endTimer = scheduler.setTimeout(() => {
        endTimer = undefined
        if (session === next) {
          endSession('end')
        }
      }, next.endsAt - startedAt)

      scheduleNextBreak(next, startedAt)
      emit('start', next)
      return next
    },

    stop() {
      if (disposed) return
      endSession('stop')
    },

    getSession() {
      return session
    },

    remainingMs() {
      return session ? sessionRemainingMs(session, now()) : 0
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

    dispose() {
      if (disposed) return
      // Ending first guarantees suppression is released and observers hear
      // about the interruption before listeners are torn down.
      endSession('stop')
      disposed = true
      listeners.clear()
    },
  }
}

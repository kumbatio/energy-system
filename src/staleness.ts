import type { EnergyEngine, EnergyEngineOptions } from './engine.ts'
import type { GateScheduler } from './gate.ts'
import { isUnproducedState } from './levels.ts'
import { defaultScheduler, logContainedError, resolveNow } from './runtime.ts'
import type { FocusSessionController } from './session.ts'
import type { EnergyLevel, EnergyState } from './types.ts'

/*
 * Staleness monitor - Paper 3, Pattern 10 (Staleness Detection).
 *
 * A capacity reading set four hours ago may no longer fit how the person feels
 * now. Yet nagging every 30 minutes creates cognitive load, and nagging at Rest
 * breaks the sanctuary rule.
 *
 * This monitor watches state age against level-aware thresholds (Peak is a
 * burst state that goes stale sooner; Steady holds longer; Rest never nags),
 * pauses while a focus session is active, and emits ONE gentle, dismissible
 * check-in per reading. It NEVER changes the energy level automatically.
 */

export interface StalenessPrompt {
  readonly state: EnergyState
  readonly ageMs: number
  readonly thresholdMs: number
  /** Plain, non-judgmental check-in copy safe to show at low energy. */
  readonly message: string
}

export type StalenessListener = (prompt: StalenessPrompt) => void

export interface StalenessMonitorOptions {
  /**
   * Per-level staleness thresholds in milliseconds. `0` disables check-ins for
   * that level (Rest defaults to `0` — never interrupt rest to ask if you're
   * still resting).
   */
  thresholdsMs?: Partial<Record<EnergyLevel, number>>
  /** Optional focus controller: check-ins wait until an active session ends. */
  sessions?: Pick<FocusSessionController, 'getSession' | 'subscribe'>
  /** Deterministic clock for tests/simulations */
  clock?: EnergyEngineOptions['clock']
  /** Deterministic timer for tests/simulations */
  scheduler?: GateScheduler
}

export interface StalenessMonitor {
  /** True if the current energy state has outlived its level threshold. */
  isStale(): boolean
  /** Current staleness prompt if stale and not dismissed, else null. */
  getPrompt(): StalenessPrompt | null
  /** Dismiss the check-in for the current state without changing the level. */
  dismiss(): void
  /** Subscribe to gentle staleness check-ins. Returns unsubscribe function. */
  subscribe(listener: StalenessListener): () => void
  /** Release timers and subscriptions. */
  dispose(): void
}

const DEFAULT_STALENESS_MS: Readonly<Record<EnergyLevel, number>> = Object.freeze({
  100: 2 * 60 * 60_000, // 2h — Peak is a burst state
  75: 3 * 60 * 60_000, // 3h
  50: 4 * 60 * 60_000, // 4h
  25: 3 * 60 * 60_000, // 3h
  0: 0, // Rest never nags
})

function formatHoursAgo(ageMs: number): string {
  const minutes = Math.round(ageMs / 60_000)
  if (minutes < 90) {
    return minutes <= 1 ? 'a minute ago' : `${String(minutes)} minutes ago`
  }
  const hours = Math.round(minutes / 60)
  return hours === 1 ? 'about an hour ago' : `about ${String(hours)} hours ago`
}

export function createStalenessMonitor(
  engine: EnergyEngine,
  options: StalenessMonitorOptions = {},
): StalenessMonitor {
  const { thresholdsMs, sessions, clock, scheduler = defaultScheduler } = options
  const now = resolveNow(clock)
  const thresholds: Record<EnergyLevel, number> = {
    ...DEFAULT_STALENESS_MS,
    ...thresholdsMs,
  }

  for (const [level, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid staleness threshold for level ${level}: ${String(value)}`)
    }
  }

  const listeners = new Set<StalenessListener>()
  let timer: unknown
  let disposed = false
  let dismissedForState: EnergyState | null = null
  let emittedForState: EnergyState | null = null
  let activePrompt: StalenessPrompt | null = null

  function clearTimer(): void {
    if (timer !== undefined) {
      scheduler.clearTimeout(timer)
      timer = undefined
    }
  }

  function thresholdFor(state: EnergyState): number {
    if (isUnproducedState(state)) return 0
    return thresholds[state.level]
  }

  function buildPrompt(state: EnergyState, ageMs: number, thresholdMs: number): StalenessPrompt {
    return Object.freeze({
      state,
      ageMs,
      thresholdMs,
      message: `You set your energy ${formatHoursAgo(ageMs)}. Still feels right?`,
    })
  }

  function emit(prompt: StalenessPrompt): void {
    const emissionListeners = [...listeners]
    for (const listener of emissionListeners) {
      try {
        listener(prompt)
      } catch (err: unknown) {
        logContainedError('Staleness listener threw', err)
      }
    }
  }

  function evaluate(): void {
    clearTimer()
    if (disposed) return

    const state = engine.getState()
    const thresholdMs = thresholdFor(state)
    if (thresholdMs <= 0 || dismissedForState === state) {
      activePrompt = null
      return
    }

    // Never interrupt an active focus session; re-evaluate when it ends.
    if (sessions?.getSession()) {
      activePrompt = null
      return
    }

    const ageMs = Math.max(0, now() - state.timestamp)
    if (ageMs >= thresholdMs) {
      const prompt = buildPrompt(state, ageMs, thresholdMs)
      activePrompt = prompt
      if (emittedForState !== state) {
        emittedForState = state
        emit(prompt)
      }
      return
    }

    activePrompt = null
    timer = scheduler.setTimeout(() => {
      timer = undefined
      evaluate()
    }, thresholdMs - ageMs)
  }

  const unsubscribeEngine = engine.subscribe(() => {
    dismissedForState = null
    emittedForState = null
    activePrompt = null
    evaluate()
  })

  const unsubscribeSessions =
    sessions?.subscribe((event) => {
      if (event === 'end' || event === 'stop') {
        evaluate()
      } else if (event === 'start') {
        clearTimer()
        activePrompt = null
      }
    }) ?? (() => {})

  evaluate()

  return {
    isStale() {
      const state = engine.getState()
      const thresholdMs = thresholdFor(state)
      if (thresholdMs <= 0) return false
      return Math.max(0, now() - state.timestamp) >= thresholdMs
    },

    getPrompt() {
      if (disposed) return null
      const state = engine.getState()
      const thresholdMs = thresholdFor(state)
      if (thresholdMs <= 0 || dismissedForState === state || sessions?.getSession()) {
        return null
      }
      const ageMs = Math.max(0, now() - state.timestamp)
      if (ageMs < thresholdMs) return null
      activePrompt = buildPrompt(state, ageMs, thresholdMs)
      return activePrompt
    },

    dismiss() {
      if (disposed) return
      dismissedForState = engine.getState()
      activePrompt = null
      clearTimer()
    },

    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      clearTimer()
      unsubscribeEngine()
      unsubscribeSessions()
      listeners.clear()
      activePrompt = null
    },
  }
}

import type { GateScheduler } from './gate.ts'
import type { EnergyClock } from './types.ts'

/*
 * Internal plumbing shared by the stateful runtimes (engine, notification gate,
 * focus sessions, persistence, React provider). Not exported from the package.
 */

/** Report a failure the library contained instead of throwing it to the host. */
export function logContainedError(message: string, err: unknown): void {
  console.error(`[energy-system] ${message}`, err)
}

/** Normalize the injectable `clock` option to a plain time function. */
export function resolveNow(clock?: EnergyClock | (() => number)): () => number {
  if (typeof clock === 'function') return clock
  if (clock?.now) return () => clock.now()
  return () => Date.now()
}

/** Real timers, for runtimes constructed without a deterministic scheduler. */
export const defaultScheduler: GateScheduler = {
  setTimeout(callback, ms) {
    return setTimeout(callback, ms)
  },
  clearTimeout(handle) {
    clearTimeout(handle as Parameters<typeof clearTimeout>[0])
  },
}

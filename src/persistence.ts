import { createEnergyState, isEnergyLevel, isEnergySource } from './levels.js'
import type { EnergyPersistence, EnergyState } from './types.js'

/*
 * `null` means "nothing usable is stored", which the engine treats as a fresh
 * install. Corrupt or schema-violating data reaches the same conclusion, but it
 * is a different event and gets logged: silently equating "storage is damaged"
 * with "first run" is how a user's persisted level disappears without trace.
 */
function parsePersistedState(source: string, raw: string | null): EnergyState | null {
  if (!raw) return null

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (err: unknown) {
    console.error(`[energy-system] Discarding unparseable persisted energy state (${source})`, err)
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || !('level' in parsed)) {
    console.error(
      `[energy-system] Discarding persisted energy state with unexpected shape (${source})`,
    )
    return null
  }

  const obj = parsed as Record<string, unknown>
  if (
    !isEnergyLevel(obj['level']) ||
    !isEnergySource(obj['source']) ||
    typeof obj['timestamp'] !== 'number' ||
    typeof obj['revision'] !== 'number' ||
    typeof obj['origin'] !== 'string'
  ) {
    console.error(`[energy-system] Discarding malformed persisted energy state (${source})`)
    return null
  }

  try {
    return createEnergyState(
      obj['level'],
      obj['source'],
      obj['timestamp'],
      obj['revision'],
      obj['origin'],
    )
  } catch (err: unknown) {
    // Field-level invariants (negative timestamp, non-integer revision, blank
    // origin) are enforced by createEnergyState, not by the checks above.
    console.error(`[energy-system] Discarding invalid persisted energy state (${source})`, err)
    return null
  }
}

/**
 * localStorage-based persistence adapter.
 * Stores the full EnergyState as JSON.
 */
export function localStoragePersistence(key = 'energy-state'): EnergyPersistence {
  return {
    async load(): Promise<EnergyState | null> {
      if (typeof localStorage === 'undefined') {
        return null
      }

      const raw = localStorage.getItem(key)
      return parsePersistedState(`localStorage key '${key}'`, raw)
    },
    async save(state: EnergyState): Promise<void> {
      try {
        localStorage.setItem(key, JSON.stringify(state))
      } catch (err: unknown) {
        // Rejecting (instead of swallowing) lets the engine's persistence
        // queue observe the failure and retry with backoff. This also covers
        // environments without localStorage (ReferenceError).
        throw new Error(`Failed to save energy state to localStorage key '${key}'`, { cause: err })
      }
    },
    observe(onState) {
      if (
        typeof globalThis.addEventListener !== 'function' ||
        typeof localStorage === 'undefined'
      ) {
        return () => {}
      }

      const handleStorage = (event: StorageEvent) => {
        if (event.storageArea !== localStorage) return
        if (event.key !== key) return

        const parsed = parsePersistedState(`storage event for key '${key}'`, event.newValue)
        if (parsed) {
          onState(parsed)
        }
      }

      globalThis.addEventListener('storage', handleStorage)
      return () => {
        globalThis.removeEventListener('storage', handleStorage)
      }
    },
  }
}

/**
 * In-memory persistence adapter.
 * Useful for tests, SSR, or ephemeral sessions.
 */
export function memoryPersistence(initial?: EnergyState): EnergyPersistence {
  let stored =
    initial === undefined
      ? null
      : createEnergyState(
          initial.level,
          initial.source,
          initial.timestamp,
          initial.revision,
          initial.origin,
        )
  const listeners = new Set<(state: EnergyState) => void>()

  return {
    async load(): Promise<EnergyState | null> {
      return stored
    },
    async save(state: EnergyState): Promise<void> {
      stored = createEnergyState(
        state.level,
        state.source,
        state.timestamp,
        state.revision,
        state.origin,
      )
      for (const listener of listeners) {
        listener(stored)
      }
    },
    observe(onState) {
      listeners.add(onState)
      return () => {
        listeners.delete(onState)
      }
    },
  }
}

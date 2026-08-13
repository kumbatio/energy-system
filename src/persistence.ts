import { parseExternalEnergyState } from './levels.js'
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

  try {
    // Shape, key set and field invariants are all one boundary rule, enforced
    // to the letter of spec/energy-state.schema.json - including its
    // `additionalProperties: false`. Storage written by a newer or foreign
    // producer is rejected, not quietly trimmed to fit.
    return parseExternalEnergyState(parsed)
  } catch (err: unknown) {
    // Distinct from the unparseable case above: the bytes were JSON, the
    // content was not an EnergyState. The thrown error carries which rule broke.
    console.error(`[energy-system] Discarding malformed persisted energy state (${source})`, err)
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
  let stored = initial === undefined ? null : parseExternalEnergyState(initial)
  const listeners = new Set<(state: EnergyState) => void>()

  return {
    async load(): Promise<EnergyState | null> {
      return stored
    },
    async save(state: EnergyState): Promise<void> {
      // Re-parsed rather than stored by reference: this adapter is the one
      // observers read back from, so what it hands out must satisfy the
      // interchange contract exactly, whoever called save().
      const next = parseExternalEnergyState(state)
      stored = next
      for (const listener of listeners) {
        listener(next)
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

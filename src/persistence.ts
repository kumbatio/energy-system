import { createEnergyState, isEnergyLevel, isEnergySource } from './levels.js'
import type { EnergyPersistence, EnergyState } from './types.js'

function parsePersistedState(raw: string | null): EnergyState | null {
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'level' in parsed) {
      const obj = parsed as Record<string, unknown>
      if (
        !isEnergyLevel(obj['level']) ||
        !isEnergySource(obj['source']) ||
        typeof obj['timestamp'] !== 'number' ||
        typeof obj['revision'] !== 'number' ||
        typeof obj['origin'] !== 'string'
      ) {
        return null
      }

      return createEnergyState(
        obj['level'],
        obj['source'],
        obj['timestamp'],
        obj['revision'],
        obj['origin'],
      )
    }
    return null
  } catch {
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
      return parsePersistedState(raw)
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

        const parsed = parsePersistedState(event.newValue)
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

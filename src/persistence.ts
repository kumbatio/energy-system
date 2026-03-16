import type { EnergyLevel, EnergyPersistence, EnergyState } from './types'
import { isEnergyLevel } from './levels'

/**
 * localStorage-based persistence adapter.
 * Stores the full EnergyState as JSON.
 */
export function localStoragePersistence(key = 'energy-state'): EnergyPersistence {
  return {
    async load(): Promise<EnergyState | null> {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        if (
          typeof parsed === 'object' && parsed !== null &&
          'level' in parsed && isEnergyLevel((parsed as { level: unknown }).level)
        ) {
          const obj = parsed as { level: EnergyLevel; timestamp?: number; source?: string }
          return {
            level: obj.level,
            timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : Date.now(),
            source: obj.source === 'scheduled' || obj.source === 'inferred' ? obj.source : 'manual',
          }
        }
        return null
      } catch {
        return null
      }
    },
    async save(state: EnergyState): Promise<void> {
      try {
        localStorage.setItem(key, JSON.stringify(state))
      } catch {
        // Storage full or unavailable — non-critical
      }
    },
  }
}

/**
 * In-memory persistence adapter.
 * Useful for tests, SSR, or ephemeral sessions.
 */
export function memoryPersistence(initial?: EnergyState): EnergyPersistence {
  let stored = initial ?? null
  return {
    async load(): Promise<EnergyState | null> {
      return stored
    },
    async save(state: EnergyState): Promise<void> {
      stored = state
    },
  }
}

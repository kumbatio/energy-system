import { getEnergyLevel } from './levels.js'
import type { EnergyLevel, EnergyMetrics, EnergyState } from './types.js'

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

const PRODUCTIVITY_WINDOW_MINUTES: Record<EnergyLevel, number> = {
  100: 120,
  75: 90,
  50: 45,
  25: 25,
  0: 0,
}

const BREAK_INTERVAL_MINUTES: Record<EnergyLevel, number> = {
  100: 90,
  75: 60,
  50: 45,
  25: 25,
  0: 15,
}

const RECOVERY_HINT_MINUTES: Partial<Record<EnergyLevel, number>> = {
  50: 10,
  25: 20,
  0: 30,
}

/**
 * Derive app-agnostic energy metrics from the current state.
 */
export function getEnergyMetrics(state: EnergyState, now = Date.now()): EnergyMetrics {
  const safeNow = Number.isFinite(now) ? now : Date.now()
  const stateAgeMs = Math.max(0, safeNow - state.timestamp)
  const definition = getEnergyLevel(state.level)
  const recoveryHintMinutes = RECOVERY_HINT_MINUTES[state.level]

  const base: EnergyMetrics = {
    stateAgeMs,
    stateAgeMinutes: Math.round(stateAgeMs / 60_000),
    expectedProductivityWindowMinutes: PRODUCTIVITY_WINDOW_MINUTES[state.level],
    suggestedBreakIntervalMinutes: BREAK_INTERVAL_MINUTES[state.level],
    recommendedTaskComplexity: definition.cognitiveProfile.taskComplexity,
    sustainable: state.level > 0 && state.level < 100,
  }

  return recoveryHintMinutes === undefined
    ? freezeObject(base)
    : freezeObject({
        ...base,
        recoveryHintMinutes,
      })
}

import type { EnergyLevel, EnergyLevelDefinition } from './types'
import { ENERGY_LEVEL_VALUES } from './types'

const LEVELS: readonly EnergyLevelDefinition[] = [
  {
    value: 100,
    key: 'peak',
    label: 'Peak',
    description: 'High capacity. Planning, complex decisions, creative work.',
    cognitiveProfile: {
      decisionCapacity: 'high',
      focusDuration: 'extended',
      taskComplexity: 'complex',
      interruptionTolerance: 'high',
    },
  },
  {
    value: 75,
    key: 'active',
    label: 'Active',
    description: 'Good capacity. Focused execution, problem-solving.',
    cognitiveProfile: {
      decisionCapacity: 'moderate',
      focusDuration: 'moderate',
      taskComplexity: 'moderate',
      interruptionTolerance: 'moderate',
    },
  },
  {
    value: 50,
    key: 'steady',
    label: 'Steady',
    description: 'Moderate capacity. Routine tasks, familiar work.',
    cognitiveProfile: {
      decisionCapacity: 'low',
      focusDuration: 'short',
      taskComplexity: 'routine',
      interruptionTolerance: 'low',
    },
  },
  {
    value: 25,
    key: 'low',
    label: 'Low',
    description: 'Limited capacity. Simple tasks, review, light work.',
    cognitiveProfile: {
      decisionCapacity: 'minimal',
      focusDuration: 'minimal',
      taskComplexity: 'simple',
      interruptionTolerance: 'minimal',
    },
  },
  {
    value: 0,
    key: 'rest',
    label: 'Rest',
    description: 'Depleted. Consumption only \u2014 reading, reflecting.',
    cognitiveProfile: {
      decisionCapacity: 'none',
      focusDuration: 'none',
      taskComplexity: 'consumption',
      interruptionTolerance: 'none',
    },
  },
] as const

/** Cycle order: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
const CYCLE_ORDER: readonly EnergyLevel[] = [100, 75, 50, 25, 0]

/** Get all energy level definitions, ordered highest to lowest */
export function getEnergyLevels(): readonly EnergyLevelDefinition[] {
  return LEVELS
}

/** Get definition for a specific energy level */
export function getEnergyLevel(level: EnergyLevel): EnergyLevelDefinition {
  const def = LEVELS.find((l) => l.value === level)
  if (!def) throw new Error(`Invalid energy level: ${level}`)
  return def
}

/** Cycle to the next energy level: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
export function cycleEnergyLevel(current: EnergyLevel): EnergyLevel {
  const fallback: EnergyLevel = 100
  const idx = CYCLE_ORDER.indexOf(current)
  if (idx < 0) return fallback
  return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length] ?? fallback
}

/** Validate that an unknown value is a valid EnergyLevel */
export function isEnergyLevel(value: unknown): value is EnergyLevel {
  return typeof value === 'number' && ENERGY_LEVEL_VALUES.has(value)
}

/** Returns true if level `a` represents higher energy than level `b` */
export function isHigherEnergy(a: EnergyLevel, b: EnergyLevel): boolean {
  return a > b
}

/** Create an EnergyState for the current moment */
export function createEnergyState(
  level: EnergyLevel,
  source: 'manual' | 'scheduled' | 'inferred' = 'manual',
): import('./types').EnergyState {
  return { level, timestamp: Date.now(), source }
}

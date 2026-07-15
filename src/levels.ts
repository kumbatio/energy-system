import type { EnergyLevel, EnergyLevelDefinition, EnergySource, EnergyState } from './types.js'
import { ENERGY_LEVEL_VALUES, ENERGY_SOURCE_VALUES } from './types.js'

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

let originSequence = 0
let standaloneRevision = 0

/** Create a unique producer identity for deterministic cross-context ordering. */
export function createEnergyOrigin(): string {
  const cryptoApi = globalThis.crypto
  const randomUUID = cryptoApi?.randomUUID
  if (typeof randomUUID === 'function') {
    return randomUUID.call(cryptoApi)
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const random = new Uint32Array(4)
    cryptoApi.getRandomValues(random)
    return [...random].map((value) => value.toString(36)).join('-')
  }

  originSequence += 1
  return `${Date.now().toString(36)}-${originSequence.toString(36)}-${Math.random().toString(36).slice(2)}`
}

const STANDALONE_ORIGIN = createEnergyOrigin()

function nextStandaloneRevision(): number {
  standaloneRevision += 1
  return standaloneRevision
}

const LEVELS: ReadonlyArray<Readonly<EnergyLevelDefinition>> = Object.freeze([
  freezeObject<EnergyLevelDefinition>({
    value: 100,
    key: 'peak',
    label: 'Peak',
    description: 'High capacity. Planning, complex decisions, creative work.',
    cognitiveProfile: freezeObject<EnergyLevelDefinition['cognitiveProfile']>({
      decisionCapacity: 'high',
      focusDuration: 'extended',
      taskComplexity: 'complex',
      interruptionTolerance: 'high',
    }),
  }),
  freezeObject<EnergyLevelDefinition>({
    value: 75,
    key: 'active',
    label: 'Active',
    description: 'Good capacity. Focused execution, problem-solving.',
    cognitiveProfile: freezeObject<EnergyLevelDefinition['cognitiveProfile']>({
      decisionCapacity: 'moderate',
      focusDuration: 'moderate',
      taskComplexity: 'moderate',
      interruptionTolerance: 'moderate',
    }),
  }),
  freezeObject<EnergyLevelDefinition>({
    value: 50,
    key: 'steady',
    label: 'Steady',
    description: 'Moderate capacity. Routine tasks, familiar work.',
    cognitiveProfile: freezeObject<EnergyLevelDefinition['cognitiveProfile']>({
      decisionCapacity: 'low',
      focusDuration: 'short',
      taskComplexity: 'routine',
      interruptionTolerance: 'low',
    }),
  }),
  freezeObject<EnergyLevelDefinition>({
    value: 25,
    key: 'low',
    label: 'Low',
    description: 'Limited capacity. Simple tasks, review, light work.',
    cognitiveProfile: freezeObject<EnergyLevelDefinition['cognitiveProfile']>({
      decisionCapacity: 'minimal',
      focusDuration: 'minimal',
      taskComplexity: 'simple',
      interruptionTolerance: 'minimal',
    }),
  }),
  freezeObject<EnergyLevelDefinition>({
    value: 0,
    key: 'rest',
    label: 'Rest',
    description: 'Depleted. Consumption only \u2014 reading, reflecting.',
    cognitiveProfile: freezeObject<EnergyLevelDefinition['cognitiveProfile']>({
      decisionCapacity: 'none',
      focusDuration: 'none',
      taskComplexity: 'consumption',
      interruptionTolerance: 'none',
    }),
  }),
])

/** Cycle order: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
const CYCLE_ORDER: readonly EnergyLevel[] = [100, 75, 50, 25, 0]

/** Get all energy level definitions, ordered highest to lowest */
export function getEnergyLevels(): ReadonlyArray<Readonly<EnergyLevelDefinition>> {
  return LEVELS
}

/** Get definition for a specific energy level */
export function getEnergyLevel(level: EnergyLevel): Readonly<EnergyLevelDefinition> {
  const def = LEVELS.find((l) => l.value === level)
  if (!def) throw new Error(`Invalid energy level: ${level}`)
  return def
}

/** Cycle to the next energy level: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
export function cycleEnergyLevel(current: EnergyLevel): EnergyLevel {
  const fallback: EnergyLevel = 100
  const idx = CYCLE_ORDER.indexOf(current)
  if (idx === -1) return fallback
  return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length] ?? fallback
}

/** Validate that an unknown value is a valid EnergyLevel */
export function isEnergyLevel(value: unknown): value is EnergyLevel {
  return typeof value === 'number' && ENERGY_LEVEL_VALUES.has(value)
}

/** Validate that an unknown value is a valid EnergySource */
export function isEnergySource(value: unknown): value is EnergySource {
  return typeof value === 'string' && ENERGY_SOURCE_VALUES.has(value as EnergySource)
}

/** Returns true if level `a` represents higher energy than level `b` */
export function isHigherEnergy(a: EnergyLevel, b: EnergyLevel): boolean {
  return a > b
}

/** Create an EnergyState for the current moment */
export function createEnergyState(
  level: EnergyLevel,
  source: EnergySource = 'manual',
  timestamp = Date.now(),
  revision = nextStandaloneRevision(),
  origin = STANDALONE_ORIGIN,
): EnergyState {
  if (!isEnergyLevel(level)) {
    throw new Error(`Invalid energy level: ${String(level)}`)
  }

  if (!isEnergySource(source)) {
    throw new Error(`Invalid energy source: ${String(source)}`)
  }

  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error(`Invalid energy timestamp: ${String(timestamp)}`)
  }

  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid energy revision: ${String(revision)}`)
  }

  if (typeof origin !== 'string' || origin.trim().length === 0) {
    throw new Error(`Invalid energy origin: ${String(origin)}`)
  }

  return freezeObject({
    level,
    timestamp,
    source,
    revision,
    origin,
  })
}

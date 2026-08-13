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

/*
 * Markers for a state that has never been *produced* - the untouched default an engine starts with,
 * as opposed to a level anyone actually chose.
 *
 * Both exist so engine construction reads neither the clock nor the random source. React providers
 * build their engine during render, so under a prerender those reads are unstable values baked into
 * static output, and Next.js Cache Components fails the build on them.
 *
 * Both sentinels sort below any real value, which is also the semantics you want: a persisted or
 * observed state must always beat the default it replaces.
 */
export const UNPRODUCED_ORIGIN = '0-initial'
export const UNPRODUCED_TIMESTAMP = 0

/** True for the untouched default state - its age and identity are not meaningful. */
export function isUnproducedState(state: Pick<EnergyState, 'timestamp' | 'origin'>): boolean {
  return state.timestamp === UNPRODUCED_TIMESTAMP && state.origin === UNPRODUCED_ORIGIN
}

let standaloneOrigin: string | undefined

/**
 * The standalone producer identity, generated on first use rather than at module load.
 *
 * Generating it eagerly meant that merely importing this module called `crypto.randomUUID()`. Under
 * a React prerender that is an unstable value baked into static output, which fails the build
 * outright when a consumer enables Next.js Cache Components. Nothing needs an identity until a
 * state object is actually produced, so nothing pays for one until then.
 */
function getStandaloneOrigin(): string {
  standaloneOrigin ??= createEnergyOrigin()
  return standaloneOrigin
}

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
    description: 'Recovery. Consumption only \u2014 reading, reflecting.',
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
  origin = getStandaloneOrigin(),
): EnergyState {
  if (!isEnergyLevel(level)) {
    throw new Error(`Invalid energy level: ${String(level)}`)
  }

  if (!isEnergySource(source)) {
    throw new Error(`Invalid energy source: ${String(source)}`)
  }

  // Integer, matching `spec/energy-state.schema.json`. A fractional timestamp
  // is not representable in the interchange format, so accepting one here
  // produces a state this implementation can hold but cannot legally publish.
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
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

/** The exact key set `spec/energy-state.schema.json` permits. */
const ENERGY_STATE_KEYS: readonly string[] = ['level', 'timestamp', 'source', 'revision', 'origin']

/**
 * Parse a value that came from OUTSIDE this engine - persisted JSON, a
 * cross-context observation, a wire message - into an `EnergyState`.
 *
 * This is the interchange boundary, so it enforces the published JSON Schema
 * exactly rather than approximately: `additionalProperties: false` means an
 * object carrying an unknown key is not an `EnergyState`, and silently
 * stripping the key would let two implementations disagree about what they
 * just exchanged while both believe they conformed.
 *
 * Throws with a specific reason; callers decide whether that is fatal or a
 * discard. Not exported from the package: the boundaries that need it are all
 * inside this library, and the schema is what external producers validate
 * against.
 */
export function parseExternalEnergyState(value: unknown): EnergyState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Energy state must be an object, received: ${String(value)}`)
  }

  const keys = Object.keys(value)
  const unknownKeys = keys.filter((key) => !ENERGY_STATE_KEYS.includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`Energy state has unknown properties: ${unknownKeys.join(', ')}`)
  }

  const missingKeys = ENERGY_STATE_KEYS.filter((key) => !keys.includes(key))
  if (missingKeys.length > 0) {
    throw new Error(`Energy state is missing properties: ${missingKeys.join(', ')}`)
  }

  const record = value as Record<string, unknown>
  if (!isEnergyLevel(record['level'])) {
    throw new Error(`Invalid energy level: ${String(record['level'])}`)
  }
  if (!isEnergySource(record['source'])) {
    throw new Error(`Invalid energy source: ${String(record['source'])}`)
  }
  if (typeof record['timestamp'] !== 'number') {
    throw new TypeError(`Invalid energy timestamp: ${String(record['timestamp'])}`)
  }
  if (typeof record['revision'] !== 'number') {
    throw new TypeError(`Invalid energy revision: ${String(record['revision'])}`)
  }
  if (typeof record['origin'] !== 'string') {
    throw new TypeError(`Invalid energy origin: ${String(record['origin'])}`)
  }

  // Field-level invariants (integer/range/blank-origin) belong to the one
  // constructor that enforces them for internally produced states too.
  return createEnergyState(
    record['level'],
    record['source'],
    record['timestamp'],
    record['revision'],
    record['origin'],
  )
}

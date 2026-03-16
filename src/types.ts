// ── Energy Levels ──

/** Discrete cognitive capacity values */
export type EnergyLevel = 0 | 25 | 50 | 75 | 100

/** How the energy level was set */
export type EnergySource = 'manual' | 'scheduled' | 'inferred'

/** Valid energy level values for runtime validation */
export const ENERGY_LEVEL_VALUES: ReadonlySet<number> = new Set([0, 25, 50, 75, 100])

// ── Energy State ──

/** A point-in-time snapshot of cognitive capacity */
export interface EnergyState {
  /** Current cognitive capacity */
  level: EnergyLevel
  /** When this state was set (epoch ms) */
  timestamp: number
  /** How this state was determined */
  source: EnergySource
}

// ── Cognitive Profile ──

export type DecisionCapacity = 'high' | 'moderate' | 'low' | 'minimal' | 'none'
export type FocusDuration = 'extended' | 'moderate' | 'short' | 'minimal' | 'none'
export type TaskComplexity = 'complex' | 'moderate' | 'routine' | 'simple' | 'consumption'
export type InterruptionTolerance = 'high' | 'moderate' | 'low' | 'minimal' | 'none'

/** What the brain can handle at a given energy level */
export interface CognitiveProfile {
  decisionCapacity: DecisionCapacity
  focusDuration: FocusDuration
  taskComplexity: TaskComplexity
  interruptionTolerance: InterruptionTolerance
}

// ── Level Definition ──

/** Complete metadata for a single energy level */
export interface EnergyLevelDefinition {
  value: EnergyLevel
  key: string
  label: string
  description: string
  cognitiveProfile: CognitiveProfile
}

// ── Adaptation Strategy ──

/**
 * Maps energy levels to application behavior.
 * Pure function — given a level, produce a configuration.
 */
export interface AdaptationStrategy<TConfig> {
  /** Unique name for this strategy */
  name: string
  /** Human-readable description of what this strategy does at a given level */
  describe(level: EnergyLevel): string
  /** Compute the configuration for a given energy level */
  resolve(level: EnergyLevel): TConfig
}

// ── Persistence ──

/** Storage contract — implement per platform */
export interface EnergyPersistence {
  load(): Promise<EnergyState | null>
  save(state: EnergyState): Promise<void>
}

// ── Listeners ──

/** Callback for energy state changes */
export type EnergyChangeListener = (state: EnergyState, prev: EnergyState) => void

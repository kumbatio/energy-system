// ── Energy Levels ──

/** Discrete cognitive capacity values */
export type EnergyLevel = 0 | 25 | 50 | 75 | 100

/** How the energy level was set */
export type EnergySource = 'manual' | 'scheduled' | 'inferred'

/** Valid energy level values for runtime validation */
export const ENERGY_LEVEL_VALUES: ReadonlySet<number> = new Set([0, 25, 50, 75, 100])
/** Valid energy source values for runtime validation */
export const ENERGY_SOURCE_VALUES: ReadonlySet<EnergySource> = new Set([
  'manual',
  'scheduled',
  'inferred',
])

// ── Energy State ──

/** A point-in-time snapshot of cognitive capacity */
export interface EnergyState {
  /** Current cognitive capacity */
  readonly level: EnergyLevel
  /** When this state was set (epoch ms) */
  readonly timestamp: number
  /** How this state was determined */
  readonly source: EnergySource
}

// ── Clock ──

/** Time source contract for deterministic environments (tests, simulations) */
export interface EnergyClock {
  now(): number
}

// ── Cognitive Profile ──

export type DecisionCapacity = 'high' | 'moderate' | 'low' | 'minimal' | 'none'
export type FocusDuration = 'extended' | 'moderate' | 'short' | 'minimal' | 'none'
export type TaskComplexity = 'complex' | 'moderate' | 'routine' | 'simple' | 'consumption'
export type InterruptionTolerance = 'high' | 'moderate' | 'low' | 'minimal' | 'none'

/** What the brain can handle at a given energy level */
export interface CognitiveProfile {
  readonly decisionCapacity: DecisionCapacity
  readonly focusDuration: FocusDuration
  readonly taskComplexity: TaskComplexity
  readonly interruptionTolerance: InterruptionTolerance
}

// ── Level Definition ──

/** Complete metadata for a single energy level */
export interface EnergyLevelDefinition {
  readonly value: EnergyLevel
  readonly key: string
  readonly label: string
  readonly description: string
  readonly cognitiveProfile: CognitiveProfile
}

// ── Adaptation Strategy ──

/**
 * Maps energy levels to application behavior.
 * Pure function - given a level, produce a configuration.
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

/** Storage contract - implement per platform */
export interface EnergyPersistence {
  load(): Promise<EnergyState | null>
  save(state: EnergyState): Promise<void>
  /**
   * Optional observer for externally persisted state updates (cross-tab, worker, etc.)
   */
  observe?(onState: (state: EnergyState) => void): () => void
}

// ── Listeners ──

/** Callback for energy state changes */
export type EnergyChangeListener = (state: EnergyState, prev: EnergyState) => void

// ── Derived Metrics ──

/**
 * Computed, app-agnostic metrics from an energy state snapshot.
 */
export interface EnergyMetrics {
  /** Milliseconds since this state was set */
  readonly stateAgeMs: number
  /** Rounded minutes since this state was set */
  readonly stateAgeMinutes: number
  /** Suggested focused-work window length */
  readonly expectedProductivityWindowMinutes: number
  /** Suggested break cadence for the current level */
  readonly suggestedBreakIntervalMinutes: number
  /** Recommended task complexity based on cognitive profile */
  readonly recommendedTaskComplexity: TaskComplexity
  /**
   * Heuristic signal for maintainability of this state.
   * True only for mid-range levels (25/50/75): peak (100) is a burst state
   * that depletes rather than holds, and rest (0) is recovery, not a working
   * state to maintain. Both extremes report false.
   */
  readonly sustainable: boolean
  /** Optional guidance for recovery horizon */
  readonly recoveryHintMinutes?: number
}

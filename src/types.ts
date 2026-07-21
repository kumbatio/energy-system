// ── Energy Levels ──

/** Discrete cognitive capacity values */
export type EnergyLevel = 0 | 25 | 50 | 75 | 100

/** How the energy level was set */
export type EnergySource = 'manual' | 'scheduled' | 'inferred'

function createReadonlySet<T>(values: readonly T[]): ReadonlySet<T> {
  const set = new Set(values)
  const readonlySet = new Proxy(set, {
    get(target, property) {
      if (property === 'add' || property === 'delete' || property === 'clear') {
        return undefined
      }

      if (property === 'forEach') {
        return (
          callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
          thisArg?: unknown,
        ) => {
          for (const value of target) {
            callback.call(thisArg, value, value, readonlySet)
          }
        }
      }

      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return Object.freeze(readonlySet)
}

/** Valid energy level values for runtime validation */
export const ENERGY_LEVEL_VALUES = createReadonlySet([0, 25, 50, 75, 100])
/** Valid energy source values for runtime validation */
export const ENERGY_SOURCE_VALUES = createReadonlySet<EnergySource>([
  'manual',
  'scheduled',
  'inferred',
])

// ── Energy Presence ──

/**
 * How a UI element participates at a given energy level.
 *
 * - `visible`: rendered normally
 * - `muted`: rendered but de-emphasized (reduced opacity, secondary styling)
 * - `hidden`: not rendered at all
 */
export type EnergyPresence = 'visible' | 'muted' | 'hidden'

/**
 * A complete presence declaration: one presence value per energy level.
 * This is the annotation apps attach to components/views to state which
 * energy levels they belong to (e.g. "hide the AI chat at 50 and below").
 */
export type EnergyPresenceMap = Readonly<Record<EnergyLevel, EnergyPresence>>

/** Valid energy presence values for runtime validation */
export const ENERGY_PRESENCE_VALUES = createReadonlySet<EnergyPresence>([
  'visible',
  'muted',
  'hidden',
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
  /** Logical sequence for writes sharing the same timestamp */
  readonly revision: number
  /** Stable identity of the engine/context that produced this state */
  readonly origin: string
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
  /** Suggested break cadence for the current level. 0 means no breaks are suggested (rest is already a break). */
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

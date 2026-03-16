/** Discrete cognitive capacity values */
export type EnergyLevel = 0 | 25 | 50 | 75 | 100;
/** How the energy level was set */
export type EnergySource = 'manual' | 'scheduled' | 'inferred';
/** Valid energy level values for runtime validation */
export declare const ENERGY_LEVEL_VALUES: ReadonlySet<number>;
/** A point-in-time snapshot of cognitive capacity */
export interface EnergyState {
    /** Current cognitive capacity */
    level: EnergyLevel;
    /** When this state was set (epoch ms) */
    timestamp: number;
    /** How this state was determined */
    source: EnergySource;
}
/** Time source contract for deterministic environments (tests, simulations) */
export interface EnergyClock {
    now(): number;
}
export type DecisionCapacity = 'high' | 'moderate' | 'low' | 'minimal' | 'none';
export type FocusDuration = 'extended' | 'moderate' | 'short' | 'minimal' | 'none';
export type TaskComplexity = 'complex' | 'moderate' | 'routine' | 'simple' | 'consumption';
export type InterruptionTolerance = 'high' | 'moderate' | 'low' | 'minimal' | 'none';
/** What the brain can handle at a given energy level */
export interface CognitiveProfile {
    decisionCapacity: DecisionCapacity;
    focusDuration: FocusDuration;
    taskComplexity: TaskComplexity;
    interruptionTolerance: InterruptionTolerance;
}
/** Complete metadata for a single energy level */
export interface EnergyLevelDefinition {
    value: EnergyLevel;
    key: string;
    label: string;
    description: string;
    cognitiveProfile: CognitiveProfile;
}
/**
 * Maps energy levels to application behavior.
 * Pure function — given a level, produce a configuration.
 */
export interface AdaptationStrategy<TConfig> {
    /** Unique name for this strategy */
    name: string;
    /** Human-readable description of what this strategy does at a given level */
    describe(level: EnergyLevel): string;
    /** Compute the configuration for a given energy level */
    resolve(level: EnergyLevel): TConfig;
}
/** Storage contract — implement per platform */
export interface EnergyPersistence {
    load(): Promise<EnergyState | null>;
    save(state: EnergyState): Promise<void>;
    /**
     * Optional observer for externally persisted state updates (cross-tab, worker, etc.)
     */
    observe?(onState: (state: EnergyState) => void): () => void;
}
/** Callback for energy state changes */
export type EnergyChangeListener = (state: EnergyState, prev: EnergyState) => void;
/**
 * Computed, app-agnostic metrics from an energy state snapshot.
 */
export interface EnergyMetrics {
    /** Milliseconds since this state was set */
    stateAgeMs: number;
    /** Rounded minutes since this state was set */
    stateAgeMinutes: number;
    /** Suggested focused-work window length */
    expectedProductivityWindowMinutes: number;
    /** Suggested break cadence for the current level */
    suggestedBreakIntervalMinutes: number;
    /** Recommended task complexity based on cognitive profile */
    recommendedTaskComplexity: TaskComplexity;
    /** Heuristic signal for maintainability of this state */
    sustainable: boolean;
    /** Optional guidance for recovery horizon */
    recoveryHintMinutes?: number;
}
//# sourceMappingURL=types.d.ts.map
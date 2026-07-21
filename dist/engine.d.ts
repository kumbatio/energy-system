import type { AdaptationStrategy, EnergyClock, EnergyChangeListener, EnergyLevel, EnergyPersistence, EnergySource, EnergyState } from './types.js';
export interface EnergyEngineOptions {
    initialLevel?: EnergyLevel;
    persistence?: EnergyPersistence;
    onChange?: EnergyChangeListener;
    /** Called when a persistence attempt fails before the engine schedules a retry. */
    onPersistenceError?: (error: unknown, state: EnergyState) => void;
    /** Deterministic time source for tests/simulations */
    clock?: EnergyClock | (() => number);
    /** Stable producer identity for deterministic reconciliation. Primarily useful in tests. */
    originId?: string;
    /**
     * Maximum tolerated future clock skew (ms) for externally supplied state
     * (hydration and cross-context observation). States stamped further ahead of
     * the local clock are rejected so one bad clock cannot win reconciliation
     * until its timestamp passes. Pass Number.POSITIVE_INFINITY to accept any
     * finite timestamp. Default: 5 minutes.
     */
    maxFutureSkewMs?: number;
}
export interface EnergyEngine {
    /** Get current energy state */
    getState(): EnergyState;
    /** Set energy level with optional source */
    setLevel(level: EnergyLevel, source?: EnergySource): void;
    /** Cycle to next energy level */
    cycleLevel(): void;
    /** Subscribe to state changes. Returns unsubscribe function. */
    subscribe(listener: EnergyChangeListener): () => void;
    /** Resolve a strategy against current energy state */
    resolve<T>(strategy: AdaptationStrategy<T>): T;
    /** Load persisted state (called automatically, but can be called manually) */
    hydrate(): Promise<void>;
    /**
     * Wait until the current state version is durably persisted.
     * Rejects if the engine is disposed or an unchanged initial state cannot be
     * reconciled because its persistence hydration read failed.
     */
    flush(): Promise<void>;
    /** Release engine-owned subscriptions/resources */
    dispose(): void;
}
export declare function createEnergyEngine(options?: EnergyEngineOptions): EnergyEngine;
//# sourceMappingURL=engine.d.ts.map
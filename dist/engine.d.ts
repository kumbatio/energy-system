import type { AdaptationStrategy, EnergyClock, EnergyChangeListener, EnergyLevel, EnergyPersistence, EnergySource, EnergyState } from './types.js';
export interface EnergyEngineOptions {
    initialLevel?: EnergyLevel;
    persistence?: EnergyPersistence;
    onChange?: EnergyChangeListener;
    /** Deterministic time source for tests/simulations */
    clock?: EnergyClock | (() => number);
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
    /** Release engine-owned subscriptions/resources */
    dispose(): void;
}
export declare function createEnergyEngine(options?: EnergyEngineOptions): EnergyEngine;
//# sourceMappingURL=engine.d.ts.map
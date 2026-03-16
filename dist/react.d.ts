import type { AdaptationStrategy, EnergyChangeListener, EnergyLevel, EnergyLevelDefinition, EnergyPersistence, EnergyState } from './types';
import type { EnergyEngine } from './engine';
export interface EnergyProviderProps {
    /** Pre-created engine. If provided, other options are ignored. */
    engine?: EnergyEngine;
    /** Initial energy level (ignored if engine provided) */
    defaultLevel?: EnergyLevel;
    /** Persistence adapter (ignored if engine provided) */
    persistence?: EnergyPersistence;
    /** Called on every level change (ignored if engine provided — use engine.subscribe) */
    onLevelChange?: EnergyChangeListener;
    /** Whether to apply energy level to DOM via data attributes */
    applyToDOM?: boolean;
    children: React.ReactNode;
}
export declare function EnergyProvider({ engine: externalEngine, defaultLevel, persistence, onLevelChange, applyToDOM, children, }: EnergyProviderProps): import("react").FunctionComponentElement<import("react").ProviderProps<EnergyEngine | null>>;
/** Get the full energy state (level + timestamp + source) */
export declare function useEnergyState(): EnergyState;
/** Read the current energy level and setter */
export declare function useEnergyLevel(): [EnergyLevel, (level: EnergyLevel) => void];
/** @deprecated Use useEnergyState instead. */
export declare function useFullEnergyState(): EnergyState;
/** Returns a function that cycles to the next energy level */
export declare function useEnergyLevelCycler(): () => void;
/** Resolve a strategy against current energy level */
export declare function useStrategy<T>(strategy: AdaptationStrategy<T>): T;
/** Returns true if current energy level meets or exceeds the given minimum */
export declare function useEnergyGate(minLevel: EnergyLevel): boolean;
export interface EnergyIndicatorRenderProps {
    level: EnergyLevel;
    label: string;
    description: string;
    cognitiveProfile: EnergyLevelDefinition['cognitiveProfile'];
    state: EnergyState;
    definition: EnergyLevelDefinition;
    levels: readonly EnergyLevelDefinition[];
    cycle: () => void;
    setLevel: (level: EnergyLevel) => void;
}
export interface EnergyIndicatorProps {
    children: (props: EnergyIndicatorRenderProps) => React.ReactNode;
}
/** Headless energy indicator — bring your own UI */
export declare function EnergyIndicator({ children }: EnergyIndicatorProps): React.ReactElement;
//# sourceMappingURL=react.d.ts.map
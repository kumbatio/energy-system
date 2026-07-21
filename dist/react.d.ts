import type { EnergyEngine } from './engine.js';
import type { AdaptationStrategy, EnergyChangeListener, EnergyLevel, EnergyLevelDefinition, EnergyPersistence, EnergyPresence, EnergyPresenceMap, EnergySource, EnergyState } from './types.js';
export interface EnergyProviderProps {
    /** Pre-created engine. When provided, this engine is used directly. */
    engine?: EnergyEngine;
    /** Initial energy level when the provider creates its own engine. */
    defaultLevel?: EnergyLevel;
    /** Persistence adapter when the provider creates its own engine. */
    persistence?: EnergyPersistence;
    /** Called on every level change. */
    onLevelChange?: EnergyChangeListener;
    /** Whether to apply energy level to DOM via data attributes */
    applyToDOM?: boolean;
    children: React.ReactNode;
}
export declare function EnergyProvider({ engine: externalEngine, defaultLevel, persistence, onLevelChange, applyToDOM, children, }: EnergyProviderProps): import("react").FunctionComponentElement<import("react").ProviderProps<EnergyEngine | null>>;
/** Get the full energy state (level + timestamp + source) */
export declare function useEnergyState(): EnergyState;
/** Read the current energy level and setter */
export declare function useEnergyLevel(): [
    EnergyLevel,
    (level: EnergyLevel, source?: EnergySource) => void
];
/** @deprecated Use useEnergyState instead. */
export declare function useFullEnergyState(): EnergyState;
/** Returns a function that cycles to the next energy level */
export declare function useEnergyLevelCycler(): () => void;
/** Resolve a strategy against current energy level */
export declare function useStrategy<T>(strategy: AdaptationStrategy<T>): T;
/** Returns true if current energy level meets or exceeds the given minimum */
export declare function useEnergyGate(minLevel: EnergyLevel): boolean;
/** Resolve a presence map against the current energy level */
export declare function useEnergyPresence(presence: EnergyPresenceMap): EnergyPresence;
interface EnergyGateBaseProps {
    /** Rendered instead of children while hidden. Default: nothing. */
    fallback?: React.ReactNode;
    /**
     * Content to gate. The function form receives the resolved presence so
     * 'muted' can style itself differently from 'visible'.
     */
    children: React.ReactNode | ((presence: EnergyPresence) => React.ReactNode);
}
export type EnergyGateProps = EnergyGateBaseProps & ({
    /** Full presence declaration for this element */
    presence: EnergyPresenceMap;
    min?: never;
    max?: never;
} | {
    presence?: never;
    /** Shorthand: visible at or above this level, hidden below */
    min: EnergyLevel;
    /** Optionally also hidden above this level (band gating) */
    max?: EnergyLevel;
} | {
    presence?: never;
    min?: never;
    /** Shorthand: visible at or below this level, hidden above */
    max: EnergyLevel;
});
/**
 * Declarative energy gating for a subtree.
 *
 * ```tsx
 * // Hide the AI chat at 50 and below:
 * <EnergyGate min={75}>
 *   <AiChatPanel />
 * </EnergyGate>
 *
 * // Full presence map, muted state styled by the child:
 * <EnergyGate presence={aiChatPresence}>
 *   {(presence) => <AiChatPanel muted={presence === 'muted'} />}
 * </EnergyGate>
 * ```
 *
 * Headless: renders no wrapper element of its own.
 */
export declare function EnergyGate({ presence, min, max, fallback, children, }: EnergyGateProps): React.ReactNode;
export interface EnergyIndicatorRenderProps {
    level: EnergyLevel;
    label: string;
    description: string;
    cognitiveProfile: EnergyLevelDefinition['cognitiveProfile'];
    state: EnergyState;
    definition: EnergyLevelDefinition;
    levels: readonly EnergyLevelDefinition[];
    cycle: () => void;
    setLevel: (level: EnergyLevel, source?: EnergySource) => void;
}
export interface EnergyIndicatorProps {
    children: (props: EnergyIndicatorRenderProps) => React.ReactNode;
}
/** Headless energy indicator - bring your own UI */
export declare function EnergyIndicator({ children }: EnergyIndicatorProps): React.ReactNode;
export {};
//# sourceMappingURL=react.d.ts.map
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, } from 'react';
import { applyEnergyLevel } from './dom';
import { createEnergyEngine } from './engine';
import { getEnergyLevel, getEnergyLevels } from './levels';
// ── Context ──
const EnergyEngineContext = createContext(null);
function useEngine() {
    const engine = useContext(EnergyEngineContext);
    if (!engine)
        throw new Error('Energy hooks must be used within an EnergyProvider');
    return engine;
}
export function EnergyProvider({ engine: externalEngine, defaultLevel = 100, persistence, onLevelChange, applyToDOM = true, children, }) {
    const engineRef = useRef(null);
    if (!engineRef.current) {
        const options = {
            initialLevel: defaultLevel,
            ...(persistence ? { persistence } : {}),
            ...(onLevelChange ? { onChange: onLevelChange } : {}),
        };
        engineRef.current = externalEngine ?? createEnergyEngine(options);
    }
    const engine = engineRef.current;
    // Sync to DOM when state changes
    useEffect(() => {
        if (!applyToDOM)
            return;
        // Apply initial
        applyEnergyLevel(engine.getState().level);
        // Subscribe to changes
        return engine.subscribe((state) => {
            applyEnergyLevel(state.level);
        });
    }, [engine, applyToDOM]);
    return createElement(EnergyEngineContext.Provider, { value: engine }, children);
}
// ── Hooks ──
function useEnergyStoreState() {
    const engine = useEngine();
    return useSyncExternalStore((onStoreChange) => engine.subscribe(() => { onStoreChange(); }), engine.getState, engine.getState);
}
/** Get the full energy state (level + timestamp + source) */
export function useEnergyState() {
    return useEnergyStoreState();
}
/** Read the current energy level and setter */
export function useEnergyLevel() {
    const engine = useEngine();
    const state = useEnergyStoreState();
    const setLevel = useCallback((level) => {
        engine.setLevel(level);
    }, [engine]);
    return [state.level, setLevel];
}
/** @deprecated Use useEnergyState instead. */
export function useFullEnergyState() {
    return useEnergyStoreState();
}
/** Returns a function that cycles to the next energy level */
export function useEnergyLevelCycler() {
    const engine = useEngine();
    return useCallback(() => {
        engine.cycleLevel();
    }, [engine]);
}
/** Resolve a strategy against current energy level */
export function useStrategy(strategy) {
    const state = useEnergyStoreState();
    return useMemo(() => strategy.resolve(state.level), [strategy, state.level]);
}
/** Returns true if current energy level meets or exceeds the given minimum */
export function useEnergyGate(minLevel) {
    const state = useEnergyStoreState();
    return state.level >= minLevel;
}
/** Headless energy indicator — bring your own UI */
export function EnergyIndicator({ children }) {
    const [level, setLevel] = useEnergyLevel();
    const state = useEnergyStoreState();
    const cycle = useEnergyLevelCycler();
    const definition = useMemo(() => getEnergyLevel(level), [level]);
    const levels = useMemo(() => getEnergyLevels(), []);
    return children({
        level,
        label: definition.label,
        description: definition.description,
        cognitiveProfile: definition.cognitiveProfile,
        state,
        definition,
        levels,
        cycle,
        setLevel,
    });
}
//# sourceMappingURL=react.js.map
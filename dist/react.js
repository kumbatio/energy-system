import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useSyncExternalStore, } from 'react';
import { applyEnergyLevel } from './dom.js';
import { createEnergyEngine } from './engine.js';
import { getEnergyLevel, getEnergyLevels } from './levels.js';
// ── Context ──
const EnergyEngineContext = createContext(null);
function useEngine() {
    const engine = useContext(EnergyEngineContext);
    if (!engine)
        throw new Error('Energy hooks must be used within an EnergyProvider');
    return engine;
}
export function EnergyProvider({ engine: externalEngine, defaultLevel = 100, persistence, onLevelChange, applyToDOM = true, children, }) {
    const internalEngineRef = useRef(null);
    const [, refreshEngine] = useReducer((version) => version + 1, 0);
    // `defaultLevel` and `persistence` are initial-only by contract: they
    // configure the engine the provider creates, they do not reconfigure it.
    const createInternalEngine = () => createEnergyEngine({
        initialLevel: defaultLevel,
        ...(persistence ? { persistence } : {}),
    });
    if (!externalEngine && !internalEngineRef.current) {
        internalEngineRef.current = createInternalEngine();
    }
    const engine = externalEngine ?? internalEngineRef.current;
    if (!engine) {
        throw new Error('EnergyProvider could not initialize an engine instance');
    }
    // Own the internal engine's lifecycle. The cleanup disposes it; the setup
    // recreates it when the previous one was disposed (StrictMode re-runs
    // effects without re-rendering, so render-time lazy init cannot recover).
    useEffect(() => {
        if (externalEngine) {
            // An external engine took over; release the provider-owned engine.
            internalEngineRef.current?.dispose();
            internalEngineRef.current = null;
            return;
        }
        if (!internalEngineRef.current) {
            internalEngineRef.current = createInternalEngine();
            refreshEngine();
        }
        return () => {
            internalEngineRef.current?.dispose();
            internalEngineRef.current = null;
        };
    }, [externalEngine]);
    // Sync to DOM when state changes
    useEffect(() => {
        if (!applyToDOM || typeof document === 'undefined')
            return;
        // Apply initial
        applyEnergyLevel(engine.getState().level);
        // Subscribe to changes
        return engine.subscribe((state) => {
            applyEnergyLevel(state.level);
        });
    }, [engine, applyToDOM]);
    useEffect(() => {
        if (!onLevelChange)
            return;
        return engine.subscribe(onLevelChange);
    }, [engine, onLevelChange]);
    return createElement(EnergyEngineContext.Provider, { value: engine }, children);
}
// ── Hooks ──
function useEnergyStoreState() {
    const engine = useEngine();
    // Stable subscribe identity so useSyncExternalStore doesn't unsubscribe +
    // resubscribe on every render. `engine.getState` is closure-backed (doesn't
    // use `this`), so it's safe to pass unbound as the snapshot getter.
    const subscribe = useCallback((onStoreChange) => engine.subscribe(() => onStoreChange()), [engine]);
    return useSyncExternalStore(subscribe, engine.getState, engine.getState);
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
/** Headless energy indicator - bring your own UI */
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
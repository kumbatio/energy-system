import { createEnergyState, isEnergyLevel } from './levels.js';
function parsePersistedState(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' &&
            parsed !== null &&
            'level' in parsed &&
            isEnergyLevel(parsed.level)) {
            const obj = parsed;
            return createEnergyState(obj.level, obj.source === 'scheduled' || obj.source === 'inferred' ? obj.source : 'manual', typeof obj.timestamp === 'number' ? obj.timestamp : Date.now());
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * localStorage-based persistence adapter.
 * Stores the full EnergyState as JSON.
 */
export function localStoragePersistence(key = 'energy-state') {
    return {
        async load() {
            if (typeof localStorage === 'undefined') {
                return null;
            }
            const raw = localStorage.getItem(key);
            return parsePersistedState(raw);
        },
        async save(state) {
            try {
                localStorage.setItem(key, JSON.stringify(state));
            }
            catch (err) {
                // Rejecting (instead of swallowing) lets the engine's persistence
                // queue observe the failure and retry with backoff. This also covers
                // environments without localStorage (ReferenceError).
                throw new Error(`Failed to save energy state to localStorage key '${key}'`, { cause: err });
            }
        },
        observe(onState) {
            if (typeof globalThis.addEventListener !== 'function' ||
                typeof localStorage === 'undefined') {
                return () => { };
            }
            const handleStorage = (event) => {
                if (event.storageArea !== localStorage)
                    return;
                if (event.key !== key)
                    return;
                const parsed = parsePersistedState(event.newValue);
                if (parsed) {
                    onState(parsed);
                }
            };
            globalThis.addEventListener('storage', handleStorage);
            return () => {
                globalThis.removeEventListener('storage', handleStorage);
            };
        },
    };
}
/**
 * In-memory persistence adapter.
 * Useful for tests, SSR, or ephemeral sessions.
 */
export function memoryPersistence(initial) {
    let stored = initial === undefined
        ? null
        : createEnergyState(initial.level, initial.source, initial.timestamp);
    const listeners = new Set();
    return {
        async load() {
            return stored;
        },
        async save(state) {
            stored = createEnergyState(state.level, state.source, state.timestamp);
            for (const listener of listeners) {
                listener(stored);
            }
        },
        observe(onState) {
            listeners.add(onState);
            return () => {
                listeners.delete(onState);
            };
        },
    };
}
//# sourceMappingURL=persistence.js.map
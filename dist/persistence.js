import { isEnergyLevel } from './levels';
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
            return {
                level: obj.level,
                timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : Date.now(),
                source: obj.source === 'scheduled' || obj.source === 'inferred' ? obj.source : 'manual',
            };
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
                console.error(`[energy-system] Failed to save localStorage state for key '${key}'`, err);
            }
        },
        observe(onState) {
            if (typeof globalThis.addEventListener !== 'function')
                return () => { };
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
    let stored = initial ?? null;
    const listeners = new Set();
    return {
        async load() {
            return stored;
        },
        async save(state) {
            stored = state;
            for (const listener of listeners) {
                listener(state);
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
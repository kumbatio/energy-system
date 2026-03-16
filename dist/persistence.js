import { isEnergyLevel } from './levels';
/**
 * localStorage-based persistence adapter.
 * Stores the full EnergyState as JSON.
 */
export function localStoragePersistence(key = 'energy-state') {
    return {
        async load() {
            try {
                const raw = localStorage.getItem(key);
                if (!raw)
                    return null;
                const parsed = JSON.parse(raw);
                if (typeof parsed === 'object' && parsed !== null &&
                    'level' in parsed && isEnergyLevel(parsed.level)) {
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
        },
        async save(state) {
            try {
                localStorage.setItem(key, JSON.stringify(state));
            }
            catch {
                // Storage full or unavailable — non-critical
            }
        },
    };
}
/**
 * In-memory persistence adapter.
 * Useful for tests, SSR, or ephemeral sessions.
 */
export function memoryPersistence(initial) {
    let stored = initial ?? null;
    return {
        async load() {
            return stored;
        },
        async save(state) {
            stored = state;
        },
    };
}
//# sourceMappingURL=persistence.js.map
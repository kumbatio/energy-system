import type { EnergyPersistence, EnergyState } from './types.js';
/**
 * localStorage-based persistence adapter.
 * Stores the full EnergyState as JSON.
 */
export declare function localStoragePersistence(key?: string): EnergyPersistence;
/**
 * In-memory persistence adapter.
 * Useful for tests, SSR, or ephemeral sessions.
 */
export declare function memoryPersistence(initial?: EnergyState): EnergyPersistence;
//# sourceMappingURL=persistence.d.ts.map
import type { EnergyChangeListener, EnergyLevel } from './types.js';
/**
 * Apply energy level to a root element.
 * Sets `data-energy-level` attribute and CSS custom properties
 * derived from the UI visibility strategy.
 */
export declare function applyEnergyLevel(level: EnergyLevel, root?: HTMLElement): void;
/**
 * Read the current energy level from a root element's data attribute.
 * Returns 100 if no valid level is set.
 */
export declare function readEnergyLevel(root?: HTMLElement): EnergyLevel;
/**
 * Observe energy level changes on a root element via MutationObserver.
 * Calls back with EnergyState (timestamp will be observation time, source 'inferred').
 * Returns a cleanup function to disconnect the observer.
 */
export declare function observeEnergyLevel(callback: EnergyChangeListener, root?: HTMLElement): () => void;
//# sourceMappingURL=dom.d.ts.map
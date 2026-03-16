import type { EnergyLevel, EnergyLevelDefinition, EnergyState } from './types';
/** Get all energy level definitions, ordered highest to lowest */
export declare function getEnergyLevels(): readonly EnergyLevelDefinition[];
/** Get definition for a specific energy level */
export declare function getEnergyLevel(level: EnergyLevel): EnergyLevelDefinition;
/** Cycle to the next energy level: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
export declare function cycleEnergyLevel(current: EnergyLevel): EnergyLevel;
/** Validate that an unknown value is a valid EnergyLevel */
export declare function isEnergyLevel(value: unknown): value is EnergyLevel;
/** Returns true if level `a` represents higher energy than level `b` */
export declare function isHigherEnergy(a: EnergyLevel, b: EnergyLevel): boolean;
/** Create an EnergyState for the current moment */
export declare function createEnergyState(level: EnergyLevel, source?: 'manual' | 'scheduled' | 'inferred', timestamp?: number): EnergyState;
//# sourceMappingURL=levels.d.ts.map
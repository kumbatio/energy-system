import type { EnergyLevel, EnergyLevelDefinition, EnergySource, EnergyState } from './types.js';
/** Get all energy level definitions, ordered highest to lowest */
export declare function getEnergyLevels(): ReadonlyArray<Readonly<EnergyLevelDefinition>>;
/** Get definition for a specific energy level */
export declare function getEnergyLevel(level: EnergyLevel): Readonly<EnergyLevelDefinition>;
/** Cycle to the next energy level: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
export declare function cycleEnergyLevel(current: EnergyLevel): EnergyLevel;
/** Validate that an unknown value is a valid EnergyLevel */
export declare function isEnergyLevel(value: unknown): value is EnergyLevel;
/** Validate that an unknown value is a valid EnergySource */
export declare function isEnergySource(value: unknown): value is EnergySource;
/** Returns true if level `a` represents higher energy than level `b` */
export declare function isHigherEnergy(a: EnergyLevel, b: EnergyLevel): boolean;
/** Create an EnergyState for the current moment */
export declare function createEnergyState(level: EnergyLevel, source?: EnergySource, timestamp?: number): EnergyState;
//# sourceMappingURL=levels.d.ts.map
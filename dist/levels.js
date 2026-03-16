import { ENERGY_LEVEL_VALUES } from './types';
const LEVELS = [
    {
        value: 100,
        key: 'peak',
        label: 'Peak',
        description: 'High capacity. Planning, complex decisions, creative work.',
        cognitiveProfile: {
            decisionCapacity: 'high',
            focusDuration: 'extended',
            taskComplexity: 'complex',
            interruptionTolerance: 'high',
        },
    },
    {
        value: 75,
        key: 'active',
        label: 'Active',
        description: 'Good capacity. Focused execution, problem-solving.',
        cognitiveProfile: {
            decisionCapacity: 'moderate',
            focusDuration: 'moderate',
            taskComplexity: 'moderate',
            interruptionTolerance: 'moderate',
        },
    },
    {
        value: 50,
        key: 'steady',
        label: 'Steady',
        description: 'Moderate capacity. Routine tasks, familiar work.',
        cognitiveProfile: {
            decisionCapacity: 'low',
            focusDuration: 'short',
            taskComplexity: 'routine',
            interruptionTolerance: 'low',
        },
    },
    {
        value: 25,
        key: 'low',
        label: 'Low',
        description: 'Limited capacity. Simple tasks, review, light work.',
        cognitiveProfile: {
            decisionCapacity: 'minimal',
            focusDuration: 'minimal',
            taskComplexity: 'simple',
            interruptionTolerance: 'minimal',
        },
    },
    {
        value: 0,
        key: 'rest',
        label: 'Rest',
        description: 'Depleted. Consumption only \u2014 reading, reflecting.',
        cognitiveProfile: {
            decisionCapacity: 'none',
            focusDuration: 'none',
            taskComplexity: 'consumption',
            interruptionTolerance: 'none',
        },
    },
];
/** Cycle order: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
const CYCLE_ORDER = [100, 75, 50, 25, 0];
/** Get all energy level definitions, ordered highest to lowest */
export function getEnergyLevels() {
    return LEVELS;
}
/** Get definition for a specific energy level */
export function getEnergyLevel(level) {
    const def = LEVELS.find((l) => l.value === level);
    if (!def)
        throw new Error(`Invalid energy level: ${level}`);
    return def;
}
/** Cycle to the next energy level: 100 -> 75 -> 50 -> 25 -> 0 -> 100 */
export function cycleEnergyLevel(current) {
    const fallback = 100;
    const idx = CYCLE_ORDER.indexOf(current);
    if (idx === -1)
        return fallback;
    return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length] ?? fallback;
}
/** Validate that an unknown value is a valid EnergyLevel */
export function isEnergyLevel(value) {
    return typeof value === 'number' && ENERGY_LEVEL_VALUES.has(value);
}
/** Returns true if level `a` represents higher energy than level `b` */
export function isHigherEnergy(a, b) {
    return a > b;
}
/** Create an EnergyState for the current moment */
export function createEnergyState(level, source = 'manual', timestamp = Date.now()) {
    return { level, timestamp, source };
}
//# sourceMappingURL=levels.js.map
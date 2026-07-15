import { ENERGY_LEVEL_VALUES, ENERGY_SOURCE_VALUES } from './types.js';
function freezeObject(value) {
    return Object.freeze(value);
}
let originSequence = 0;
let standaloneRevision = 0;
/** Create a unique producer identity for deterministic cross-context ordering. */
export function createEnergyOrigin() {
    const cryptoApi = globalThis.crypto;
    const randomUUID = cryptoApi?.randomUUID;
    if (typeof randomUUID === 'function') {
        return randomUUID.call(cryptoApi);
    }
    if (typeof cryptoApi?.getRandomValues === 'function') {
        const random = new Uint32Array(4);
        cryptoApi.getRandomValues(random);
        return [...random].map((value) => value.toString(36)).join('-');
    }
    originSequence += 1;
    return `${Date.now().toString(36)}-${originSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
const STANDALONE_ORIGIN = createEnergyOrigin();
function nextStandaloneRevision() {
    standaloneRevision += 1;
    return standaloneRevision;
}
const LEVELS = Object.freeze([
    freezeObject({
        value: 100,
        key: 'peak',
        label: 'Peak',
        description: 'High capacity. Planning, complex decisions, creative work.',
        cognitiveProfile: freezeObject({
            decisionCapacity: 'high',
            focusDuration: 'extended',
            taskComplexity: 'complex',
            interruptionTolerance: 'high',
        }),
    }),
    freezeObject({
        value: 75,
        key: 'active',
        label: 'Active',
        description: 'Good capacity. Focused execution, problem-solving.',
        cognitiveProfile: freezeObject({
            decisionCapacity: 'moderate',
            focusDuration: 'moderate',
            taskComplexity: 'moderate',
            interruptionTolerance: 'moderate',
        }),
    }),
    freezeObject({
        value: 50,
        key: 'steady',
        label: 'Steady',
        description: 'Moderate capacity. Routine tasks, familiar work.',
        cognitiveProfile: freezeObject({
            decisionCapacity: 'low',
            focusDuration: 'short',
            taskComplexity: 'routine',
            interruptionTolerance: 'low',
        }),
    }),
    freezeObject({
        value: 25,
        key: 'low',
        label: 'Low',
        description: 'Limited capacity. Simple tasks, review, light work.',
        cognitiveProfile: freezeObject({
            decisionCapacity: 'minimal',
            focusDuration: 'minimal',
            taskComplexity: 'simple',
            interruptionTolerance: 'minimal',
        }),
    }),
    freezeObject({
        value: 0,
        key: 'rest',
        label: 'Rest',
        description: 'Depleted. Consumption only \u2014 reading, reflecting.',
        cognitiveProfile: freezeObject({
            decisionCapacity: 'none',
            focusDuration: 'none',
            taskComplexity: 'consumption',
            interruptionTolerance: 'none',
        }),
    }),
]);
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
/** Validate that an unknown value is a valid EnergySource */
export function isEnergySource(value) {
    return typeof value === 'string' && ENERGY_SOURCE_VALUES.has(value);
}
/** Returns true if level `a` represents higher energy than level `b` */
export function isHigherEnergy(a, b) {
    return a > b;
}
/** Create an EnergyState for the current moment */
export function createEnergyState(level, source = 'manual', timestamp = Date.now(), revision = nextStandaloneRevision(), origin = STANDALONE_ORIGIN) {
    if (!isEnergyLevel(level)) {
        throw new Error(`Invalid energy level: ${String(level)}`);
    }
    if (!isEnergySource(source)) {
        throw new Error(`Invalid energy source: ${String(source)}`);
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
        throw new Error(`Invalid energy timestamp: ${String(timestamp)}`);
    }
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new Error(`Invalid energy revision: ${String(revision)}`);
    }
    if (typeof origin !== 'string' || origin.trim().length === 0) {
        throw new Error(`Invalid energy origin: ${String(origin)}`);
    }
    return freezeObject({
        level,
        timestamp,
        source,
        revision,
        origin,
    });
}
//# sourceMappingURL=levels.js.map
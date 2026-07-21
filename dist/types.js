// ── Energy Levels ──
function createReadonlySet(values) {
    const set = new Set(values);
    const readonlySet = new Proxy(set, {
        get(target, property) {
            if (property === 'add' || property === 'delete' || property === 'clear') {
                return undefined;
            }
            if (property === 'forEach') {
                return (callback, thisArg) => {
                    for (const value of target) {
                        callback.call(thisArg, value, value, readonlySet);
                    }
                };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    return Object.freeze(readonlySet);
}
/** Valid energy level values for runtime validation */
export const ENERGY_LEVEL_VALUES = createReadonlySet([0, 25, 50, 75, 100]);
/** Valid energy source values for runtime validation */
export const ENERGY_SOURCE_VALUES = createReadonlySet([
    'manual',
    'scheduled',
    'inferred',
]);
/** Valid energy presence values for runtime validation */
export const ENERGY_PRESENCE_VALUES = createReadonlySet([
    'visible',
    'muted',
    'hidden',
]);
//# sourceMappingURL=types.js.map
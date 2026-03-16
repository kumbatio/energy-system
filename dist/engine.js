import { createEnergyState, cycleEnergyLevel } from './levels';
export function createEnergyEngine(options = {}) {
    const { initialLevel = 100, persistence, onChange } = options;
    const listeners = new Set();
    let state = createEnergyState(initialLevel, 'manual');
    function notify(prev) {
        onChange?.(state, prev);
        for (const listener of listeners) {
            listener(state, prev);
        }
    }
    const engine = {
        getState() {
            return state;
        },
        setLevel(level, source = 'manual') {
            const prev = state;
            state = createEnergyState(level, source);
            void persistence?.save(state);
            notify(prev);
        },
        cycleLevel() {
            engine.setLevel(cycleEnergyLevel(state.level), 'manual');
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        resolve(strategy) {
            return strategy.resolve(state.level);
        },
        async hydrate() {
            if (!persistence)
                return;
            const stored = await persistence.load();
            if (stored) {
                const prev = state;
                state = stored;
                notify(prev);
            }
        },
    };
    // Auto-hydrate from persistence
    if (persistence) {
        void engine.hydrate();
    }
    return engine;
}
//# sourceMappingURL=engine.js.map
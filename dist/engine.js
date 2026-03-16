import { createEnergyState, cycleEnergyLevel, isEnergyLevel } from './levels';
function resolveNow(clock) {
    if (typeof clock === 'function')
        return clock;
    if (clock?.now)
        return () => clock.now();
    return () => Date.now();
}
function isSameState(a, b) {
    return a.level === b.level && a.timestamp === b.timestamp && a.source === b.source;
}
function normalizeState(candidate, now) {
    if (!isEnergyLevel(candidate.level)) {
        throw new Error(`Invalid energy level from persistence: ${String(candidate.level)}`);
    }
    const timestamp = Number.isFinite(candidate.timestamp) ? candidate.timestamp : now();
    const source = candidate.source === 'scheduled' || candidate.source === 'inferred' ? candidate.source : 'manual';
    return {
        level: candidate.level,
        timestamp,
        source,
    };
}
export function createEnergyEngine(options = {}) {
    const { initialLevel = 100, persistence, onChange, clock } = options;
    const now = resolveNow(clock);
    const listeners = new Set();
    let isSaving = false;
    let state = createEnergyState(initialLevel, 'manual', now());
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
            const next = createEnergyState(level, source, now());
            if (isSameState(next, state))
                return;
            const prev = state;
            state = next;
            if (persistence) {
                isSaving = true;
                void persistence
                    .save(state)
                    .catch((err) => {
                    console.error('[energy-system] Failed to persist energy state', err);
                })
                    .finally(() => {
                    isSaving = false;
                });
            }
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
                const normalized = normalizeState(stored, now);
                if (isSameState(normalized, state))
                    return;
                const prev = state;
                state = normalized;
                notify(prev);
            }
        },
    };
    // Auto-hydrate from persistence
    if (persistence) {
        void engine.hydrate();
    }
    if (persistence?.observe) {
        persistence.observe((externalState) => {
            if (isSaving)
                return;
            const normalized = normalizeState(externalState, now);
            if (isSameState(normalized, state))
                return;
            const prev = state;
            state = normalized;
            notify(prev);
        });
    }
    return engine;
}
//# sourceMappingURL=engine.js.map
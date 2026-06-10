import { createEnergyState, cycleEnergyLevel, isEnergyLevel, isEnergySource } from './levels.js';
function logEngineError(message, err) {
    console.error(`[energy-system] ${message}`, err);
}
const PERSIST_RETRY_INITIAL_MS = 250;
const PERSIST_RETRY_MAX_MS = 30_000;
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
function getSourcePriority(source) {
    switch (source) {
        case 'manual':
            return 3;
        case 'scheduled':
            return 2;
        case 'inferred':
            return 1;
    }
}
function isPreferredExternalState(candidate, current) {
    if (candidate.timestamp !== current.timestamp) {
        return candidate.timestamp > current.timestamp;
    }
    if (candidate.source !== current.source) {
        return getSourcePriority(candidate.source) > getSourcePriority(current.source);
    }
    return false;
}
function normalizeState(candidate, now) {
    if (!isEnergyLevel(candidate.level)) {
        throw new Error(`Invalid energy level from persistence: ${String(candidate.level)}`);
    }
    const timestamp = Number.isFinite(candidate.timestamp) ? candidate.timestamp : now();
    const source = isEnergySource(candidate.source) ? candidate.source : 'manual';
    return createEnergyState(candidate.level, source, timestamp);
}
export function createEnergyEngine(options = {}) {
    const { initialLevel = 100, persistence, onChange, clock } = options;
    const now = resolveNow(clock);
    const listeners = new Set();
    let stateVersion = 0;
    let disposed = false;
    let state = createEnergyState(initialLevel, 'manual', now());
    let persistedVersion = 0;
    let requestedPersistVersion = 0;
    let persistTask;
    let persistRetryTimer;
    let persistRetryDelayMs = PERSIST_RETRY_INITIAL_MS;
    function queuePersist() {
        if (!persistence || disposed)
            return;
        requestedPersistVersion = Math.max(requestedPersistVersion, stateVersion);
        if (persistTask)
            return;
        persistTask = (async () => {
            while (!disposed && persistedVersion < requestedPersistVersion) {
                const snapshot = state;
                const snapshotVersion = stateVersion;
                try {
                    await persistence.save(snapshot);
                    persistedVersion = Math.max(persistedVersion, snapshotVersion);
                    persistRetryDelayMs = PERSIST_RETRY_INITIAL_MS;
                }
                catch (err) {
                    logEngineError('Failed to persist energy state', err);
                    persistTask = undefined;
                    if (!disposed && !persistRetryTimer && persistedVersion < requestedPersistVersion) {
                        const retryDelayMs = persistRetryDelayMs;
                        // Exponential backoff so a persistently failing store (e.g. quota
                        // exceeded) is not hammered every 250ms forever.
                        persistRetryDelayMs = Math.min(persistRetryDelayMs * 2, PERSIST_RETRY_MAX_MS);
                        persistRetryTimer = setTimeout(() => {
                            persistRetryTimer = undefined;
                            queuePersist();
                        }, retryDelayMs);
                    }
                    return;
                }
            }
            persistTask = undefined;
            if (!disposed && persistedVersion < requestedPersistVersion) {
                queuePersist();
            }
        })();
    }
    function notify(prev) {
        if (onChange) {
            try {
                onChange(state, prev);
            }
            catch (err) {
                logEngineError('onChange listener threw', err);
            }
        }
        for (const listener of listeners) {
            try {
                listener(state, prev);
            }
            catch (err) {
                logEngineError('Energy subscriber threw', err);
            }
        }
    }
    function applyState(next) {
        // A disposed engine is inert: it must not mutate state, notify onChange,
        // or schedule persistence after its resources were released.
        if (disposed || isSameState(next, state))
            return false;
        const prev = state;
        state = next;
        stateVersion += 1;
        notify(prev);
        if (persistence) {
            queuePersist();
        }
        return true;
    }
    let disposePersistenceObservation = () => { };
    const engine = {
        getState() {
            return state;
        },
        setLevel(level, source = 'manual') {
            applyState(createEnergyState(level, source, now()));
        },
        cycleLevel() {
            engine.setLevel(cycleEnergyLevel(state.level), 'manual');
        },
        subscribe(listener) {
            if (disposed) {
                return () => { };
            }
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        resolve(strategy) {
            return strategy.resolve(state.level);
        },
        async hydrate() {
            if (!persistence || disposed)
                return;
            const hydrateStartVersion = stateVersion;
            let stored;
            try {
                stored = await persistence.load();
            }
            catch (err) {
                logEngineError('Failed to load persisted energy state', err);
                return;
            }
            if (!stored || disposed)
                return;
            let normalized;
            try {
                normalized = normalizeState(stored, now);
            }
            catch (err) {
                logEngineError('Ignoring invalid persisted energy state', err);
                return;
            }
            if (isSameState(normalized, state))
                return;
            if (hydrateStartVersion === stateVersion || isPreferredExternalState(normalized, state)) {
                applyState(normalized);
            }
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            disposePersistenceObservation();
            if (persistRetryTimer) {
                clearTimeout(persistRetryTimer);
                persistRetryTimer = undefined;
            }
            listeners.clear();
        },
    };
    // Auto-hydrate from persistence
    if (persistence) {
        void engine.hydrate().catch((err) => {
            logEngineError('Unexpected hydrate failure', err);
        });
    }
    if (persistence?.observe) {
        try {
            disposePersistenceObservation = persistence.observe((externalState) => {
                if (disposed)
                    return;
                let normalized;
                try {
                    normalized = normalizeState(externalState, now);
                }
                catch (err) {
                    logEngineError('Ignoring invalid observed energy state', err);
                    return;
                }
                if (!isPreferredExternalState(normalized, state))
                    return;
                applyState(normalized);
            });
        }
        catch (err) {
            logEngineError('Failed to subscribe to persistence observation', err);
        }
    }
    return engine;
}
//# sourceMappingURL=engine.js.map
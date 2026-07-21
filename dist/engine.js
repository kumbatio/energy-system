import { createEnergyOrigin, createEnergyState, cycleEnergyLevel, isEnergyLevel, isEnergySource, } from './levels.js';
function logEngineError(message, err) {
    console.error(`[energy-system] ${message}`, err);
}
const PERSIST_RETRY_INITIAL_MS = 250;
const PERSIST_RETRY_MAX_MS = 30_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
function resolveNow(clock) {
    if (typeof clock === 'function')
        return clock;
    if (clock?.now)
        return () => clock.now();
    return () => Date.now();
}
function isSameState(a, b) {
    return (a.level === b.level &&
        a.timestamp === b.timestamp &&
        a.source === b.source &&
        a.revision === b.revision &&
        a.origin === b.origin);
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
    if (candidate.revision !== current.revision) {
        return candidate.revision > current.revision;
    }
    if (candidate.source !== current.source) {
        return getSourcePriority(candidate.source) > getSourcePriority(current.source);
    }
    if (candidate.origin !== current.origin) {
        return candidate.origin > current.origin;
    }
    // A producer must not reuse an identity for different state. Keep a final
    // deterministic fallback so malformed duplicate identities still converge.
    if (candidate.level !== current.level) {
        return candidate.level > current.level;
    }
    return false;
}
function normalizeState(candidate, nowMs, maxFutureSkewMs) {
    if (!isEnergyLevel(candidate.level)) {
        throw new Error(`Invalid energy level from persistence: ${String(candidate.level)}`);
    }
    if (!isEnergySource(candidate.source)) {
        throw new Error(`Invalid energy source from persistence: ${String(candidate.source)}`);
    }
    if (candidate.timestamp - nowMs > maxFutureSkewMs) {
        throw new Error(`Energy state timestamp ${String(candidate.timestamp)} exceeds local clock by more than ${String(maxFutureSkewMs)}ms`);
    }
    return createEnergyState(candidate.level, candidate.source, candidate.timestamp, candidate.revision, candidate.origin);
}
export function createEnergyEngine(options = {}) {
    const { initialLevel = 100, persistence, onChange, onPersistenceError, clock, originId = createEnergyOrigin(), maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS, } = options;
    if (typeof maxFutureSkewMs !== 'number' ||
        (!Number.isFinite(maxFutureSkewMs) && maxFutureSkewMs !== Number.POSITIVE_INFINITY) ||
        maxFutureSkewMs < 0) {
        throw new Error(`Invalid maxFutureSkewMs: ${String(maxFutureSkewMs)}`);
    }
    const now = resolveNow(clock);
    const listeners = new Set();
    const notificationQueue = [];
    let stateVersion = 0;
    let disposed = false;
    let isNotifying = false;
    let state = createEnergyState(initialLevel, 'manual', now(), 0, originId);
    // Version 0 is the initial in-memory state, not proof that a persistence
    // adapter has durably stored it. Starting below the version domain keeps
    // flush() honest even before the first state transition.
    let persistedVersion = -1;
    let requestedPersistVersion = 0;
    let persistTask;
    let persistRetryTimer;
    let persistRetryDelayMs = PERSIST_RETRY_INITIAL_MS;
    let initialHydrationTask;
    let hasCompletedPersistenceLoad = false;
    let persistenceLoadError;
    const persistWaiters = [];
    function resolvePersistWaiters() {
        for (let index = persistWaiters.length - 1; index >= 0; index -= 1) {
            const waiter = persistWaiters[index];
            if (waiter && waiter.version <= persistedVersion) {
                persistWaiters.splice(index, 1);
                waiter.resolve();
            }
        }
    }
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
                    resolvePersistWaiters();
                }
                catch (err) {
                    logEngineError('Failed to persist energy state', err);
                    if (onPersistenceError) {
                        try {
                            onPersistenceError(err, snapshot);
                        }
                        catch (err) {
                            logEngineError('onPersistenceError callback threw', err);
                        }
                    }
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
    function notify(next, prev) {
        notificationQueue.push({ next, prev });
        if (isNotifying)
            return;
        isNotifying = true;
        try {
            while (notificationQueue.length > 0) {
                const transition = notificationQueue.shift();
                if (!transition)
                    continue;
                if (onChange) {
                    try {
                        onChange(transition.next, transition.prev);
                    }
                    catch (err) {
                        logEngineError('onChange listener threw', err);
                    }
                }
                const transitionListeners = [...listeners];
                for (const listener of transitionListeners) {
                    try {
                        listener(transition.next, transition.prev);
                    }
                    catch (err) {
                        logEngineError('Energy subscriber threw', err);
                    }
                }
            }
        }
        finally {
            isNotifying = false;
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
        notify(next, prev);
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
            if (disposed)
                return;
            const wallTime = now();
            let timestamp = Math.max(wallTime, state.timestamp);
            let revision = 0;
            if (timestamp === state.timestamp) {
                if (state.revision === Number.MAX_SAFE_INTEGER) {
                    // Preserve a strictly newer ordering key without producing an
                    // invalid revision when a deterministic/future clock cannot advance.
                    timestamp += 1;
                }
                else {
                    revision = state.revision + 1;
                }
            }
            applyState(createEnergyState(level, source, timestamp, revision, originId));
        },
        cycleLevel() {
            if (disposed)
                return;
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
                hasCompletedPersistenceLoad = true;
                persistenceLoadError = undefined;
            }
            catch (err) {
                persistenceLoadError = err;
                logEngineError('Failed to load persisted energy state', err);
                return;
            }
            if (!stored || disposed)
                return;
            let normalized;
            try {
                normalized = normalizeState(stored, now(), maxFutureSkewMs);
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
        async flush() {
            if (!persistence)
                return;
            if (disposed) {
                throw new Error('Cannot flush a disposed energy engine');
            }
            // Do not persist the default state over an unread stored value. Once a
            // local/external transition exists, that newer intent can persist
            // immediately; an unchanged initial state must wait for auto-hydration.
            if (stateVersion === 0 && initialHydrationTask) {
                await initialHydrationTask;
            }
            if (disposed) {
                throw new Error('Cannot flush a disposed energy engine');
            }
            if (stateVersion === 0 && !hasCompletedPersistenceLoad) {
                throw new Error('Cannot flush the initial energy state because persistence hydration did not complete', { cause: persistenceLoadError });
            }
            const targetVersion = stateVersion;
            if (persistedVersion >= targetVersion)
                return;
            requestedPersistVersion = Math.max(requestedPersistVersion, targetVersion);
            const pending = new Promise((resolve, reject) => {
                persistWaiters.push({ version: targetVersion, resolve, reject });
            });
            queuePersist();
            return pending;
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            try {
                disposePersistenceObservation();
            }
            catch (err) {
                logEngineError('Failed to release persistence observation', err);
            }
            if (persistRetryTimer) {
                clearTimeout(persistRetryTimer);
                persistRetryTimer = undefined;
            }
            listeners.clear();
            notificationQueue.length = 0;
            const disposeError = new Error('Energy engine disposed before persistence completed');
            for (const waiter of persistWaiters.splice(0)) {
                waiter.reject(disposeError);
            }
        },
    };
    // Auto-hydrate from persistence
    if (persistence) {
        initialHydrationTask = engine.hydrate().catch((err) => {
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
                    normalized = normalizeState(externalState, now(), maxFutureSkewMs);
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
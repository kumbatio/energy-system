import { parseExternalEnergyState } from './levels.ts'
import { logContainedError } from './runtime.ts'
import type { EnergyPersistence, EnergyState } from './types.ts'

/*
 * `null` means "nothing usable is stored", which the engine treats as a fresh
 * install. Corrupt or schema-violating data reaches the same conclusion, but it
 * is a different event and gets logged: silently equating "storage is damaged"
 * with "first run" is how a user's persisted level disappears without trace.
 */
function parsePersistedState(
  source: string,
  raw: string | null,
  onCorrupt?: (raw: string, error: unknown) => EnergyState | null | undefined,
): EnergyState | null {
  if (!raw) return null

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (err: unknown) {
    logContainedError(`Discarding unparseable persisted energy state (${source})`, err)
    const recovered = onCorrupt?.(raw, err)
    return recovered ?? null
  }

  try {
    // Shape, key set and field invariants are all one boundary rule, enforced
    // to the letter of spec/energy-state.schema.json - including its
    // `additionalProperties: false`. Storage written by a newer or foreign
    // producer is rejected, not quietly trimmed to fit.
    return parseExternalEnergyState(parsed)
  } catch (err: unknown) {
    // Distinct from the unparseable case above: the bytes were JSON, the
    // content was not an EnergyState. The thrown error carries which rule broke.
    logContainedError(`Discarding malformed persisted energy state (${source})`, err)
    const recovered = onCorrupt?.(raw, err)
    return recovered ?? null
  }
}

export interface LocalStoragePersistenceOptions {
  /**
   * Called when stored data cannot be parsed or fails schema validation.
   * Return a valid `EnergyState` to migrate/recover, or `null`/`undefined` to
   * discard it.
   */
  onCorruptState?: (raw: string, error: unknown) => EnergyState | null | undefined
  /**
   * Remove corrupt/malformed entries automatically after reporting them so
   * subsequent page loads don't log the same error forever. Default: `false`.
   */
  clearOnCorrupt?: boolean
}

/**
 * localStorage-based persistence adapter.
 * Stores the full EnergyState as JSON.
 */
export function localStoragePersistence(
  key = 'energy-state',
  options: LocalStoragePersistenceOptions = {},
): EnergyPersistence {
  const { onCorruptState, clearOnCorrupt = false } = options

  const handleCorrupt = (raw: string, err: unknown): EnergyState | null => {
    const recovered = onCorruptState?.(raw, err) ?? null
    if (!recovered && clearOnCorrupt && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key)
      } catch {
        // Ignore read-only storage failures during cleanup.
      }
    }
    return recovered
  }

  return {
    async load(): Promise<EnergyState | null> {
      if (typeof localStorage === 'undefined') {
        return null
      }

      const raw = localStorage.getItem(key)
      return parsePersistedState(`localStorage key '${key}'`, raw, handleCorrupt)
    },
    async save(state: EnergyState): Promise<void> {
      try {
        localStorage.setItem(key, JSON.stringify(state))
      } catch (err: unknown) {
        // Rejecting (instead of swallowing) lets the engine's persistence
        // queue observe the failure and retry with backoff. This also covers
        // environments without localStorage (ReferenceError).
        throw new Error(`Failed to save energy state to localStorage key '${key}'`, { cause: err })
      }
    },
    observe(onState) {
      if (
        typeof globalThis.addEventListener !== 'function' ||
        typeof localStorage === 'undefined'
      ) {
        return () => {}
      }

      const handleStorage = (event: StorageEvent) => {
        if (event.storageArea !== localStorage) return
        if (event.key !== key) return

        const parsed = parsePersistedState(
          `storage event for key '${key}'`,
          event.newValue,
          handleCorrupt,
        )
        if (parsed) {
          onState(parsed)
        }
      }

      globalThis.addEventListener('storage', handleStorage)
      return () => {
        globalThis.removeEventListener('storage', handleStorage)
      }
    },
  }
}

// ── Cookie persistence (SSR-friendly) ──

export interface CookiePersistenceOptions {
  /** Cookie name. Default: `'kumbatio-energy'`. */
  name?: string
  /** Cookie max-age in seconds. Default: 30 days (`2_592_000`). */
  maxAgeSeconds?: number
  /** Cookie path. Default: `'/'`. */
  path?: string
  /** SameSite attribute. Default: `'Lax'`. */
  sameSite?: 'Strict' | 'Lax' | 'None'
  /** Set `Secure` attribute. Default: `false` (auto-recommended on HTTPS). */
  secure?: boolean
}

/**
 * Parse an `EnergyState` from a `Cookie` header string (server-side) or
 * `document.cookie` (browser). Returns `null` when absent or invalid.
 */
export function parseEnergyCookie(
  cookieHeader: string | null | undefined,
  name = 'kumbatio-energy',
): EnergyState | null {
  if (!cookieHeader) return null

  const pairs = cookieHeader.split(';')
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex === -1) continue
    const cookieKey = pair.slice(0, eqIndex).trim()
    if (cookieKey !== name) continue
    const rawValue = pair.slice(eqIndex + 1).trim()
    try {
      const decoded = decodeURIComponent(rawValue)
      return parsePersistedState(`cookie '${name}'`, decoded)
    } catch (err: unknown) {
      logContainedError(`Discarding undecodable energy cookie '${name}'`, err)
      return null
    }
  }

  return null
}

/**
 * Cookie-backed persistence adapter so SSR frameworks (Next.js, Remix, Astro,
 * SvelteKit) can read the user's real energy level on the server and render
 * matching HTML with zero flash and zero hydration mismatch.
 */
export function cookiePersistence(options: CookiePersistenceOptions = {}): EnergyPersistence {
  const {
    name = 'kumbatio-energy',
    maxAgeSeconds = 30 * 24 * 60 * 60,
    path = '/',
    sameSite = 'Lax',
    secure = false,
  } = options

  return {
    async load(): Promise<EnergyState | null> {
      if (typeof document === 'undefined') return null
      return parseEnergyCookie(document.cookie, name)
    },
    async save(state: EnergyState): Promise<void> {
      if (typeof document === 'undefined') {
        throw new TypeError(`Cannot save energy cookie '${name}' outside a browser document`)
      }
      const validated = parseExternalEnergyState(state)
      const encoded = encodeURIComponent(JSON.stringify(validated))
      const parts = [
        `${name}=${encoded}`,
        `Path=${path}`,
        `Max-Age=${String(maxAgeSeconds)}`,
        `SameSite=${sameSite}`,
      ]
      if (secure) parts.push('Secure')
      document.cookie = parts.join('; ')
    },
  }
}

// ── BroadcastChannel persistence (cross-tab & Web Worker sync) ──

/**
 * Wrap any persistence adapter with a `BroadcastChannel` so tabs, iframes, and
 * Web Workers sharing an origin sync immediately—even when the underlying
 * store does not emit `storage` events (such as `cookiePersistence` or
 * `memoryPersistence`).
 */
export function broadcastChannelPersistence(
  backing: EnergyPersistence,
  channelName = 'kumbatio-energy-state',
): EnergyPersistence {
  return {
    load: () => backing.load(),
    async save(state: EnergyState): Promise<void> {
      const validated = parseExternalEnergyState(state)
      await backing.save(validated)
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const channel = new BroadcastChannel(channelName)
          channel.postMessage(validated)
          channel.close()
        } catch (err: unknown) {
          logContainedError(`Failed to broadcast energy state on '${channelName}'`, err)
        }
      }
    },
    observe(onState) {
      const cleanups: Array<() => void> = []
      if (backing.observe) {
        cleanups.push(backing.observe(onState))
      }

      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(channelName)
        channel.onmessage = (event: MessageEvent) => {
          try {
            onState(parseExternalEnergyState(event.data))
          } catch (err: unknown) {
            logContainedError(
              `Ignoring invalid BroadcastChannel energy state (${channelName})`,
              err,
            )
          }
        }
        cleanups.push(() => {
          channel.close()
        })
      }

      return () => {
        for (const cleanup of cleanups) cleanup()
      }
    },
  }
}

// ── Browser extension bridge persistence ──

interface KumbatioExtensionBridge {
  getState(): EnergyState | null
  setState?(state: EnergyState): void
  subscribe?(listener: (state: EnergyState) => void): () => void
}

/**
 * Persistence adapter that connects a web app to the Kumbatio Energy Browser
 * Extension (or any compatible `window.__KUMBATIO_ENERGY__` bridge), falling
 * back cleanly to `fallback` (default `localStoragePersistence`) when no
 * extension is installed.
 */
export function browserExtensionPersistence(
  fallback: EnergyPersistence = localStoragePersistence(),
): EnergyPersistence {
  const getBridge = (): KumbatioExtensionBridge | null => {
    const candidate = (globalThis as { __KUMBATIO_ENERGY__?: unknown }).__KUMBATIO_ENERGY__
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      'getState' in candidate &&
      typeof (candidate as KumbatioExtensionBridge).getState === 'function'
    ) {
      return candidate as KumbatioExtensionBridge
    }
    return null
  }

  return {
    async load(): Promise<EnergyState | null> {
      const bridge = getBridge()
      if (bridge) {
        const fromExtension = bridge.getState()
        if (fromExtension) {
          try {
            return parseExternalEnergyState(fromExtension)
          } catch (err: unknown) {
            logContainedError('Ignoring invalid state from browser extension bridge', err)
          }
        }
      }
      return fallback.load()
    },
    async save(state: EnergyState): Promise<void> {
      const validated = parseExternalEnergyState(state)
      const bridge = getBridge()
      bridge?.setState?.(validated)
      await fallback.save(validated)
    },
    observe(onState) {
      const cleanups: Array<() => void> = []
      if (fallback.observe) {
        cleanups.push(fallback.observe(onState))
      }

      const bridge = getBridge()
      if (bridge?.subscribe) {
        cleanups.push(
          bridge.subscribe((external) => {
            try {
              onState(parseExternalEnergyState(external))
            } catch (err: unknown) {
              logContainedError('Ignoring invalid observed state from browser extension', err)
            }
          }),
        )
      } else if (typeof globalThis.addEventListener === 'function') {
        const handleEvent = (event: Event) => {
          const { detail } = event as CustomEvent<unknown>
          try {
            onState(parseExternalEnergyState(detail))
          } catch (err: unknown) {
            logContainedError('Ignoring invalid kumbatio:energy-change event', err)
          }
        }
        globalThis.addEventListener('kumbatio:energy-change', handleEvent)
        cleanups.push(() => {
          globalThis.removeEventListener('kumbatio:energy-change', handleEvent)
        })
      }

      return () => {
        for (const cleanup of cleanups) cleanup()
      }
    },
  }
}

/**
 * In-memory persistence adapter.
 * Useful for tests, SSR, or ephemeral sessions.
 */
export function memoryPersistence(initial?: EnergyState): EnergyPersistence {
  let stored = initial === undefined ? null : parseExternalEnergyState(initial)
  const listeners = new Set<(state: EnergyState) => void>()

  return {
    async load(): Promise<EnergyState | null> {
      return stored
    },
    async save(state: EnergyState): Promise<void> {
      // Re-parsed rather than stored by reference: this adapter is the one
      // observers read back from, so what it hands out must satisfy the
      // interchange contract exactly, whoever called save().
      const next = parseExternalEnergyState(state)
      stored = next
      for (const listener of listeners) {
        listener(next)
      }
    },
    observe(onState) {
      listeners.add(onState)
      return () => {
        listeners.delete(onState)
      }
    },
  }
}

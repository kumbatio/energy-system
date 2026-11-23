'use client'

// Every export in this module is a hook, a context, or a component built on
// one. Marking the module itself is what lets a consumer import it directly
// from a Server Component tree (Next.js App Router, RSC bundlers) without
// having to wrap it in their own client boundary first. The directive must
// stay the first statement in the file for bundlers to honour it.

import type { ComponentType, ReactNode } from 'react'
import * as ReactNamespace from 'react'
import {
  Fragment,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from 'react'

import { bindEnergyEngine, createEnergyAnnouncer } from './dom.ts'
import type { EnergyEngine } from './engine.ts'
import { createEnergyEngine } from './engine.ts'
import { getEnergyLevel, getEnergyLevels, isEnergyLevel } from './levels.ts'
import {
  defineEnergyPresence,
  presenceAtOrAbove,
  presenceAtOrBelow,
  resolveEnergyPresence,
} from './presence.ts'
import { logContainedError } from './runtime.ts'
import type {
  AdaptationStrategy,
  EnergyChangeListener,
  EnergyLevel,
  EnergyLevelDefinition,
  EnergyPersistence,
  EnergyPresence,
  EnergyPresenceMap,
  EnergySource,
  EnergyState,
} from './types.ts'

// ── React 19.2 <Activity> feature detection (supports React 18.0+) ──

type ActivityComponentType = ComponentType<{ mode: 'visible' | 'hidden'; children?: ReactNode }>

const ReactActivity: ActivityComponentType | undefined = (
  ReactNamespace as { Activity?: ActivityComponentType }
).Activity

// ── Context ──

const EnergyEngineContext = createContext<EnergyEngine | null>(null)

function callLevelChange(
  listener: EnergyChangeListener | undefined,
  state: EnergyState,
  prev: EnergyState,
): void {
  if (!listener) return

  try {
    listener(state, prev)
  } catch (err: unknown) {
    logContainedError('onLevelChange listener threw', err)
  }
}

function useEngine(): EnergyEngine {
  const engine = useContext(EnergyEngineContext)
  if (!engine) throw new Error('Energy hooks must be used within an EnergyProvider')
  return engine
}

// ── Provider ──

export interface EnergyProviderProps {
  /** Pre-created engine. When provided, this engine is used directly. */
  engine?: EnergyEngine
  /** Initial energy level when the provider creates its own engine. */
  defaultLevel?: EnergyLevel
  /**
   * Optional server-resolved state (e.g. from `parseEnergyCookie()` in SSR) so
   * the server HTML and first client render agree with zero hydration flash.
   */
  initialState?: EnergyState | null
  /** Persistence adapter when the provider creates its own engine. */
  persistence?: EnergyPersistence
  /** Called on every level change. */
  onLevelChange?: EnergyChangeListener
  /** Whether to apply energy level to DOM via data attributes */
  applyToDOM?: boolean
  /**
   * Element the level is projected onto. Default: `document.body`.
   *
   * Pass `() => document.documentElement` when the stylesheet keys off
   * `[data-energy-level]` at the root - resolved inside the effect, so the
   * render phase never touches the DOM. Whatever the target, the provider
   * snapshots what was there, layers overlapping providers, and restores the
   * baseline on unmount.
   */
  domTarget?: HTMLElement | (() => HTMLElement | null)
  /**
   * Automatically mount a polite ARIA live region announcing energy transitions
   * to screen readers (SPEC.md §10.4). Default: `false`.
   */
  announceTransitions?: boolean
  children: ReactNode
}

export function EnergyProvider({
  engine: externalEngine,
  defaultLevel = 100,
  initialState,
  persistence,
  onLevelChange,
  applyToDOM = true,
  domTarget,
  announceTransitions = false,
  children,
}: EnergyProviderProps) {
  const internalEngineRef = useRef<EnergyEngine | null>(null)
  const [, refreshEngine] = useReducer((version: number) => version + 1, 0)
  const onLevelChangeRef = useRef(onLevelChange)
  const domTargetRef = useRef(domTarget)
  const isProviderCommittedRef = useRef(false)
  const pendingInternalChangesRef = useRef<Array<{ state: EnergyState; prev: EnergyState }>>([])

  useInsertionEffect(() => {
    onLevelChangeRef.current = onLevelChange
    domTargetRef.current = domTarget
  }, [onLevelChange, domTarget])

  const effectiveDefaultLevel = initialState?.level ?? defaultLevel

  const createInternalEngine = () =>
    createEnergyEngine({
      initialLevel: effectiveDefaultLevel,
      autoStart: false,
      ...(persistence ? { persistence } : {}),
      onChange(state, prev) {
        if (isProviderCommittedRef.current) {
          callLevelChange(onLevelChangeRef.current, state, prev)
          return
        }

        if (onLevelChangeRef.current) {
          pendingInternalChangesRef.current.push({ state, prev })
        }
      },
    })

  if (!externalEngine && !internalEngineRef.current) {
    internalEngineRef.current = createInternalEngine()
  }

  const engine = externalEngine ?? internalEngineRef.current

  if (!engine) {
    throw new Error('EnergyProvider could not initialize an engine instance')
  }

  // Own the internal engine's lifecycle. The cleanup disposes it; the setup
  // recreates it when the previous one was disposed (StrictMode re-runs
  // effects without re-rendering, so render-time lazy init cannot recover).
  useEffect(() => {
    if (externalEngine) {
      internalEngineRef.current?.dispose()
      internalEngineRef.current = null
      return
    }

    if (!internalEngineRef.current) {
      isProviderCommittedRef.current = false
      pendingInternalChangesRef.current.length = 0
      internalEngineRef.current = createInternalEngine()
      refreshEngine()
    }

    internalEngineRef.current.start()

    return () => {
      internalEngineRef.current?.dispose()
      internalEngineRef.current = null
    }
  }, [externalEngine])

  useLayoutEffect(() => {
    if (externalEngine) return

    isProviderCommittedRef.current = true
    const pending = pendingInternalChangesRef.current.splice(0)
    for (const transition of pending) {
      callLevelChange(onLevelChangeRef.current, transition.state, transition.prev)
    }

    return () => {
      isProviderCommittedRef.current = false
      pendingInternalChangesRef.current.length = 0
    }
  }, [engine, externalEngine])

  useInsertionEffect(() => {
    if (!externalEngine) return

    return engine.subscribe((state, prev) => {
      callLevelChange(onLevelChangeRef.current, state, prev)
    })
  }, [engine, externalEngine])

  // Sync to DOM using the shared projection stack from `@kumbatio/energy-system/dom`.
  useEffect(() => {
    if (!applyToDOM || typeof document === 'undefined') return

    const requested = domTargetRef.current
    const target = (typeof requested === 'function' ? requested() : requested) ?? document.body
    if (!target) return

    return bindEnergyEngine(engine, target)
  }, [engine, applyToDOM])

  // Optional built-in ARIA live-region announcer (SPEC.md §10.4).
  useEffect(() => {
    if (!announceTransitions || typeof document === 'undefined' || !document.body) return
    return createEnergyAnnouncer(engine)
  }, [engine, announceTransitions])

  return createElement(EnergyEngineContext.Provider, { value: engine }, children)
}

// ── Hooks ──

const subscribeNoop = () => () => {}

/**
 * Returns `false` during SSR and on the first client hydration render, then
 * `true` after hydration commits. Useful when reading client-only storage
 * without cookie SSR handoff.
 */
export function useIsEnergyHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )
}

function useEnergyStoreState(): EnergyState {
  const engine = useEngine()
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      engine.subscribe(() => {
        onStoreChange()
      }),
    [engine],
  )
  return useSyncExternalStore(subscribe, engine.getState, engine.getState)
}

/** Get the full energy state (level + timestamp + source) */
export function useEnergyState(): EnergyState {
  return useEnergyStoreState()
}

/** Read the current energy level and setter */
export function useEnergyLevel(): [
  EnergyLevel,
  (level: EnergyLevel, source?: EnergySource) => void,
] {
  const engine = useEngine()
  const state = useEnergyStoreState()
  const setLevel = useCallback(
    (level: EnergyLevel, source: EnergySource = 'manual') => {
      engine.setLevel(level, source)
    },
    [engine],
  )
  return [state.level, setLevel]
}

/** Returns a function that cycles to the next energy level */
export function useEnergyLevelCycler(): () => void {
  const engine = useEngine()
  return useCallback(() => {
    engine.cycleLevel()
  }, [engine])
}

/** Resolve a strategy against current energy level */
export function useStrategy<T>(strategy: AdaptationStrategy<T>): T {
  const state = useEnergyStoreState()
  return useMemo(() => strategy.resolve(state.level), [strategy, state.level])
}

/** Returns true if current energy level meets or exceeds the given minimum */
export function useEnergyGate(minLevel: EnergyLevel): boolean {
  const state = useEnergyStoreState()
  return state.level >= minLevel
}

/** Resolve a presence map against the current energy level */
export function useEnergyPresence(presence: EnergyPresenceMap): EnergyPresence {
  const state = useEnergyStoreState()
  return useMemo(() => resolveEnergyPresence(presence, state.level), [presence, state.level])
}

// ── EnergyAnnouncer component (SPEC.md §10.4) ──

export interface EnergyAnnouncerProps {
  /** ARIA politeness level. Default: `'polite'`. */
  politeness?: 'polite' | 'assertive'
  /** Custom phrasing for screen-reader announcements. */
  formatMessage?: (state: EnergyState, prev: EnergyState) => string
}

/**
 * Mounts a polite, visually-hidden ARIA live region announcing energy level
 * transitions (SPEC.md §10.4). Drop anywhere under `<EnergyProvider>`.
 */
export function EnergyAnnouncer({
  politeness = 'polite',
  formatMessage,
}: EnergyAnnouncerProps = {}): ReactNode {
  const engine = useEngine()
  const formatRef = useRef(formatMessage)

  useInsertionEffect(() => {
    formatRef.current = formatMessage
  }, [formatMessage])

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return
    return createEnergyAnnouncer(engine, {
      politeness,
      ...(formatRef.current
        ? {
            formatMessage: (state, prev) =>
              formatRef.current ? formatRef.current(state, prev) : '',
          }
        : {}),
    })
  }, [engine, politeness])

  return null
}

// ── EnergyGate component ──

/**
 * What happens to the gated subtree when its presence resolves to 'hidden'.
 *
 * - `preserve` (default): kept mounted inside React 19.2's `<Activity mode="hidden">`
 *   when available (or an accessible `hidden` wrapper on React 18 / 19.0–19.1),
 *   so component state and drafts survive dips in energy.
 * - `unmount`: removed from the tree entirely. Use for subtrees whose cost is
 *   worth reclaiming at low energy (media, canvases, live connections).
 */
export type EnergyHiddenBehavior = 'preserve' | 'unmount'

interface EnergyGateBaseProps {
  /** Rendered instead of children while hidden. Default: nothing. */
  fallback?: ReactNode
  /** How the subtree is treated while hidden. Default: 'preserve'. */
  whenHidden?: EnergyHiddenBehavior
  /**
   * Content to gate. The function form receives the resolved presence so
   * 'muted' can style itself differently from 'visible'. Under `preserve` it
   * is also called with 'hidden', because the subtree stays mounted.
   */
  children: ReactNode | ((presence: EnergyPresence) => ReactNode)
}

export type EnergyGateProps = EnergyGateBaseProps &
  (
    | {
        /** Full presence declaration for this element */
        presence: EnergyPresenceMap
        min?: never
        max?: never
      }
    | {
        presence?: never
        /** Shorthand: visible at or above this level, hidden below */
        min: EnergyLevel
        /** Optionally also hidden above this level (band gating) */
        max?: EnergyLevel
      }
    | {
        presence?: never
        min?: never
        /** Shorthand: visible at or below this level, hidden above */
        max: EnergyLevel
      }
  )

/**
 * Declarative energy gating for a subtree.
 *
 * Headless when React 19.2+ `<Activity>` is present (or under `whenHidden="unmount"`).
 */
export function EnergyGate({
  presence,
  min,
  max,
  fallback = null,
  whenHidden = 'preserve',
  children,
}: EnergyGateProps): ReactNode {
  const map = useMemo<EnergyPresenceMap>(() => {
    if (presence) return presence
    if (min !== undefined && max !== undefined) {
      if (!isEnergyLevel(min)) {
        throw new Error(`Invalid energy level: ${String(min)}`)
      }
      if (!isEnergyLevel(max)) {
        throw new Error(`Invalid energy level: ${String(max)}`)
      }
      if (min > max) {
        throw new Error(`EnergyGate min (${String(min)}) cannot exceed max (${String(max)})`)
      }
      const spec: Partial<Record<EnergyLevel, EnergyPresence>> = {}
      for (const definition of getEnergyLevels()) {
        spec[definition.value] =
          definition.value >= min && definition.value <= max ? 'visible' : 'hidden'
      }
      return defineEnergyPresence(spec)
    }
    if (min !== undefined) return presenceAtOrAbove(min)
    if (max !== undefined) return presenceAtOrBelow(max)
    throw new Error('EnergyGate requires a presence map or min/max level')
  }, [presence, min, max])

  const resolved = useEnergyPresence(map)
  const isHidden = resolved === 'hidden'

  if (whenHidden === 'unmount') {
    if (isHidden) return fallback
    return typeof children === 'function' ? children(resolved) : children
  }

  const content = typeof children === 'function' ? children(resolved) : children

  if (ReactActivity) {
    /*
     * The <Activity> element sits at a fixed position in a fixed Fragment on every
     * render, hidden or not. That stability is the whole mechanism: reconciling the
     * same boundary is what carries state across the transition.
     */
    return createElement(
      Fragment,
      null,
      isHidden ? fallback : null,
      createElement(ReactActivity, {
        mode: isHidden ? 'hidden' : 'visible',
        children: content,
      }),
    )
  }

  // Fallback for React 18 / 19.0 / 19.1: preserves React state in a stable slot
  // and removes the hidden subtree from layout and the accessibility tree.
  return createElement(
    Fragment,
    null,
    isHidden ? fallback : null,
    createElement(
      'div',
      {
        hidden: isHidden,
        style: isHidden ? { display: 'none' } : { display: 'contents' },
      },
      content,
    ),
  )
}

// ── Headless Components ──

export interface EnergyIndicatorRenderProps {
  level: EnergyLevel
  label: string
  description: string
  cognitiveProfile: EnergyLevelDefinition['cognitiveProfile']
  state: EnergyState
  definition: EnergyLevelDefinition
  levels: readonly EnergyLevelDefinition[]
  cycle: () => void
  setLevel: (level: EnergyLevel, source?: EnergySource) => void
}

export interface EnergyIndicatorProps {
  children: (props: EnergyIndicatorRenderProps) => ReactNode
}

/** Headless energy indicator - bring your own UI */
export function EnergyIndicator({ children }: EnergyIndicatorProps): ReactNode {
  const [level, setLevel] = useEnergyLevel()
  const state = useEnergyStoreState()
  const cycle = useEnergyLevelCycler()

  const definition = useMemo(() => getEnergyLevel(level), [level])
  const levels = useMemo(() => getEnergyLevels(), [])

  return children({
    level,
    label: definition.label,
    description: definition.description,
    cognitiveProfile: definition.cognitiveProfile,
    state,
    definition,
    levels,
    cycle,
    setLevel,
  })
}

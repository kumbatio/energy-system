'use client'

// Every export in this module is a hook, a context, or a component built on
// one. Marking the module itself is what lets a consumer import it directly
// from a Server Component tree (Next.js App Router, RSC bundlers) without
// having to wrap it in their own client boundary first. The directive must
// stay the first statement in the file for bundlers to honour it.

import type { ReactNode } from 'react'
import {
  Activity,
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

import { applyEnergyLevel } from './dom.js'
import type { EnergyEngine } from './engine.js'
import { createEnergyEngine } from './engine.js'
import { getEnergyLevel, getEnergyLevels } from './levels.js'
import { defineEnergyPresence, presenceAtOrAbove, resolveEnergyPresence } from './presence.js'
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
} from './types.js'

// ── Context ──

const EnergyEngineContext = createContext<EnergyEngine | null>(null)
const DOM_STYLE_PROPERTIES = [
  '--energy-chrome-opacity',
  '--energy-chrome-opacity-hover',
  '--energy-content-max-width',
  '--energy-content-font-scale',
] as const

interface DOMProjectionSnapshot {
  attribute: string | null
  styles: ReadonlyMap<(typeof DOM_STYLE_PROPERTIES)[number], string>
}

interface DOMProjectionLayer {
  owner: object
  level: EnergyLevel
}

interface DOMProjectionStack {
  baseline: DOMProjectionSnapshot
  layers: DOMProjectionLayer[]
}

const domProjectionStacks = new WeakMap<HTMLElement, DOMProjectionStack>()

function callLevelChange(
  listener: EnergyChangeListener | undefined,
  state: EnergyState,
  prev: EnergyState,
): void {
  if (!listener) return

  try {
    listener(state, prev)
  } catch (err: unknown) {
    console.error('[energy-system] onLevelChange listener threw', err)
  }
}

function restoreDOMProjection(target: HTMLElement, snapshot: DOMProjectionSnapshot): void {
  if (snapshot.attribute === null) {
    target.removeAttribute('data-energy-level')
  } else {
    target.setAttribute('data-energy-level', snapshot.attribute)
  }

  for (const [property, value] of snapshot.styles) {
    if (value === '') {
      target.style.removeProperty(property)
    } else {
      target.style.setProperty(property, value)
    }
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
  /** Persistence adapter when the provider creates its own engine. */
  persistence?: EnergyPersistence
  /** Called on every level change. */
  onLevelChange?: EnergyChangeListener
  /** Whether to apply energy level to DOM via data attributes */
  applyToDOM?: boolean
  children: ReactNode
}

export function EnergyProvider({
  engine: externalEngine,
  defaultLevel = 100,
  persistence,
  onLevelChange,
  applyToDOM = true,
  children,
}: EnergyProviderProps) {
  const internalEngineRef = useRef<EnergyEngine | null>(null)
  const [, refreshEngine] = useReducer((version: number) => version + 1, 0)
  const onLevelChangeRef = useRef(onLevelChange)
  const isProviderCommittedRef = useRef(false)
  const pendingInternalChangesRef = useRef<Array<{ state: EnergyState; prev: EnergyState }>>([])

  useInsertionEffect(() => {
    onLevelChangeRef.current = onLevelChange
  }, [onLevelChange])

  // `defaultLevel` and `persistence` are initial-only by contract: they
  // configure the engine the provider creates, they do not reconfigure it.
  //
  // `autoStart: false` because this runs during render. React discards
  // in-progress renders (an interrupted transition, a sibling suspending), and
  // the effect that disposes the engine only runs for a tree it committed. An
  // engine that hydrated and subscribed at construction would strand a live
  // cross-context observer with nothing left to release it. Starting from the
  // effect below ties both to a commit.
  const createInternalEngine = () =>
    createEnergyEngine({
      initialLevel: defaultLevel,
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
      // An external engine took over; release the provider-owned engine.
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

    // Idempotent, so the StrictMode remount path above and the ordinary mount
    // path both land here exactly once per live engine.
    internalEngineRef.current.start()

    return () => {
      internalEngineRef.current?.dispose()
      internalEngineRef.current = null
    }
  }, [externalEngine])

  // Internal changes can happen during hydration or child layout effects
  // before a parent effect subscription would exist. Queue them until the
  // provider commits, then deliver them in transition order.
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

  // External engines own their own pre-provider history. Subscribe before
  // descendant layout effects so changes made after this provider commits are
  // still reported through onLevelChange.
  useInsertionEffect(() => {
    if (!externalEngine) return

    return engine.subscribe((state, prev) => {
      callLevelChange(onLevelChangeRef.current, state, prev)
    })
  }, [engine, externalEngine])

  // Sync to DOM when state changes
  useEffect(() => {
    if (!applyToDOM || typeof document === 'undefined') return

    const target = document.body
    const owner = {}
    const existingStack = domProjectionStacks.get(target)
    const stack = existingStack ?? {
      baseline: {
        attribute: target.getAttribute('data-energy-level'),
        styles: new Map(
          DOM_STYLE_PROPERTIES.map((property) => [
            property,
            target.style.getPropertyValue(property),
          ]),
        ),
      },
      layers: [],
    }
    const layer: DOMProjectionLayer = { owner, level: engine.getState().level }
    stack.layers.push(layer)
    domProjectionStacks.set(target, stack)
    applyEnergyLevel(layer.level, target)
    const unsubscribe = engine.subscribe((state) => {
      layer.level = state.level
      if (stack.layers.at(-1)?.owner === owner) {
        applyEnergyLevel(state.level, target)
      }
    })

    return () => {
      unsubscribe()
      const layerIndex = stack.layers.findIndex((candidate) => candidate.owner === owner)
      if (layerIndex === -1) return

      const wasTopLayer = layerIndex === stack.layers.length - 1
      stack.layers.splice(layerIndex, 1)
      if (!wasTopLayer) return

      const nextLayer = stack.layers.at(-1)
      if (nextLayer) {
        applyEnergyLevel(nextLayer.level, target)
      } else {
        domProjectionStacks.delete(target)
        restoreDOMProjection(target, stack.baseline)
      }
    }
  }, [engine, applyToDOM])

  return createElement(EnergyEngineContext.Provider, { value: engine }, children)
}

// ── Hooks ──

function useEnergyStoreState(): EnergyState {
  const engine = useEngine()
  // Stable subscribe identity so useSyncExternalStore doesn't unsubscribe +
  // resubscribe on every render. `engine.getState` is closure-backed (doesn't
  // use `this`), so it's safe to pass unbound as the snapshot getter.
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

// ── EnergyGate component ──

/**
 * What happens to the gated subtree when its presence resolves to 'hidden'.
 *
 * - `preserve` (default): kept mounted inside `<Activity mode="hidden">`, so
 *   component state, DOM and scroll position survive. Effects are torn down
 *   while hidden and re-run on reveal, and hidden content is not rendered on
 *   the server. Energy is expected to move up and down; a half-written message
 *   should still be there when capacity returns.
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
 * ```tsx
 * // Hide the AI chat at 50 and below:
 * <EnergyGate min={75}>
 *   <AiChatPanel />
 * </EnergyGate>
 *
 * // Full presence map, muted state styled by the child:
 * <EnergyGate presence={aiChatPresence}>
 *   {(presence) => <AiChatPanel muted={presence === 'muted'} />}
 * </EnergyGate>
 * ```
 *
 * Headless: renders no wrapper element of its own.
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
      const spec: Partial<Record<EnergyLevel, EnergyPresence>> = {}
      for (const definition of getEnergyLevels()) {
        spec[definition.value] =
          definition.value >= min && definition.value <= max ? 'visible' : 'hidden'
      }
      return defineEnergyPresence(spec)
    }
    if (min !== undefined) return presenceAtOrAbove(min)
    if (max !== undefined) {
      const spec: Partial<Record<EnergyLevel, EnergyPresence>> = {}
      for (const definition of getEnergyLevels()) {
        spec[definition.value] = definition.value <= max ? 'visible' : 'hidden'
      }
      return defineEnergyPresence(spec)
    }
    throw new Error('EnergyGate requires a presence map or min/max level')
  }, [presence, min, max])

  const resolved = useEnergyPresence(map)
  const isHidden = resolved === 'hidden'

  if (whenHidden === 'unmount') {
    if (isHidden) return fallback
    return typeof children === 'function' ? children(resolved) : children
  }

  /*
   * The <Activity> element sits at a fixed position in a fixed Fragment on every
   * render, hidden or not. That stability is the whole mechanism: reconciling the
   * same boundary is what carries state across the transition. Rendering Activity
   * only while hidden would swap the element type at that slot and remount the
   * subtree on reveal — losing exactly the state this is here to keep.
   */
  return createElement(
    Fragment,
    null,
    isHidden ? fallback : null,
    createElement(Activity, {
      mode: isHidden ? 'hidden' : 'visible',
      children: typeof children === 'function' ? children(resolved) : children,
    }),
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

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

import { applyEnergyLevel } from './dom.js'
import type { EnergyEngine } from './engine.js'
import { createEnergyEngine } from './engine.js'
import { getEnergyLevel, getEnergyLevels } from './levels.js'
import type {
  AdaptationStrategy,
  EnergyChangeListener,
  EnergyLevel,
  EnergyLevelDefinition,
  EnergyPersistence,
  EnergyState,
} from './types.js'

// ── Context ──

const EnergyEngineContext = createContext<EnergyEngine | null>(null)

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
  children: React.ReactNode
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
  const previousExternalEngineRef = useRef<EnergyEngine | undefined>(externalEngine)

  if (!externalEngine && !internalEngineRef.current) {
    const options = {
      initialLevel: defaultLevel,
      ...(persistence ? { persistence } : {}),
    }

    internalEngineRef.current = createEnergyEngine(options)
  }

  const engine = externalEngine ?? internalEngineRef.current

  if (!engine) {
    throw new Error('EnergyProvider could not initialize an engine instance')
  }

  useEffect(() => {
    const previousExternalEngine = previousExternalEngineRef.current
    previousExternalEngineRef.current = externalEngine

    if (!externalEngine) return
    if (previousExternalEngine === externalEngine) return
    if (!internalEngineRef.current) return

    internalEngineRef.current.dispose()
    internalEngineRef.current = null
  }, [externalEngine])

  // Sync to DOM when state changes
  useEffect(() => {
    if (!applyToDOM) return
    // Apply initial
    applyEnergyLevel(engine.getState().level)
    // Subscribe to changes
    return engine.subscribe((state) => {
      applyEnergyLevel(state.level)
    })
  }, [engine, applyToDOM])

  useEffect(() => {
    if (!onLevelChange) return

    return engine.subscribe(onLevelChange)
  }, [engine, onLevelChange])

  useEffect(() => {
    return () => {
      internalEngineRef.current?.dispose()
      internalEngineRef.current = null
    }
  }, [])

  return createElement(EnergyEngineContext.Provider, { value: engine }, children)
}

// ── Hooks ──

function useEnergyStoreState(): EnergyState {
  const engine = useEngine()
  return useSyncExternalStore(
    (onStoreChange) =>
      engine.subscribe(() => {
        onStoreChange()
      }),
    engine.getState,
    engine.getState,
  )
}

/** Get the full energy state (level + timestamp + source) */
export function useEnergyState(): EnergyState {
  return useEnergyStoreState()
}

/** Read the current energy level and setter */
export function useEnergyLevel(): [EnergyLevel, (level: EnergyLevel) => void] {
  const engine = useEngine()
  const state = useEnergyStoreState()
  const setLevel = useCallback(
    (level: EnergyLevel) => {
      engine.setLevel(level)
    },
    [engine],
  )
  return [state.level, setLevel]
}

/** @deprecated Use useEnergyState instead. */
export function useFullEnergyState(): EnergyState {
  return useEnergyStoreState()
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
  setLevel: (level: EnergyLevel) => void
}

export interface EnergyIndicatorProps {
  children: (props: EnergyIndicatorRenderProps) => React.ReactNode
}

/** Headless energy indicator - bring your own UI */
export function EnergyIndicator({ children }: EnergyIndicatorProps) {
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
  }) as React.ReactElement
}

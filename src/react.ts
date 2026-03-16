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

import type {
  AdaptationStrategy,
  EnergyChangeListener,
  EnergyLevel,
  EnergyLevelDefinition,
  EnergyPersistence,
  EnergyState,
} from './types'
import type { EnergyEngine } from './engine'
import { applyEnergyLevel } from './dom'
import { createEnergyEngine } from './engine'
import { getEnergyLevel, getEnergyLevels } from './levels'

// ── Context ──

const EnergyEngineContext = createContext<EnergyEngine | null>(null)

function useEngine(): EnergyEngine {
  const engine = useContext(EnergyEngineContext)
  if (!engine) throw new Error('Energy hooks must be used within an EnergyProvider')
  return engine
}

// ── Provider ──

export interface EnergyProviderProps {
  /** Pre-created engine. If provided, other options are ignored. */
  engine?: EnergyEngine
  /** Initial energy level (ignored if engine provided) */
  defaultLevel?: EnergyLevel
  /** Persistence adapter (ignored if engine provided) */
  persistence?: EnergyPersistence
  /** Called on every level change (ignored if engine provided — use engine.subscribe) */
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
  const engineRef = useRef<EnergyEngine | null>(null)

  if (!engineRef.current) {
    const options = {
      initialLevel: defaultLevel,
      ...(persistence ? { persistence } : {}),
      ...(onLevelChange ? { onChange: onLevelChange } : {}),
    }

    engineRef.current = externalEngine ?? createEnergyEngine(options)
  }

  const engine = engineRef.current

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

  return createElement(EnergyEngineContext.Provider, { value: engine }, children)
}

// ── Hooks ──

function useEnergyStoreState(): EnergyState {
  const engine = useEngine()
  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(() => { onStoreChange() }),
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
  const setLevel = useCallback((level: EnergyLevel) => {
    engine.setLevel(level)
  }, [engine])
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

/** Headless energy indicator — bring your own UI */
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

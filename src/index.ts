// Core types
export type {
  AdaptationStrategy,
  CognitiveProfile,
  DecisionCapacity,
  EnergyChangeListener,
  EnergyLevel,
  EnergyLevelDefinition,
  EnergyPersistence,
  EnergySource,
  EnergyState,
  FocusDuration,
  InterruptionTolerance,
  TaskComplexity,
} from './types'
export { ENERGY_LEVEL_VALUES } from './types'

// Level definitions and pure functions
export {
  createEnergyState,
  cycleEnergyLevel,
  getEnergyLevel,
  getEnergyLevels,
  isEnergyLevel,
  isHigherEnergy,
} from './levels'

// Engine
export type { EnergyEngine, EnergyEngineOptions } from './engine'
export { createEnergyEngine } from './engine'

// Built-in strategies
export type { NotificationConfig, TaskComplexityConfig, UIVisibilityConfig } from './strategies'
export { notificationStrategy, taskComplexityStrategy, uiVisibilityStrategy } from './strategies'

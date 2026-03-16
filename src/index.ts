// Core types
export type {
  AdaptationStrategy,
  CognitiveProfile,
  DecisionCapacity,
  EnergyClock,
  EnergyChangeListener,
  EnergyLevel,
  EnergyLevelDefinition,
  EnergyMetrics,
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

// Compatibility helpers for non-native external level models
export type {
  ExternalLevelCompatibility,
  ExternalLevelCompatibilityOptions,
} from './compat'
export {
  createExternalLevelCompatibility,
  cycleDiscreteLevel,
  mapToNearestDiscreteLevel,
  mapToNearestEnergyLevel,
} from './compat'

// Derived metrics
export { getEnergyMetrics } from './metrics'

// Engine
export type { EnergyEngine, EnergyEngineOptions } from './engine'
export { createEnergyEngine } from './engine'

// Built-in strategies
export type { NotificationConfig, TaskComplexityConfig, UIVisibilityConfig } from './strategies'
export { notificationStrategy, taskComplexityStrategy, uiVisibilityStrategy } from './strategies'

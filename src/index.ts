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
} from './types.js'
export { ENERGY_LEVEL_VALUES, ENERGY_SOURCE_VALUES } from './types.js'

// Level definitions and pure functions
export {
  createEnergyState,
  cycleEnergyLevel,
  getEnergyLevel,
  getEnergyLevels,
  isEnergyLevel,
  isEnergySource,
  isHigherEnergy,
} from './levels.js'
// Compatibility helpers for non-native external level models
export type { ExternalLevelCompatibility, ExternalLevelCompatibilityOptions } from './compat.js'
export {
  createExternalLevelCompatibility,
  cycleDiscreteLevel,
  mapToNearestDiscreteLevel,
  mapToNearestEnergyLevel,
} from './compat.js'

// Derived metrics
export { getEnergyMetrics } from './metrics.js'

// Engine
export type { EnergyEngine, EnergyEngineOptions } from './engine.js'
export { createEnergyEngine } from './engine.js'

// Built-in strategies
export type { NotificationConfig, TaskComplexityConfig, UIVisibilityConfig } from './strategies.js'
export { notificationStrategy, taskComplexityStrategy, uiVisibilityStrategy } from './strategies.js'

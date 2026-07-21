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
  EnergyPresence,
  EnergyPresenceMap,
  EnergySource,
  EnergyState,
  FocusDuration,
  InterruptionTolerance,
  TaskComplexity,
} from './types.js'
export { ENERGY_LEVEL_VALUES, ENERGY_PRESENCE_VALUES, ENERGY_SOURCE_VALUES } from './types.js'

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
export type {
  InteractionForgivenessConfig,
  NotificationConfig,
  TaskComplexityConfig,
  UIVisibilityConfig,
} from './strategies.js'
export {
  interactionForgivenessStrategy,
  notificationStrategy,
  taskComplexityStrategy,
  uiVisibilityStrategy,
} from './strategies.js'

// Presence annotation (which energy states an element belongs to)
export type { EnergyPresenceSpec } from './presence.js'
export {
  createPresenceStrategy,
  defineEnergyPresence,
  isEnergyPresence,
  isPresenceVisible,
  presenceAtOrAbove,
  presenceAtOrBelow,
  resolveEnergyPresence,
} from './presence.js'

// Focus sessions (time-boxed suppression with auto-expiry)
export type {
  FocusSession,
  FocusSessionController,
  FocusSessionControllerOptions,
  FocusSessionEvent,
  FocusSessionListener,
  FocusSuppressible,
  StartFocusSessionOptions,
} from './session.js'
export { createFocusSessionController, isSessionExpired, sessionRemainingMs } from './session.js'

// Deferral ("not now") presets and energy-aware ordering
export type { DeferralConfig, DeferralPreset, DeferralPresetOptions } from './defer.js'
export {
  DEFERRAL_PRESET_IDS,
  createDeferralPresets,
  deferralStrategy,
  resolveDeferral,
} from './defer.js'

// Notification gate (runtime enforcement of NotificationConfig)
export type {
  EnergyNotification,
  GateScheduler,
  NotificationChannels,
  NotificationDelivery,
  NotificationDeliveryReason,
  NotificationGate,
  NotificationGateOptions,
  NotificationPriority,
  PublishOutcome,
} from './gate.js'
export {
  createNotificationGate,
  isNotificationPriority,
  resolveNotificationOutcome,
} from './gate.js'

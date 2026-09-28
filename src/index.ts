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
} from './types.ts'
export { ENERGY_LEVEL_VALUES, ENERGY_PRESENCE_VALUES, ENERGY_SOURCE_VALUES } from './types.ts'

// Level definitions and pure functions
export {
  UNPRODUCED_ORIGIN,
  UNPRODUCED_TIMESTAMP,
  createEnergyOrigin,
  createEnergyState,
  cycleEnergyLevel,
  getEnergyLevel,
  getEnergyLevels,
  isEnergyLevel,
  isEnergySource,
  isHigherEnergy,
  isUnproducedState,
} from './levels.ts'
// Compatibility helpers for non-native external level models
export type { ExternalLevelCompatibility, ExternalLevelCompatibilityOptions } from './compat.ts'
export {
  createExternalLevelCompatibility,
  cycleDiscreteLevel,
  mapToNearestDiscreteLevel,
  mapToNearestEnergyLevel,
} from './compat.ts'

// State reconciliation (which of two states for the same user wins)
export { isPreferredEnergyState } from './reconcile.ts'

// Derived metrics
export { getEnergyMetrics } from './metrics.ts'

// Engine
export type { EnergyEngine, EnergyEngineOptions } from './engine.ts'
export { createEnergyEngine } from './engine.ts'

// Built-in strategies
export type {
  AutonomyConfig,
  InteractionForgivenessConfig,
  NotificationConfig,
  TaskComplexityConfig,
  UIVisibilityConfig,
} from './strategies.ts'
export {
  autonomyStrategy,
  interactionForgivenessStrategy,
  notificationStrategy,
  taskComplexityStrategy,
  uiVisibilityStrategy,
} from './strategies.ts'

// Presence annotation (which energy states an element belongs to)
export type { EnergyPresenceSpec } from './presence.ts'
export {
  createPresenceStrategy,
  defineEnergyPresence,
  isEnergyPresence,
  isPresenceVisible,
  presenceAtOrAbove,
  presenceAtOrBelow,
  resolveEnergyPresence,
} from './presence.ts'

// Focus sessions (time-boxed suppression with auto-expiry)
export type {
  FocusSession,
  FocusSessionController,
  FocusSessionControllerOptions,
  FocusSessionEvent,
  FocusSessionListener,
  FocusSuppressible,
  StartFocusSessionOptions,
} from './session.ts'
export { createFocusSessionController, isSessionExpired, sessionRemainingMs } from './session.ts'

// Deferral ("not now") presets and energy-aware ordering
export type { DeferralConfig, DeferralPreset, DeferralPresetOptions } from './defer.ts'
export {
  DEFERRAL_PRESET_IDS,
  createDeferralPresets,
  deferralStrategy,
  resolveDeferral,
} from './defer.ts'

// Inbound demand admission (energy-resolved policy for obligation-bearing arrivals)
export type {
  AcknowledgmentDetail,
  DemandAcknowledgment,
  DemandAdmission,
  DemandAdmissionConfig,
  DemandInput,
  DemandOutcome,
  DemandOutcomeReason,
  OriginatorTier,
} from './demand.ts'
export { demandAdmissionStrategy, isOriginatorTier, resolveDemandOutcome } from './demand.ts'

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
} from './gate.ts'
export {
  createNotificationGate,
  isNotificationPriority,
  resolveNotificationOutcome,
} from './gate.ts'

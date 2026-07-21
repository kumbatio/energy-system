import { getEnergyLevel } from './levels.js'
import type { AdaptationStrategy, EnergyLevel, TaskComplexity } from './types.js'

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

// ── UI Visibility Strategy ──

export interface UIVisibilityConfig {
  readonly sidebar: boolean
  readonly tabBar: boolean
  readonly statusBar: boolean
  readonly toolbar: boolean
  readonly chromeOpacity: number
  readonly chromeOpacityHover: number
  readonly contentMaxWidth: string
  readonly contentFontScale: number
  readonly readOnlyCursor: boolean
}

const UI_CONFIGS = freezeObject({
  100: freezeObject({
    sidebar: true,
    tabBar: true,
    statusBar: true,
    toolbar: true,
    chromeOpacity: 1,
    chromeOpacityHover: 1,
    contentMaxWidth: 'none',
    contentFontScale: 1,
    readOnlyCursor: false,
  }),
  75: freezeObject({
    sidebar: true,
    tabBar: true,
    statusBar: true,
    toolbar: true,
    chromeOpacity: 0.7,
    chromeOpacityHover: 1,
    contentMaxWidth: 'none',
    contentFontScale: 1,
    readOnlyCursor: false,
  }),
  50: freezeObject({
    sidebar: true,
    tabBar: true,
    statusBar: true,
    toolbar: true,
    chromeOpacity: 0.4,
    chromeOpacityHover: 1,
    contentMaxWidth: '90ch',
    contentFontScale: 1,
    readOnlyCursor: false,
  }),
  25: freezeObject({
    sidebar: false,
    tabBar: false,
    statusBar: false,
    toolbar: true,
    chromeOpacity: 0.1,
    chromeOpacityHover: 1,
    contentMaxWidth: '80ch',
    contentFontScale: 1.05,
    readOnlyCursor: false,
  }),
  0: freezeObject({
    sidebar: false,
    tabBar: false,
    statusBar: false,
    toolbar: false,
    chromeOpacity: 0.05,
    chromeOpacityHover: 0.8,
    contentMaxWidth: '75ch',
    contentFontScale: 1.1,
    readOnlyCursor: true,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<UIVisibilityConfig>>>

export const uiVisibilityStrategy: AdaptationStrategy<UIVisibilityConfig> = {
  name: 'ui-visibility',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = UI_CONFIGS[def.value]
    const hidden = [
      !config.sidebar && 'sidebar',
      !config.tabBar && 'tabs',
      !config.statusBar && 'status bar',
      !config.toolbar && 'toolbar',
    ].filter(Boolean)

    if (hidden.length === 0) {
      return `${def.label}: All UI elements visible${config.chromeOpacity < 1 ? `, chrome at ${Math.round(config.chromeOpacity * 100)}% opacity` : ''}`
    }
    return `${def.label}: ${hidden.join(', ')} hidden, chrome at ${Math.round(config.chromeOpacity * 100)}% opacity`
  },
  resolve(level) {
    return UI_CONFIGS[getEnergyLevel(level).value]
  },
}

// ── Notification Strategy ──

export interface NotificationConfig {
  /** Allow visual notifications (badges, toasts) */
  readonly allowVisual: boolean
  /** Allow audio notifications */
  readonly allowSound: boolean
  /** Allow haptic feedback */
  readonly allowVibration: boolean
  /** Minimum ms between batched notifications (0 = immediate) */
  readonly batchInterval: number
  /** Minimum priority to show */
  readonly priorityThreshold: 'all' | 'high' | 'critical' | 'none'
}

const NOTIFICATION_CONFIGS = freezeObject({
  100: freezeObject({
    allowVisual: true,
    allowSound: true,
    allowVibration: true,
    batchInterval: 0,
    priorityThreshold: 'all',
  }),
  75: freezeObject({
    allowVisual: true,
    allowSound: true,
    allowVibration: false,
    batchInterval: 0,
    priorityThreshold: 'all',
  }),
  50: freezeObject({
    allowVisual: true,
    allowSound: false,
    allowVibration: false,
    batchInterval: 5 * 60 * 1000, // 5 minutes
    priorityThreshold: 'high',
  }),
  25: freezeObject({
    allowVisual: true,
    allowSound: false,
    allowVibration: false,
    batchInterval: 15 * 60 * 1000, // 15 minutes
    priorityThreshold: 'critical',
  }),
  0: freezeObject({
    allowVisual: false,
    allowSound: false,
    allowVibration: false,
    batchInterval: 0,
    priorityThreshold: 'none',
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<NotificationConfig>>>

export const notificationStrategy: AdaptationStrategy<NotificationConfig> = {
  name: 'notifications',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = NOTIFICATION_CONFIGS[def.value]
    if (config.priorityThreshold === 'none') return 'Rest: All notifications silenced'
    if (config.priorityThreshold === 'all') {
      return config.allowVibration
        ? `${def.label}: All notification channels enabled`
        : `${def.label}: Visual and sound notifications enabled, haptics disabled`
    }
    return `${def.label}: Only ${config.priorityThreshold} priority, batched every ${config.batchInterval / 60_000}min`
  },
  resolve(level) {
    return NOTIFICATION_CONFIGS[getEnergyLevel(level).value]
  },
}

// ── Task Complexity Strategy ──

export interface TaskComplexityConfig {
  /** Maximum task complexity to surface */
  readonly maxComplexity: TaskComplexity
  /** Whether to proactively suggest breaks */
  readonly suggestBreaks: boolean
  /** Minutes between break suggestions (when enabled) */
  readonly breakIntervalMinutes: number
}

const TASK_CONFIGS = freezeObject({
  100: freezeObject({
    maxComplexity: 'complex',
    suggestBreaks: false,
    breakIntervalMinutes: 0,
  }),
  75: freezeObject({
    maxComplexity: 'moderate',
    suggestBreaks: false,
    breakIntervalMinutes: 0,
  }),
  50: freezeObject({
    maxComplexity: 'routine',
    suggestBreaks: true,
    breakIntervalMinutes: 45,
  }),
  25: freezeObject({
    maxComplexity: 'simple',
    suggestBreaks: true,
    breakIntervalMinutes: 25,
  }),
  // Rest is already a break: prompting someone at 0 to take a break from
  // resting is noise, so break suggestions are disabled entirely.
  0: freezeObject({
    maxComplexity: 'consumption',
    suggestBreaks: false,
    breakIntervalMinutes: 0,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<TaskComplexityConfig>>>

export const taskComplexityStrategy: AdaptationStrategy<TaskComplexityConfig> = {
  name: 'task-complexity',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = TASK_CONFIGS[def.value]
    const parts = [`${def.label}: Max complexity: ${config.maxComplexity}`]
    if (config.suggestBreaks) parts.push(`breaks every ${config.breakIntervalMinutes}min`)
    return parts.join(', ')
  },
  resolve(level) {
    return TASK_CONFIGS[getEnergyLevel(level).value]
  },
}

// ── Interaction Forgiveness Strategy ──

/**
 * How much room the interface gives the user to notice and reverse mistakes.
 * Lower energy means slower error detection, so forgiveness scales inversely
 * with capacity: longer undo windows, confirmation on destructive actions,
 * more frequent autosave.
 */
export interface InteractionForgivenessConfig {
  /** How long an undo affordance stays available after an action */
  readonly undoWindowMs: number
  /** Whether destructive actions (delete, discard, overwrite) ask first */
  readonly confirmDestructive: boolean
  /** Suggested autosave cadence for in-progress work */
  readonly autosaveIntervalMs: number
}

const FORGIVENESS_CONFIGS = freezeObject({
  100: freezeObject({
    undoWindowMs: 5000,
    confirmDestructive: false,
    autosaveIntervalMs: 60_000,
  }),
  75: freezeObject({
    undoWindowMs: 8000,
    confirmDestructive: false,
    autosaveIntervalMs: 45_000,
  }),
  50: freezeObject({
    undoWindowMs: 10_000,
    confirmDestructive: true,
    autosaveIntervalMs: 30_000,
  }),
  25: freezeObject({
    undoWindowMs: 15_000,
    confirmDestructive: true,
    autosaveIntervalMs: 20_000,
  }),
  0: freezeObject({
    undoWindowMs: 20_000,
    confirmDestructive: true,
    autosaveIntervalMs: 15_000,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<InteractionForgivenessConfig>>>

export const interactionForgivenessStrategy: AdaptationStrategy<InteractionForgivenessConfig> = {
  name: 'interaction-forgiveness',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = FORGIVENESS_CONFIGS[def.value]
    const confirm = config.confirmDestructive
      ? 'destructive actions confirm first'
      : 'no confirmation friction'
    return `${def.label}: ${config.undoWindowMs / 1000}s undo window, ${confirm}`
  },
  resolve(level) {
    return FORGIVENESS_CONFIGS[getEnergyLevel(level).value]
  },
}

import { getEnergyLevel } from './levels.ts'
import type { AdaptationStrategy, EnergyLevel, TaskComplexity } from './types.ts'

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

const UI_CONFIGS = Object.freeze({
  100: Object.freeze({
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
  75: Object.freeze({
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
  50: Object.freeze({
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
  25: Object.freeze({
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
  0: Object.freeze({
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
      return `${def.label}: full workspace visible${config.chromeOpacity < 1 ? `, chrome softened to ${Math.round(config.chromeOpacity * 100)}%` : ''}`
    }
    if (def.value === 0) {
      return `${def.label}: workspace chrome tucked away for quiet reading`
    }
    return `${def.label}: ${hidden.join(', ')} tucked away, chrome softened to ${Math.round(config.chromeOpacity * 100)}%`
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

const NOTIFICATION_CONFIGS = Object.freeze({
  100: Object.freeze({
    allowVisual: true,
    allowSound: true,
    allowVibration: true,
    batchInterval: 0,
    priorityThreshold: 'all',
  }),
  75: Object.freeze({
    allowVisual: true,
    allowSound: true,
    allowVibration: false,
    batchInterval: 0,
    priorityThreshold: 'all',
  }),
  50: Object.freeze({
    allowVisual: true,
    allowSound: false,
    allowVibration: false,
    batchInterval: 5 * 60 * 1000, // 5 minutes
    priorityThreshold: 'high',
  }),
  25: Object.freeze({
    allowVisual: true,
    allowSound: false,
    allowVibration: false,
    batchInterval: 15 * 60 * 1000, // 15 minutes
    priorityThreshold: 'critical',
  }),
  0: Object.freeze({
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
    if (config.priorityThreshold === 'none') {
      return `${def.label}: all alerts held quietly until you're ready`
    }
    if (config.priorityThreshold === 'all') {
      return config.allowVibration
        ? `${def.label}: visual, sound, and haptic alerts arrive right away`
        : `${def.label}: visual and sound alerts arrive right away, no haptics`
    }
    const label = config.priorityThreshold === 'critical' ? 'urgent' : 'important'
    return `${def.label}: ${label} alerts only, grouped every ${config.batchInterval / 60_000} minutes`
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

const TASK_CONFIGS = Object.freeze({
  100: Object.freeze({
    maxComplexity: 'complex',
    suggestBreaks: false,
    breakIntervalMinutes: 0,
  }),
  75: Object.freeze({
    maxComplexity: 'moderate',
    suggestBreaks: false,
    breakIntervalMinutes: 0,
  }),
  50: Object.freeze({
    maxComplexity: 'routine',
    suggestBreaks: true,
    breakIntervalMinutes: 45,
  }),
  25: Object.freeze({
    maxComplexity: 'simple',
    suggestBreaks: true,
    breakIntervalMinutes: 25,
  }),
  // Rest is already a break: prompting someone at 0 to take a break from
  // resting is noise, so break suggestions are disabled entirely.
  0: Object.freeze({
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
    const guidance: Record<TaskComplexity, string> = {
      complex: 'open to complex work',
      moderate: 'good for focused, moderate work',
      routine: 'best for familiar, routine work',
      simple: 'stick to light, simple steps',
      consumption: 'reading and recovery only, no work prompts',
    }
    const base = `${def.label}: ${guidance[config.maxComplexity]}`
    return config.suggestBreaks
      ? `${base}, with breaks every ${config.breakIntervalMinutes}min`
      : base
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

const FORGIVENESS_CONFIGS = Object.freeze({
  100: Object.freeze({
    undoWindowMs: 5000,
    confirmDestructive: false,
    autosaveIntervalMs: 60_000,
  }),
  75: Object.freeze({
    undoWindowMs: 8000,
    confirmDestructive: false,
    autosaveIntervalMs: 45_000,
  }),
  50: Object.freeze({
    undoWindowMs: 10_000,
    confirmDestructive: true,
    autosaveIntervalMs: 30_000,
  }),
  25: Object.freeze({
    undoWindowMs: 15_000,
    confirmDestructive: true,
    autosaveIntervalMs: 20_000,
  }),
  0: Object.freeze({
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
      ? 'asks before destructive actions'
      : 'direct destructive actions'
    return `${def.label}: ${config.undoWindowMs / 1000}s undo window, ${confirm}`
  },
  resolve(level) {
    return FORGIVENESS_CONFIGS[getEnergyLevel(level).value]
  },
}

// ── Autonomy Strategy ──

/**
 * How much latitude automation has to act for the user without asking.
 *
 * The mirror of `interactionForgivenessStrategy`: forgiveness protects against
 * the *user's* mistakes at low energy, autonomy against the *agent's*. The
 * system acts on the user's behalf precisely when they are least able to
 * supervise it, so the worst day is the wrong day for it to improvise.
 *
 * What narrows as energy falls is *discretion*, not action. At rest the
 * automation may still take a single, certain, template-only step - an
 * out-of-office reply is exactly that shape - but it may not chain steps,
 * compose novel wording, or act on a judgment call.
 */
export interface AutonomyConfig {
  /**
   * Minimum confidence (0–1) an automated decision needs before acting
   * unattended. `1` admits only certainty, which in practice means rule-based
   * actions and never a judgment call.
   */
  readonly confidenceThreshold: number
  /** Whether automation may compose novel wording, or only fill fixed templates. */
  readonly allowGeneratedContent: boolean
  /** How many automated steps may chain before control returns to the user. */
  readonly maxUnattendedSteps: number
}

const AUTONOMY_CONFIGS = Object.freeze({
  100: Object.freeze({
    confidenceThreshold: 0.6,
    allowGeneratedContent: true,
    maxUnattendedSteps: 8,
  }),
  75: Object.freeze({
    confidenceThreshold: 0.7,
    allowGeneratedContent: true,
    maxUnattendedSteps: 5,
  }),
  50: Object.freeze({
    confidenceThreshold: 0.8,
    allowGeneratedContent: true,
    maxUnattendedSteps: 3,
  }),
  25: Object.freeze({
    confidenceThreshold: 0.9,
    allowGeneratedContent: false,
    maxUnattendedSteps: 1,
  }),
  // Rest: one certain, templated step at most. Not zero - an automated action
  // the user has standing consent for (an out-of-office reply is the classic)
  // is safest at rest precisely because it stops improvising.
  0: Object.freeze({
    confidenceThreshold: 1,
    allowGeneratedContent: false,
    maxUnattendedSteps: 1,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<AutonomyConfig>>>

export const autonomyStrategy: AdaptationStrategy<AutonomyConfig> = {
  name: 'autonomy',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = AUTONOMY_CONFIGS[def.value]
    const content = config.allowGeneratedContent ? 'drafts allowed' : 'fixed templates only'
    const steps =
      config.maxUnattendedSteps === 1
        ? '1 step at a time'
        : `up to ${config.maxUnattendedSteps} chained steps`
    const certainty =
      config.confidenceThreshold === 1
        ? 'certainty only'
        : `${Math.round(config.confidenceThreshold * 100)}% confidence`
    return `${def.label}: automation acts on ${certainty}, ${content}, ${steps}`
  },
  resolve(level) {
    return AUTONOMY_CONFIGS[getEnergyLevel(level).value]
  },
}

// ── Sensory Strategy ──

/**
 * Sensory pacing across energy levels: motion, ambient sound, visual intensity,
 * and whether unsolicited calls-to-action should appear.
 *
 * Lower energy means a calmer, quieter room — never harsh animations, never
 * surprise popups, and no asks at Rest.
 */
export interface SensoryConfig {
  /** Multiplier for animation/transition durations (1 = normal, 0 = instant/still) */
  readonly motionScale: number
  /** Whether purely decorative animations (parallax, ambient glows) may run */
  readonly allowDecorativeMotion: boolean
  /** Whether optional ambient audio / soundscapes may play by default */
  readonly allowAmbientAudio: boolean
  /** Relative font-weight softening step (0 = normal, negative = gentler display weight) */
  readonly displayWeightScale: number
  /** Whether non-essential calls-to-action or prompts may surface (false at Rest) */
  readonly allowCallsToAction: boolean
}

const SENSORY_CONFIGS = Object.freeze({
  100: Object.freeze({
    motionScale: 1,
    allowDecorativeMotion: true,
    allowAmbientAudio: true,
    displayWeightScale: 1,
    allowCallsToAction: true,
  }),
  75: Object.freeze({
    motionScale: 0.75,
    allowDecorativeMotion: true,
    allowAmbientAudio: true,
    displayWeightScale: 0.85,
    allowCallsToAction: true,
  }),
  50: Object.freeze({
    motionScale: 0.5,
    allowDecorativeMotion: false,
    allowAmbientAudio: true,
    displayWeightScale: 0.7,
    allowCallsToAction: true,
  }),
  25: Object.freeze({
    motionScale: 0.25,
    allowDecorativeMotion: false,
    allowAmbientAudio: false,
    displayWeightScale: 0.55,
    allowCallsToAction: false,
  }),
  0: Object.freeze({
    motionScale: 0,
    allowDecorativeMotion: false,
    allowAmbientAudio: false,
    displayWeightScale: 0.45,
    allowCallsToAction: false,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<SensoryConfig>>>

export const sensoryStrategy: AdaptationStrategy<SensoryConfig> = {
  name: 'sensory',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = SENSORY_CONFIGS[def.value]
    if (config.motionScale === 0) {
      return `${def.label}: still, quiet, and free of prompts`
    }
    const motion = config.allowDecorativeMotion
      ? `full motion (${Math.round(config.motionScale * 100)}%)`
      : `gentle transitions only (${Math.round(config.motionScale * 100)}%)`
    const asks = config.allowCallsToAction ? 'prompts allowed' : 'no extra prompts'
    return `${def.label}: ${motion}, ${asks}`
  },
  resolve(level) {
    return SENSORY_CONFIGS[getEnergyLevel(level).value]
  },
}

// ── Choice Budget Strategy ──

export type ResponseDensity = 'detailed' | 'balanced' | 'concise' | 'single-step' | 'quiet'

/**
 * How many simultaneous choices and how much text an interface or AI assistant
 * should present at once. Grounded in Hick's Law and executive-function
 * support: at low energy, presenting seven options creates paralysis; one clear
 * next step creates relief.
 *
 * Applies to passive / unsolicited surfaces and default assistant output —
 * never locks out explicitly invoked tools.
 */
export interface ChoiceBudgetConfig {
  /** Maximum simultaneous options to present (`null` = unbounded) */
  readonly maxChoices: number | null
  /** Default depth/length for assistant or interface copy */
  readonly responseDensity: ResponseDensity
  /** Whether unsolicited proactive suggestions or sidebars may appear */
  readonly allowProactiveSuggestions: boolean
}

const CHOICE_BUDGET_CONFIGS = Object.freeze({
  100: Object.freeze({
    maxChoices: null,
    responseDensity: 'detailed',
    allowProactiveSuggestions: true,
  }),
  75: Object.freeze({
    maxChoices: 5,
    responseDensity: 'balanced',
    allowProactiveSuggestions: true,
  }),
  50: Object.freeze({
    maxChoices: 3,
    responseDensity: 'concise',
    allowProactiveSuggestions: false,
  }),
  25: Object.freeze({
    maxChoices: 1,
    responseDensity: 'single-step',
    allowProactiveSuggestions: false,
  }),
  0: Object.freeze({
    maxChoices: 0,
    responseDensity: 'quiet',
    allowProactiveSuggestions: false,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<ChoiceBudgetConfig>>>

export const choiceBudgetStrategy: AdaptationStrategy<ChoiceBudgetConfig> = {
  name: 'choice-budget',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = CHOICE_BUDGET_CONFIGS[def.value]
    if (config.maxChoices === null) {
      return `${def.label}: full options and detailed responses`
    }
    if (config.maxChoices === 0) {
      return `${def.label}: no decisions asked, quiet reading only`
    }
    const choices =
      config.maxChoices === 1 ? 'one clear next step' : `up to ${config.maxChoices} options`
    return `${def.label}: ${choices}, ${config.responseDensity} responses`
  },
  resolve(level) {
    return CHOICE_BUDGET_CONFIGS[getEnergyLevel(level).value]
  },
}

// ── Form Pacing Strategy ──

export type ValidationTiming = 'inline' | 'on-blur' | 'on-submit'

/**
 * How forms, checkouts, and onboarding flows pace themselves as capacity falls:
 * fewer fields per step, optional fields tucked away, gentler validation timing,
 * and automatic draft saving.
 */
export interface FormPacingConfig {
  /** Maximum fields shown in a single step or screen */
  readonly maxFieldsPerStep: number
  /** Whether optional fields are shown inline or collapsed */
  readonly showOptionalFields: boolean
  /** When validation feedback appears (gentler at lower energy) */
  readonly validationTiming: ValidationTiming
  /** Whether draft progress saves automatically on change */
  readonly autosaveDraft: boolean
}

const FORM_PACING_CONFIGS = Object.freeze({
  100: Object.freeze({
    maxFieldsPerStep: 12,
    showOptionalFields: true,
    validationTiming: 'inline',
    autosaveDraft: false,
  }),
  75: Object.freeze({
    maxFieldsPerStep: 8,
    showOptionalFields: true,
    validationTiming: 'inline',
    autosaveDraft: true,
  }),
  50: Object.freeze({
    maxFieldsPerStep: 5,
    showOptionalFields: false,
    validationTiming: 'on-blur',
    autosaveDraft: true,
  }),
  25: Object.freeze({
    maxFieldsPerStep: 3,
    showOptionalFields: false,
    validationTiming: 'on-blur',
    autosaveDraft: true,
  }),
  0: Object.freeze({
    maxFieldsPerStep: 1,
    showOptionalFields: false,
    validationTiming: 'on-submit',
    autosaveDraft: true,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<FormPacingConfig>>>

export const formPacingStrategy: AdaptationStrategy<FormPacingConfig> = {
  name: 'form-pacing',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = FORM_PACING_CONFIGS[def.value]
    const fields =
      config.maxFieldsPerStep === 1
        ? '1 field at a time'
        : `up to ${config.maxFieldsPerStep} fields per step`
    const optional = config.showOptionalFields
      ? 'optional fields shown'
      : 'optional fields tucked away'
    return `${def.label}: ${fields}, ${optional}`
  },
  resolve(level) {
    return FORM_PACING_CONFIGS[getEnergyLevel(level).value]
  },
}

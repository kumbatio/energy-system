import type { AdaptationStrategy, TaskComplexity } from './types.js';
export interface UIVisibilityConfig {
    readonly sidebar: boolean;
    readonly tabBar: boolean;
    readonly statusBar: boolean;
    readonly toolbar: boolean;
    readonly chromeOpacity: number;
    readonly chromeOpacityHover: number;
    readonly contentMaxWidth: string;
    readonly contentFontScale: number;
    readonly readOnlyCursor: boolean;
}
export declare const uiVisibilityStrategy: AdaptationStrategy<UIVisibilityConfig>;
export interface NotificationConfig {
    /** Allow visual notifications (badges, toasts) */
    readonly allowVisual: boolean;
    /** Allow audio notifications */
    readonly allowSound: boolean;
    /** Allow haptic feedback */
    readonly allowVibration: boolean;
    /** Minimum ms between batched notifications (0 = immediate) */
    readonly batchInterval: number;
    /** Minimum priority to show */
    readonly priorityThreshold: 'all' | 'high' | 'critical' | 'none';
}
export declare const notificationStrategy: AdaptationStrategy<NotificationConfig>;
export interface TaskComplexityConfig {
    /** Maximum task complexity to surface */
    readonly maxComplexity: TaskComplexity;
    /** Whether to proactively suggest breaks */
    readonly suggestBreaks: boolean;
    /** Minutes between break suggestions (when enabled) */
    readonly breakIntervalMinutes: number;
}
export declare const taskComplexityStrategy: AdaptationStrategy<TaskComplexityConfig>;
/**
 * How much room the interface gives the user to notice and reverse mistakes.
 * Lower energy means slower error detection, so forgiveness scales inversely
 * with capacity: longer undo windows, confirmation on destructive actions,
 * more frequent autosave.
 */
export interface InteractionForgivenessConfig {
    /** How long an undo affordance stays available after an action */
    readonly undoWindowMs: number;
    /** Whether destructive actions (delete, discard, overwrite) ask first */
    readonly confirmDestructive: boolean;
    /** Suggested autosave cadence for in-progress work */
    readonly autosaveIntervalMs: number;
}
export declare const interactionForgivenessStrategy: AdaptationStrategy<InteractionForgivenessConfig>;
//# sourceMappingURL=strategies.d.ts.map
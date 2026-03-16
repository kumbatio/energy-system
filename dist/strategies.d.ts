import type { AdaptationStrategy } from './types';
export interface UIVisibilityConfig {
    sidebar: boolean;
    tabBar: boolean;
    statusBar: boolean;
    toolbar: boolean;
    chromeOpacity: number;
    chromeOpacityHover: number;
    contentMaxWidth: string;
    contentFontScale: number;
    readOnlyCursor: boolean;
}
export declare const uiVisibilityStrategy: AdaptationStrategy<UIVisibilityConfig>;
export interface NotificationConfig {
    /** Allow visual notifications (badges, toasts) */
    allowVisual: boolean;
    /** Allow audio notifications */
    allowSound: boolean;
    /** Allow haptic feedback */
    allowVibration: boolean;
    /** Minimum ms between batched notifications (0 = immediate) */
    batchInterval: number;
    /** Minimum priority to show */
    priorityThreshold: 'all' | 'high' | 'critical' | 'none';
}
export declare const notificationStrategy: AdaptationStrategy<NotificationConfig>;
export interface TaskComplexityConfig {
    /** Maximum task complexity to surface */
    maxComplexity: 'any' | 'moderate' | 'routine' | 'simple';
    /** Whether to proactively suggest breaks */
    suggestBreaks: boolean;
    /** Minutes between break suggestions (when enabled) */
    breakIntervalMinutes: number;
}
export declare const taskComplexityStrategy: AdaptationStrategy<TaskComplexityConfig>;
//# sourceMappingURL=strategies.d.ts.map
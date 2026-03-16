import { getEnergyLevel } from './levels';
const UI_CONFIGS = {
    100: {
        sidebar: true,
        tabBar: true,
        statusBar: true,
        toolbar: true,
        chromeOpacity: 1,
        chromeOpacityHover: 1,
        contentMaxWidth: 'none',
        contentFontScale: 1,
        readOnlyCursor: false,
    },
    75: {
        sidebar: true,
        tabBar: true,
        statusBar: true,
        toolbar: true,
        chromeOpacity: 0.7,
        chromeOpacityHover: 1,
        contentMaxWidth: 'none',
        contentFontScale: 1,
        readOnlyCursor: false,
    },
    50: {
        sidebar: true,
        tabBar: true,
        statusBar: true,
        toolbar: true,
        chromeOpacity: 0.4,
        chromeOpacityHover: 1,
        contentMaxWidth: '90ch',
        contentFontScale: 1,
        readOnlyCursor: false,
    },
    25: {
        sidebar: false,
        tabBar: false,
        statusBar: false,
        toolbar: true,
        chromeOpacity: 0.1,
        chromeOpacityHover: 1,
        contentMaxWidth: '80ch',
        contentFontScale: 1.05,
        readOnlyCursor: false,
    },
    0: {
        sidebar: false,
        tabBar: false,
        statusBar: false,
        toolbar: false,
        chromeOpacity: 0.05,
        chromeOpacityHover: 0.8,
        contentMaxWidth: '75ch',
        contentFontScale: 1.1,
        readOnlyCursor: true,
    },
};
export const uiVisibilityStrategy = {
    name: 'ui-visibility',
    describe(level) {
        const def = getEnergyLevel(level);
        const config = UI_CONFIGS[level];
        const hidden = [
            !config.sidebar && 'sidebar',
            !config.tabBar && 'tabs',
            !config.statusBar && 'status bar',
            !config.toolbar && 'toolbar',
        ].filter(Boolean);
        if (hidden.length === 0) {
            return `${def.label}: All UI elements visible` + (config.chromeOpacity < 1 ? `, chrome at ${Math.round(config.chromeOpacity * 100)}% opacity` : '');
        }
        return `${def.label}: ${hidden.join(', ')} hidden, chrome at ${Math.round(config.chromeOpacity * 100)}% opacity`;
    },
    resolve(level) {
        return UI_CONFIGS[level];
    },
};
const NOTIFICATION_CONFIGS = {
    100: {
        allowVisual: true,
        allowSound: true,
        allowVibration: true,
        batchInterval: 0,
        priorityThreshold: 'all',
    },
    75: {
        allowVisual: true,
        allowSound: true,
        allowVibration: false,
        batchInterval: 0,
        priorityThreshold: 'all',
    },
    50: {
        allowVisual: true,
        allowSound: false,
        allowVibration: false,
        batchInterval: 5 * 60 * 1000, // 5 minutes
        priorityThreshold: 'high',
    },
    25: {
        allowVisual: true,
        allowSound: false,
        allowVibration: false,
        batchInterval: 15 * 60 * 1000, // 15 minutes
        priorityThreshold: 'critical',
    },
    0: {
        allowVisual: false,
        allowSound: false,
        allowVibration: false,
        batchInterval: 0,
        priorityThreshold: 'none',
    },
};
export const notificationStrategy = {
    name: 'notifications',
    describe(level) {
        const config = NOTIFICATION_CONFIGS[level];
        if (config.priorityThreshold === 'none')
            return 'Rest: All notifications silenced';
        if (config.priorityThreshold === 'all')
            return `${getEnergyLevel(level).label}: All notifications enabled`;
        return `${getEnergyLevel(level).label}: Only ${config.priorityThreshold} priority, batched every ${config.batchInterval / 60000}min`;
    },
    resolve(level) {
        return NOTIFICATION_CONFIGS[level];
    },
};
const TASK_CONFIGS = {
    100: {
        maxComplexity: 'any',
        suggestBreaks: false,
        breakIntervalMinutes: 0,
    },
    75: {
        maxComplexity: 'any',
        suggestBreaks: false,
        breakIntervalMinutes: 0,
    },
    50: {
        maxComplexity: 'moderate',
        suggestBreaks: true,
        breakIntervalMinutes: 45,
    },
    25: {
        maxComplexity: 'simple',
        suggestBreaks: true,
        breakIntervalMinutes: 25,
    },
    0: {
        maxComplexity: 'simple',
        suggestBreaks: true,
        breakIntervalMinutes: 15,
    },
};
export const taskComplexityStrategy = {
    name: 'task-complexity',
    describe(level) {
        const config = TASK_CONFIGS[level];
        const def = getEnergyLevel(level);
        const parts = [`${def.label}: Max complexity: ${config.maxComplexity}`];
        if (config.suggestBreaks)
            parts.push(`breaks every ${config.breakIntervalMinutes}min`);
        return parts.join(', ');
    },
    resolve(level) {
        return TASK_CONFIGS[level];
    },
};
//# sourceMappingURL=strategies.js.map
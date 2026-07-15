import { createEnergyState, isEnergyLevel } from './levels.js';
import { uiVisibilityStrategy } from './strategies.js';
const ATTR = 'energyLevel';
function resolveRoot(root) {
    if (root) {
        return root;
    }
    if (typeof document === 'undefined' || !document.body) {
        throw new Error('Energy DOM APIs require a browser document or an explicit root element');
    }
    return document.body;
}
function normalizeEnergyLevel(level) {
    if (!isEnergyLevel(level)) {
        throw new Error(`Invalid energy level: ${String(level)}`);
    }
    return level;
}
/**
 * Apply energy level to a root element.
 * Sets `data-energy-level` attribute and CSS custom properties
 * derived from the UI visibility strategy.
 */
export function applyEnergyLevel(level, root) {
    const target = resolveRoot(root);
    const normalizedLevel = normalizeEnergyLevel(level);
    const config = uiVisibilityStrategy.resolve(normalizedLevel);
    target.dataset[ATTR] = normalizedLevel.toString();
    target.style.setProperty('--energy-chrome-opacity', config.chromeOpacity.toString());
    target.style.setProperty('--energy-chrome-opacity-hover', config.chromeOpacityHover.toString());
    target.style.setProperty('--energy-content-max-width', config.contentMaxWidth);
    target.style.setProperty('--energy-content-font-scale', config.contentFontScale.toString());
}
/**
 * Read the current energy level from a root element's data attribute.
 * Returns 100 if no valid level is set.
 */
export function readEnergyLevel(root) {
    const target = resolveRoot(root);
    const raw = target.dataset[ATTR];
    switch (raw) {
        case '100':
            return 100;
        case '75':
            return 75;
        case '50':
            return 50;
        case '25':
            return 25;
        case '0':
            return 0;
        default:
            return 100;
    }
}
/**
 * Observe energy level changes on a root element via MutationObserver.
 * Calls back with EnergyState (timestamp will be observation time, source 'inferred').
 * Returns a cleanup function to disconnect the observer.
 */
export function observeEnergyLevel(callback, root) {
    const target = resolveRoot(root);
    let prevLevel = readEnergyLevel(target);
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-energy-level') {
                const currentLevel = readEnergyLevel(target);
                if (currentLevel !== prevLevel) {
                    const prev = createEnergyState(prevLevel, 'inferred', Date.now());
                    const current = createEnergyState(currentLevel, 'inferred', Date.now());
                    prevLevel = currentLevel;
                    callback(current, prev);
                }
            }
        }
    });
    observer.observe(target, {
        attributes: true,
        attributeFilter: ['data-energy-level'],
    });
    return () => {
        observer.disconnect();
    };
}
//# sourceMappingURL=dom.js.map
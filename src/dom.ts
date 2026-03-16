import type { EnergyChangeListener, EnergyLevel, EnergyState } from './types'
import { isEnergyLevel } from './levels'
import { uiVisibilityStrategy } from './strategies'

const ATTR = 'energyLevel'

/**
 * Apply energy level to a root element.
 * Sets `data-energy-level` attribute and CSS custom properties
 * derived from the UI visibility strategy.
 */
export function applyEnergyLevel(level: EnergyLevel, root: HTMLElement = document.body): void {
  const config = uiVisibilityStrategy.resolve(level)

  root.dataset[ATTR] = level.toString()
  root.style.setProperty('--energy-chrome-opacity', config.chromeOpacity.toString())
  root.style.setProperty('--energy-chrome-opacity-hover', config.chromeOpacityHover.toString())
  root.style.setProperty('--energy-content-max-width', config.contentMaxWidth)
  root.style.setProperty('--energy-content-font-scale', config.contentFontScale.toString())
}

/**
 * Read the current energy level from a root element's data attribute.
 * Returns 100 if no valid level is set.
 */
export function readEnergyLevel(root: HTMLElement = document.body): EnergyLevel {
  const raw = Number(root.dataset[ATTR])
  return isEnergyLevel(raw) ? raw : 100
}

/**
 * Observe energy level changes on a root element via MutationObserver.
 * Calls back with EnergyState (timestamp will be observation time, source 'inferred').
 * Returns a cleanup function to disconnect the observer.
 */
export function observeEnergyLevel(
  callback: EnergyChangeListener,
  root: HTMLElement = document.body,
): () => void {
  let prevLevel = readEnergyLevel(root)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'data-energy-level'
      ) {
        const currentLevel = readEnergyLevel(root)
        if (currentLevel !== prevLevel) {
          const prev: EnergyState = { level: prevLevel, timestamp: Date.now(), source: 'inferred' }
          const current: EnergyState = { level: currentLevel, timestamp: Date.now(), source: 'inferred' }
          prevLevel = currentLevel
          callback(current, prev)
        }
      }
    }
  })

  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-energy-level'],
  })

  return () => observer.disconnect()
}

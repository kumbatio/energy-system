import type { EnergyEngine } from './engine.ts'
import { createEnergyState, getEnergyLevel, isEnergyLevel } from './levels.ts'
import { uiVisibilityStrategy } from './strategies.ts'
import type { EnergyChangeListener, EnergyLevel, EnergyState } from './types.ts'

const ATTR = 'energyLevel'
const DOM_STYLE_PROPERTIES = [
  '--energy-chrome-opacity',
  '--energy-chrome-opacity-hover',
  '--energy-content-max-width',
  '--energy-content-font-scale',
] as const

interface DOMProjectionSnapshot {
  attribute: string | null
  styles: ReadonlyMap<(typeof DOM_STYLE_PROPERTIES)[number], string>
}

interface DOMProjectionLayer {
  owner: object
  level: EnergyLevel
}

interface DOMProjectionStack {
  baseline: DOMProjectionSnapshot
  layers: DOMProjectionLayer[]
}

const domProjectionStacks = new WeakMap<HTMLElement, DOMProjectionStack>()

function resolveRoot(root?: HTMLElement): HTMLElement {
  if (root) {
    return root
  }

  if (typeof document === 'undefined' || !document.body) {
    throw new Error('Energy DOM APIs require a browser document or an explicit root element')
  }

  return document.body
}

function normalizeEnergyLevel(level: EnergyLevel): EnergyLevel {
  if (!isEnergyLevel(level)) {
    throw new Error(`Invalid energy level: ${String(level)}`)
  }

  return level
}

function restoreDOMProjection(target: HTMLElement, snapshot: DOMProjectionSnapshot): void {
  if (snapshot.attribute === null) {
    target.removeAttribute('data-energy-level')
  } else {
    target.setAttribute('data-energy-level', snapshot.attribute)
  }

  for (const [property, value] of snapshot.styles) {
    if (value === '') {
      target.style.removeProperty(property)
    } else {
      target.style.setProperty(property, value)
    }
  }
}

/**
 * Apply energy level to a root element.
 * Sets `data-energy-level` attribute and CSS custom properties
 * derived from the UI visibility strategy.
 */
export function applyEnergyLevel(level: EnergyLevel, root?: HTMLElement): void {
  const target = resolveRoot(root)
  const normalizedLevel = normalizeEnergyLevel(level)
  const config = uiVisibilityStrategy.resolve(normalizedLevel)

  target.dataset[ATTR] = normalizedLevel.toString()
  target.style.setProperty('--energy-chrome-opacity', config.chromeOpacity.toString())
  target.style.setProperty('--energy-chrome-opacity-hover', config.chromeOpacityHover.toString())
  target.style.setProperty('--energy-content-max-width', config.contentMaxWidth)
  target.style.setProperty('--energy-content-font-scale', config.contentFontScale.toString())
}

/**
 * Read the current energy level from a root element's data attribute.
 * Returns 100 if no valid level is set.
 */
export function readEnergyLevel(root?: HTMLElement): EnergyLevel {
  const target = resolveRoot(root)
  const raw = target.dataset[ATTR]

  switch (raw) {
    case '100':
      return 100
    case '75':
      return 75
    case '50':
      return 50
    case '25':
      return 25
    case '0':
      return 0
    default:
      return 100
  }
}

/**
 * Bind an `EnergyEngine` directly to a DOM element (default `document.body`).
 * Snapshots the element's previous attribute and CSS properties, supports
 * overlapping bindings in stack order, and restores the baseline on cleanup.
 *
 * Works identically in vanilla JS, Web Components, Vue, Svelte, or React.
 */
export function bindEnergyEngine(engine: EnergyEngine, root?: HTMLElement): () => void {
  const target = resolveRoot(root)
  const owner = {}
  const existingStack = domProjectionStacks.get(target)
  const stack: DOMProjectionStack = existingStack ?? {
    baseline: {
      attribute: target.getAttribute('data-energy-level'),
      styles: new Map(
        DOM_STYLE_PROPERTIES.map((property) => [property, target.style.getPropertyValue(property)]),
      ),
    },
    layers: [],
  }

  const layer: DOMProjectionLayer = { owner, level: engine.getState().level }
  stack.layers.push(layer)
  domProjectionStacks.set(target, stack)
  applyEnergyLevel(layer.level, target)

  const unsubscribe = engine.subscribe((state) => {
    layer.level = state.level
    if (stack.layers.at(-1)?.owner === owner) {
      applyEnergyLevel(state.level, target)
    }
  })

  let released = false
  return () => {
    if (released) return
    released = true
    unsubscribe()

    const layerIndex = stack.layers.findIndex((candidate) => candidate.owner === owner)
    if (layerIndex === -1) return

    const wasTopLayer = layerIndex === stack.layers.length - 1
    stack.layers.splice(layerIndex, 1)
    if (!wasTopLayer) return

    const nextLayer = stack.layers.at(-1)
    if (nextLayer) {
      applyEnergyLevel(nextLayer.level, target)
    } else {
      domProjectionStacks.delete(target)
      restoreDOMProjection(target, stack.baseline)
    }
  }
}

/**
 * Observe energy level changes on a root element via MutationObserver.
 * Calls back with EnergyState (timestamp will be observation time, source 'inferred').
 * Returns a cleanup function to disconnect the observer.
 */
export function observeEnergyLevel(callback: EnergyChangeListener, root?: HTMLElement): () => void {
  const target = resolveRoot(root)
  let prevLevel = readEnergyLevel(target)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-energy-level') {
        const currentLevel = readEnergyLevel(target)
        if (currentLevel !== prevLevel) {
          const observedAt = Date.now()
          const prev = createEnergyState(prevLevel, 'inferred', observedAt)
          const current = createEnergyState(currentLevel, 'inferred', observedAt)
          prevLevel = currentLevel
          callback(current, prev)
        }
      }
    }
  })

  observer.observe(target, {
    attributes: true,
    attributeFilter: ['data-energy-level'],
  })

  return () => {
    observer.disconnect()
  }
}

// ── Accessibility helpers (SPEC.md §10.2 & §10.4) ──

export interface EnergyAnnouncerOptions {
  /** Container to append the visually-hidden live region to. Default: `document.body`. */
  container?: HTMLElement
  /** ARIA politeness level. Default: `'polite'`. */
  politeness?: 'polite' | 'assertive'
  /** Custom phrasing for screen-reader announcements. */
  formatMessage?: (state: EnergyState, prev: EnergyState) => string
}

function defaultAnnouncement(state: EnergyState): string {
  const def = getEnergyLevel(state.level)
  return `Energy set to ${String(def.value)}%, ${def.label}. ${def.description}`
}

/**
 * Create a visually hidden ARIA live region that announces energy level
 * transitions to screen readers (SPEC.md §10.4). Returns a cleanup function.
 */
export function createEnergyAnnouncer(
  engine: EnergyEngine,
  options: EnergyAnnouncerOptions = {},
): () => void {
  const { container, politeness = 'polite', formatMessage = defaultAnnouncement } = options
  const parent = resolveRoot(container)
  const region = document.createElement('div')
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', politeness)
  region.setAttribute('aria-atomic', 'true')
  region.dataset['energyAnnouncer'] = 'true'
  // Standard visually-hidden styles without requiring consumer CSS.
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0',
  })
  parent.appendChild(region)

  const unsubscribe = engine.subscribe((state, prev) => {
    if (state.level === prev.level) return
    region.textContent = formatMessage(state, prev)
  })

  return () => {
    unsubscribe()
    region.remove()
  }
}

function isElementHidden(element: Element): boolean {
  let current: Element | null = element
  while (current) {
    if (current instanceof HTMLElement) {
      if (current.hidden || current.style.display === 'none') return true
      if (typeof getComputedStyle === 'function') {
        const computed = getComputedStyle(current)
        if (computed.display === 'none' || computed.visibility === 'hidden') return true
      }
    }
    current = current.parentElement
  }
  return false
}

/**
 * Preserve keyboard focus across level transitions (SPEC.md §10.2).
 * If lowering energy hides the currently focused element, moves focus to
 * `fallbackTarget` (e.g. `<main>` or the energy dial trigger).
 */
export function manageEnergyFocus(
  engine: EnergyEngine,
  fallbackTarget: HTMLElement | (() => HTMLElement | null),
): () => void {
  const resolveFallback = (): HTMLElement | null =>
    typeof fallbackTarget === 'function' ? fallbackTarget() : fallbackTarget

  return engine.subscribe((state, prev) => {
    if (state.level === prev.level || typeof document === 'undefined') return

    const recover = () => {
      const active = document.activeElement
      const lostFocus =
        !active ||
        active === document.body ||
        active === document.documentElement ||
        isElementHidden(active)
      if (!lostFocus) return

      const target = resolveFallback()
      if (!target || isElementHidden(target)) return
      if (!target.hasAttribute('tabindex') && target.tabIndex < 0) {
        target.setAttribute('tabindex', '-1')
      }
      target.focus()
    }

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(recover)
    } else {
      recover()
    }
  })
}

// ── SSR pre-paint script helper ──

export interface EnergyPrepaintScriptOptions {
  /** localStorage key holding the serialized EnergyState. Default: `'energy-state'`. */
  storageKey?: string
  /** Optional cookie name to check first (takes precedence when present). */
  cookieName?: string
  /** Root element to stamp: `'documentElement'` (`<html>`) or `'body'`. Default: `'documentElement'`. */
  target?: 'documentElement' | 'body'
}

/**
 * Generate a tiny, blocking inline `<script>` string for SSR frameworks
 * (Next.js, Remix, Astro, SvelteKit) that stamps `data-energy-level` before
 * the first paint — eliminating the Peak-100 flash for visitors who chose Low
 * or Rest. Safe to import in Server Components (no `'use client'` directive).
 */
export function createEnergyPrepaintScript(options: EnergyPrepaintScriptOptions = {}): string {
  const { storageKey = 'energy-state', cookieName, target = 'documentElement' } = options
  const targetExpr = target === 'body' ? 'document.body' : 'document.documentElement'
  const keyJson = JSON.stringify(storageKey)
  const cookieSnippet = cookieName
    ? `var m=document.cookie.match(new RegExp('(?:^|; )'+${JSON.stringify(cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}+'=([^;]*)'));if(m){var c=JSON.parse(decodeURIComponent(m[1]));if(c&&v.indexOf(c.level)!==-1){el.dataset.energyLevel=String(c.level);return}}`
    : ''

  return `(function(){try{var v=[0,25,50,75,100],el=${targetExpr};if(!el)return;${cookieSnippet}var r=localStorage.getItem(${keyJson});if(!r)return;var s=JSON.parse(r);if(s&&v.indexOf(s.level)!==-1){el.dataset.energyLevel=String(s.level)}}catch(e){}})()`
}

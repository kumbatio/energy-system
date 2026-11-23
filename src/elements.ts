import { applyEnergyLevel, readEnergyLevel } from './dom.ts'
import type { EnergyEngine } from './engine.ts'
import { getEnergyLevel, getEnergyLevels, isEnergyLevel } from './levels.ts'
import { resolveEnergyPresence } from './presence.ts'
import type { EnergyLevel, EnergyPresenceMap } from './types.ts'

/*
 * Zero-dependency Web Components for any HTML, Astro, Rails, Django, Vue,
 * Svelte, or vanilla page — fulfilling Roadmap M5 with zero framework lock-in.
 *
 *   <energy-dial></energy-dial>
 *   <energy-gate min="75">...</energy-gate>
 *
 * Both elements synchronize automatically with `[data-energy-level]` on the
 * target root (default `document.documentElement`) or an explicitly bound
 * `EnergyEngine`.
 */

let boundEngine: EnergyEngine | null = null

function parseLevelAttr(raw: string | null): EnergyLevel | null {
  if (raw === null || raw.trim() === '') return null
  const num = Number(raw)
  return isEnergyLevel(num) ? num : null
}

function getTargetRoot(element: HTMLElement): HTMLElement {
  const selector = element.getAttribute('target')
  if (selector) {
    const found = document.querySelector<HTMLElement>(selector)
    if (found) return found
  }
  return document.documentElement ?? document.body
}

/**
 * Optionally bind all `<energy-dial>` and `<energy-gate>` custom elements to
 * a shared `EnergyEngine` instance. Without one, elements sync via
 * `data-energy-level` on `document.documentElement`.
 */
export function setEnergyElementsEngine(engine: EnergyEngine | null): void {
  boundEngine = engine
}

export interface RegisterEnergyElementsOptions {
  /** Optional engine shared by the registered custom elements. */
  engine?: EnergyEngine
  /** Custom tag name for the dial. Default: `'energy-dial'`. */
  dialTag?: string
  /** Custom tag name for the gate. Default: `'energy-gate'`. */
  gateTag?: string
}

/**
 * Register `<energy-dial>` and `<energy-gate>` custom elements in the browser.
 * Safe to call multiple times (idempotent) and a no-op outside a DOM.
 */
export function registerEnergyElements(options: RegisterEnergyElementsOptions = {}): void {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') {
    return
  }

  if (options.engine) {
    boundEngine = options.engine
  }

  const dialTag = options.dialTag ?? 'energy-dial'
  const gateTag = options.gateTag ?? 'energy-gate'

  if (!customElements.get(dialTag)) {
    class EnergyDialElement extends HTMLElement {
      private unsubscribe: (() => void) | null = null
      private observer: MutationObserver | null = null

      connectedCallback(): void {
        this.setAttribute('data-energy-exempt', '')
        this.render()
        this.bind()
      }

      disconnectedCallback(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
        this.observer?.disconnect()
        this.observer = null
      }

      private currentLevel(): EnergyLevel {
        if (boundEngine) return boundEngine.getState().level
        return readEnergyLevel(getTargetRoot(this))
      }

      private selectLevel(level: EnergyLevel): void {
        if (boundEngine) {
          boundEngine.setLevel(level, 'manual')
        } else {
          applyEnergyLevel(level, getTargetRoot(this))
        }
        this.dispatchEvent(
          new CustomEvent('energy-change', {
            bubbles: true,
            composed: true,
            detail: { level, definition: getEnergyLevel(level) },
          }),
        )
        this.syncSelection()
      }

      private bind(): void {
        if (boundEngine) {
          this.unsubscribe = boundEngine.subscribe(() => {
            this.syncSelection()
          })
          return
        }

        const target = getTargetRoot(this)
        this.observer = new MutationObserver(() => {
          this.syncSelection()
        })
        this.observer.observe(target, {
          attributes: true,
          attributeFilter: ['data-energy-level'],
        })
      }

      private syncSelection(): void {
        const active = this.currentLevel()
        const inputs = this.querySelectorAll<HTMLInputElement>('input[type="radio"]')
        for (const input of inputs) {
          input.checked = Number(input.value) === active
        }
      }

      private render(): void {
        const legendText = this.getAttribute('label') ?? 'How much energy do you have right now?'
        const groupName = `energy-dial-${Math.random().toString(36).slice(2, 8)}`
        const active = this.currentLevel()

        const fieldset = document.createElement('fieldset')
        fieldset.setAttribute('part', 'fieldset')

        const legend = document.createElement('legend')
        legend.setAttribute('part', 'legend')
        legend.textContent = legendText
        fieldset.appendChild(legend)

        for (const def of getEnergyLevels()) {
          const label = document.createElement('label')
          label.setAttribute('part', 'option')

          const input = document.createElement('input')
          input.type = 'radio'
          input.name = groupName
          input.value = String(def.value)
          input.checked = def.value === active
          input.addEventListener('change', () => {
            if (input.checked) this.selectLevel(def.value)
          })

          const text = document.createElement('span')
          text.textContent = `${String(def.value)}% ${def.label}`
          text.title = def.description

          label.append(input, text)
          fieldset.appendChild(label)
        }

        this.replaceChildren(fieldset)
      }
    }

    customElements.define(dialTag, EnergyDialElement)
  }

  if (!customElements.get(gateTag)) {
    class EnergyGateElement extends HTMLElement {
      static observedAttributes = ['min', 'max', 'below', 'above']
      private unsubscribe: (() => void) | null = null
      private observer: MutationObserver | null = null

      connectedCallback(): void {
        this.bind()
        this.update()
      }

      disconnectedCallback(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
        this.observer?.disconnect()
        this.observer = null
      }

      attributeChangedCallback(): void {
        this.update()
      }

      private bind(): void {
        if (boundEngine) {
          this.unsubscribe = boundEngine.subscribe(() => {
            this.update()
          })
          return
        }

        const target = getTargetRoot(this)
        this.observer = new MutationObserver(() => {
          this.update()
        })
        this.observer.observe(target, {
          attributes: true,
          attributeFilter: ['data-energy-level'],
        })
      }

      private buildPresenceMap(): EnergyPresenceMap {
        const min = parseLevelAttr(this.getAttribute('min'))
        const max = parseLevelAttr(this.getAttribute('max'))
        const below = this.getAttribute('below') === 'muted' ? 'muted' : 'hidden'
        const above = this.getAttribute('above') === 'muted' ? 'muted' : 'hidden'

        const map = {} as Record<EnergyLevel, 'visible' | 'muted' | 'hidden'>
        for (const def of getEnergyLevels()) {
          const level = def.value
          if (min !== null && level < min) {
            map[level] = below
          } else if (max !== null && level > max) {
            map[level] = above
          } else {
            map[level] = 'visible'
          }
        }
        return Object.freeze(map)
      }

      private update(): void {
        const level = boundEngine
          ? boundEngine.getState().level
          : readEnergyLevel(getTargetRoot(this))
        const presence = resolveEnergyPresence(this.buildPresenceMap(), level)
        this.dataset['energyPresence'] = presence
        // Remove from layout and accessibility tree per SPEC.md §10.1.
        this.hidden = presence === 'hidden'
      }
    }

    customElements.define(gateTag, EnergyGateElement)
  }
}

import { getEnergyLevel, getEnergyLevels, isEnergyLevel } from './levels.js'
import type { AdaptationStrategy, EnergyLevel, EnergyPresence, EnergyPresenceMap } from './types.js'
import { ENERGY_PRESENCE_VALUES } from './types.js'

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

/** Validate that an unknown value is a valid EnergyPresence */
export function isEnergyPresence(value: unknown): value is EnergyPresence {
  return typeof value === 'string' && ENERGY_PRESENCE_VALUES.has(value as EnergyPresence)
}

/**
 * Per-level presence spec. Unlisted levels fall back to `default`
 * ('visible' when omitted).
 */
export type EnergyPresenceSpec = Partial<Record<EnergyLevel, EnergyPresence>> & {
  default?: EnergyPresence
}

/**
 * Build a complete, frozen presence map from a partial spec.
 *
 * ```ts
 * // Hide the AI chat at 50 and below, keep it muted at 75:
 * const aiChatPresence = defineEnergyPresence({
 *   default: 'visible',
 *   75: 'muted',
 *   50: 'hidden',
 *   25: 'hidden',
 *   0: 'hidden',
 * })
 * ```
 */
export function defineEnergyPresence(spec: EnergyPresenceSpec = {}): EnergyPresenceMap {
  const fallback = spec.default ?? 'visible'
  if (!isEnergyPresence(fallback)) {
    throw new Error(`Invalid energy presence: ${String(fallback)}`)
  }

  const entries = {} as Record<EnergyLevel, EnergyPresence>
  for (const definition of getEnergyLevels()) {
    const declared = spec[definition.value]
    if (declared !== undefined && !isEnergyPresence(declared)) {
      throw new Error(
        `Invalid energy presence for level ${String(definition.value)}: ${String(declared)}`,
      )
    }
    entries[definition.value] = declared ?? fallback
  }

  return freezeObject(entries)
}

/**
 * Presence map for elements that need at least `min` energy.
 * Below `min` the element is `below` ('hidden' by default).
 *
 * ```ts
 * const composerToolbar = presenceAtOrAbove(50)          // hidden at 25 and 0
 * const aiSidebar = presenceAtOrAbove(75, 'muted')       // muted below 75
 * ```
 */
export function presenceAtOrAbove(
  min: EnergyLevel,
  below: EnergyPresence = 'hidden',
): EnergyPresenceMap {
  if (!isEnergyLevel(min)) {
    throw new Error(`Invalid energy level: ${String(min)}`)
  }
  if (!isEnergyPresence(below)) {
    throw new Error(`Invalid energy presence: ${String(below)}`)
  }

  const entries = {} as Record<EnergyLevel, EnergyPresence>
  for (const definition of getEnergyLevels()) {
    entries[definition.value] = definition.value >= min ? 'visible' : below
  }
  return freezeObject(entries)
}

/**
 * Presence map for elements that only belong at low energy — recovery hints,
 * "one thing at a time" affordances. Above `max` the element is `above`
 * ('hidden' by default).
 */
export function presenceAtOrBelow(
  max: EnergyLevel,
  above: EnergyPresence = 'hidden',
): EnergyPresenceMap {
  if (!isEnergyLevel(max)) {
    throw new Error(`Invalid energy level: ${String(max)}`)
  }
  if (!isEnergyPresence(above)) {
    throw new Error(`Invalid energy presence: ${String(above)}`)
  }

  const entries = {} as Record<EnergyLevel, EnergyPresence>
  for (const definition of getEnergyLevels()) {
    entries[definition.value] = definition.value <= max ? 'visible' : above
  }
  return freezeObject(entries)
}

/** Resolve the presence of an element for a given energy level */
export function resolveEnergyPresence(
  presence: EnergyPresenceMap,
  level: EnergyLevel,
): EnergyPresence {
  if (!isEnergyLevel(level)) {
    throw new Error(`Invalid energy level: ${String(level)}`)
  }

  const resolved = presence[level]
  if (!isEnergyPresence(resolved)) {
    throw new Error(`Presence map has no valid entry for level ${String(level)}`)
  }
  return resolved
}

/** True unless the presence is 'hidden' */
export function isPresenceVisible(presence: EnergyPresence): boolean {
  return presence !== 'hidden'
}

/**
 * Lift a presence map into an AdaptationStrategy so it can be resolved
 * through the engine like any built-in strategy:
 *
 * ```ts
 * const aiChat = createPresenceStrategy('ai-chat', presenceAtOrAbove(75))
 * engine.resolve(aiChat) // 'visible' | 'muted' | 'hidden'
 * ```
 */
export function createPresenceStrategy(
  name: string,
  presence: EnergyPresenceMap,
): AdaptationStrategy<EnergyPresence> {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`Invalid presence strategy name: ${String(name)}`)
  }

  // Validate the full map once at creation so resolve() cannot fail later.
  for (const definition of getEnergyLevels()) {
    resolveEnergyPresence(presence, definition.value)
  }

  return {
    name,
    describe(level) {
      const def = getEnergyLevel(level)
      return `${def.label}: ${name} is ${resolveEnergyPresence(presence, level)}`
    },
    resolve(level) {
      return resolveEnergyPresence(presence, level)
    },
  }
}

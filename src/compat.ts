import { isEnergyLevel } from './levels.js'
import type { EnergyLevel } from './types.js'

const NATIVE_ENERGY_LEVELS: readonly EnergyLevel[] = [100, 75, 50, 25, 0]

const hasOwn = (target: object, key: PropertyKey): boolean => Object.hasOwn(target, key)

/**
 * Cycle through any discrete numeric level list.
 */
export function cycleDiscreteLevel<TLevel extends number>(
  current: number,
  levels: readonly TLevel[],
  fallback: TLevel,
): TLevel {
  const index = levels.findIndex((level) => level === current)
  if (index === -1) return fallback
  return levels[(index + 1) % levels.length] ?? fallback
}

/**
 * Map an arbitrary number to the nearest available discrete level.
 */
export function mapToNearestDiscreteLevel<TLevel extends number>(
  value: number,
  levels: readonly TLevel[],
  fallback: TLevel,
): TLevel {
  if (levels.length === 0 || !Number.isFinite(value)) {
    return fallback
  }

  let nearest = levels[0] ?? fallback
  let nearestDistance = Math.abs(nearest - value)

  for (const level of levels) {
    const distance = Math.abs(level - value)
    if (distance < nearestDistance) {
      nearest = level
      nearestDistance = distance
    }
  }

  return nearest
}

/**
 * Map any number to the closest native package energy level.
 */
export function mapToNearestEnergyLevel(value: number): EnergyLevel {
  return mapToNearestDiscreteLevel(value, NATIVE_ENERGY_LEVELS, 100)
}

export interface ExternalLevelCompatibilityOptions<TExternal extends number> {
  /**
   * External level cycle order (e.g. [100, 66, 33, 0]).
   */
  levels: readonly TExternal[]
  /**
   * Mapping from external level values to native package levels.
   */
  toEnergyLevel: Readonly<Record<TExternal, EnergyLevel>>
  /**
   * Fallback external level when input is unknown.
   */
  fallbackLevel: TExternal
  /**
   * Fallback native level when mapping is invalid or missing.
   * Defaults to the mapped value of fallbackLevel.
   */
  fallbackEnergyLevel?: EnergyLevel
}

export interface ExternalLevelCompatibility<TExternal extends number> {
  levels: readonly TExternal[]
  fallbackLevel: TExternal
  fallbackEnergyLevel: EnergyLevel
  toEnergyLevel: (externalLevel: TExternal | number) => EnergyLevel
  fromEnergyLevel: (level: EnergyLevel) => TExternal
  cycleExternalLevel: (current: TExternal | number) => TExternal
  cycleMappedEnergyLevel: (current: TExternal | number) => EnergyLevel
}

/**
 * Build a compatibility bridge for systems that use non-native level values.
 *
 * This is useful during migrations (e.g. legacy 4-level models) while keeping
 * the package's native fixed 5-level model unchanged.
 */
export function createExternalLevelCompatibility<TExternal extends number>(
  options: ExternalLevelCompatibilityOptions<TExternal>,
): ExternalLevelCompatibility<TExternal> {
  const { levels, toEnergyLevel, fallbackLevel } = options
  const normalizedLevels = Object.freeze([...levels])

  if (normalizedLevels.length === 0) {
    throw new Error('External compatibility requires at least one level value')
  }

  if (normalizedLevels.some((level) => !Number.isFinite(level))) {
    throw new Error('External compatibility levels must be finite numbers')
  }

  if (new Set(normalizedLevels).size !== normalizedLevels.length) {
    throw new Error('External compatibility levels must be unique')
  }

  if (!normalizedLevels.includes(fallbackLevel)) {
    throw new Error('fallbackLevel must be present in levels')
  }

  const normalizedMap = new Map<TExternal, EnergyLevel>()

  for (const externalLevel of normalizedLevels) {
    if (!hasOwn(toEnergyLevel, externalLevel)) {
      throw new Error(`Missing toEnergyLevel mapping for external level: ${externalLevel}`)
    }

    const mapped = toEnergyLevel[externalLevel]
    if (!isEnergyLevel(mapped)) {
      throw new Error(
        `Invalid native energy level mapping for external level ${externalLevel}: ${String(mapped)}`,
      )
    }

    normalizedMap.set(externalLevel, mapped)
  }

  const fallbackEnergyLevel = options.fallbackEnergyLevel ?? normalizedMap.get(fallbackLevel) ?? 100

  if (!isEnergyLevel(fallbackEnergyLevel)) {
    throw new Error(`Invalid fallbackEnergyLevel: ${String(fallbackEnergyLevel)}`)
  }

  const reverseMap = new Map<EnergyLevel, TExternal>()
  for (const externalLevel of normalizedLevels) {
    const mapped = normalizedMap.get(externalLevel)
    if (mapped === undefined) continue
    if (!reverseMap.has(mapped)) {
      reverseMap.set(mapped, externalLevel)
    }
  }

  const toNativeLevel = (externalLevel: TExternal | number): EnergyLevel => {
    const exact = normalizedMap.get(externalLevel as TExternal)
    if (exact !== undefined) {
      return exact
    }

    const nearestExternal = mapToNearestDiscreteLevel(
      externalLevel,
      normalizedLevels,
      fallbackLevel,
    )
    return normalizedMap.get(nearestExternal) ?? fallbackEnergyLevel
  }

  const fromNativeLevel = (level: EnergyLevel): TExternal => {
    const exact = reverseMap.get(level)
    if (exact !== undefined) {
      return exact
    }

    let nearest = fallbackLevel
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const externalLevel of normalizedLevels) {
      const mapped = normalizedMap.get(externalLevel) ?? fallbackEnergyLevel
      const distance = Math.abs(mapped - level)
      if (distance < nearestDistance) {
        nearest = externalLevel
        nearestDistance = distance
      }
    }

    return nearest
  }

  const cycleExternal = (current: TExternal | number): TExternal =>
    cycleDiscreteLevel(current, normalizedLevels, fallbackLevel)

  return Object.freeze({
    levels: normalizedLevels,
    fallbackLevel,
    fallbackEnergyLevel,
    toEnergyLevel: toNativeLevel,
    fromEnergyLevel: fromNativeLevel,
    cycleExternalLevel: cycleExternal,
    cycleMappedEnergyLevel: (current: TExternal | number) => toNativeLevel(cycleExternal(current)),
  })
}

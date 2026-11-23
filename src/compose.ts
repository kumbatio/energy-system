import { getEnergyLevel, getEnergyLevels } from './levels.ts'
import type { AdaptationStrategy, EnergyLevel } from './types.ts'

/*
 * Strategy authoring and composition helpers.
 *
 * Real apps rarely fork built-in strategies; they resolve a built-in and layer
 * domain fields on top (Anasa adds AI availability onto UI visibility; Meltemi
 * layers inbox scope onto it). These helpers keep every custom or composed
 * strategy exhaustive over all five levels, referentially stable, and frozen.
 */

export type StrategyTable<TConfig> = Readonly<Record<EnergyLevel, TConfig>>

function freezeValue<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    return Object.freeze({ ...value })
  }
  return value
}

/**
 * Define a pure, exhaustive, frozen adaptation strategy from a 5-level table.
 */
export function defineStrategy<TConfig>(
  name: string,
  table: StrategyTable<TConfig>,
  describe?: (level: EnergyLevel, config: TConfig) => string,
): AdaptationStrategy<TConfig> {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`Invalid strategy name: ${String(name)}`)
  }

  const frozen = {} as Record<EnergyLevel, TConfig>
  for (const definition of getEnergyLevels()) {
    if (!Object.hasOwn(table, definition.value)) {
      throw new Error(`Strategy "${name}" is missing level ${String(definition.value)}`)
    }
    frozen[definition.value] = freezeValue(table[definition.value])
  }

  const snapshot = Object.freeze(frozen)

  return {
    name,
    describe(level) {
      const def = getEnergyLevel(level)
      const config = snapshot[def.value]
      return describe ? describe(def.value, config) : `${def.label}: ${name} active`
    },
    resolve(level) {
      return snapshot[getEnergyLevel(level).value]
    },
  }
}

/**
 * Layer domain-specific fields onto an existing strategy without forking it.
 *
 * ```ts
 * const workspaceUI = extendStrategy(uiVisibilityStrategy, 'workspace-ui', (level, base) => ({
 *   ...base,
 *   showAiSidebar: level >= 75,
 * }))
 * ```
 */
export function extendStrategy<TBase, TExtended>(
  base: AdaptationStrategy<TBase>,
  name: string,
  extend: (level: EnergyLevel, baseConfig: TBase) => TExtended,
  describe?: (level: EnergyLevel, config: TExtended) => string,
): AdaptationStrategy<TExtended> {
  const table = {} as Record<EnergyLevel, TExtended>
  for (const definition of getEnergyLevels()) {
    const level = definition.value
    table[level] = extend(level, base.resolve(level))
  }

  return defineStrategy(name, table, describe ?? ((level) => base.describe(level)))
}

/**
 * Combine multiple named strategies into a single resolved snapshot per level,
 * precomputed and frozen across all five levels.
 */
export function composeStrategies<
  TStrategies extends Readonly<Record<string, AdaptationStrategy<unknown>>>,
>(
  name: string,
  strategies: TStrategies,
): AdaptationStrategy<{
  readonly [K in keyof TStrategies]: TStrategies[K] extends AdaptationStrategy<infer TConfig>
    ? TConfig
    : never
}> {
  type Combined = {
    readonly [K in keyof TStrategies]: TStrategies[K] extends AdaptationStrategy<infer TConfig>
      ? TConfig
      : never
  }

  const entries = Object.entries(strategies)
  if (entries.length === 0) {
    throw new Error('composeStrategies requires at least one strategy')
  }

  const table = {} as Record<EnergyLevel, Combined>
  for (const definition of getEnergyLevels()) {
    const level = definition.value
    const resolved: Record<string, unknown> = {}
    for (const [key, strategy] of entries) {
      resolved[key] = strategy.resolve(level)
    }
    table[level] = Object.freeze(resolved) as Combined
  }

  return defineStrategy(name, table, (level) => {
    const def = getEnergyLevel(level)
    const parts = entries.map(([, strategy]) => strategy.describe(level))
    return `${def.label}: ${parts.join(' · ')}`
  })
}

import { getEnergyLevel } from './levels.js'
import type { AdaptationStrategy, EnergyLevel } from './types.js'

/**
 * Deferral ("snooze") — the "not now" primitive. Deferring an item is an
 * energy statement: it declares insufficient capacity for it right now and
 * names when it should resurface. Presets are pure `(now) -> Date` functions;
 * the energy-aware strategy orders them so the default suggestion matches
 * current capacity (low energy -> longer deferrals, because items should
 * resurface when capacity has plausibly recovered, not in an hour).
 */

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

/** A named deferral option */
export interface DeferralPreset {
  readonly id: string
  readonly label: string
  /** Compute the resurface time from a reference moment */
  compute(now: Date): Date
}

export interface DeferralPresetOptions {
  /** Hour (0-23) mornings resolve to. Default 9. */
  morningHour?: number
  /** Hour (0-23) evenings resolve to. Default 18. */
  eveningHour?: number
}

/** Stable preset ids, exported so configs/strategies can reference them */
export const DEFERRAL_PRESET_IDS = freezeObject({
  inOneHour: 'in-1-hour',
  thisEvening: 'this-evening',
  tomorrowMorning: 'tomorrow-morning',
  nextWorkday: 'next-workday',
  nextMonday: 'next-monday',
} as const)

function validateHour(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error(`Invalid ${name}: ${String(value)} (expected an integer hour 0-23)`)
  }
}

function startOfDay(from: Date): Date {
  const day = new Date(from)
  day.setHours(0, 0, 0, 0)
  return day
}

function isWeekend(day: Date): boolean {
  const weekday = day.getDay()
  return weekday === 0 || weekday === 6
}

/**
 * Build the standard deferral presets. Times are computed in local time —
 * "tomorrow morning" means the user's morning.
 */
export function createDeferralPresets(
  options: DeferralPresetOptions = {},
): readonly DeferralPreset[] {
  const { morningHour = 9, eveningHour = 18 } = options
  validateHour('morningHour', morningHour)
  validateHour('eveningHour', eveningHour)

  return Object.freeze([
    freezeObject({
      id: DEFERRAL_PRESET_IDS.inOneHour,
      label: 'In 1 hour',
      compute(now: Date): Date {
        return new Date(now.getTime() + 60 * 60_000)
      },
    }),
    freezeObject({
      id: DEFERRAL_PRESET_IDS.thisEvening,
      label: `This evening (${eveningHour}:00)`,
      compute(now: Date): Date {
        const evening = startOfDay(now)
        evening.setHours(eveningHour)
        if (evening.getTime() <= now.getTime()) {
          evening.setDate(evening.getDate() + 1)
        }
        return evening
      },
    }),
    freezeObject({
      id: DEFERRAL_PRESET_IDS.tomorrowMorning,
      label: `Tomorrow morning (${morningHour}:00)`,
      compute(now: Date): Date {
        const morning = startOfDay(now)
        morning.setDate(morning.getDate() + 1)
        morning.setHours(morningHour)
        return morning
      },
    }),
    freezeObject({
      id: DEFERRAL_PRESET_IDS.nextWorkday,
      label: `Next workday (${morningHour}:00)`,
      compute(now: Date): Date {
        const day = startOfDay(now)
        day.setDate(day.getDate() + 1)
        while (isWeekend(day)) {
          day.setDate(day.getDate() + 1)
        }
        day.setHours(morningHour)
        return day
      },
    }),
    freezeObject({
      id: DEFERRAL_PRESET_IDS.nextMonday,
      label: `Next Monday (${morningHour}:00)`,
      compute(now: Date): Date {
        const day = startOfDay(now)
        const delta = (1 - day.getDay() + 7) % 7 || 7
        day.setDate(day.getDate() + delta)
        day.setHours(morningHour)
        return day
      },
    }),
  ])
}

/**
 * Resolve a preset id to a resurface timestamp (epoch ms).
 * Returns null for an unknown id — callers decide whether that is an error.
 */
export function resolveDeferral(
  presets: readonly DeferralPreset[],
  presetId: string,
  now: Date = new Date(),
): number | null {
  const preset = presets.find((candidate) => candidate.id === presetId)
  if (!preset) return null
  return preset.compute(now).getTime()
}

// ── Energy-aware deferral strategy ──

export interface DeferralConfig {
  /** Preset ids in suggestion order for this level (first = most prominent) */
  readonly orderedPresetIds: readonly string[]
  /** The preset a one-tap "defer" action should use at this level */
  readonly defaultPresetId: string
}

const IDS = DEFERRAL_PRESET_IDS

const DEFERRAL_CONFIGS = freezeObject({
  100: freezeObject({
    orderedPresetIds: Object.freeze([
      IDS.inOneHour,
      IDS.thisEvening,
      IDS.tomorrowMorning,
      IDS.nextWorkday,
      IDS.nextMonday,
    ]),
    defaultPresetId: IDS.inOneHour,
  }),
  75: freezeObject({
    orderedPresetIds: Object.freeze([
      IDS.inOneHour,
      IDS.thisEvening,
      IDS.tomorrowMorning,
      IDS.nextWorkday,
      IDS.nextMonday,
    ]),
    defaultPresetId: IDS.inOneHour,
  }),
  50: freezeObject({
    orderedPresetIds: Object.freeze([
      IDS.thisEvening,
      IDS.tomorrowMorning,
      IDS.inOneHour,
      IDS.nextWorkday,
      IDS.nextMonday,
    ]),
    defaultPresetId: IDS.thisEvening,
  }),
  25: freezeObject({
    orderedPresetIds: Object.freeze([
      IDS.tomorrowMorning,
      IDS.nextWorkday,
      IDS.thisEvening,
      IDS.nextMonday,
      IDS.inOneHour,
    ]),
    defaultPresetId: IDS.tomorrowMorning,
  }),
  0: freezeObject({
    orderedPresetIds: Object.freeze([
      IDS.tomorrowMorning,
      IDS.nextMonday,
      IDS.nextWorkday,
      IDS.thisEvening,
      IDS.inOneHour,
    ]),
    defaultPresetId: IDS.tomorrowMorning,
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<DeferralConfig>>>

export const deferralStrategy: AdaptationStrategy<DeferralConfig> = {
  name: 'deferral',
  describe(level) {
    const def = getEnergyLevel(level)
    const config = DEFERRAL_CONFIGS[def.value]
    return `${def.label}: default deferral is "${config.defaultPresetId}"`
  },
  resolve(level) {
    return DEFERRAL_CONFIGS[getEnergyLevel(level).value]
  },
}

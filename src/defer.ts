import { getEnergyLevel } from './levels.ts'
import type { AdaptationStrategy, EnergyLevel } from './types.ts'

/*
 * Deferral ("snooze") - the "not now" primitive. Deferring an item is an
 * energy statement: it declares insufficient capacity for it right now and
 * names when it should resurface. Presets are pure `(now) -> Date` functions;
 * the energy-aware strategy orders them so the default suggestion matches
 * current capacity (low energy -> longer deferrals, because items should
 * resurface when capacity has plausibly recovered, not in an hour).
 */

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
  /**
   * IANA time zone (e.g. 'Europe/Athens', 'America/New_York') for server-side
   * resolution in the person's local time. When omitted, uses the host's local
   * clock.
   */
  timeZone?: string
  /**
   * Days of the week treated as weekend (0 = Sunday .. 6 = Saturday).
   * Default: `[0, 6]` (Saturday and Sunday). Pass `[5, 6]` for Friday-Saturday
   * workweeks. Must leave at least one workday.
   */
  weekendDays?: readonly number[]
}

/** Stable preset ids, exported so configs/strategies can reference them */
export const DEFERRAL_PRESET_IDS = Object.freeze({
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

function validateWeekendDays(weekendDays: readonly number[]): ReadonlySet<number> {
  const normalized = new Set<number>()
  for (const day of weekendDays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error(`Invalid weekend day: ${String(day)} (expected integer 0-6)`)
    }
    normalized.add(day)
  }
  if (normalized.size >= 7) {
    throw new Error('weekendDays cannot exclude all seven days of the week')
  }
  return normalized
}

interface WallParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function createTimeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
  } catch (err: unknown) {
    throw new Error(`Invalid timeZone: ${timeZone}`, { cause: err })
  }
}

function getWallParts(date: Date, formatter: Intl.DateTimeFormat): WallParts {
  const parts = formatter.formatToParts(date)
  let year = 0
  let month = 1
  let day = 1
  let hour = 0
  let minute = 0
  let second = 0
  let weekday = 0

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value)
        break
      case 'month':
        month = Number(part.value)
        break
      case 'day':
        day = Number(part.value)
        break
      case 'hour':
        hour = Number(part.value) % 24
        break
      case 'minute':
        minute = Number(part.value)
        break
      case 'second':
        second = Number(part.value)
        break
      case 'weekday':
        weekday = WEEKDAY_INDEX[part.value] ?? 0
        break
    }
  }

  return { year, month, day, hour, minute, second, weekday }
}

/**
 * Convert a wall-clock date/hour in `timeZone` back to an epoch `Date`.
 * Uses two-step offset refinement so DST boundaries settle accurately.
 */
function wallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  formatter: Intl.DateTimeFormat,
): Date {
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, 0, 0, 0)
  let guess = targetUtcMs

  for (let pass = 0; pass < 2; pass += 1) {
    const actual = getWallParts(new Date(guess), formatter)
    const actualAsUtcMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    )
    const diff = targetUtcMs - actualAsUtcMs
    if (diff === 0) break
    guess += diff
  }

  return new Date(guess)
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number; weekday: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  }
}

function startOfDay(from: Date): Date {
  const day = new Date(from)
  day.setHours(0, 0, 0, 0)
  return day
}

/**
 * Build the standard deferral presets. Times are computed in local time (or the
 * supplied IANA `timeZone`) - "tomorrow morning" means the person's morning.
 */
export function createDeferralPresets(
  options: DeferralPresetOptions = {},
): readonly DeferralPreset[] {
  const { morningHour = 9, eveningHour = 18, timeZone, weekendDays = [0, 6] } = options
  validateHour('morningHour', morningHour)
  validateHour('eveningHour', eveningHour)
  const weekendSet = validateWeekendDays(weekendDays)
  const formatter = timeZone ? createTimeZoneFormatter(timeZone) : null

  const atDayOffset = (now: Date, deltaDays: number, targetHour: number): Date => {
    if (formatter) {
      const parts = getWallParts(now, formatter)
      const shifted = addCalendarDays(parts.year, parts.month, parts.day, deltaDays)
      return wallTimeToDate(shifted.year, shifted.month, shifted.day, targetHour, formatter)
    }
    const day = startOfDay(now)
    day.setDate(day.getDate() + deltaDays)
    day.setHours(targetHour)
    return day
  }

  const weekdayAtOffset = (now: Date, deltaDays: number): number => {
    if (formatter) {
      const parts = getWallParts(now, formatter)
      return addCalendarDays(parts.year, parts.month, parts.day, deltaDays).weekday
    }
    const day = startOfDay(now)
    day.setDate(day.getDate() + deltaDays)
    return day.getDay()
  }

  return Object.freeze([
    Object.freeze({
      id: DEFERRAL_PRESET_IDS.inOneHour,
      label: 'In 1 hour',
      compute(now: Date): Date {
        return new Date(now.getTime() + 60 * 60_000)
      },
    }),
    Object.freeze({
      id: DEFERRAL_PRESET_IDS.thisEvening,
      label: `This evening (${eveningHour}:00)`,
      compute(now: Date): Date {
        const todayEvening = atDayOffset(now, 0, eveningHour)
        if (todayEvening.getTime() <= now.getTime()) {
          return atDayOffset(now, 1, eveningHour)
        }
        return todayEvening
      },
    }),
    Object.freeze({
      id: DEFERRAL_PRESET_IDS.tomorrowMorning,
      label: `Tomorrow morning (${morningHour}:00)`,
      compute(now: Date): Date {
        return atDayOffset(now, 1, morningHour)
      },
    }),
    Object.freeze({
      id: DEFERRAL_PRESET_IDS.nextWorkday,
      label: `Next workday (${morningHour}:00)`,
      compute(now: Date): Date {
        let offset = 1
        while (weekendSet.has(weekdayAtOffset(now, offset))) {
          offset += 1
        }
        return atDayOffset(now, offset, morningHour)
      },
    }),
    Object.freeze({
      id: DEFERRAL_PRESET_IDS.nextMonday,
      label: `Next Monday (${morningHour}:00)`,
      compute(now: Date): Date {
        const currentWeekday = weekdayAtOffset(now, 0)
        const delta = (1 - currentWeekday + 7) % 7 || 7
        return atDayOffset(now, delta, morningHour)
      },
    }),
  ])
}

/**
 * Neutral, fact-not-promise human phrasing for a deferral preset horizon,
 * suitable for inbound-demand acknowledgments (SPEC.md §8.2.2) so the queue
 * and the message to the sender always agree.
 */
export function describeDeferralHorizon(presetId: string): string {
  switch (presetId) {
    case DEFERRAL_PRESET_IDS.inOneHour:
      return 'within the next few hours'
    case DEFERRAL_PRESET_IDS.thisEvening:
      return 'later today'
    case DEFERRAL_PRESET_IDS.tomorrowMorning:
      return 'tomorrow morning'
    case DEFERRAL_PRESET_IDS.nextWorkday:
      return 'the next working day'
    case DEFERRAL_PRESET_IDS.nextMonday:
      return 'early next week'
    default:
      return 'when capacity opens up'
  }
}

/**
 * Resolve a preset id to a resurface timestamp (epoch ms).
 * Returns null for an unknown id - callers decide whether that is an error.
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

const DEFERRAL_CONFIGS = Object.freeze({
  100: Object.freeze({
    orderedPresetIds: Object.freeze([
      IDS.inOneHour,
      IDS.thisEvening,
      IDS.tomorrowMorning,
      IDS.nextWorkday,
      IDS.nextMonday,
    ]),
    defaultPresetId: IDS.inOneHour,
  }),
  75: Object.freeze({
    orderedPresetIds: Object.freeze([
      IDS.inOneHour,
      IDS.thisEvening,
      IDS.tomorrowMorning,
      IDS.nextWorkday,
      IDS.nextMonday,
    ]),
    defaultPresetId: IDS.inOneHour,
  }),
  50: Object.freeze({
    orderedPresetIds: Object.freeze([
      IDS.thisEvening,
      IDS.tomorrowMorning,
      IDS.inOneHour,
      IDS.nextWorkday,
      IDS.nextMonday,
    ]),
    defaultPresetId: IDS.thisEvening,
  }),
  25: Object.freeze({
    orderedPresetIds: Object.freeze([
      IDS.tomorrowMorning,
      IDS.nextWorkday,
      IDS.thisEvening,
      IDS.nextMonday,
      IDS.inOneHour,
    ]),
    defaultPresetId: IDS.tomorrowMorning,
  }),
  0: Object.freeze({
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
    return `${def.label}: one-tap "not now" defaults to ${describeDeferralHorizon(config.defaultPresetId)}`
  },
  resolve(level) {
    return DEFERRAL_CONFIGS[getEnergyLevel(level).value]
  },
}

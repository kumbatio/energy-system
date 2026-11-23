import { defineStrategy } from './compose.ts'
import type { DeferralPresetOptions } from './defer.ts'
import { getEnergyLevels } from './levels.ts'
import type { NotificationConfig, SensoryConfig, UIVisibilityConfig } from './strategies.ts'
import { notificationStrategy, sensoryStrategy, uiVisibilityStrategy } from './strategies.ts'
import type { AdaptationStrategy, EnergyLevel } from './types.ts'

/*
 * Personal calibration - adapting the adaptation to each person.
 *
 * Five discrete levels keep the dial effortless at low energy, and fixed
 * strategy tables keep apps predictable. Still, no two neurodivergent minds
 * share one sensory or circadian profile: an autistic user may never want sound
 * or haptics even at Peak; a low-vision user may need a higher chrome-opacity
 * floor; a night owl's "morning" may be 11:00.
 *
 * Calibration is a pure, local-only overlay on top of the frozen strategies. It
 * never changes the wire format or the five-level model.
 */

export interface EnergyCalibration {
  /** Keep notification sound off at every level (even Peak and Active) */
  readonly muteSoundAlways?: boolean
  /** Keep haptic/vibration alerts off at every level */
  readonly muteVibrationAlways?: boolean
  /** Never fade chrome below this opacity floor (0–1), e.g. 0.4 or 0.7 */
  readonly minChromeOpacity?: number
  /** Disable decorative motion at every level regardless of capacity */
  readonly reduceMotionAlways?: boolean
  /** Keep ambient audio muted at every level */
  readonly muteAmbientAudioAlways?: boolean
  /** Personal morning hour (0–23) for deferral presets */
  readonly morningHour?: number
  /** Personal evening hour (0–23) for deferral presets */
  readonly eveningHour?: number
  /** Personal IANA time zone for server-side deferral resolution */
  readonly timeZone?: string
  /** Personal weekend days (0 = Sunday .. 6 = Saturday) */
  readonly weekendDays?: readonly number[]
}

/**
 * Apply a pure personal-preference transform across all five levels of any
 * strategy, returning a new frozen strategy without mutating the base one.
 */
export function createCalibratedStrategy<TConfig>(
  base: AdaptationStrategy<TConfig>,
  calibrate: (level: EnergyLevel, config: TConfig) => TConfig,
  name = `${base.name}:calibrated`,
): AdaptationStrategy<TConfig> {
  const table = {} as Record<EnergyLevel, TConfig>
  for (const definition of getEnergyLevels()) {
    const level = definition.value
    table[level] = calibrate(level, base.resolve(level))
  }
  return defineStrategy(name, table, (level) => base.describe(level))
}

/**
 * Calibrate `notificationStrategy` (or a custom notification strategy) with a
 * person's standing sensory preferences (e.g. sound/haptics always off).
 */
export function calibrateNotifications(
  calibration: Pick<EnergyCalibration, 'muteSoundAlways' | 'muteVibrationAlways'>,
  base: AdaptationStrategy<NotificationConfig> = notificationStrategy,
): AdaptationStrategy<NotificationConfig> {
  return createCalibratedStrategy(
    base,
    (_level, config) => ({
      ...config,
      allowSound: calibration.muteSoundAlways ? false : config.allowSound,
      allowVibration: calibration.muteVibrationAlways ? false : config.allowVibration,
    }),
    `${base.name}:calibrated`,
  )
}

/**
 * Calibrate `uiVisibilityStrategy` with a minimum chrome-opacity floor so
 * low-vision or high-contrast users never lose sight of receding controls.
 */
export function calibrateUIVisibility(
  calibration: Pick<EnergyCalibration, 'minChromeOpacity'>,
  base: AdaptationStrategy<UIVisibilityConfig> = uiVisibilityStrategy,
): AdaptationStrategy<UIVisibilityConfig> {
  const floor = calibration.minChromeOpacity ?? 0
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) {
    throw new Error(
      `Invalid minChromeOpacity: ${String(calibration.minChromeOpacity)} (expected 0-1)`,
    )
  }

  return createCalibratedStrategy(
    base,
    (_level, config) => ({
      ...config,
      chromeOpacity: Math.max(floor, config.chromeOpacity),
      chromeOpacityHover: Math.max(floor, config.chromeOpacityHover),
    }),
    `${base.name}:calibrated`,
  )
}

/**
 * Calibrate `sensoryStrategy` with standing motion and ambient-audio bounds.
 */
export function calibrateSensory(
  calibration: Pick<EnergyCalibration, 'reduceMotionAlways' | 'muteAmbientAudioAlways'>,
  base: AdaptationStrategy<SensoryConfig> = sensoryStrategy,
): AdaptationStrategy<SensoryConfig> {
  return createCalibratedStrategy(
    base,
    (_level, config) => ({
      ...config,
      motionScale: calibration.reduceMotionAlways ? 0 : config.motionScale,
      allowDecorativeMotion: calibration.reduceMotionAlways ? false : config.allowDecorativeMotion,
      allowAmbientAudio: calibration.muteAmbientAudioAlways ? false : config.allowAmbientAudio,
    }),
    `${base.name}:calibrated`,
  )
}

/**
 * Extract `DeferralPresetOptions` from a personal calibration profile so
 * "tomorrow morning" and "next workday" reflect the user's real schedule.
 */
export function calibrateDeferralOptions(
  calibration: Pick<EnergyCalibration, 'morningHour' | 'eveningHour' | 'timeZone' | 'weekendDays'>,
): DeferralPresetOptions {
  return {
    ...(calibration.morningHour !== undefined ? { morningHour: calibration.morningHour } : {}),
    ...(calibration.eveningHour !== undefined ? { eveningHour: calibration.eveningHour } : {}),
    ...(calibration.timeZone !== undefined ? { timeZone: calibration.timeZone } : {}),
    ...(calibration.weekendDays !== undefined ? { weekendDays: calibration.weekendDays } : {}),
  }
}

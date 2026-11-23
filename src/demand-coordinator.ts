import type { DeferralPreset, DeferralPresetOptions } from './defer.ts'
import {
  createDeferralPresets,
  deferralStrategy,
  describeDeferralHorizon,
  resolveDeferral,
} from './defer.ts'
import type {
  DemandAcknowledgment,
  DemandAdmissionConfig,
  DemandInput,
  DemandOutcome,
} from './demand.ts'
import { demandAdmissionStrategy, resolveDemandOutcome } from './demand.ts'
import type { EnergyEngine, EnergyEngineOptions } from './engine.ts'
import { logContainedError, resolveNow } from './runtime.ts'
import type { AutonomyConfig } from './strategies.ts'
import { autonomyStrategy } from './strategies.ts'
import type { AdaptationStrategy } from './types.ts'

/*
 * Inbound demand coordinator - enforces all four SPEC.md §8.2 invariants by
 * construction while keeping outbound I/O completely pluggable:
 *
 *   1. Atomic capture-then-acknowledge: always captures first (the reversible
 *      half) and rolls back capture if sending the acknowledgment fails.
 *   2. Facts, never promises: computes the resurface instant and neutral
 *      horizon copy from `deferralStrategy`, so the queue and the message to
 *      the originator can never disagree.
 *   3. Automated disclosure: hands the app a structured acknowledgment payload
 *      explicitly marked automated for its medium (RFC 3834 header, badge, etc.).
 *   4. At most once per originator per window: deduplicates acknowledgments so
 *      five arrivals from one sender during a low-energy window clear the
 *      social debt once instead of five times.
 */

export interface DemandHorizon {
  readonly presetId: string
  readonly resurfaceAt: number
  /** Neutral, fact-not-promise phrasing (e.g. "tomorrow morning"). */
  readonly phrase: string
}

export interface DemandCoordinatorItem<TItem = unknown> extends DemandInput {
  /** Stable identifier for the sender/originator (email address, user id, handle) */
  readonly originatorId: string
  /** App-specific payload (message, PR review, task invite, etc.) */
  readonly item: TItem
}

export interface DemandAcknowledgeContext<TItem = unknown> {
  readonly item: TItem
  readonly originatorId: string
  readonly acknowledgment: DemandAcknowledgment
  readonly horizon: DemandHorizon
  /** Explicit reminder for medium-appropriate disclosure (SPEC.md §8.2.3). */
  readonly automated: true
}

export interface DemandCoordinatorOptions<TItem = unknown, TCaptureReceipt = unknown> {
  engine: EnergyEngine
  /** Deliver a live arrival directly to the user. */
  deliverLive(item: TItem): Promise<void> | void
  /** Capture an obligation into the user's queue for later. Returns a receipt for rollback. */
  capture(item: TItem, horizon: DemandHorizon): Promise<TCaptureReceipt> | TCaptureReceipt
  /** Undo a capture if the paired outbound acknowledgment fails (SPEC.md §8.2.1). */
  rollbackCapture(receipt: TCaptureReceipt, item: TItem): Promise<void> | void
  /** Send the disclosed, state-only acknowledgment to the originator. */
  acknowledge(context: DemandAcknowledgeContext<TItem>): Promise<void> | void
  /** Deferral preset options (morningHour, eveningHour, timeZone, weekendDays). */
  deferralOptions?: DeferralPresetOptions
  /** Custom deferral presets (overrides deferralOptions when provided). */
  presets?: readonly DeferralPreset[]
  /** Override strategies if calibrated or customized. */
  admissionStrategy?: AdaptationStrategy<DemandAdmissionConfig>
  autonomyStrategy?: AdaptationStrategy<AutonomyConfig>
  /** Deduplication window per originator in ms. Default: 12 hours. */
  dedupeWindowMs?: number
  /** Deterministic clock for tests/simulations. */
  clock?: EnergyEngineOptions['clock']
}

export interface DemandCoordinationResult {
  readonly outcome: DemandOutcome
  readonly horizon: DemandHorizon | null
  /** True when the obligation was captured silently because this originator was already acknowledged in-window. */
  readonly deduplicated: boolean
}

export interface DemandCoordinator<TItem = unknown> {
  /** Route a single inbound arrival under the current energy policy. */
  handle(arrival: DemandCoordinatorItem<TItem>): Promise<DemandCoordinationResult>
  /** Clear deduplication memory (e.g. when starting a new day or resetting tests). */
  clearDedupe(): void
}

const DEFAULT_DEDUPE_WINDOW_MS = 12 * 60 * 60_000

export function createDemandCoordinator<TItem = unknown, TCaptureReceipt = unknown>(
  options: DemandCoordinatorOptions<TItem, TCaptureReceipt>,
): DemandCoordinator<TItem> {
  const {
    engine,
    deliverLive,
    capture,
    rollbackCapture,
    acknowledge,
    deferralOptions,
    presets = createDeferralPresets(deferralOptions),
    admissionStrategy = demandAdmissionStrategy,
    autonomyStrategy: resolvedAutonomyStrategy = autonomyStrategy,
    dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
    clock,
  } = options

  if (!Number.isFinite(dedupeWindowMs) || dedupeWindowMs < 0) {
    throw new Error(`Invalid dedupeWindowMs: ${String(dedupeWindowMs)}`)
  }

  const now = resolveNow(clock)
  const acknowledgedAt = new Map<string, number>()

  function computeHorizon(nowMs: number): DemandHorizon {
    const deferral = engine.resolve(deferralStrategy)
    const presetId = deferral.defaultPresetId
    const resurfaceAt = resolveDeferral(presets, presetId, new Date(nowMs)) ?? nowMs + 60 * 60_000
    return Object.freeze({
      presetId,
      resurfaceAt,
      phrase: describeDeferralHorizon(presetId),
    })
  }

  function wasRecentlyAcknowledged(originatorId: string, nowMs: number): boolean {
    if (dedupeWindowMs === 0) return false
    const last = acknowledgedAt.get(originatorId)
    if (last === undefined) return false
    if (nowMs - last >= dedupeWindowMs) {
      acknowledgedAt.delete(originatorId)
      return false
    }
    return true
  }

  return {
    async handle(arrival) {
      const outcome = resolveDemandOutcome(
        engine.resolve(admissionStrategy),
        engine.resolve(resolvedAutonomyStrategy),
        arrival,
      )

      if (outcome.admission === 'live') {
        await deliverLive(arrival.item)
        return Object.freeze({ outcome, horizon: null, deduplicated: false })
      }

      const nowMs = now()
      const horizon = computeHorizon(nowMs)

      if (outcome.admission === 'silent' || !outcome.acknowledgment) {
        await capture(arrival.item, horizon)
        return Object.freeze({ outcome, horizon, deduplicated: false })
      }

      // SPEC.md §8.2.4: at most once per originator per window. Still capture
      // the obligation so nothing is lost, without flooding the sender.
      if (wasRecentlyAcknowledged(arrival.originatorId, nowMs)) {
        await capture(arrival.item, horizon)
        return Object.freeze({ outcome, horizon, deduplicated: true })
      }

      // SPEC.md §8.2.1: capture first (reversible), then acknowledge. Roll back
      // the capture if the acknowledgment fails so the two halves stay one act.
      const receipt = await capture(arrival.item, horizon)
      try {
        await acknowledge({
          item: arrival.item,
          originatorId: arrival.originatorId,
          acknowledgment: outcome.acknowledgment,
          horizon,
          automated: true,
        })
      } catch (err: unknown) {
        try {
          await rollbackCapture(receipt, arrival.item)
        } catch (err: unknown) {
          logContainedError('Failed to roll back demand capture after acknowledgment failure', err)
        }
        throw err
      }

      acknowledgedAt.set(arrival.originatorId, nowMs)
      return Object.freeze({ outcome, horizon, deduplicated: false })
    },

    clearDedupe() {
      acknowledgedAt.clear()
    },
  }
}

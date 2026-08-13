import { getEnergyLevel } from './levels.js'
import type { AutonomyConfig } from './strategies.js'
import type { AdaptationStrategy, EnergyLevel } from './types.js'

/**
 * Inbound demand - anything arriving from outside that asks for the user's
 * attention or action: an email, a document comment, a review request, a task
 * assignment, a collaboration invite.
 *
 * Email is the only queue in modern life with no backpressure: infinite
 * senders write to a finite human with zero feedback about that human's
 * capacity. Every other triage system is organised around properties of the
 * *message* (sender, urgency, type); this one is organised around the state of
 * the *recipient*.
 *
 * This module is the policy half only, and it is pure. It decides whether a
 * piece of demand reaches the user now, is acknowledged to its originator and
 * captured for later, or is captured silently. It never performs any of those
 * effects: acknowledging an originator means sending mail, posting a comment,
 * or updating a status chip depending on the app, and those effects are
 * irreversible in ways an in-process runtime cannot make transactional. The
 * consuming app owns the orchestration; it owns the ordering, the retries, and
 * the deduplication that go with irreversible outbound effects.
 *
 * Pair the outcome with `deferralStrategy` for the resurface horizon: the
 * acknowledgment states when the user will actually get to the item, and the
 * energy-ordered deferral default is that answer.
 */

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

/**
 * Standing of the originator relative to the user.
 *
 * - `exempt`: the inner circle. Never sees an energy acknowledgment.
 * - `known`: an established correspondent.
 * - `unknown`: no established relationship.
 *
 * Tier assignment is the app's job - a Screener approval, a contacts list, an
 * org chart. The policy only consumes the tier.
 */
export type OriginatorTier = 'exempt' | 'known' | 'unknown'

const ORIGINATOR_TIERS: ReadonlySet<OriginatorTier> = new Set(['exempt', 'known', 'unknown'])

/** Validate that an unknown value is a valid OriginatorTier */
export function isOriginatorTier(value: unknown): value is OriginatorTier {
  return typeof value === 'string' && ORIGINATOR_TIERS.has(value as OriginatorTier)
}

/**
 * What happens to a piece of inbound demand.
 *
 * - `live`: reaches the user now, untouched by this policy.
 * - `acknowledge`: the originator is acknowledged and the obligation is
 *   captured for later. The two are one act - an acknowledgment without a
 *   capture is a promise nobody kept, a capture without an acknowledgment
 *   leaves the originator in silence.
 * - `silent`: captured for later with no acknowledgment.
 */
export type DemandAdmission = 'live' | 'acknowledge' | 'silent'

/** How much an acknowledgment may say */
export type AcknowledgmentDetail = 'full' | 'brief' | 'minimal'

/** Why the policy reached its decision - for audit trails and explanatory UI */
export type DemandOutcomeReason =
  | 'exempt-originator'
  | 'tier-admitted'
  | 'no-obligation'
  | 'acknowledgment-disabled'
  | 'below-confidence'
  | 'acknowledged'

/**
 * What the acknowledgment is permitted to be. The two axes are independent:
 * how much it may say comes from the level's admission config, whether the
 * wording may be composed at all comes from autonomy.
 */
export interface DemandAcknowledgment {
  readonly detail: AcknowledgmentDetail
  /** Whether the wording may be composed, or must come from a fixed template. */
  readonly allowGeneratedContent: boolean
}

/** The policy decision for one piece of demand */
export interface DemandOutcome {
  readonly admission: DemandAdmission
  /** The acknowledgment to send. Null unless `admission` is `acknowledge`. */
  readonly acknowledgment: DemandAcknowledgment | null
  readonly reason: DemandOutcomeReason
}

/** The properties of one piece of demand that the policy reads */
export interface DemandInput {
  readonly originatorTier: OriginatorTier
  /**
   * Whether this demand asks something of the user. Informational mail - a
   * receipt, a newsletter, a build notification - is not this policy's
   * business and passes through untouched.
   */
  readonly bearsObligation: boolean
  /**
   * Confidence (0–1) that the two classifications above are right. A
   * deterministic rule reports `1`; an LLM classifier reports what it reports.
   * Below the level's autonomy threshold, the demand is captured silently
   * rather than risking a wrong automated action on the user's worst day.
   * Defaults to `1`, so a caller with no classifier gets rule-based behavior.
   */
  readonly confidence?: number
}

export interface DemandAdmissionConfig {
  /**
   * Lowest originator tier admitted live. Mirrors the notification gate's
   * `priorityThreshold`: `all` admits everyone, `none` admits no one.
   */
  readonly originatorThreshold: 'all' | 'known' | 'exempt' | 'none'
  /** Whether demand held back from the user is acknowledged to its originator. */
  readonly acknowledge: boolean
  /** Ceiling on acknowledgment detail at this level. */
  readonly acknowledgmentDetail: AcknowledgmentDetail
}

const ADMISSION_CONFIGS = freezeObject({
  // Full capacity: no policy at all. Everything reaches the user.
  100: freezeObject({
    originatorThreshold: 'all',
    acknowledge: false,
    acknowledgmentDetail: 'full',
  }),
  75: freezeObject({
    originatorThreshold: 'known',
    acknowledge: true,
    acknowledgmentDetail: 'full',
  }),
  50: freezeObject({
    originatorThreshold: 'exempt',
    acknowledge: true,
    acknowledgmentDetail: 'full',
  }),
  25: freezeObject({
    originatorThreshold: 'exempt',
    acknowledge: true,
    acknowledgmentDetail: 'brief',
  }),
  // Rest: the acknowledgment survives, stripped to a fixed template. The
  // originator's social debt still clears - that is the whole point of the
  // loop - but nothing is composed on the user's behalf.
  0: freezeObject({
    originatorThreshold: 'exempt',
    acknowledge: true,
    acknowledgmentDetail: 'minimal',
  }),
}) satisfies Readonly<Record<EnergyLevel, Readonly<DemandAdmissionConfig>>>

export const demandAdmissionStrategy: AdaptationStrategy<DemandAdmissionConfig> = {
  name: 'demand-admission',
  describe(level) {
    const def = getEnergyLevel(level)
    const config: DemandAdmissionConfig = ADMISSION_CONFIGS[def.value]

    const admitted =
      config.originatorThreshold === 'all'
        ? 'all originators reach the inbox'
        : config.originatorThreshold === 'none'
          ? 'no originator reaches the inbox'
          : `only ${config.originatorThreshold} originators reach the inbox`

    if (!config.acknowledge) return `${def.label}: ${admitted}`
    return `${def.label}: ${admitted}, the rest get a ${config.acknowledgmentDetail} acknowledgment and are queued`
  },
  resolve(level) {
    return ADMISSION_CONFIGS[getEnergyLevel(level).value]
  },
}

function isTierAdmitted(
  threshold: DemandAdmissionConfig['originatorThreshold'],
  tier: OriginatorTier,
): boolean {
  switch (threshold) {
    case 'all':
      return true
    case 'known':
      return tier !== 'unknown'
    case 'exempt':
      return tier === 'exempt'
    case 'none':
      return false
  }
}

/**
 * The pure gating decision, extracted so apps can unit-test their demand
 * policy without wiring any effects - the counterpart of
 * `resolveNotificationOutcome`.
 *
 * Both configs are required because the two questions are genuinely separate:
 * `admission` says what the app's policy wants done, `autonomy` says how much
 * of it may happen without the user watching.
 */
export function resolveDemandOutcome(
  config: DemandAdmissionConfig,
  autonomy: AutonomyConfig,
  demand: DemandInput,
): DemandOutcome {
  if (!isOriginatorTier(demand.originatorTier)) {
    throw new Error(`Invalid originator tier: ${String(demand.originatorTier)}`)
  }

  const confidence = demand.confidence ?? 1
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid demand confidence: ${String(demand.confidence)} (expected 0-1)`)
  }

  // The inner circle is never handled by machine. This is also what defuses the
  // gaming risk: an originator who learns that an acknowledgment means
  // "deprioritised" and escalates through another channel only succeeds if
  // their escalation is one the user cannot ignore - which makes them exempt.
  if (demand.originatorTier === 'exempt') {
    return freezeObject({
      admission: 'live',
      acknowledgment: null,
      reason: 'exempt-originator',
    })
  }

  if (isTierAdmitted(config.originatorThreshold, demand.originatorTier)) {
    return freezeObject({
      admission: 'live',
      acknowledgment: null,
      reason: 'tier-admitted',
    })
  }

  // Informational mail asks nothing, so there is nothing to acknowledge or
  // capture. Whether it should *interrupt* is the notification gate's question.
  if (!demand.bearsObligation) {
    return freezeObject({
      admission: 'live',
      acknowledgment: null,
      reason: 'no-obligation',
    })
  }

  if (!config.acknowledge) {
    return freezeObject({
      admission: 'silent',
      acknowledgment: null,
      reason: 'acknowledgment-disabled',
    })
  }

  // Rule 4, the reason this policy needs the autonomy config: an uncertain
  // classification queues silently rather than sending a stranger a wrong
  // acknowledgment on the user's behalf. Silence is recoverable; a sent message
  // is not.
  if (confidence < autonomy.confidenceThreshold) {
    return freezeObject({
      admission: 'silent',
      acknowledgment: null,
      reason: 'below-confidence',
    })
  }

  return freezeObject({
    admission: 'acknowledge',
    acknowledgment: freezeObject({
      detail: config.acknowledgmentDetail,
      allowGeneratedContent: autonomy.allowGeneratedContent,
    }),
    reason: 'acknowledged',
  })
}

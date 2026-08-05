import assert from 'node:assert/strict'
import test from 'node:test'

import type { DemandInput, EnergyLevel, OriginatorTier } from '../src/index.ts'
import {
  autonomyStrategy,
  createEnergyEngine,
  deferralStrategy,
  demandAdmissionStrategy,
  isOriginatorTier,
  resolveDemandOutcome,
} from '../src/index.ts'

const LEVELS = [100, 75, 50, 25, 0] as const satisfies readonly EnergyLevel[]

/** Resolve both halves of the policy at one level, as a consuming app would. */
function policyAt(level: EnergyLevel) {
  return {
    admission: demandAdmissionStrategy.resolve(level),
    autonomy: autonomyStrategy.resolve(level),
  }
}

function outcomeAt(level: EnergyLevel, demand: DemandInput) {
  const { admission, autonomy } = policyAt(level)
  return resolveDemandOutcome(admission, autonomy, demand)
}

const obligation = (originatorTier: OriginatorTier, confidence?: number): DemandInput => ({
  originatorTier,
  bearsObligation: true,
  ...(confidence === undefined ? {} : { confidence }),
})

// ── Autonomy strategy ──

void test('autonomy narrows monotonically as energy drops', () => {
  let previousThreshold = 0
  let previousSteps = Number.POSITIVE_INFINITY

  for (const level of LEVELS) {
    const config = autonomyStrategy.resolve(level)
    assert.equal(config.confidenceThreshold > previousThreshold, true)
    assert.equal(config.maxUnattendedSteps <= previousSteps, true)
    assert.equal(Object.isFrozen(config), true)
    previousThreshold = config.confidenceThreshold
    previousSteps = config.maxUnattendedSteps
  }

  assert.equal(autonomyStrategy.resolve(50).allowGeneratedContent, true)
  assert.equal(autonomyStrategy.resolve(25).allowGeneratedContent, false)
})

void test('rest admits only certainty, but still admits one templated step', () => {
  const atRest = autonomyStrategy.resolve(0)

  // Discretion narrows to zero; action does not. A rule-based decision reports
  // confidence 1 and still passes, which is what keeps an out-of-office-grade
  // acknowledgment possible at rest.
  assert.equal(atRest.confidenceThreshold, 1)
  assert.equal(atRest.maxUnattendedSteps, 1)
  assert.equal(atRest.allowGeneratedContent, false)
})

void test('autonomyStrategy describes itself at every level', () => {
  assert.match(autonomyStrategy.describe(100), /generated content allowed/)
  assert.match(autonomyStrategy.describe(0), /templates only/)
  assert.match(autonomyStrategy.describe(0), /1 chained step\b/)
  assert.match(autonomyStrategy.describe(50), /3 chained steps/)
})

// ── Admission strategy ──

void test('full capacity applies no demand policy at all', () => {
  const config = demandAdmissionStrategy.resolve(100)
  assert.equal(config.originatorThreshold, 'all')
  assert.equal(config.acknowledge, false)

  for (const tier of ['exempt', 'known', 'unknown'] as const) {
    assert.equal(outcomeAt(100, obligation(tier)).admission, 'live')
  }
})

void test('the admitted tier narrows as energy drops', () => {
  assert.equal(outcomeAt(75, obligation('known')).admission, 'live')
  assert.equal(outcomeAt(75, obligation('unknown')).admission, 'acknowledge')

  assert.equal(outcomeAt(50, obligation('known')).admission, 'acknowledge')
  assert.equal(outcomeAt(50, obligation('unknown')).admission, 'acknowledge')
})

void test('the exempt tier never sees an acknowledgment, at any level', () => {
  for (const level of LEVELS) {
    const outcome = outcomeAt(level, obligation('exempt'))
    assert.equal(outcome.admission, 'live')
    assert.equal(outcome.acknowledgment, null)
    assert.equal(outcome.reason, 'exempt-originator')
  }
})

void test('informational demand passes through untouched', () => {
  const outcome = outcomeAt(25, {
    originatorTier: 'unknown',
    bearsObligation: false,
  })

  assert.equal(outcome.admission, 'live')
  assert.equal(outcome.reason, 'no-obligation')
  assert.equal(outcome.acknowledgment, null)
})

// ── The two axes of an acknowledgment ──

void test('detail and generation narrow on independent axes', () => {
  const atSteady = outcomeAt(50, obligation('unknown')).acknowledgment
  assert.deepEqual(atSteady, { detail: 'full', allowGeneratedContent: true })

  // 25 shortens the acknowledgment *and* stops composing it. Both, not either:
  // conflating the axes would make 'brief' unreachable.
  const atLow = outcomeAt(25, obligation('unknown')).acknowledgment
  assert.deepEqual(atLow, { detail: 'brief', allowGeneratedContent: false })

  const atRest = outcomeAt(0, obligation('unknown')).acknowledgment
  assert.deepEqual(atRest, { detail: 'minimal', allowGeneratedContent: false })
})

void test('the acknowledgment survives at rest — the social debt still clears', () => {
  const outcome = outcomeAt(0, obligation('unknown'))
  assert.equal(outcome.admission, 'acknowledge')
  assert.equal(outcome.reason, 'acknowledged')
})

// ── Confidence and rule 4 ──

void test('an uncertain classification queues silently instead of guessing', () => {
  // 50 admits at 0.8 confidence.
  assert.equal(outcomeAt(50, obligation('unknown', 0.85)).admission, 'acknowledge')

  const unsure = outcomeAt(50, obligation('unknown', 0.6))
  assert.equal(unsure.admission, 'silent')
  assert.equal(unsure.reason, 'below-confidence')
  assert.equal(unsure.acknowledgment, null)
})

void test('the same classification is admitted at high energy and queued at low', () => {
  const demand = obligation('unknown', 0.75)
  assert.equal(outcomeAt(75, demand).admission, 'acknowledge')
  assert.equal(outcomeAt(25, demand).admission, 'silent')
})

void test('at rest only certainty is acknowledged', () => {
  assert.equal(outcomeAt(0, obligation('unknown', 0.99)).admission, 'silent')
  assert.equal(outcomeAt(0, obligation('unknown', 1)).admission, 'acknowledge')
})

void test('omitted confidence means a rule-based caller, not an unsure one', () => {
  const outcome = outcomeAt(0, obligation('unknown'))
  assert.equal(outcome.admission, 'acknowledge')
})

void test('acknowledgment can be disabled without losing the capture', () => {
  const { autonomy } = policyAt(50)
  const outcome = resolveDemandOutcome(
    { originatorThreshold: 'exempt', acknowledge: false, acknowledgmentDetail: 'full' },
    autonomy,
    obligation('unknown'),
  )

  assert.equal(outcome.admission, 'silent')
  assert.equal(outcome.reason, 'acknowledgment-disabled')
})

void test('the "none" threshold admits nobody', () => {
  const { autonomy } = policyAt(50)
  const outcome = resolveDemandOutcome(
    { originatorThreshold: 'none', acknowledge: true, acknowledgmentDetail: 'full' },
    autonomy,
    obligation('known'),
  )

  assert.equal(outcome.admission, 'acknowledge')
})

// ── Validation and shape ──

void test('outcomes are frozen and tiers are validated', () => {
  const outcome = outcomeAt(50, obligation('unknown'))
  assert.equal(Object.isFrozen(outcome), true)
  assert.equal(Object.isFrozen(outcome.acknowledgment), true)

  assert.equal(isOriginatorTier('exempt'), true)
  assert.equal(isOriginatorTier('vip'), false)
  assert.equal(isOriginatorTier(undefined), false)

  const { admission, autonomy } = policyAt(50)
  assert.throws(
    () =>
      resolveDemandOutcome(admission, autonomy, {
        originatorTier: 'vip' as OriginatorTier,
        bearsObligation: true,
      }),
    /Invalid originator tier/,
  )
  assert.throws(
    () =>
      resolveDemandOutcome(admission, autonomy, {
        ...obligation('unknown'),
        confidence: Number.NaN,
      }),
    /Invalid demand confidence/,
  )
})

void test('demandAdmissionStrategy describes itself at every level', () => {
  assert.match(demandAdmissionStrategy.describe(100), /all originators reach the inbox/)
  assert.match(demandAdmissionStrategy.describe(75), /only known originators/)
  assert.match(demandAdmissionStrategy.describe(0), /minimal acknowledgment and are queued/)

  for (const level of LEVELS) {
    assert.equal(typeof demandAdmissionStrategy.describe(level), 'string')
    assert.equal(Object.isFrozen(demandAdmissionStrategy.resolve(level)), true)
  }
})

// ── Integration with the rest of the library ──

void test('both strategies resolve through the engine', () => {
  const engine = createEnergyEngine({ initialLevel: 50 })

  assert.equal(engine.resolve(demandAdmissionStrategy).originatorThreshold, 'exempt')
  assert.equal(engine.resolve(autonomyStrategy).confidenceThreshold, 0.8)

  engine.setLevel(100)
  assert.equal(engine.resolve(demandAdmissionStrategy).originatorThreshold, 'all')

  engine.dispose()
})

void test('the resurface horizon comes from deferralStrategy, not from this policy', () => {
  // The acknowledgment states when the user will get to the item; the
  // energy-ordered deferral default is that answer. One source of truth.
  for (const level of LEVELS) {
    const outcome = outcomeAt(level, obligation('unknown'))
    if (outcome.admission !== 'acknowledge') continue
    assert.equal(typeof deferralStrategy.resolve(level).defaultPresetId, 'string')
  }

  assert.equal(deferralStrategy.resolve(25).defaultPresetId, 'tomorrow-morning')
})

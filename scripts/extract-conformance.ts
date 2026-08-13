/**
 * Emits `conformance.json`: the executable half of `SPEC.md`.
 *
 * The spec says in prose what an energy-aware implementation must do. This says
 * it in data - every level definition, every strategy's output at every level,
 * the full decision matrix of both pure gating functions, the deferral
 * arithmetic, the reconciliation ordering, and the derived metrics. An
 * implementation in any language passes by loading this file and asserting its
 * own output against each vector.
 *
 * Why generate rather than hand-write: a hand-written table is a second
 * implementation, and second implementations drift. These vectors are read out
 * of the built modules, so "the vectors" and "the library" cannot disagree - and
 * `test/conformance.test.ts` fails the build if the committed file falls behind
 * the code that produced it.
 *
 * Scope is deliberate. Vectors cover the PURE surface: tables, and functions of
 * their arguments alone. The stateful runtimes - the notification gate's
 * defer-never-drop, focus-session expiry, the engine's persistence ladder -
 * are specified normatively in SPEC.md and checked by this package's own suite,
 * because a vector cannot express "and it must never drop one".
 *
 * Determinism: the deferral presets compute in LOCAL time by design ("tomorrow
 * morning" means the user's morning), so this generator refuses to run outside
 * UTC. A vector file baked in Athens would encode a two-hour lie for everyone
 * else.
 */

import { readFileSync } from 'node:fs'

import type { ErrorObject } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'

import {
  DEFERRAL_PRESET_IDS,
  autonomyStrategy,
  createDeferralPresets,
  createEnergyState,
  cycleEnergyLevel,
  deferralStrategy,
  demandAdmissionStrategy,
  getEnergyLevels,
  getEnergyMetrics,
  interactionForgivenessStrategy,
  isPreferredEnergyState,
  mapToNearestEnergyLevel,
  notificationStrategy,
  presenceAtOrAbove,
  presenceAtOrBelow,
  resolveDeferral,
  resolveDemandOutcome,
  resolveNotificationOutcome,
  taskComplexityStrategy,
  uiVisibilityStrategy,
} from '../src/index.ts'
import type {
  AdaptationStrategy,
  EnergyLevel,
  EnergySource,
  EnergyState,
  NotificationPriority,
  OriginatorTier,
} from '../src/index.ts'
import { emitArtifact, isCheckRun } from './emit-artifact.ts'

const ROOT = new URL('../', import.meta.url)

const LEVELS: readonly EnergyLevel[] = [100, 75, 50, 25, 0]
const PRIORITIES: readonly NotificationPriority[] = ['normal', 'high', 'critical']
const TIERS: readonly OriginatorTier[] = ['exempt', 'known', 'unknown']
const SOURCES: readonly EnergySource[] = ['manual', 'scheduled', 'inferred']

/**
 * Every confidence that sits on a boundary of the shipped autonomy thresholds
 * (0.6 / 0.7 / 0.8 / 0.9 / 1), plus one clearly below all of them. A port that
 * uses `>` where the spec says `>=` fails on the exact-match rows.
 */
const CONFIDENCES: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

/**
 * Reference instants for the deferral arithmetic, chosen so every branch of the
 * preset computations is exercised at least once.
 */
const DEFERRAL_REFERENCES: ReadonlyArray<{ label: string; iso: string }> = [
  { label: 'wednesday morning, before the evening hour', iso: '2026-08-05T08:30:00.000Z' },
  { label: 'wednesday evening, after the evening hour', iso: '2026-08-05T21:00:00.000Z' },
  { label: 'friday afternoon (next workday crosses the weekend)', iso: '2026-08-07T15:00:00.000Z' },
  { label: 'saturday (already the weekend)', iso: '2026-08-08T11:00:00.000Z' },
  { label: 'sunday late (next workday is tomorrow)', iso: '2026-08-09T23:30:00.000Z' },
  { label: 'monday (next monday is a week out)', iso: '2026-08-10T10:00:00.000Z' },
]

/** A fixed instant for metrics, so `stateAgeMs` is a vector rather than a clock read. */
const METRICS_NOW = Date.parse('2026-08-05T12:00:00.000Z')

function requireUtc(): void {
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error(
      'conformance vectors must be generated under TZ=UTC - the deferral presets compute in ' +
        'local time, so any other zone bakes a local-only answer into a portable file',
    )
  }
}

function state(over: Partial<EnergyState> = {}): EnergyState {
  return createEnergyState(
    over.level ?? 50,
    over.source ?? 'manual',
    over.timestamp ?? 1_000_000,
    over.revision ?? 0,
    over.origin ?? 'origin-a',
  )
}

/** `strategy.resolve` across every level. `describe` is prose and deliberately not normative. */
function tableFor<T>(strategy: AdaptationStrategy<T>): Record<string, T> {
  const table: Record<string, T> = {}
  for (const level of LEVELS) table[String(level)] = strategy.resolve(level)
  return table
}

function notificationVectors() {
  const vectors = []
  for (const level of LEVELS) {
    const config = notificationStrategy.resolve(level)
    for (const priority of PRIORITIES) {
      for (const suppressed of [false, true]) {
        vectors.push({
          level,
          priority,
          suppressed,
          outcome: resolveNotificationOutcome(config, priority, suppressed),
        })
      }
    }
  }
  return vectors
}

function demandVectors() {
  const vectors = []
  for (const level of LEVELS) {
    const admission = demandAdmissionStrategy.resolve(level)
    const autonomy = autonomyStrategy.resolve(level)
    for (const originatorTier of TIERS) {
      for (const bearsObligation of [true, false]) {
        for (const confidence of CONFIDENCES) {
          vectors.push({
            level,
            originatorTier,
            bearsObligation,
            confidence,
            outcome: resolveDemandOutcome(admission, autonomy, {
              originatorTier,
              bearsObligation,
              confidence,
            }),
          })
        }
      }
    }
  }
  return vectors
}

function deferralVectors() {
  // Default preset hours (morning 9, evening 18) - a port that hard-codes other
  // defaults produces a different "tomorrow morning" for the same instant.
  const presets = createDeferralPresets()
  const ids = Object.values(DEFERRAL_PRESET_IDS)

  return DEFERRAL_REFERENCES.map((reference) => {
    const now = new Date(reference.iso)
    const resolved: Record<string, { epochMs: number; iso: string }> = {}
    for (const id of ids) {
      const epochMs = resolveDeferral(presets, id, now)
      if (epochMs === null) throw new Error(`preset ${id} did not resolve`)
      resolved[id] = { epochMs, iso: new Date(epochMs).toISOString() }
    }
    return { label: reference.label, iso: reference.iso, epochMs: now.getTime(), resolved }
  })
}

/**
 * Reconciliation pairs, one per key of the ordering plus the equality case and
 * the contract-violation backstop. `expected` is whether `candidate` replaces
 * `current`; each pair is also asserted in the reverse direction, because an
 * implementation that returns true both ways oscillates forever.
 */
function reconciliationVectors() {
  const pairs: ReadonlyArray<{
    rule: string
    candidate: EnergyState
    current: EnergyState
    expected: boolean
  }> = [
    {
      rule: 'later timestamp wins',
      candidate: state({ timestamp: 2_000_000 }),
      current: state({ timestamp: 1_000_000 }),
      expected: true,
    },
    {
      rule: 'earlier timestamp loses, whatever else it carries',
      candidate: state({ timestamp: 1_000_000, source: 'manual', revision: 99 }),
      current: state({ timestamp: 2_000_000, source: 'inferred', revision: 0 }),
      expected: false,
    },
    {
      rule: 'same timestamp: higher revision wins',
      candidate: state({ revision: 2 }),
      current: state({ revision: 1 }),
      expected: true,
    },
    {
      rule: 'same timestamp and revision: manual outranks scheduled',
      candidate: state({ source: 'manual', origin: 'origin-a' }),
      current: state({ source: 'scheduled', origin: 'origin-b' }),
      expected: true,
    },
    {
      rule: 'same timestamp and revision: scheduled outranks inferred',
      candidate: state({ source: 'scheduled', origin: 'origin-a' }),
      current: state({ source: 'inferred', origin: 'origin-b' }),
      expected: true,
    },
    {
      rule: 'inferred never overwrites manual on a tie',
      candidate: state({ source: 'inferred', origin: 'origin-z' }),
      current: state({ source: 'manual', origin: 'origin-a' }),
      expected: false,
    },
    {
      rule: 'everything else tied: higher origin string wins',
      candidate: state({ origin: 'origin-b' }),
      current: state({ origin: 'origin-a' }),
      expected: true,
    },
    {
      rule: 'identical states are not a change',
      candidate: state(),
      current: state(),
      expected: false,
    },
    {
      rule: 'backstop: one identity reused for two levels still converges',
      candidate: state({ level: 75, origin: 'origin-a' }),
      current: state({ level: 25, origin: 'origin-a' }),
      expected: true,
    },
    {
      rule: 'any produced state beats the unproduced sentinel',
      candidate: state({ timestamp: 1, revision: 0, origin: 'origin-a' }),
      current: createEnergyState(100, 'manual', 0, 0, '0-initial'),
      expected: true,
    },
  ]

  return pairs.map((pair) => ({
    rule: pair.rule,
    candidate: pair.candidate,
    current: pair.current,
    expected: pair.expected,
    // The reverse direction must be false whenever the forward one is true.
    // Together they assert the relation is a strict order, not merely a boolean.
    expectedReversed: isPreferredEnergyState(pair.current, pair.candidate),
  }))
}

function metricsVectors() {
  return LEVELS.map((level) => ({
    level,
    stateTimestamp: METRICS_NOW - 30 * 60_000,
    now: METRICS_NOW,
    metrics: getEnergyMetrics(state({ level, timestamp: METRICS_NOW - 30 * 60_000 }), METRICS_NOW),
  }))
}

function compatibilityVectors() {
  // Percentages an external model might hand over, including both midpoints -
  // 12.5 and 37.5 sit exactly between two levels, which is where rounding
  // implementations disagree.
  const inputs = [-20, 0, 5, 12.5, 13, 25, 37.5, 38, 50, 62.5, 63, 75, 87.5, 88, 100, 140]
  return inputs.map((input) => ({ input, level: mapToNearestEnergyLevel(input) }))
}

requireUtc()

const surface: unknown = JSON.parse(readFileSync(new URL('api-surface.json', ROOT), 'utf8'))
const version =
  typeof surface === 'object' && surface !== null && 'version' in surface
    ? String(surface.version)
    : 'unknown'

const conformance = {
  $schema: './spec/conformance.schema.json',
  version,
  timezone: 'UTC',
  note: 'Generated from the built library by scripts/extract-conformance.ts. See SPEC.md for the normative rules these vectors encode, including the runtime invariants that no vector can express.',

  /** Level definitions, including the cognitive profile a port must reproduce. */
  levels: getEnergyLevels(),

  /** 100 -> 75 -> 50 -> 25 -> 0 -> 100, plus the fallback for an invalid input. */
  cycle: LEVELS.map((level) => ({ from: level, to: cycleEnergyLevel(level) })),

  /** Every built-in strategy's config at every level. */
  strategies: {
    'ui-visibility': tableFor(uiVisibilityStrategy),
    notifications: tableFor(notificationStrategy),
    'task-complexity': tableFor(taskComplexityStrategy),
    'interaction-forgiveness': tableFor(interactionForgivenessStrategy),
    deferral: tableFor(deferralStrategy),
    autonomy: tableFor(autonomyStrategy),
    'demand-admission': tableFor(demandAdmissionStrategy),
  },

  /** Presence helpers, which are pure maps over the level set. */
  presence: {
    atOrAbove: Object.fromEntries(LEVELS.map((min) => [String(min), presenceAtOrAbove(min)])),
    atOrAboveMuted: Object.fromEntries(
      LEVELS.map((min) => [String(min), presenceAtOrAbove(min, 'muted')]),
    ),
    atOrBelow: Object.fromEntries(LEVELS.map((max) => [String(max), presenceAtOrBelow(max)])),
  },

  decisions: {
    notification: notificationVectors(),
    demand: demandVectors(),
  },

  deferral: {
    morningHour: 9,
    eveningHour: 18,
    references: deferralVectors(),
  },

  reconciliation: {
    sourcePriority: Object.fromEntries(
      SOURCES.map((source) => [source, { manual: 3, scheduled: 2, inferred: 1 }[source]]),
    ),
    pairs: reconciliationVectors(),
  },

  metrics: metricsVectors(),
  externalLevelMapping: compatibilityVectors(),
}

/*
 * Validate the vectors against their own published schema BEFORE emitting.
 *
 * conformance.json ships with a `$schema` pointer, which is a promise to every
 * port that loads it: this file has the shape that document describes. A
 * pointer nothing checks is worse than no pointer - it invites a reader to
 * trust a guarantee no one is keeping. Both schemas are registered together,
 * so the reconciliation vectors are validated against the same EnergyState
 * definition external producers write to.
 */
function validateAgainstSchema(candidate: unknown): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  const readSchema = (name: string): object =>
    JSON.parse(readFileSync(new URL(`spec/${name}`, ROOT), 'utf8')) as object

  ajv.addSchema(readSchema('energy-state.schema.json'))
  const validate = ajv.compile(readSchema('conformance.schema.json'))

  if (!validate(candidate)) {
    const problems = (validate.errors ?? [])
      .map((error: ErrorObject) => `  ${error.instancePath || '/'}: ${error.message ?? 'invalid'}`)
      .join('\n')
    throw new Error(
      `Generated conformance vectors do not satisfy spec/conformance.schema.json:\n${problems}`,
    )
  }
}

validateAgainstSchema(conformance)

const target = new URL('conformance.json', ROOT)
const targetPath = emitArtifact(target, `${JSON.stringify(conformance, null, 2)}\n`)

const vectorCount =
  conformance.decisions.notification.length +
  conformance.decisions.demand.length +
  conformance.deferral.references.length +
  conformance.reconciliation.pairs.length +
  conformance.metrics.length +
  conformance.externalLevelMapping.length +
  conformance.cycle.length

console.log(
  `[energy-system] conformance.json ${isCheckRun ? 'verified' : 'written'}: ${vectorCount} vectors + ${
    Object.keys(conformance.strategies).length
  } strategy tables (v${version}) -> ${targetPath}`,
)

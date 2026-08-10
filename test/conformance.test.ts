import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  autonomyStrategy,
  demandAdmissionStrategy,
  isPreferredEnergyState,
  notificationStrategy,
  resolveDemandOutcome,
  resolveNotificationOutcome,
} from '../src/index.ts'
import type { EnergyLevel, EnergyState } from '../src/index.ts'

/**
 * The conformance vectors are the executable half of SPEC.md, and they are only
 * worth something if two things hold: they match the library that produced them,
 * and a consumer reading them gets the same answers the library gives.
 *
 * The first is a drift guard — recompute and compare without writing, the same
 * discipline `api-surface.json` is held to below. The second is a round-trip:
 * replay a sample of the vectors THROUGH the public API, so the file is proven
 * to be a description of behavior rather than a snapshot of one afternoon.
 */

const ROOT = new URL('../', import.meta.url)

interface Conformance {
  version: string
  timezone: string
  levels: ReadonlyArray<{ value: EnergyLevel; key: string; label: string }>
  cycle: ReadonlyArray<{ from: EnergyLevel; to: EnergyLevel }>
  strategies: Record<string, Record<string, unknown>>
  decisions: {
    notification: ReadonlyArray<{
      level: EnergyLevel
      priority: 'normal' | 'high' | 'critical'
      suppressed: boolean
      outcome: string
    }>
    demand: ReadonlyArray<{
      level: EnergyLevel
      originatorTier: 'exempt' | 'known' | 'unknown'
      bearsObligation: boolean
      confidence: number
      outcome: unknown
    }>
  }
  reconciliation: {
    pairs: ReadonlyArray<{
      rule: string
      candidate: EnergyState
      current: EnergyState
      expected: boolean
      expectedReversed: boolean
    }>
  }
}

function readCommitted(): Conformance {
  return JSON.parse(readFileSync(new URL('conformance.json', ROOT), 'utf8')) as Conformance
}

/*
 * `--check` computes the artifact and compares it to the committed file
 * WITHOUT writing. That distinction is the whole guard: this test used to
 * regenerate first and compare the result to itself, which passed no matter
 * what was committed. Generation now belongs to `pnpm run build` alone, so
 * `pnpm test` never rewrites what it is about to check.
 */
void test('the committed vectors match the library that generates them', () => {
  const before = readFileSync(new URL('conformance.json', ROOT), 'utf8')

  execFileSync('node', ['--import', 'tsx', 'scripts/extract-conformance.ts', '--check'], {
    cwd: ROOT.pathname,
    env: { ...process.env, TZ: 'UTC' },
    stdio: 'pipe',
  })

  assert.equal(
    readFileSync(new URL('conformance.json', ROOT), 'utf8'),
    before,
    'a --check run must not rewrite the artifact it is verifying',
  )
})

void test('the committed API surface matches the declarations that generate it', () => {
  const before = readFileSync(new URL('api-surface.json', ROOT), 'utf8')

  execFileSync('node', ['--import', 'tsx', 'scripts/extract-api-surface.ts', '--check'], {
    cwd: ROOT.pathname,
    stdio: 'pipe',
  })

  assert.equal(
    readFileSync(new URL('api-surface.json', ROOT), 'utf8'),
    before,
    'a --check run must not rewrite the artifact it is verifying',
  )
})

void test('the frozen API surface includes generic members', () => {
  const surface = JSON.parse(readFileSync(new URL('api-surface.json', ROOT), 'utf8')) as {
    members: Record<string, string[]>
  }

  // `resolve<T>()` opens with its own type parameter rather than `(`, which is
  // exactly the shape the declaration parser used to skip. A public method
  // missing from the freeze is a method nobody notices removing.
  assert.ok(
    surface.members['EnergyEngine']?.includes('resolve'),
    'EnergyEngine.resolve is missing from api-surface.json',
  )
})

void test('the vectors declare a schema that ships alongside them', () => {
  const conformance = readCommitted() as unknown as { $schema: string }
  const reference = conformance.$schema

  assert.equal(reference, './spec/conformance.schema.json')

  // Resolved from the package root, which is where the reference is anchored
  // for both this repository and the published tarball.
  const schema = JSON.parse(readFileSync(new URL(reference, ROOT), 'utf8')) as {
    $id: string
    properties: Record<string, unknown>
  }
  assert.equal(schema.$id, 'https://kumbat.io/spec/conformance.schema.json')

  const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as {
    exports: Record<string, unknown>
  }
  assert.equal(
    pkg.exports['./spec/conformance.schema.json'],
    './spec/conformance.schema.json',
    'a consumer cannot follow the reference unless the schema is an export',
  )
})

void test('the generator refuses to run outside UTC', () => {
  assert.throws(
    () =>
      execFileSync('node', ['--import', 'tsx', 'scripts/extract-conformance.ts'], {
        cwd: ROOT.pathname,
        env: { ...process.env, TZ: 'Europe/Athens' },
        stdio: 'pipe',
      }),
    // A zone-local "tomorrow morning" baked into a portable file is a lie for
    // every other reader, so this must fail loudly rather than quietly differ.
    /TZ=UTC/,
  )
})

void test('every notification vector replays through the public API', () => {
  const { decisions } = readCommitted()
  assert.equal(decisions.notification.length, 30)

  for (const vector of decisions.notification) {
    const config = notificationStrategy.resolve(vector.level)
    assert.equal(
      resolveNotificationOutcome(config, vector.priority, vector.suppressed),
      vector.outcome,
      `level ${vector.level} / ${vector.priority} / suppressed=${String(vector.suppressed)}`,
    )
  }
})

void test('every demand vector replays through the public API', () => {
  const { decisions } = readCommitted()
  assert.equal(decisions.demand.length, 180)

  for (const vector of decisions.demand) {
    const outcome = resolveDemandOutcome(
      demandAdmissionStrategy.resolve(vector.level),
      autonomyStrategy.resolve(vector.level),
      {
        originatorTier: vector.originatorTier,
        bearsObligation: vector.bearsObligation,
        confidence: vector.confidence,
      },
    )
    assert.deepEqual(
      outcome,
      vector.outcome,
      `level ${vector.level} / ${vector.originatorTier} / confidence ${vector.confidence}`,
    )
  }
})

void test('every reconciliation pair replays, in both directions', () => {
  const { reconciliation } = readCommitted()

  for (const pair of reconciliation.pairs) {
    assert.equal(isPreferredEnergyState(pair.candidate, pair.current), pair.expected, pair.rule)
    assert.equal(
      isPreferredEnergyState(pair.current, pair.candidate),
      pair.expectedReversed,
      `${pair.rule} (reversed)`,
    )
    // Antisymmetry is the property that makes the relation safe to apply
    // repeatedly: if both directions were true, two contexts observing each
    // other would swap states forever.
    assert.ok(
      !(pair.expected && pair.expectedReversed),
      `${pair.rule}: both directions preferred — the ordering is not antisymmetric`,
    )
  }
})

void test('the vectors cover every level and every strategy', () => {
  const conformance = readCommitted()
  const levels: readonly EnergyLevel[] = [100, 75, 50, 25, 0]

  assert.deepEqual(
    conformance.levels.map((definition) => definition.value),
    levels,
  )
  assert.equal(conformance.cycle.length, levels.length)
  assert.equal(conformance.timezone, 'UTC')

  for (const [name, table] of Object.entries(conformance.strategies)) {
    assert.deepEqual(
      Object.keys(table)
        .map(Number)
        .sort((a, b) => b - a),
      [...levels],
      `strategy ${name} is missing a level`,
    )
  }
})

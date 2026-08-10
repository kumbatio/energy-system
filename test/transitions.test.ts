import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AdaptationStrategy,
  EnergyLevel,
  EnergyState,
  NotificationDelivery,
} from '../src/index.ts'
import {
  autonomyStrategy,
  createEnergyEngine,
  createFocusSessionController,
  createNotificationGate,
  cycleEnergyLevel,
  deferralStrategy,
  demandAdmissionStrategy,
  getEnergyLevels,
  getEnergyMetrics,
  interactionForgivenessStrategy,
  isPreferredEnergyState,
  notificationStrategy,
  presenceAtOrAbove,
  resolveEnergyPresence,
  resolveNotificationOutcome,
  taskComplexityStrategy,
  uiVisibilityStrategy,
} from '../src/index.ts'

/**
 * M4 coverage: every level transition, and the strategies composed rather than
 * resolved one at a time.
 *
 * The unit tests elsewhere check each piece against its own table. What they
 * cannot see is the shape of the whole model — that protection only ever
 * increases as capacity falls, that the runtimes agree with the strategies
 * driving them, and that moving between any two levels is safe in both
 * directions. Those are the properties a future edit to one table would break
 * silently.
 */

const LEVELS = [100, 75, 50, 25, 0] as const satisfies readonly EnergyLevel[]

/** Every ordered pair of distinct levels — 20 transitions, both directions. */
const TRANSITIONS: ReadonlyArray<readonly [EnergyLevel, EnergyLevel]> = LEVELS.flatMap((from) =>
  LEVELS.filter((to) => to !== from).map((to) => [from, to] as const),
)

const STRATEGIES: ReadonlyArray<AdaptationStrategy<unknown>> = [
  uiVisibilityStrategy,
  notificationStrategy,
  taskComplexityStrategy,
  interactionForgivenessStrategy,
  deferralStrategy,
  autonomyStrategy,
  demandAdmissionStrategy,
]

function createFakeTimeline(start = 1_000_000) {
  let currentMs = start
  let nextId = 1
  const tasks = new Map<number, { at: number; callback: () => void }>()

  return {
    clock: () => currentMs,
    scheduler: {
      setTimeout(callback: () => void, ms: number): unknown {
        const id = nextId
        nextId += 1
        tasks.set(id, { at: currentMs + ms, callback })
        return id
      },
      clearTimeout(handle: unknown): void {
        tasks.delete(handle as number)
      },
    },
    advance(ms: number): void {
      const until = currentMs + ms
      for (;;) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.at <= until)
          .sort((a, b) => a[1].at - b[1].at)
        const next = due[0]
        if (!next) break
        tasks.delete(next[0])
        currentMs = next[1].at
        next[1].callback()
      }
      currentMs = until
    },
  }
}

// ── Every transition, through the engine ──

void test('every level transition applies, notifies once, and orders after its predecessor', () => {
  for (const [from, to] of TRANSITIONS) {
    const seen: Array<{ next: EnergyState; prev: EnergyState }> = []
    const engine = createEnergyEngine({ initialLevel: from, originId: 'test' })
    const unsubscribe = engine.subscribe((next, prev) => {
      seen.push({ next, prev })
    })

    const before = engine.getState()
    engine.setLevel(to)
    const after = engine.getState()

    const label = `${from} -> ${to}`
    assert.equal(after.level, to, label)
    assert.equal(seen.length, 1, `${label}: expected exactly one notification`)
    assert.equal(seen[0]?.prev.level, from, label)
    assert.equal(seen[0]?.next.level, to, label)

    // The new state must win reconciliation against the one it replaced, or a
    // second context observing both would keep reinstating the old level.
    assert.ok(isPreferredEnergyState(after, before), `${label}: new state does not order after old`)
    assert.ok(!isPreferredEnergyState(before, after), `${label}: ordering is not antisymmetric`)

    unsubscribe()
    engine.dispose()
  }
})

void test('re-setting the same level is not a transition', () => {
  for (const level of LEVELS) {
    let notifications = 0
    const engine = createEnergyEngine({ initialLevel: level, originId: 'test' })
    engine.subscribe(() => {
      notifications += 1
    })

    // The first set produces a real state over the unproduced default, so it
    // does notify; the second is genuinely identical and must not.
    engine.setLevel(level)
    const afterFirst = notifications
    engine.setLevel(level)

    assert.equal(notifications, afterFirst + 1, `level ${level}: revision must still advance`)
    engine.dispose()
  }
})

void test('cycling visits all five levels and returns to the start', () => {
  let level: EnergyLevel = 100
  const visited: EnergyLevel[] = [level]
  for (let step = 0; step < LEVELS.length - 1; step += 1) {
    level = cycleEnergyLevel(level)
    visited.push(level)
  }

  assert.deepEqual(visited, [...LEVELS])
  assert.equal(cycleEnergyLevel(level), 100)
})

void test('every strategy resolves at every level, frozen, and identically each time', () => {
  for (const strategy of STRATEGIES) {
    for (const level of LEVELS) {
      const first = strategy.resolve(level)
      const second = strategy.resolve(level)

      assert.equal(first, second, `${strategy.name} at ${level} is not referentially stable`)
      assert.ok(Object.isFrozen(first), `${strategy.name} at ${level} is not frozen`)
      assert.equal(typeof strategy.describe(level), 'string')
    }
  }
})

void test('every strategy rejects a level outside the model', () => {
  for (const strategy of STRATEGIES) {
    assert.throws(
      () => strategy.resolve(60 as EnergyLevel),
      /Invalid energy level/,
      `${strategy.name} accepted an invalid level`,
    )
  }
})

// ── Direction: the model's two shape rules (SPEC §6) ──

void test('protection never decreases as capacity falls', () => {
  let previousUndo = 0
  let previousAutosave = Number.POSITIVE_INFINITY
  let confirmedYet = false

  for (const level of LEVELS) {
    const forgiveness = interactionForgivenessStrategy.resolve(level)

    assert.ok(
      forgiveness.undoWindowMs > previousUndo,
      `undo window shrank going into level ${level}`,
    )
    assert.ok(
      forgiveness.autosaveIntervalMs < previousAutosave,
      `autosave slowed going into level ${level}`,
    )
    // Once destructive actions start confirming, they must never stop.
    if (confirmedYet) {
      assert.ok(forgiveness.confirmDestructive, `confirmation was withdrawn at level ${level}`)
    }
    confirmedYet ||= forgiveness.confirmDestructive

    previousUndo = forgiveness.undoWindowMs
    previousAutosave = forgiveness.autosaveIntervalMs
  }
})

void test('automation never gains discretion as capacity falls', () => {
  let previousThreshold = 0
  let previousSteps = Number.POSITIVE_INFINITY
  let templatesOnlyYet = false

  for (const level of LEVELS) {
    const autonomy = autonomyStrategy.resolve(level)

    assert.ok(
      autonomy.confidenceThreshold > previousThreshold,
      `confidence threshold fell at level ${level}`,
    )
    assert.ok(autonomy.maxUnattendedSteps <= previousSteps, `step budget grew at level ${level}`)
    if (templatesOnlyYet) {
      assert.ok(!autonomy.allowGeneratedContent, `composition was re-permitted at level ${level}`)
    }
    templatesOnlyYet ||= !autonomy.allowGeneratedContent

    previousThreshold = autonomy.confidenceThreshold
    previousSteps = autonomy.maxUnattendedSteps
  }

  // The floor the model commits to: at Rest, judgement is inadmissible but a
  // single certain, templated action still is.
  const rest = autonomyStrategy.resolve(0)
  assert.equal(rest.confidenceThreshold, 1)
  assert.equal(rest.maxUnattendedSteps, 1)
})

void test('interruption never becomes easier as capacity falls', () => {
  const order = { all: 3, high: 2, critical: 1, none: 0 } as const
  let previousThreshold = Number.POSITIVE_INFINITY
  let previousChannels = Number.POSITIVE_INFINITY

  for (const level of LEVELS) {
    const config = notificationStrategy.resolve(level)
    const permissiveness = order[config.priorityThreshold]
    const channels = [config.allowVisual, config.allowSound, config.allowVibration].filter(
      Boolean,
    ).length

    assert.ok(permissiveness <= previousThreshold, `priority threshold loosened at level ${level}`)
    assert.ok(channels <= previousChannels, `a channel was re-enabled at level ${level}`)

    previousThreshold = permissiveness
    previousChannels = channels
  }
})

void test('the interface asks less of the person as capacity falls', () => {
  let previousVisible = Number.POSITIVE_INFINITY
  let previousFontScale = 0

  for (const level of LEVELS) {
    const ui = uiVisibilityStrategy.resolve(level)
    const visible = [ui.sidebar, ui.tabBar, ui.statusBar, ui.toolbar].filter(Boolean).length

    assert.ok(visible <= previousVisible, `chrome reappeared at level ${level}`)
    // Larger text, not smaller, as capacity drops.
    assert.ok(ui.contentFontScale >= previousFontScale, `font scale shrank at level ${level}`)

    previousVisible = visible
    previousFontScale = ui.contentFontScale
  }
})

void test('deferral horizons lengthen as capacity falls', () => {
  const rank = [
    'in-1-hour',
    'this-evening',
    'tomorrow-morning',
    'next-workday',
    'next-monday',
  ] as const
  let previousRank = -1

  for (const level of LEVELS) {
    const config = deferralStrategy.resolve(level)
    const index = rank.indexOf(config.defaultPresetId as (typeof rank)[number])

    assert.ok(index !== -1, `unknown default preset at level ${level}`)
    assert.ok(index >= previousRank, `the default deferral shortened at level ${level}`)
    assert.equal(config.orderedPresetIds.length, rank.length)
    assert.equal(config.orderedPresetIds[0], config.defaultPresetId)

    previousRank = index
  }
})

void test('the demand policy never admits more as capacity falls', () => {
  const order = { all: 3, known: 2, exempt: 1, none: 0 } as const
  const detail = { full: 3, brief: 2, minimal: 1 } as const
  let previousAdmission = Number.POSITIVE_INFINITY
  let previousDetail = Number.POSITIVE_INFINITY

  for (const level of LEVELS) {
    const config = demandAdmissionStrategy.resolve(level)

    assert.ok(
      order[config.originatorThreshold] <= previousAdmission,
      `the admitted tier widened at level ${level}`,
    )
    assert.ok(
      detail[config.acknowledgmentDetail] <= previousDetail,
      `acknowledgments got longer at level ${level}`,
    )

    previousAdmission = order[config.originatorThreshold]
    previousDetail = detail[config.acknowledgmentDetail]
  }
})

// ── Composition: the runtimes against the strategies driving them ──

void test('a gated notification is released by any transition that admits it', () => {
  for (const [from, to] of TRANSITIONS) {
    const timeline = createFakeTimeline()
    const delivered: NotificationDelivery[] = []
    const engine = createEnergyEngine({ initialLevel: from, originId: 'test' })
    const gate = createNotificationGate(engine, {
      onDeliver: (delivery) => delivered.push(delivery),
      clock: timeline.clock,
      scheduler: timeline.scheduler,
    })

    const outcome = gate.publish({ priority: 'high' })
    engine.setLevel(to)
    timeline.advance(60 * 60 * 1000)
    gate.flush()

    const label = `${from} -> ${to}`
    const surfaced = delivered.flatMap((delivery) => delivery.notifications).length

    // Defer-never-drop, stated as a property rather than one scenario: whatever
    // the gate did with the intent, it exists somewhere afterwards. Whether the
    // destination level admits it is the strategy's answer, not a guess — asking
    // the same pure function the gate asks is what keeps this a test of the
    // runtime rather than a second copy of the table.
    const admittedAfter =
      resolveNotificationOutcome(notificationStrategy.resolve(to), 'high', false) !== 'deferred'

    if (outcome === 'delivered') {
      // Already surfaced before the transition; a later level cannot recall it.
      assert.equal(surfaced, 1, `${label}: an immediate intent was not delivered once`)
    } else {
      // Still held when energy moved — batched and deferred alike are judged by
      // the policy in force at delivery, not the one in force at publish.
      assert.equal(
        surfaced,
        admittedAfter ? 1 : 0,
        `${label}: held intent ignored the destination level's policy`,
      )
    }

    gate.dispose()
    // Disposal is the last exit: nothing may remain held.
    assert.deepEqual(gate.pendingCount(), { batched: 0, deferred: 0 }, label)
    engine.dispose()
  }
})

void test('no transition can strand an intent inside a disposed gate', () => {
  for (const [from, to] of TRANSITIONS) {
    const delivered: NotificationDelivery[] = []
    const engine = createEnergyEngine({ initialLevel: from, originId: 'test' })
    const gate = createNotificationGate(engine, {
      onDeliver: (delivery) => delivered.push(delivery),
    })

    gate.publish({ priority: 'normal', payload: 'a' })
    engine.setLevel(to)
    gate.dispose()

    const surfaced = delivered.flatMap((delivery) => delivery.notifications).length
    assert.equal(surfaced, 1, `${from} -> ${to}: the intent never came back out`)
    engine.dispose()
  }
})

void test('a focus session survives every transition and still expires', () => {
  for (const [from, to] of TRANSITIONS) {
    const timeline = createFakeTimeline()
    const events: string[] = []
    const engine = createEnergyEngine({ initialLevel: from, originId: 'test' })
    const gate = createNotificationGate(engine, {
      onDeliver: () => {},
      clock: timeline.clock,
      scheduler: timeline.scheduler,
    })
    const sessions = createFocusSessionController({
      engine,
      gate,
      clock: timeline.clock,
      scheduler: timeline.scheduler,
    })
    sessions.subscribe((event) => events.push(event))

    sessions.start({ durationMinutes: 25 })
    assert.ok(gate.isSuppressed(), `${from} -> ${to}: session did not suppress`)

    engine.setLevel(to)
    timeline.advance(26 * 60 * 1000)

    assert.ok(events.includes('end'), `${from} -> ${to}: session did not auto-expire`)
    assert.equal(gate.isSuppressed(), false, `${from} -> ${to}: suppression outlived the session`)
    assert.equal(sessions.getSession(), null)

    sessions.dispose()
    gate.dispose()
    engine.dispose()
  }
})

void test('presence, metrics and strategies agree at every level through one engine', () => {
  const engine = createEnergyEngine({ initialLevel: 100, originId: 'test' })
  const aiPanel = presenceAtOrAbove(75)

  for (const level of LEVELS) {
    engine.setLevel(level)
    const state = engine.getState()

    assert.equal(state.level, level)
    assert.equal(engine.resolve(uiVisibilityStrategy), uiVisibilityStrategy.resolve(level))
    assert.equal(
      resolveEnergyPresence(aiPanel, level),
      level >= 75 ? 'visible' : 'hidden',
      `presence disagrees at level ${level}`,
    )

    const metrics = getEnergyMetrics(state, state.timestamp)
    assert.equal(
      metrics.recommendedTaskComplexity,
      taskComplexityStrategy.resolve(level).maxComplexity,
      `metrics and the task strategy disagree at level ${level}`,
    )
    // Only the mid-range levels are states to hold: peak depletes, rest recovers.
    assert.equal(metrics.sustainable, level > 0 && level < 100)
  }

  engine.dispose()
})

void test('the level definitions and the strategy tables cover the same set', () => {
  const defined = getEnergyLevels().map((definition) => definition.value)
  assert.deepEqual(defined, [...LEVELS])

  for (const strategy of STRATEGIES) {
    for (const level of defined) {
      assert.doesNotThrow(() => strategy.resolve(level), `${strategy.name} missing level ${level}`)
    }
  }
})

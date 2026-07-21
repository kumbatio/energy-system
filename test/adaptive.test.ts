import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  EnergyNotification,
  NotificationDelivery,
  FocusSession,
  FocusSessionEvent,
} from '../src/index.ts'
import {
  DEFERRAL_PRESET_IDS,
  createDeferralPresets,
  createEnergyEngine,
  createFocusSessionController,
  createNotificationGate,
  createPresenceStrategy,
  defineEnergyPresence,
  deferralStrategy,
  interactionForgivenessStrategy,
  isEnergyPresence,
  isPresenceVisible,
  notificationStrategy,
  presenceAtOrAbove,
  presenceAtOrBelow,
  resolveDeferral,
  resolveEnergyPresence,
  resolveNotificationOutcome,
} from '../src/index.ts'

/**
 * Deterministic clock + timer pair. `advance(ms)` moves time forward and runs
 * every timer that comes due, in schedule order, including timers scheduled
 * by other timers' callbacks (break chains).
 */
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
      const target = currentMs + ms
      for (;;) {
        let dueId: number | undefined
        let dueAt = Number.POSITIVE_INFINITY
        for (const [id, taskEntry] of tasks) {
          if (taskEntry.at <= target && taskEntry.at < dueAt) {
            dueAt = taskEntry.at
            dueId = id
          }
        }
        if (dueId === undefined) break
        const taskEntry = tasks.get(dueId)
        tasks.delete(dueId)
        currentMs = Math.max(currentMs, dueAt)
        taskEntry?.callback()
      }
      currentMs = target
    },
  }
}

// ── Presence ──

void test('defineEnergyPresence fills unlisted levels from default and freezes the map', () => {
  const presence = defineEnergyPresence({ default: 'visible', 50: 'hidden', 25: 'hidden' })

  assert.equal(presence[100], 'visible')
  assert.equal(presence[75], 'visible')
  assert.equal(presence[50], 'hidden')
  assert.equal(presence[25], 'hidden')
  assert.equal(presence[0], 'visible')
  assert.equal(Object.isFrozen(presence), true)

  assert.throws(
    () => defineEnergyPresence({ default: 'faded' as never }),
    /Invalid energy presence/,
  )
  assert.throws(() => defineEnergyPresence({ 50: 'faded' as never }), /Invalid energy presence/)
})

void test('presenceAtOrAbove and presenceAtOrBelow build range maps', () => {
  const above = presenceAtOrAbove(75)
  assert.equal(above[100], 'visible')
  assert.equal(above[75], 'visible')
  assert.equal(above[50], 'hidden')
  assert.equal(above[0], 'hidden')

  const aboveMuted = presenceAtOrAbove(75, 'muted')
  assert.equal(aboveMuted[50], 'muted')

  const below = presenceAtOrBelow(25)
  assert.equal(below[25], 'visible')
  assert.equal(below[0], 'visible')
  assert.equal(below[50], 'hidden')
  assert.equal(below[100], 'hidden')

  assert.throws(() => presenceAtOrAbove(33 as never), /Invalid energy level/)
})

void test('resolveEnergyPresence validates level and map entries', () => {
  const presence = presenceAtOrAbove(50)
  assert.equal(resolveEnergyPresence(presence, 50), 'visible')
  assert.equal(resolveEnergyPresence(presence, 25), 'hidden')
  assert.throws(() => resolveEnergyPresence(presence, 33 as never), /Invalid energy level/)

  assert.equal(isEnergyPresence('muted'), true)
  assert.equal(isEnergyPresence('faded'), false)
  assert.equal(isPresenceVisible('muted'), true)
  assert.equal(isPresenceVisible('hidden'), false)
})

void test('createPresenceStrategy resolves through the engine like any strategy', () => {
  const aiChat = createPresenceStrategy('ai-chat', presenceAtOrAbove(75))
  const engine = createEnergyEngine({ initialLevel: 100 })

  assert.equal(engine.resolve(aiChat), 'visible')
  engine.setLevel(50)
  assert.equal(engine.resolve(aiChat), 'hidden')
  assert.match(aiChat.describe(50), /ai-chat is hidden/)

  assert.throws(
    () => createPresenceStrategy('', presenceAtOrAbove(75)),
    /Invalid presence strategy name/,
  )
  assert.throws(
    () => createPresenceStrategy('bad', { 100: 'faded' } as never),
    /Invalid energy presence|no valid entry/,
  )
})

// ── Deferral ──

void test('deferral presets compute local resurface times', () => {
  const presets = createDeferralPresets()
  // Wednesday 2026-01-07, 10:30 local time
  const wednesday = new Date(2026, 0, 7, 10, 30)

  const inOneHour = resolveDeferral(presets, DEFERRAL_PRESET_IDS.inOneHour, wednesday)
  assert.equal(inOneHour, wednesday.getTime() + 60 * 60_000)

  const evening = new Date(
    resolveDeferral(presets, DEFERRAL_PRESET_IDS.thisEvening, wednesday) ?? 0,
  )
  assert.deepEqual([evening.getDate(), evening.getHours(), evening.getMinutes()], [7, 18, 0])

  // Past the evening hour, "this evening" rolls to tomorrow evening
  const lateNight = new Date(2026, 0, 7, 21, 0)
  const rolledEvening = new Date(
    resolveDeferral(presets, DEFERRAL_PRESET_IDS.thisEvening, lateNight) ?? 0,
  )
  assert.equal(rolledEvening.getDate(), 8)

  const morning = new Date(
    resolveDeferral(presets, DEFERRAL_PRESET_IDS.tomorrowMorning, wednesday) ?? 0,
  )
  assert.deepEqual([morning.getDate(), morning.getHours()], [8, 9])

  // Friday -> next workday is Monday
  const friday = new Date(2026, 0, 9, 10, 0)
  const workday = new Date(resolveDeferral(presets, DEFERRAL_PRESET_IDS.nextWorkday, friday) ?? 0)
  assert.deepEqual([workday.getDate(), workday.getDay()], [12, 1])

  // Monday -> next Monday is a full week out
  const monday = new Date(2026, 0, 5, 10, 0)
  const nextMonday = new Date(resolveDeferral(presets, DEFERRAL_PRESET_IDS.nextMonday, monday) ?? 0)
  assert.deepEqual([nextMonday.getDate(), nextMonday.getDay()], [12, 1])

  assert.equal(resolveDeferral(presets, 'unknown-preset', wednesday), null)
})

void test('deferral presets honour custom hours and reject invalid ones', () => {
  const presets = createDeferralPresets({ morningHour: 7, eveningHour: 20 })
  const wednesday = new Date(2026, 0, 7, 10, 30)

  const morning = new Date(
    resolveDeferral(presets, DEFERRAL_PRESET_IDS.tomorrowMorning, wednesday) ?? 0,
  )
  assert.equal(morning.getHours(), 7)

  const evening = new Date(
    resolveDeferral(presets, DEFERRAL_PRESET_IDS.thisEvening, wednesday) ?? 0,
  )
  assert.equal(evening.getHours(), 20)

  assert.throws(() => createDeferralPresets({ morningHour: 24 }), /Invalid morningHour/)
  assert.throws(() => createDeferralPresets({ eveningHour: 5.5 }), /Invalid eveningHour/)
})

void test('deferralStrategy suggests longer deferrals at lower energy', () => {
  const atPeak = deferralStrategy.resolve(100)
  assert.equal(atPeak.defaultPresetId, DEFERRAL_PRESET_IDS.inOneHour)

  const atLow = deferralStrategy.resolve(25)
  assert.equal(atLow.defaultPresetId, DEFERRAL_PRESET_IDS.tomorrowMorning)

  const atRest = deferralStrategy.resolve(0)
  assert.equal(atRest.defaultPresetId, DEFERRAL_PRESET_IDS.tomorrowMorning)
  assert.equal(atRest.orderedPresetIds.length, 5)
  assert.equal(Object.isFrozen(atRest), true)
})

// ── Interaction forgiveness ──

void test('interaction forgiveness scales inversely with energy', () => {
  const levels = [100, 75, 50, 25, 0] as const
  let previousUndoWindow = 0
  for (const level of levels) {
    const config = interactionForgivenessStrategy.resolve(level)
    assert.equal(config.undoWindowMs > previousUndoWindow, true)
    previousUndoWindow = config.undoWindowMs
    assert.equal(Object.isFrozen(config), true)
  }

  assert.equal(interactionForgivenessStrategy.resolve(100).confirmDestructive, false)
  assert.equal(interactionForgivenessStrategy.resolve(50).confirmDestructive, true)
  assert.match(interactionForgivenessStrategy.describe(50), /10s undo window/)
})

// ── Notification gate ──

void test('resolveNotificationOutcome encodes the gating matrix', () => {
  const atPeak = notificationStrategy.resolve(100)
  const atSteady = notificationStrategy.resolve(50)
  const atRest = notificationStrategy.resolve(0)

  assert.equal(resolveNotificationOutcome(atPeak, 'normal', false), 'delivered')
  assert.equal(resolveNotificationOutcome(atPeak, 'normal', true), 'deferred')
  assert.equal(resolveNotificationOutcome(atSteady, 'high', false), 'batched')
  assert.equal(resolveNotificationOutcome(atSteady, 'normal', false), 'deferred')
  assert.equal(resolveNotificationOutcome(atRest, 'critical', false), 'deferred')
})

void test('gate delivers immediately at peak with the level channels', () => {
  const timeline = createFakeTimeline()
  const engine = createEnergyEngine({ initialLevel: 100, clock: timeline.clock })
  const deliveries: NotificationDelivery[] = []
  const gate = createNotificationGate(engine, {
    onDeliver: (delivery) => deliveries.push(delivery),
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })

  assert.equal(gate.publish({ priority: 'normal', payload: 'hello' }), 'delivered')
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.reason, 'immediate')
  assert.equal(deliveries[0]?.level, 100)
  assert.deepEqual(deliveries[0]?.channels, { visual: true, sound: true, vibration: true })
  assert.equal(deliveries[0]?.notifications[0]?.payload, 'hello')

  assert.throws(
    () => gate.publish({ priority: 'urgent' as never }),
    /Invalid notification priority/,
  )
  gate.dispose()
})

void test('gate batches at 50, defers below threshold, and releases on energy rise', () => {
  const timeline = createFakeTimeline()
  const engine = createEnergyEngine({ initialLevel: 50, clock: timeline.clock })
  const deliveries: NotificationDelivery[] = []
  const gate = createNotificationGate(engine, {
    onDeliver: (delivery) => deliveries.push(delivery),
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })

  // 50 -> threshold 'high', batchInterval 5min
  assert.equal(gate.publish({ priority: 'high', payload: 'a' }), 'batched')
  assert.equal(gate.publish({ priority: 'high', payload: 'b' }), 'batched')
  assert.equal(gate.publish({ priority: 'normal', payload: 'c' }), 'deferred')
  assert.deepEqual(gate.pendingCount(), { batched: 2, deferred: 1 })
  assert.equal(deliveries.length, 0)

  timeline.advance(5 * 60_000)
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.reason, 'batch')
  assert.equal(deliveries[0]?.notifications.length, 2)

  // Raising energy releases the deferred 'normal' notification
  engine.setLevel(100)
  assert.equal(deliveries.length, 2)
  assert.equal(deliveries[1]?.reason, 'released')
  assert.equal(deliveries[1]?.notifications[0]?.payload, 'c')
  assert.deepEqual(gate.pendingCount(), { batched: 0, deferred: 0 })
  gate.dispose()
})

void test('gate suppression defers everything and lifting it releases the queue', () => {
  const timeline = createFakeTimeline()
  const engine = createEnergyEngine({ initialLevel: 100, clock: timeline.clock })
  const deliveries: NotificationDelivery[] = []
  const gate = createNotificationGate(engine, {
    onDeliver: (delivery) => deliveries.push(delivery),
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })

  gate.setSuppressed(true)
  assert.equal(gate.publish({ priority: 'critical', payload: 'urgent' }), 'deferred')
  assert.equal(deliveries.length, 0)

  gate.setSuppressed(false)
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.reason, 'released')
  gate.dispose()
})

void test('gate never drops: rest-level deferrals survive until release or dispose', () => {
  const timeline = createFakeTimeline()
  const engine = createEnergyEngine({ initialLevel: 0, clock: timeline.clock })
  const deliveries: NotificationDelivery[] = []
  const gate = createNotificationGate(engine, {
    onDeliver: (delivery) => deliveries.push(delivery),
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })

  // Rest -> threshold 'none': even critical defers rather than dropping
  assert.equal(gate.publish({ priority: 'critical', payload: 'x' }), 'deferred')
  assert.equal(gate.publish({ priority: 'normal', payload: 'y' }), 'deferred')
  assert.equal(deliveries.length, 0)

  gate.dispose()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.reason, 'released')
  assert.equal(deliveries[0]?.notifications.length, 2)
  assert.throws(() => gate.publish({ payload: 'z' }), /disposed notification gate/)
})

void test('gate flush delivers the open batch without waiting for the window', () => {
  const timeline = createFakeTimeline()
  const engine = createEnergyEngine({ initialLevel: 25, clock: timeline.clock })
  const deliveries: NotificationDelivery[] = []
  const gate = createNotificationGate(engine, {
    onDeliver: (delivery) => deliveries.push(delivery),
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })

  // 25 -> threshold 'critical', batchInterval 15min
  assert.equal(gate.publish({ priority: 'critical', payload: 'now' }), 'batched')
  gate.flush()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.reason, 'batch')

  // The window timer was consumed by flush; nothing further fires
  timeline.advance(20 * 60_000)
  assert.equal(deliveries.length, 1)
  gate.dispose()
})

// ── Focus sessions ──

interface RecordedEvent {
  event: FocusSessionEvent
  session: FocusSession
  suppressedAtEmit: boolean
}

function createRecordingGate() {
  let suppressed = false
  return {
    setSuppressed(next: boolean) {
      suppressed = next
    },
    isSuppressed: () => suppressed,
  }
}

void test('sessions auto-expire, and suppression lifts before the end event', () => {
  const timeline = createFakeTimeline()
  const gate = createRecordingGate()
  const events: RecordedEvent[] = []
  const controller = createFocusSessionController({
    gate,
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })
  controller.subscribe((event, session) => {
    events.push({ event, session, suppressedAtEmit: gate.isSuppressed() })
  })

  const session = controller.start({ durationMinutes: 25 })
  assert.equal(gate.isSuppressed(), true)
  assert.equal(controller.remainingMs(), 25 * 60_000)
  assert.equal(events[0]?.event, 'start')

  timeline.advance(25 * 60_000)
  assert.equal(controller.getSession(), null)
  assert.equal(gate.isSuppressed(), false)

  const endEvent = events.at(-1)
  assert.equal(endEvent?.event, 'end')
  assert.equal(endEvent?.session.endsAt, session.endsAt)
  // The invariant: suppression was already lifted when 'end' fired, so an
  // end-of-session notification cannot be swallowed.
  assert.equal(endEvent?.suppressedAtEmit, false)
})

void test('break nudges recur but never land on or after the session end', () => {
  const timeline = createFakeTimeline()
  const events: FocusSessionEvent[] = []
  const controller = createFocusSessionController({
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })
  controller.subscribe((event) => events.push(event))

  controller.start({ durationMinutes: 60, breakEveryMinutes: 25 })
  timeline.advance(60 * 60_000)

  // Breaks at 25 and 50; the would-be 75 nudge is past the end. End fires once.
  assert.deepEqual(events, ['start', 'break', 'break', 'end'])
})

void test('sessions default their shape from the engine energy level', () => {
  const timeline = createFakeTimeline()
  const engine = createEnergyEngine({ initialLevel: 50, clock: timeline.clock })
  const controller = createFocusSessionController({
    engine,
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })

  // 50 -> 45min productivity window, 45min break cadence (suppressed: >= end)
  const steady = controller.start()
  assert.equal(steady.endsAt - steady.startedAt, 45 * 60_000)
  assert.equal(steady.breakIntervalMs, 45 * 60_000)
  controller.stop()

  // 100 -> 120min window, no break suggestions at peak
  engine.setLevel(100)
  const peak = controller.start()
  assert.equal(peak.endsAt - peak.startedAt, 120 * 60_000)
  assert.equal(peak.breakIntervalMs, 0)
  controller.stop()

  // 0 -> metrics window is 0; an explicit session still gets a real bound
  engine.setLevel(0)
  const rest = controller.start()
  assert.equal(rest.endsAt - rest.startedAt, 25 * 60_000)
  controller.dispose()
})

void test('manual stop, restart, and dispose all release suppression exactly once', () => {
  const timeline = createFakeTimeline()
  const gate = createRecordingGate()
  const events: FocusSessionEvent[] = []
  const controller = createFocusSessionController({
    gate,
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })
  controller.subscribe((event) => events.push(event))

  controller.start({ durationMinutes: 30 })
  controller.start({ durationMinutes: 10 }) // replaces: stop then start
  assert.deepEqual(events, ['start', 'stop', 'start'])
  assert.equal(gate.isSuppressed(), true)

  controller.stop()
  assert.equal(gate.isSuppressed(), false)
  assert.deepEqual(events, ['start', 'stop', 'start', 'stop'])

  // Timers from the replaced/stopped sessions never fire afterwards
  timeline.advance(60 * 60_000)
  assert.deepEqual(events, ['start', 'stop', 'start', 'stop'])

  controller.dispose()
  assert.throws(() => controller.start(), /disposed controller/)
  assert.throws(
    () => createFocusSessionController().start({ durationMinutes: -5 }),
    /Invalid session duration/,
  )
})

void test('gate and session controller compose: focus defers, end releases', () => {
  const timeline = createFakeTimeline()
  const engine = createEnergyEngine({ initialLevel: 100, clock: timeline.clock })
  const deliveries: NotificationDelivery[] = []
  const gate = createNotificationGate(engine, {
    onDeliver: (delivery) => deliveries.push(delivery),
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })
  const controller = createFocusSessionController({
    engine,
    gate,
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })

  controller.start({ durationMinutes: 25 })
  assert.equal(gate.publish({ priority: 'high', payload: 'during-focus' }), 'deferred')
  assert.equal(deliveries.length, 0)

  timeline.advance(25 * 60_000)
  // Session auto-expired -> suppression lifted -> deferred queue released.
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.reason, 'released')
  const released: readonly EnergyNotification[] = deliveries[0]?.notifications ?? []
  assert.equal(released[0]?.payload, 'during-focus')

  controller.dispose()
  gate.dispose()
})

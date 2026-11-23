import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import {
  bindEnergyEngine,
  createEnergyAnnouncer,
  createEnergyPrepaintScript,
  manageEnergyFocus,
} from '../src/dom.ts'
import { registerEnergyElements, setEnergyElementsEngine } from '../src/elements.ts'
import type { EnergyLevel, EnergyState } from '../src/index.ts'
import {
  DEFERRAL_PRESET_IDS,
  calibrateDeferralOptions,
  calibrateNotifications,
  calibrateSensory,
  calibrateUIVisibility,
  choiceBudgetStrategy,
  composeStrategies,
  computeSharedWindows,
  createDeferralPresets,
  createDemandCoordinator,
  createEnergyEngine,
  createEnergyLedger,
  createEnergyState,
  createFocusSessionController,
  createNotificationGate,
  createStalenessMonitor,
  defineStrategy,
  describeDeferralHorizon,
  extendStrategy,
  formPacingStrategy,
  resolveDeferral,
  sensoryStrategy,
  uiVisibilityStrategy,
} from '../src/index.ts'
import { filePersistence, resolveEnergyStatePath } from '../src/node.ts'
import {
  broadcastChannelPersistence,
  browserExtensionPersistence,
  cookiePersistence,
  localStoragePersistence,
  memoryPersistence,
  parseEnergyCookie,
} from '../src/persistence.ts'
import {
  EnergyAnnouncer,
  EnergyProvider,
  useEnergyLevel,
  useIsEnergyHydrated,
} from '../src/react.ts'

GlobalRegistrator.register()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LEVELS: readonly EnergyLevel[] = [100, 75, 50, 25, 0]

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
        const due = [...tasks.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort((a, b) => a[1].at - b[1].at)
        const next = due[0]
        if (!next) break
        tasks.delete(next[0])
        currentMs = Math.max(currentMs, next[1].at)
        next[1].callback()
      }
      currentMs = target
    },
  }
}

// ── New built-in strategies (monotonicity + shape) ──

void test('sensory, choice-budget, and form-pacing strategies scale monotonically across all levels', () => {
  let prevMotion = Number.POSITIVE_INFINITY
  let prevChoices = Number.POSITIVE_INFINITY
  let prevFields = Number.POSITIVE_INFINITY

  for (const level of LEVELS) {
    const sensory = sensoryStrategy.resolve(level)
    const choice = choiceBudgetStrategy.resolve(level)
    const form = formPacingStrategy.resolve(level)

    assert.equal(Object.isFrozen(sensory), true)
    assert.equal(Object.isFrozen(choice), true)
    assert.equal(Object.isFrozen(form), true)

    assert.ok(sensory.motionScale <= prevMotion)
    const numericChoices = choice.maxChoices ?? Number.POSITIVE_INFINITY
    assert.ok(numericChoices <= prevChoices)
    assert.ok(form.maxFieldsPerStep <= prevFields)

    assert.equal(typeof sensoryStrategy.describe(level), 'string')
    assert.equal(typeof choiceBudgetStrategy.describe(level), 'string')
    assert.equal(typeof formPacingStrategy.describe(level), 'string')

    prevMotion = sensory.motionScale
    prevChoices = numericChoices
    prevFields = form.maxFieldsPerStep
  }

  assert.equal(sensoryStrategy.resolve(0).allowCallsToAction, false)
  assert.equal(choiceBudgetStrategy.resolve(25).maxChoices, 1)
  assert.equal(formPacingStrategy.resolve(25).showOptionalFields, false)
})

// ── Strategy authoring, composition, and personal calibration ──

void test('defineStrategy, extendStrategy, and composeStrategies produce frozen exhaustive tables', () => {
  const custom = defineStrategy('reading', {
    100: { summaryFirst: false },
    75: { summaryFirst: false },
    50: { summaryFirst: true },
    25: { summaryFirst: true },
    0: { summaryFirst: true },
  })
  assert.equal(custom.resolve(25).summaryFirst, true)
  assert.equal(Object.isFrozen(custom.resolve(25)), true)

  const extended = extendStrategy(uiVisibilityStrategy, 'workspace-ui', (level, base) => ({
    ...base,
    showAiRail: level >= 75,
  }))
  assert.equal(extended.resolve(100).showAiRail, true)
  assert.equal(extended.resolve(50).showAiRail, false)
  assert.equal(extended.resolve(50).contentMaxWidth, '90ch')

  const combined = composeStrategies('bundle', {
    sensory: sensoryStrategy,
    choice: choiceBudgetStrategy,
  })
  assert.equal(combined.resolve(25).choice.maxChoices, 1)
  assert.equal(combined.resolve(0).sensory.motionScale, 0)
})

void test('personal calibration overlays user sensory and schedule preferences without altering base strategies', () => {
  const quietAlerts = calibrateNotifications({ muteSoundAlways: true, muteVibrationAlways: true })
  assert.equal(quietAlerts.resolve(100).allowSound, false)
  assert.equal(quietAlerts.resolve(100).allowVibration, false)
  assert.equal(quietAlerts.resolve(100).allowVisual, true)

  const highFloorUI = calibrateUIVisibility({ minChromeOpacity: 0.5 })
  assert.equal(highFloorUI.resolve(0).chromeOpacity, 0.5)
  assert.equal(highFloorUI.resolve(25).chromeOpacity, 0.5)
  assert.equal(highFloorUI.resolve(75).chromeOpacity, 0.7)

  const stillSensory = calibrateSensory({ reduceMotionAlways: true, muteAmbientAudioAlways: true })
  assert.equal(stillSensory.resolve(100).motionScale, 0)
  assert.equal(stillSensory.resolve(100).allowDecorativeMotion, false)
  assert.equal(stillSensory.resolve(100).allowAmbientAudio, false)

  const deferralOpts = calibrateDeferralOptions({
    morningHour: 11,
    eveningHour: 21,
    weekendDays: [5, 6],
    timeZone: 'UTC',
  })
  const presets = createDeferralPresets(deferralOpts)
  // Thursday 2026-08-06 in UTC -> with Fri/Sat weekend, next workday is Sunday 2026-08-09 11:00 UTC.
  const thursday = new Date('2026-08-06T12:00:00.000Z')
  const nextWorkday = resolveDeferral(presets, DEFERRAL_PRESET_IDS.nextWorkday, thursday)
  assert.equal(new Date(nextWorkday ?? 0).toISOString(), '2026-08-09T11:00:00.000Z')
  assert.equal(describeDeferralHorizon(DEFERRAL_PRESET_IDS.tomorrowMorning), 'tomorrow morning')
})

// ── Timezone-aware deferral ──

void test('createDeferralPresets computes wall-clock hours in an explicit IANA timezone', () => {
  const presets = createDeferralPresets({ morningHour: 9, timeZone: 'America/New_York' })
  // 2026-01-07 15:00 UTC is 10:00 EST (UTC-5) in New York -> tomorrow morning 09:00 EST = 14:00 UTC.
  const instant = new Date('2026-01-07T15:00:00.000Z')
  const tomorrow = resolveDeferral(presets, DEFERRAL_PRESET_IDS.tomorrowMorning, instant)
  assert.equal(new Date(tomorrow ?? 0).toISOString(), '2026-01-08T14:00:00.000Z')
})

// ── Generic notification gate ──

void test('createNotificationGate supports strongly typed payloads', () => {
  interface AlertPayload {
    title: string
  }
  const engine = createEnergyEngine({ initialLevel: 100 })
  const titles: string[] = []
  const gate = createNotificationGate<AlertPayload>(engine, {
    onDeliver(delivery) {
      for (const n of delivery.notifications) {
        titles.push(n.payload.title)
      }
    },
  })

  gate.publish({ priority: 'normal', payload: { title: 'Saved' } })
  assert.deepEqual(titles, ['Saved'])
  gate.dispose()
  engine.dispose()
})

// ── Focus session pause / resume / extend / restore / drop-to-rest ──

void test('focus sessions support pause, resume, extend, restore, and optional stop on Rest', () => {
  const timeline = createFakeTimeline(0)
  const engine = createEnergyEngine({ initialLevel: 75, clock: timeline.clock })
  let suppressed = false
  const events: string[] = []
  const sessions = createFocusSessionController({
    engine,
    gate: {
      setSuppressed(next) {
        suppressed = next
      },
    },
    onEnergyDropToRest: 'stop',
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })
  sessions.subscribe((event) => events.push(event))

  sessions.start({ durationMinutes: 20 })
  assert.equal(suppressed, true)

  timeline.advance(5 * 60_000)
  sessions.pause()
  assert.equal(sessions.isPaused(), true)
  assert.equal(suppressed, false)
  assert.equal(sessions.remainingMs(), 15 * 60_000)

  // Time passing while paused does not burn the remaining focus budget.
  timeline.advance(30 * 60_000)
  assert.equal(sessions.remainingMs(), 15 * 60_000)

  sessions.extend(5)
  assert.equal(sessions.remainingMs(), 20 * 60_000)

  sessions.resume()
  assert.equal(sessions.isPaused(), false)
  assert.equal(suppressed, true)

  const snapshot = sessions.getSession()
  assert.ok(snapshot)

  // Dropping to Rest stops the active session when configured.
  engine.setLevel(0)
  assert.equal(sessions.getSession(), null)
  assert.equal(suppressed, false)
  assert.deepEqual(events, ['start', 'pause', 'extend', 'resume', 'stop'])

  // Restoring a non-expired snapshot resumes suppression until expiry.
  const restored = sessions.restore(snapshot)
  assert.ok(restored)
  assert.equal(suppressed, true)
  timeline.advance(20 * 60_000)
  assert.equal(sessions.getSession(), null)
  assert.equal(suppressed, false)

  sessions.dispose()
  engine.dispose()
})

// ── Staleness monitor (Paper 3 Pattern 10) ──

void test('staleness monitor checks in gently by level, pauses during focus, and never nags at Rest', () => {
  const timeline = createFakeTimeline(0)
  const engine = createEnergyEngine({ initialLevel: 100, clock: timeline.clock })
  const sessions = createFocusSessionController({
    engine,
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })
  const prompts: string[] = []
  const monitor = createStalenessMonitor(engine, {
    sessions,
    clock: timeline.clock,
    scheduler: timeline.scheduler,
  })
  monitor.subscribe((prompt) => prompts.push(prompt.message))

  // Unproduced default state never nags.
  timeline.advance(4 * 60 * 60_000)
  assert.equal(prompts.length, 0)

  // Setting Peak (100) schedules a gentle check-in after 2 hours.
  engine.setLevel(100)
  timeline.advance(2 * 60 * 60_000)
  assert.equal(prompts.length, 1)
  assert.match(prompts[0] ?? '', /Still feels right/)
  // Never mutates the person's declared level.
  assert.equal(engine.getState().level, 100)

  monitor.dismiss()
  assert.equal(monitor.getPrompt(), null)

  // Rest (0) never nags.
  engine.setLevel(0)
  timeline.advance(10 * 60 * 60_000)
  assert.equal(prompts.length, 1)

  // Focus sessions hold staleness check-ins until the session finishes.
  engine.setLevel(100)
  sessions.start({ durationMinutes: 150 })
  timeline.advance(120 * 60_000)
  assert.equal(prompts.length, 1)
  timeline.advance(30 * 60_000)
  assert.equal(prompts.length, 2)

  monitor.dispose()
  sessions.dispose()
  engine.dispose()
})

// ── Demand coordinator (SPEC.md §8.2) ──

void test('demand coordinator enforces capture-first with rollback, deduplication, and unified horizon', async () => {
  const nowMs = Date.parse('2026-08-05T10:00:00.000Z')
  const engine = createEnergyEngine({ initialLevel: 25, clock: () => nowMs })
  const log: string[] = []
  let failAck = false

  const coordinator = createDemandCoordinator<{ id: string }, string>({
    engine,
    clock: () => nowMs,
    deferralOptions: { timeZone: 'UTC' },
    deliverLive(item) {
      log.push(`live:${item.id}`)
    },
    capture(item, horizon) {
      log.push(`capture:${item.id}:${horizon.presetId}`)
      return `receipt-${item.id}`
    },
    rollbackCapture(receipt) {
      log.push(`rollback:${receipt}`)
    },
    acknowledge(ctx) {
      if (failAck) throw new Error('smtp-down')
      log.push(`ack:${ctx.item.id}:${ctx.horizon.phrase}:auto=${String(ctx.automated)}`)
    },
  })

  // Exempt originator always passes live.
  const exemptRes = await coordinator.handle({
    originatorId: 'partner@home',
    originatorTier: 'exempt',
    bearsObligation: true,
    item: { id: 'm0' },
  })
  assert.equal(exemptRes.outcome.admission, 'live')

  // First unknown obligation captures first, then acknowledges with tomorrow-morning horizon.
  const first = await coordinator.handle({
    originatorId: 'stranger@example.com',
    originatorTier: 'unknown',
    bearsObligation: true,
    item: { id: 'm1' },
  })
  assert.equal(first.deduplicated, false)
  assert.equal(first.horizon?.presetId, 'tomorrow-morning')

  // Second arrival from same sender inside window captures without double-acknowledging.
  const second = await coordinator.handle({
    originatorId: 'stranger@example.com',
    originatorTier: 'unknown',
    bearsObligation: true,
    item: { id: 'm2' },
  })
  assert.equal(second.deduplicated, true)

  // Failed acknowledgment rolls back its paired capture.
  failAck = true
  await assert.rejects(
    () =>
      coordinator.handle({
        originatorId: 'other@example.com',
        originatorTier: 'unknown',
        bearsObligation: true,
        item: { id: 'm3' },
      }),
    /smtp-down/,
  )

  assert.deepEqual(log, [
    'live:m0',
    'capture:m1:tomorrow-morning',
    'ack:m1:tomorrow morning:auto=true',
    'capture:m2:tomorrow-morning',
    'capture:m3:tomorrow-morning',
    'rollback:receipt-m3',
  ])
  engine.dispose()
})

// ── Local ledger & privacy-preserving team windows ──

void test('energy ledger summarizes capacity spans and offers opt-in explainable suggestions', () => {
  let nowMs = new Date(2026, 7, 1, 10, 0).getTime()
  const engine = createEnergyEngine({ initialLevel: 100, clock: () => nowMs })
  const ledger = createEnergyLedger(engine, { clock: () => nowMs })

  // Three mornings at 10:00 set to 75, then one afternoon at 14:00 set to 25.
  engine.setLevel(75)
  nowMs = new Date(2026, 7, 1, 11, 0).getTime()
  engine.setLevel(0)
  nowMs = new Date(2026, 7, 2, 10, 0).getTime()
  engine.setLevel(75)
  nowMs = new Date(2026, 7, 3, 10, 0).getTime()
  engine.setLevel(75)

  const suggestion = ledger.suggestForTime(new Date(2026, 7, 4, 10, 15))
  assert.ok(suggestion)
  assert.equal(suggestion.level, 75)
  assert.equal(suggestion.sampleCount, 3)
  assert.equal(suggestion.confidence, 1)

  const summary = ledger.summarize(
    new Date(2026, 7, 1, 10, 0).getTime(),
    new Date(2026, 7, 1, 12, 0).getTime(),
  )
  assert.equal(summary.highCapacityMs, 60 * 60_000)
  assert.equal(summary.restMs, 60 * 60_000)

  ledger.dispose()
  engine.dispose()
})

void test('computeSharedWindows finds overlapping team windows from voluntary hour preferences only', () => {
  const windows = computeSharedWindows([
    { memberId: 'alex', preferredHours: [9, 10, 11, 14] },
    { memberId: 'sam', preferredHours: [10, 11, 12, 15] },
    { memberId: 'kai', preferredHours: [10, 11, 14, 15] },
  ])

  assert.equal(windows.length, 1)
  assert.equal(windows[0]?.startHour, 10)
  assert.equal(windows[0]?.endHour, 12)
  assert.equal(windows[0]?.coverage, 1)
  assert.deepEqual(windows[0]?.memberIds, ['alex', 'kai', 'sam'])
})

// ── DOM kit: bindEnergyEngine, announcer, focus recovery, prepaint script ──

void test('DOM kit binds engine, announces transitions, recovers focus, and generates prepaint script', async () => {
  const engine = createEnergyEngine({ initialLevel: 100 })
  const rootEl = document.createElement('div')
  const mainEl = document.createElement('main')
  const hiddenBtn = document.createElement('button')
  rootEl.append(mainEl, hiddenBtn)
  document.body.appendChild(rootEl)

  const unbind = bindEnergyEngine(engine, rootEl)
  const stopAnnouncer = createEnergyAnnouncer(engine, { container: rootEl })
  const stopFocus = manageEnergyFocus(engine, mainEl)

  assert.equal(rootEl.dataset['energyLevel'], '100')

  hiddenBtn.focus()
  hiddenBtn.hidden = true
  engine.setLevel(25)

  await new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })

  const liveRegion = rootEl.querySelector('[data-energy-announcer="true"]')
  assert.match(liveRegion?.textContent ?? '', /25%, Low/)
  assert.equal(document.activeElement, mainEl)

  const script = createEnergyPrepaintScript({
    storageKey: 'my-key',
    cookieName: 'my-cookie',
    target: 'documentElement',
  })
  assert.match(script, /my-key/)
  assert.match(script, /my-cookie/)
  assert.match(script, /dataset\.energyLevel/)

  stopFocus()
  stopAnnouncer()
  unbind()
  assert.equal(rootEl.getAttribute('data-energy-level'), null)
  rootEl.remove()
  engine.dispose()
})

// ── Persistence kit: cookies, corrupt recovery, broadcast, extension bridge, local file bus ──

void test('cookiePersistence, parseEnergyCookie, localStorage corruption cleanup, and extension bridge work end to end', async () => {
  const sample = createEnergyState(25, 'manual', 5000, 1, 'ssr-origin')
  const cookieHeader = `foo=bar; kumbatio-energy=${encodeURIComponent(JSON.stringify(sample))}`
  assert.deepEqual(parseEnergyCookie(cookieHeader), sample)

  // Happy DOM starts on about:blank where document.cookie is inert; point it
  // at a real origin so cookiePersistence exercises the real browser cookie API.
  const win = globalThis as unknown as { happyDOM?: { setURL(url: string): void } }
  win.happyDOM?.setURL('https://kumbat.io/')
  const cookies = cookiePersistence()
  await cookies.save(sample)
  assert.deepEqual(await cookies.load(), sample)

  // localStorage clearOnCorrupt cleans unreadable entries automatically.
  localStorage.setItem('corrupt-auto', '{bad json')
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const ls = localStoragePersistence('corrupt-auto', { clearOnCorrupt: true })
    assert.equal(await ls.load(), null)
    assert.equal(localStorage.getItem('corrupt-auto'), null)
  } finally {
    console.error = originalConsoleError
  }

  // BroadcastChannel wrapper round-trips through backing persistence cleanly.
  const wrapped = broadcastChannelPersistence(memoryPersistence(sample), 'test-energy-ch')
  assert.deepEqual(await wrapped.load(), sample)

  // Browser extension bridge takes precedence when present on globalThis.
  const extState = createEnergyState(50, 'manual', 9000, 0, 'ext-origin')
  let extListener: ((state: EnergyState) => void) | undefined
  ;(globalThis as { __KUMBATIO_ENERGY__?: unknown }).__KUMBATIO_ENERGY__ = {
    getState: () => extState,
    subscribe(listener: (state: EnergyState) => void) {
      extListener = listener
      return () => {}
    },
  }
  try {
    const extPersistence = browserExtensionPersistence(memoryPersistence())
    assert.deepEqual(await extPersistence.load(), extState)
    const seen: EnergyLevel[] = []
    const stop = extPersistence.observe?.((s) => seen.push(s.level))
    extListener?.(createEnergyState(0, 'manual', 9500, 0, 'ext-origin'))
    assert.deepEqual(seen, [0])
    stop?.()
  } finally {
    delete (globalThis as { __KUMBATIO_ENERGY__?: unknown }).__KUMBATIO_ENERGY__
  }
})

void test('filePersistence atomically persists and resolves standard local interchange paths', async () => {
  assert.equal(
    resolveEnergyStatePath({ KUMBATIO_ENERGY_FILE: '/tmp/custom-energy.json' }),
    '/tmp/custom-energy.json',
  )
  assert.equal(
    resolveEnergyStatePath({ XDG_STATE_HOME: '/tmp/xdg-state' }, 'linux'),
    '/tmp/xdg-state/kumbatio/energy-state.json',
  )

  const dir = mkdtempSync(join(tmpdir(), 'kumbatio-energy-file-'))
  const filePath = join(dir, 'energy-state.json')
  try {
    const persistence = filePersistence(filePath)
    assert.equal(await persistence.load(), null)

    const engineA = createEnergyEngine({
      initialLevel: 100,
      persistence,
      originId: 'app-a',
      clock: () => 5000,
    })
    engineA.setLevel(25)
    await engineA.flush()

    const loaded = await persistence.load()
    assert.equal(loaded?.level, 25)
    assert.equal(loaded?.origin, 'app-a')
    engineA.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── React SSR initialState, useIsEnergyHydrated, and EnergyAnnouncer ──

void test('EnergyProvider initialState, useIsEnergyHydrated, and EnergyAnnouncer work together', async () => {
  const initialState = createEnergyState(25, 'manual', 1000, 0, 'cookie-ssr')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let setLevelRef: ((level: EnergyLevel) => void) | undefined

  function Probe() {
    const [level, setLevel] = useEnergyLevel()
    const hydrated = useIsEnergyHydrated()
    setLevelRef = setLevel
    return createElement('span', null, `${String(level)}:${String(hydrated)}`)
  }

  try {
    await act(async () => {
      root.render(
        createElement(EnergyProvider, {
          initialState,
          applyToDOM: false,
          children: [
            createElement(EnergyAnnouncer, { key: 'announcer' }),
            createElement(Probe, { key: 'probe' }),
          ],
        }),
      )
    })

    assert.equal(container.textContent, '25:true')
    await act(async () => {
      setLevelRef?.(75)
    })
    const live = document.body.querySelector('[data-energy-announcer="true"]')
    assert.match(live?.textContent ?? '', /75%, Active/)
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})

// ── Zero-dependency Web Components (<energy-dial>, <energy-gate>) ──

void test('registerEnergyElements provides working <energy-dial> and <energy-gate> custom elements', () => {
  const engine = createEnergyEngine({ initialLevel: 100 })
  registerEnergyElements({ engine })
  setEnergyElementsEngine(engine)

  const host = document.createElement('div')
  host.innerHTML = `<energy-dial></energy-dial><energy-gate min="75">deep-panel</energy-gate>`
  document.body.appendChild(host)

  const dial = host.querySelector('energy-dial')
  const gate = host.querySelector<HTMLElement>('energy-gate')
  assert.ok(dial)
  assert.ok(gate)
  assert.equal(dial.hasAttribute('data-energy-exempt'), true)
  assert.equal(gate.hidden, false)

  const lowRadio = dial.querySelector<HTMLInputElement>('input[value="25"]')
  assert.ok(lowRadio)
  lowRadio.checked = true
  lowRadio.dispatchEvent(new Event('change'))

  assert.equal(engine.getState().level, 25)
  assert.equal(gate.hidden, true)
  assert.equal(gate.dataset['energyPresence'], 'hidden')

  host.remove()
  setEnergyElementsEngine(null)
  engine.dispose()
})

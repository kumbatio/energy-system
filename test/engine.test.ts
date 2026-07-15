import assert from 'node:assert/strict'
import test from 'node:test'

import { applyEnergyLevel, readEnergyLevel } from '../src/dom.ts'
import {
  createExternalLevelCompatibility,
  createEnergyEngine,
  createEnergyState,
  cycleEnergyLevel,
  getEnergyLevel,
  getEnergyMetrics,
  notificationStrategy,
  taskComplexityStrategy,
  uiVisibilityStrategy,
} from '../src/index.ts'
import { localStoragePersistence, memoryPersistence } from '../src/persistence.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

void test('engine rejects invalid runtime levels', () => {
  assert.throws(() => createEnergyEngine({ initialLevel: 33 as never }), /Invalid energy level/)

  const engine = createEnergyEngine({ initialLevel: 100 })
  assert.throws(() => {
    engine.setLevel(33 as never)
  }, /Invalid energy level/)
  assert.throws(() => createEnergyState(33 as never), /Invalid energy level/)
})

void test('core snapshots and configs are frozen', () => {
  const engine = createEnergyEngine({ initialLevel: 100 })
  const state = engine.getState()
  const definition = getEnergyLevel(100)
  const uiConfig = uiVisibilityStrategy.resolve(25)

  assert.equal(Object.isFrozen(state), true)
  assert.equal(Object.isFrozen(definition), true)
  assert.equal(Object.isFrozen(definition.cognitiveProfile), true)
  assert.equal(Object.isFrozen(uiConfig), true)

  assert.throws(() => {
    ;(state as { level: number }).level = 25
  }, TypeError)

  assert.throws(() => {
    ;(definition as { label: string }).label = 'Changed'
  }, TypeError)

  assert.throws(() => {
    ;(uiConfig as { sidebar: boolean }).sidebar = true
  }, TypeError)
})

void test('hydrate does not override a newer local change', async () => {
  let resolveStored: ((state: ReturnType<typeof createEnergyState>) => void) | undefined

  const persistence = {
    async load() {
      return new Promise<ReturnType<typeof createEnergyState>>((resolve) => {
        resolveStored = resolve
      })
    },
    async save() {},
  }

  const engine = createEnergyEngine({ initialLevel: 100, persistence })
  engine.setLevel(75)
  resolveStored?.(createEnergyState(25, 'manual', 1))

  await sleep(0)

  assert.equal(engine.getState().level, 75)
  assert.equal(engine.getState().source, 'manual')
})

void test('newer observed external state is applied even while a save is in flight', async () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined

  const persistence = {
    async load() {
      return null
    },
    async save() {
      await sleep(20)
    },
    observe(onState: (state: ReturnType<typeof createEnergyState>) => void) {
      observeState = onState
      return () => {}
    },
  }

  const engine = createEnergyEngine({
    initialLevel: 100,
    persistence,
    clock: (() => {
      let current = 10
      return () => current++
    })(),
  })

  const seen: number[] = []
  engine.subscribe((state) => {
    seen.push(state.level)
  })

  engine.setLevel(75)
  observeState?.(createEnergyState(25, 'manual', 999))

  await sleep(30)

  assert.equal(engine.getState().level, 25)
  assert.deepEqual(seen, [75, 25])
})

void test('newer observed external state eventually becomes the durable persisted state', async () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined
  let persisted: ReturnType<typeof createEnergyState> | null = null
  const getPersisted = (): ReturnType<typeof createEnergyState> | null => persisted

  const persistence = {
    async load() {
      return null
    },
    async save(state: ReturnType<typeof createEnergyState>) {
      await sleep(20)
      persisted = state
    },
    observe(onState: (state: ReturnType<typeof createEnergyState>) => void) {
      observeState = onState
      return () => {}
    },
  }

  const engine = createEnergyEngine({
    initialLevel: 100,
    persistence,
    clock: (() => {
      let current = 1
      return () => current++
    })(),
  })

  engine.setLevel(75)
  observeState?.(createEnergyState(25, 'manual', 999))

  await sleep(70)

  assert.equal(engine.getState().level, 25)
  assert.equal(getPersisted()?.level, 25)
  assert.equal(getPersisted()?.timestamp, 999)
})

void test('hydrate load failures are contained without unhandled rejections', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
  }
  const originalConsoleError = console.error
  const loggedErrors: unknown[][] = []
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args)
  }

  process.on('unhandledRejection', onUnhandled)

  try {
    const engine = createEnergyEngine({
      initialLevel: 100,
      persistence: {
        async load() {
          throw new Error('load-failed')
        },
        async save() {},
      },
    })

    await sleep(10)
    await assert.doesNotReject(() => engine.hydrate())
    await sleep(10)

    assert.equal(unhandled.length, 0)
    assert.equal(loggedErrors.length >= 1, true)
    assert.equal(engine.getState().level, 100)
  } finally {
    process.off('unhandledRejection', onUnhandled)
    console.error = originalConsoleError
  }
})

void test('invalid observed external state is ignored instead of throwing', () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined
  const originalConsoleError = console.error
  const loggedErrors: unknown[][] = []
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args)
  }

  try {
    const persistence = {
      async load() {
        return null
      },
      async save() {},
      observe(onState: (state: ReturnType<typeof createEnergyState>) => void) {
        observeState = onState
        return () => {}
      },
    }

    const engine = createEnergyEngine({ initialLevel: 100, persistence })

    assert.doesNotThrow(() => {
      observeState?.({ level: 33, source: 'manual', timestamp: Date.now() } as never)
    })

    assert.equal(engine.getState().level, 100)
    assert.equal(loggedErrors.length >= 1, true)
  } finally {
    console.error = originalConsoleError
  }
})

void test('dispose releases persistence observation and blocks later external updates', () => {
  let cleanedUp = false
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined

  const persistence = {
    async load() {
      return null
    },
    async save() {},
    observe(onState: (state: ReturnType<typeof createEnergyState>) => void) {
      observeState = onState
      return () => {
        cleanedUp = true
      }
    },
  }

  const engine = createEnergyEngine({ initialLevel: 100, persistence })
  engine.dispose()

  observeState?.(createEnergyState(25, 'manual', 999))

  assert.equal(cleanedUp, true)
  assert.equal(engine.getState().level, 100)
})

void test('cycleEnergyLevel follows the documented order and recovers from invalid input', () => {
  assert.equal(cycleEnergyLevel(100), 75)
  assert.equal(cycleEnergyLevel(75), 50)
  assert.equal(cycleEnergyLevel(50), 25)
  assert.equal(cycleEnergyLevel(25), 0)
  assert.equal(cycleEnergyLevel(0), 100)
  assert.equal(cycleEnergyLevel(33 as never), 100)
})

void test('state-changing operations after dispose are inert', () => {
  const changes: Array<[number, number]> = []
  const engine = createEnergyEngine({
    initialLevel: 100,
    onChange: (state, prev) => {
      changes.push([prev.level, state.level])
    },
  })

  engine.setLevel(75)
  engine.dispose()
  engine.setLevel(25)
  engine.cycleLevel()

  assert.equal(engine.getState().level, 75)
  assert.deepEqual(changes, [[100, 75]])
})

void test('failed saves are retried with backoff until the state is durably persisted', async () => {
  let attempts = 0
  let persisted: ReturnType<typeof createEnergyState> | null = null
  const getPersisted = (): ReturnType<typeof createEnergyState> | null => persisted

  const persistence = {
    async load() {
      return null
    },
    async save(state: ReturnType<typeof createEnergyState>) {
      attempts += 1
      if (attempts < 2) throw new Error('transient failure')
      persisted = state
    },
  }

  const originalConsoleError = console.error
  console.error = () => {}

  const engine = createEnergyEngine({ initialLevel: 100, persistence })

  try {
    engine.setLevel(50)
    await sleep(400)

    assert.equal(attempts, 2)
    assert.equal(getPersisted()?.level, 50)
  } finally {
    engine.dispose()
    console.error = originalConsoleError
  }
})

void test('localStorage persistence save surfaces failures instead of swallowing them', async () => {
  const globalWithStorage = globalThis as { localStorage?: unknown }
  const originalStorage = globalWithStorage.localStorage

  try {
    delete globalWithStorage.localStorage
    const unavailable = localStoragePersistence('energy-test')
    await assert.rejects(
      () => unavailable.save(createEnergyState(50, 'manual', 1)),
      /Failed to save energy state to localStorage key 'energy-test'/,
    )

    globalWithStorage.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const full = localStoragePersistence('energy-test')
    await assert.rejects(
      () => full.save(createEnergyState(50, 'manual', 1)),
      /Failed to save energy state to localStorage key 'energy-test'/,
    )
  } finally {
    if (originalStorage === undefined) {
      delete globalWithStorage.localStorage
    } else {
      globalWithStorage.localStorage = originalStorage
    }
  }
})

void test('localStorage persistence rejects malformed state metadata', async () => {
  const globalWithStorage = globalThis as { localStorage?: unknown }
  const originalStorage = globalWithStorage.localStorage
  const malformedStates = [
    { level: 25, source: 'manual', timestamp: 1 },
    { level: 25, source: 'unknown', timestamp: 1, revision: 1, origin: 'external' },
    { level: 25, source: 'manual', timestamp: null, revision: 1, origin: 'external' },
    { level: 25, source: 'manual', timestamp: 1, revision: -1, origin: 'external' },
    { level: 25, source: 'manual', timestamp: 1, revision: 1, origin: '' },
  ]

  try {
    const adapter = localStoragePersistence('energy-test')
    for (const malformed of malformedStates) {
      globalWithStorage.localStorage = {
        getItem: () => JSON.stringify(malformed),
        setItem() {},
      }
      assert.equal(await adapter.load(), null)
    }
  } finally {
    if (originalStorage === undefined) {
      delete globalWithStorage.localStorage
    } else {
      globalWithStorage.localStorage = originalStorage
    }
  }
})

void test('break cadence agrees between task strategy and metrics wherever breaks are suggested', () => {
  for (const level of [100, 75, 50, 25, 0] as const) {
    const config = taskComplexityStrategy.resolve(level)
    if (!config.suggestBreaks) continue

    const metrics = getEnergyMetrics(createEnergyState(level, 'manual', 10), 10)
    assert.equal(
      config.breakIntervalMinutes,
      metrics.suggestedBreakIntervalMinutes,
      `break cadence diverges at level ${level}`,
    )
  }
})

void test('task complexity guidance stays aligned across levels, metrics, and level definitions', () => {
  const expected = new Map([
    [100, 'complex'],
    [75, 'moderate'],
    [50, 'routine'],
    [25, 'simple'],
    [0, 'consumption'],
  ] as const)

  for (const [level, complexity] of expected) {
    const state = createEnergyState(level, 'manual', 10)
    assert.equal(taskComplexityStrategy.resolve(level).maxComplexity, complexity)
    assert.equal(getEnergyMetrics(state, 10).recommendedTaskComplexity, complexity)
    assert.equal(getEnergyLevel(level).cognitiveProfile.taskComplexity, complexity)
  }
})

void test('dom adapter rejects invalid runtime levels with a domain error', () => {
  const root = {
    dataset: {} as DOMStringMap,
    style: {
      setProperty() {},
    },
  } as unknown as HTMLElement

  assert.throws(() => {
    applyEnergyLevel(33 as never, root)
  }, /Invalid energy level/)
})

void test('state metadata is validated instead of being repaired', () => {
  assert.throws(() => createEnergyState(25, 'manual', Number.NaN), /Invalid energy timestamp/)
  assert.throws(
    () => createEnergyState(25, 'manual', Number.POSITIVE_INFINITY),
    /Invalid energy timestamp/,
  )
  assert.throws(() => createEnergyState(25, 'manual', 1, -1), /Invalid energy revision/)
  assert.throws(() => createEnergyState(25, 'manual', 1, 0, ''), /Invalid energy origin/)
})

void test('re-entrant updates are delivered to every listener in FIFO transition order', () => {
  const engine = createEnergyEngine({
    initialLevel: 100,
    originId: 'reentrant-test',
    clock: (() => {
      let timestamp = 0
      return () => ++timestamp
    })(),
  })
  const first: Array<[number, number]> = []
  const second: Array<[number, number]> = []

  engine.subscribe((state, prev) => {
    first.push([prev.level, state.level])
    if (state.level === 75) engine.setLevel(25)
  })
  engine.subscribe((state, prev) => {
    second.push([prev.level, state.level])
  })

  engine.setLevel(75)

  assert.deepEqual(first, [
    [100, 75],
    [75, 25],
  ])
  assert.deepEqual(second, [
    [100, 75],
    [75, 25],
  ])
  assert.equal(engine.getState().level, 25)
})

void test('same-timestamp concurrent contexts converge deterministically', () => {
  const observers: Array<(state: ReturnType<typeof createEnergyState>) => void> = []
  const persistence = {
    async load() {
      return null
    },
    async save() {},
    observe(listener: (state: ReturnType<typeof createEnergyState>) => void) {
      observers.push(listener)
      return () => {}
    },
  }
  const clock = () => 100
  const a = createEnergyEngine({ initialLevel: 100, persistence, clock, originId: 'origin-a' })
  const b = createEnergyEngine({ initialLevel: 100, persistence, clock, originId: 'origin-b' })

  a.setLevel(75)
  b.setLevel(25)
  const aState = a.getState()
  const bState = b.getState()

  observers[0]?.(bState)
  observers[1]?.(aState)

  assert.deepEqual(a.getState(), bState)
  assert.deepEqual(b.getState(), bState)
})

void test('same-origin logical revisions outrank an earlier write source priority', () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined
  const persistence = {
    async load() {
      return null
    },
    async save() {},
    observe(listener: (state: ReturnType<typeof createEnergyState>) => void) {
      observeState = listener
      return () => {}
    },
  }
  const producer = createEnergyEngine({
    initialLevel: 100,
    clock: () => 100,
    originId: 'producer',
  })
  const observer = createEnergyEngine({
    initialLevel: 100,
    persistence,
    clock: () => 100,
    originId: 'observer',
  })

  producer.setLevel(75, 'manual')
  observeState?.(producer.getState())
  producer.setLevel(25, 'inferred')
  observeState?.(producer.getState())

  assert.equal(observer.getState().level, 25)
  assert.equal(observer.getState().source, 'inferred')
  assert.equal(observer.getState().revision, 2)
})

void test('malformed observed state is ignored without gaining manual priority', () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const engine = createEnergyEngine({
      initialLevel: 100,
      originId: 'validation-test',
      clock: () => 10,
      persistence: {
        async load() {
          return null
        },
        async save() {},
        observe(listener: (state: ReturnType<typeof createEnergyState>) => void) {
          observeState = listener
          return () => {}
        },
      },
    })
    engine.setLevel(50, 'inferred')

    observeState?.({
      level: 25,
      timestamp: 10,
      source: 'not-a-source',
      revision: 2,
      origin: 'external',
    } as never)

    assert.equal(engine.getState().level, 50)
    assert.equal(engine.getState().source, 'inferred')
  } finally {
    console.error = originalConsoleError
  }
})

void test('flush resolves only after the current state is durably saved', async () => {
  let releaseSave: (() => void) | undefined
  const persistence = memoryPersistence()
  const delayedPersistence = {
    load: persistence.load,
    async save(state: ReturnType<typeof createEnergyState>) {
      await new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      await persistence.save(state)
    },
  }
  const engine = createEnergyEngine({
    initialLevel: 100,
    persistence: delayedPersistence,
    originId: 'flush-test',
    clock: () => 1,
  })
  engine.setLevel(25)

  let flushed = false
  const flush = engine.flush().then(() => {
    flushed = true
  })
  await sleep(0)
  assert.equal(flushed, false)

  releaseSave?.()
  await flush

  assert.equal(flushed, true)
  assert.equal((await persistence.load())?.level, 25)
})

void test('persistence failures are observable and pending flushes reject on dispose', async () => {
  const failures: Array<{ error: unknown; level: number }> = []
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const engine = createEnergyEngine({
      initialLevel: 100,
      originId: 'failure-test',
      clock: () => 1,
      persistence: {
        async load() {
          return null
        },
        async save() {
          throw new Error('storage unavailable')
        },
      },
      onPersistenceError(error, state) {
        failures.push({ error, level: state.level })
      },
    })

    engine.setLevel(25)
    const flush = engine.flush()
    await sleep(0)

    assert.equal(failures.length, 1)
    assert.equal(failures[0]?.level, 25)
    assert.match(String(failures[0]?.error), /storage unavailable/)

    engine.dispose()
    await assert.rejects(flush, /disposed before persistence completed/)
  } finally {
    console.error = originalConsoleError
  }
})

void test('compatibility mappings are snapshotted and validate their domain', () => {
  const mapping: Record<0 | 100, 0 | 25 | 50 | 75 | 100> = { 100: 100, 0: 0 }
  const compatibility = createExternalLevelCompatibility({
    levels: [100, 0] as const,
    toEnergyLevel: mapping,
    fallbackLevel: 100,
  })

  mapping[100] = 25
  assert.equal(compatibility.toEnergyLevel(100), 100)
  assert.equal(compatibility.fromEnergyLevel(100), 100)

  assert.throws(
    () =>
      createExternalLevelCompatibility({
        levels: [100, 100] as const,
        toEnergyLevel: { 100: 100 },
        fallbackLevel: 100,
      }),
    /must be unique/,
  )
  assert.throws(
    () =>
      createExternalLevelCompatibility({
        levels: [100, 0] as const,
        toEnergyLevel: { 100: 100, 0: 0 },
        fallbackLevel: 100,
        fallbackEnergyLevel: 33 as never,
      }),
    /Invalid fallbackEnergyLevel/,
  )
})

void test('DOM parsing rejects empty and coerced values', () => {
  const root = {
    dataset: { energyLevel: '' },
  } as unknown as HTMLElement

  assert.equal(readEnergyLevel(root), 100)
  root.dataset['energyLevel'] = ' 0 '
  assert.equal(readEnergyLevel(root), 100)
  root.dataset['energyLevel'] = '0'
  assert.equal(readEnergyLevel(root), 0)
})

void test('notification descriptions match enabled channels', () => {
  assert.match(notificationStrategy.describe(100), /All notification channels enabled/)
  assert.match(notificationStrategy.describe(75), /haptics disabled/)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { applyEnergyLevel, readEnergyLevel } from '../src/dom.ts'
import type { EnergyState } from '../src/index.ts'
import {
  ENERGY_LEVEL_VALUES,
  ENERGY_SOURCE_VALUES,
  UNPRODUCED_ORIGIN,
  UNPRODUCED_TIMESTAMP,
  createExternalLevelCompatibility,
  createEnergyEngine,
  createEnergyState,
  cycleEnergyLevel,
  getEnergyLevel,
  getEnergyMetrics,
  isEnergyLevel,
  isEnergySource,
  isUnproducedState,
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

void test('public validation collections cannot be mutated to admit illegal domain values', () => {
  assert.throws(() => {
    ;(ENERGY_LEVEL_VALUES as Set<number>).add(33)
  }, TypeError)
  assert.throws(() => {
    ;(ENERGY_SOURCE_VALUES as Set<string>).add('guessed')
  }, TypeError)

  assert.equal(isEnergyLevel(33), false)
  assert.equal(isEnergySource('guessed'), false)
  assert.throws(() => createEnergyState(33 as never), /Invalid energy level/)
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

void test('engine construction reads neither the clock nor the random source', () => {
  /*
   * React providers construct their engine during render. Under a prerender, any clock or random
   * read during render is an unstable value baked into static output - Next.js Cache Components
   * fails the build on exactly this. The untouched initial state therefore carries sentinels, and
   * the real timestamp and origin are produced on the first state anyone actually sets.
   */
  const realRandomUUID = globalThis.crypto.randomUUID
  const realGetRandomValues = globalThis.crypto.getRandomValues
  let randomReads = 0
  let clockReads = 0

  // Annotated rather than asserted, so the parameter and return types are inferred from the real
  // signatures instead of being forced onto them.
  const countingRandomUUID: Crypto['randomUUID'] = () => {
    randomReads += 1
    return realRandomUUID.call(globalThis.crypto)
  }
  const countingGetRandomValues: Crypto['getRandomValues'] = (array) => {
    randomReads += 1
    // Fills in place and returns the same reference; returning `array` keeps the caller's type.
    realGetRandomValues.call(globalThis.crypto, array)
    return array
  }

  globalThis.crypto.randomUUID = countingRandomUUID
  globalThis.crypto.getRandomValues = countingGetRandomValues

  try {
    const engine = createEnergyEngine({
      initialLevel: 100,
      clock: () => {
        clockReads += 1
        return 1000
      },
    })

    assert.equal(randomReads, 0, 'construction must not generate an origin')
    assert.equal(clockReads, 0, 'construction must not read the clock')
    assert.equal(engine.getState().timestamp, UNPRODUCED_TIMESTAMP)
    assert.equal(engine.getState().origin, UNPRODUCED_ORIGIN)
    assert.ok(isUnproducedState(engine.getState()))

    // Reading state is still free; only producing one costs an identity and a timestamp.
    engine.getState()
    assert.equal(randomReads, 0)
    assert.equal(clockReads, 0)

    engine.setLevel(75)
    assert.equal(randomReads, 1, 'the first produced state gets a real origin')
    assert.equal(clockReads, 1, 'the first produced state gets a real timestamp')
    assert.equal(engine.getState().timestamp, 1000)
    assert.notEqual(engine.getState().origin, UNPRODUCED_ORIGIN)
    assert.ok(!isUnproducedState(engine.getState()))

    // The identity is stable across subsequent writes rather than regenerated.
    const { origin } = engine.getState()
    engine.setLevel(50)
    assert.equal(randomReads, 1)
    assert.equal(engine.getState().origin, origin)
  } finally {
    globalThis.crypto.randomUUID = realRandomUUID
    globalThis.crypto.getRandomValues = realGetRandomValues
  }
})

void test('an unproduced state reports no age, and a produced one reports its real age', () => {
  const engine = createEnergyEngine({ initialLevel: 100, clock: () => 60_000 })

  // Subtracting from the sentinel would report an age measured from the epoch.
  assert.equal(getEnergyMetrics(engine.getState(), 60_000).stateAgeMs, 0)

  engine.setLevel(75)
  assert.equal(getEnergyMetrics(engine.getState(), 90_000).stateAgeMs, 30_000)
})

void test('a persisted state always outranks the untouched default', async () => {
  const stored = createEnergyState(25, 'manual', 5000, 0, 'previous-session')
  const engine = createEnergyEngine({
    initialLevel: 100,
    clock: () => 10_000,
    persistence: {
      async load() {
        return stored
      },
      async save() {},
    },
  })

  await engine.hydrate()
  assert.equal(engine.getState().level, 25)
  assert.equal(engine.getState().origin, 'previous-session')
})

void test('state-changing operations after dispose are inert', () => {
  let clockCalls = 0
  const changes: Array<[number, number]> = []
  const engine = createEnergyEngine({
    initialLevel: 100,
    clock: () => {
      clockCalls += 1
      return clockCalls
    },
    onChange: (state, prev) => {
      changes.push([prev.level, state.level])
    },
  })

  engine.setLevel(75)
  engine.dispose()
  assert.doesNotThrow(() => {
    engine.setLevel(33 as never)
  })
  engine.cycleLevel()

  assert.equal(engine.getState().level, 75)
  assert.deepEqual(changes, [[100, 75]])
  // One call, from `setLevel`. Construction deliberately reads no clock - see
  // 'engine construction reads neither the clock nor the random source' below.
  assert.equal(clockCalls, 1)
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

/*
 * The runtime and spec/energy-state.schema.json are one contract, not two that
 * happen to agree. Anything the schema rejects must be rejected here too:
 * a state this implementation accepts but cannot legally publish is a
 * divergence that only shows up once two implementations exchange it.
 */
void test('a state the published schema rejects is rejected at runtime too', () => {
  // integer, per the schema's "type": "integer" on timestamp
  assert.throws(() => createEnergyState(25, 'manual', 1.5), /Invalid energy timestamp/)
  assert.throws(
    () => createEnergyState(25, 'manual', Number.MAX_SAFE_INTEGER + 2),
    /Invalid energy timestamp/,
  )
  assert.throws(() => createEnergyState(25, 'manual', -1), /Invalid energy timestamp/)
  assert.throws(() => createEnergyState(25, 'manual', 1, 1.5), /Invalid energy revision/)
})

void test('persisted state is held to the exact key set the schema permits', async () => {
  const valid = {
    level: 75,
    timestamp: 1_786_060_800_000,
    source: 'manual',
    revision: 3,
    origin: 'producer-a',
  }

  const cases: ReadonlyArray<{ label: string; stored: unknown }> = [
    { label: 'extra property', stored: { ...valid, extra: true } },
    { label: 'missing origin', stored: { ...valid, origin: undefined } },
    { label: 'fractional timestamp', stored: { ...valid, timestamp: 1.5 } },
    { label: 'negative timestamp', stored: { ...valid, timestamp: -1 } },
    { label: 'unsafe revision', stored: { ...valid, revision: Number.MAX_SAFE_INTEGER + 2 } },
    { label: 'blank origin', stored: { ...valid, origin: '   ' } },
    { label: 'wrong-typed level', stored: { ...valid, level: '75' } },
    { label: 'array', stored: [valid] },
    { label: 'null', stored: null },
  ]

  const store = new Map<string, string>()
  const original = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => {
        store.clear()
      },
      key: () => null,
      length: 0,
    },
  })

  const errors: string[] = []
  const consoleError = console.error
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '))

  try {
    const persistence = localStoragePersistence('schema-test')

    for (const { label, stored } of cases) {
      store.set('schema-test', JSON.stringify(stored))
      assert.equal(await persistence.load(), null, label)
    }

    store.set('schema-test', JSON.stringify(valid))
    assert.deepEqual(await persistence.load(), valid, 'a conforming state must still load')
  } finally {
    console.error = consoleError
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage')
    } else {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original })
    }
  }

  assert.equal(errors.length, cases.length, 'every rejection must be reported, not silent')
})

void test('an observed state carrying unknown properties is not silently trimmed', () => {
  let emit: ((state: EnergyState) => void) | undefined
  const engine = createEnergyEngine({
    initialLevel: 100,
    clock: () => 10_000,
    persistence: {
      async load() {
        return null
      },
      async save() {},
      observe(onState) {
        emit = onState
        return () => {}
      },
    },
  })

  const consoleError = console.error
  const errors: string[] = []
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '))

  try {
    emit?.({
      level: 25,
      timestamp: 9000,
      source: 'manual',
      revision: 1,
      origin: 'other-tab',
      extra: 'from a newer producer',
    } as unknown as EnergyState)
  } finally {
    console.error = consoleError
  }

  assert.equal(engine.getState().level, 100, 'a non-conforming observation must not win')
  assert.match(errors.join(' '), /unknown properties: extra/)
  engine.dispose()
})

void test('a configured originId does not masquerade as a produced state', () => {
  const engine = createEnergyEngine({
    initialLevel: 75,
    originId: 'device-a',
    clock: () => 60_000,
  })

  // SPEC.md §3.2: the untouched default MUST stay distinguishable from a real
  // state. Stamping a real producer identity on it makes metrics read the
  // sentinel timestamp as a level chosen at the epoch.
  const initial = engine.getState()
  assert.equal(initial.origin, '0-initial')
  assert.equal(initial.timestamp, 0)
  assert.equal(isUnproducedState(initial), true)
  assert.equal(getEnergyMetrics(initial, 60_000).stateAgeMs, 0)

  // The configured identity still owns everything this engine actually produces.
  engine.setLevel(50)
  assert.equal(engine.getState().origin, 'device-a')
  assert.equal(isUnproducedState(engine.getState()), false)
  engine.dispose()
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
  /*
   * Revisions are 0 and 1 for the two writes. The untouched initial state no longer carries the
   * wall clock, so under this frozen clock the first real write is genuinely the first state at
   * t=100 rather than colliding with the default and starting at 1. What this test exists to prove
   * is unchanged and asserted above: the later 'inferred' write wins over the earlier 'manual' one
   * because revision is compared before source priority.
   */
  assert.equal(observer.getState().revision, 1)
})

void test('local writes remain possible when an accepted logical revision is exhausted', () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined
  const engine = createEnergyEngine({
    initialLevel: 100,
    originId: 'revision-rollover-local',
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

  observeState?.(
    createEnergyState(25, 'manual', 10, Number.MAX_SAFE_INTEGER, 'revision-rollover-remote'),
  )
  engine.setLevel(50)

  assert.equal(engine.getState().level, 50)
  assert.equal(engine.getState().timestamp, 11)
  assert.equal(engine.getState().revision, 0)
  engine.dispose()
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

void test('flush durably stores an unchanged initial state after hydration completes', async () => {
  const persistence = memoryPersistence()
  const engine = createEnergyEngine({
    initialLevel: 75,
    persistence,
    originId: 'initial-flush-test',
    clock: () => 10,
  })

  await engine.flush()

  assert.deepEqual(await persistence.load(), engine.getState())
  engine.dispose()
})

void test('initial flush waits for hydration instead of overwriting unread persisted state', async () => {
  let releaseLoad: (() => void) | undefined
  const stored = createEnergyState(25, 'manual', 10, 1, 'stored')
  const saves: Array<ReturnType<typeof createEnergyState>> = []
  const engine = createEnergyEngine({
    initialLevel: 100,
    originId: 'initial-flush-hydration-test',
    clock: () => 10,
    persistence: {
      async load() {
        await new Promise<void>((resolve) => {
          releaseLoad = resolve
        })
        return stored
      },
      async save(state) {
        saves.push(state)
      },
    },
  })

  let flushed = false
  const flush = engine.flush().then(() => {
    flushed = true
  })
  await sleep(0)

  assert.equal(flushed, false)
  assert.equal(saves.length, 0)

  releaseLoad?.()
  await flush

  assert.equal(engine.getState().level, 25)
  assert.deepEqual(saves.at(-1), engine.getState())
  engine.dispose()
})

void test('initial flush rejects instead of overwriting storage after a hydration read failure', async () => {
  let saveAttempts = 0
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const engine = createEnergyEngine({
      initialLevel: 100,
      persistence: {
        async load() {
          throw new Error('read unavailable')
        },
        async save() {
          saveAttempts += 1
        },
      },
    })

    await assert.rejects(
      engine.flush(),
      /Cannot flush the initial energy state because persistence hydration did not complete/,
    )
    assert.equal(saveAttempts, 0)
    engine.dispose()
  } finally {
    console.error = originalConsoleError
  }
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

void test('rest level suggests no breaks anywhere: the user is already resting', () => {
  const config = taskComplexityStrategy.resolve(0)
  assert.equal(config.suggestBreaks, false)
  assert.equal(config.breakIntervalMinutes, 0)
  assert.equal(
    getEnergyMetrics(createEnergyState(0, 'manual', 10), 10).suggestedBreakIntervalMinutes,
    0,
  )
  assert.doesNotMatch(taskComplexityStrategy.describe(0), /breaks every/)
})

void test('observed state beyond the future skew budget is rejected, within it is applied', () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const engine = createEnergyEngine({
      initialLevel: 100,
      originId: 'skew-test',
      clock: () => 1000,
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

    // Default budget is 5 minutes: 1000 + 300_000 ms.
    observeState?.(createEnergyState(25, 'manual', 1000 + 300_001, 1, 'remote'))
    assert.equal(engine.getState().level, 100)

    observeState?.(createEnergyState(25, 'manual', 1000 + 299_000, 1, 'remote'))
    assert.equal(engine.getState().level, 25)
  } finally {
    console.error = originalConsoleError
  }
})

void test('hydrate rejects persisted state beyond the future skew budget', async () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const engine = createEnergyEngine({
      initialLevel: 100,
      originId: 'skew-hydrate-test',
      clock: () => 1000,
      maxFutureSkewMs: 60_000,
      persistence: {
        async load() {
          return createEnergyState(25, 'manual', 1000 + 60_001, 1, 'remote')
        },
        async save() {},
      },
    })

    await engine.hydrate()
    assert.equal(engine.getState().level, 100)
  } finally {
    console.error = originalConsoleError
  }
})

void test('maxFutureSkewMs is configurable, allows opting out, and rejects invalid values', () => {
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

  const unbounded = createEnergyEngine({
    initialLevel: 100,
    originId: 'skew-config-test',
    clock: () => 1000,
    maxFutureSkewMs: Number.POSITIVE_INFINITY,
    persistence,
  })
  observeState?.(createEnergyState(25, 'manual', Number.MAX_SAFE_INTEGER, 1, 'remote'))
  assert.equal(unbounded.getState().level, 25)

  assert.throws(() => createEnergyEngine({ maxFutureSkewMs: -1 }), /Invalid maxFutureSkewMs/)
  assert.throws(
    () => createEnergyEngine({ maxFutureSkewMs: Number.NaN }),
    /Invalid maxFutureSkewMs/,
  )
  assert.throws(
    () => createEnergyEngine({ maxFutureSkewMs: 'unbounded' as never }),
    /Invalid maxFutureSkewMs/,
  )
  assert.throws(
    () => createEnergyEngine({ maxFutureSkewMs: null as never }),
    /Invalid maxFutureSkewMs/,
  )
})

void test('dispose contains persistence observer cleanup failures', () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const engine = createEnergyEngine({
      persistence: {
        async load() {
          return null
        },
        async save() {},
        observe() {
          return () => {
            throw new Error('cleanup failed')
          }
        },
      },
    })

    assert.doesNotThrow(() => {
      engine.dispose()
    })
  } finally {
    console.error = originalConsoleError
  }
})

void test('a synchronously throwing save does not permanently wedge the persist queue', async () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const saved: number[] = []
    let failNext = true
    // Deliberately NOT declared `async`: an adapter built directly on
    // localStorage.setItem throws its quota error synchronously, before the
    // engine's persist loop ever reaches an await.
    const persistence = {
      load(): Promise<null> {
        return Promise.resolve(null)
      },
      save(state: EnergyState): Promise<void> {
        if (failNext) throw new Error('QuotaExceededError')
        saved.push(state.level)
        return Promise.resolve()
      },
    }

    const engine = createEnergyEngine({ initialLevel: 100, persistence })
    engine.setLevel(75)
    await sleep(20)
    assert.deepEqual(saved, [], 'the failing write must not be recorded')

    // Storage recovers. Every later write has to reach it, and flush() has to
    // settle rather than hang on a queue that already gave up.
    failNext = false
    engine.setLevel(50)
    engine.setLevel(25)
    await engine.flush()

    // `slice(-1)` rather than `at(-1)`: oxlint 1.76.0's type-aware
    // no-confusing-void-expression false-positives on Array.prototype.at here
    // (tsc types it `number | undefined`).
    assert.deepEqual(saved.slice(-1), [25], 'writes after recovery must reach storage')
    assert.equal(engine.getState().level, 25)
    engine.dispose()
  } finally {
    console.error = originalConsoleError
  }
})

void test('corrupt persisted state is reported, not silently treated as a fresh install', async () => {
  const messages: string[] = []
  const originalConsoleError = console.error
  console.error = (message: unknown) => {
    messages.push(String(message))
  }

  try {
    const store = new Map<string, string>()
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
      key: () => null,
      length: 0,
    }

    const persistence = localStoragePersistence('corrupt-test')

    store.set('corrupt-test', '{not json')
    assert.equal(await persistence.load(), null)
    assert.match(messages.at(-1) ?? '', /unparseable persisted energy state/)

    store.set('corrupt-test', JSON.stringify({ level: 33, source: 'manual' }))
    assert.equal(await persistence.load(), null)
    assert.match(messages.at(-1) ?? '', /malformed persisted energy state/)

    // An absent key is a genuine fresh install and must stay quiet.
    const quietFrom = messages.length
    store.delete('corrupt-test')
    assert.equal(await persistence.load(), null)
    assert.equal(messages.length, quietFrom)
  } finally {
    console.error = originalConsoleError
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

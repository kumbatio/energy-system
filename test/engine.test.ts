import assert from 'node:assert/strict'
import test from 'node:test'

import { applyEnergyLevel } from '../src/dom.ts'
import {
  createEnergyEngine,
  createEnergyState,
  getEnergyLevel,
  getEnergyMetrics,
  taskComplexityStrategy,
  uiVisibilityStrategy,
} from '../src/index.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('engine rejects invalid runtime levels', () => {
  assert.throws(() => createEnergyEngine({ initialLevel: 33 as never }), /Invalid energy level/)

  const engine = createEnergyEngine({ initialLevel: 100 })
  assert.throws(() => engine.setLevel(33 as never), /Invalid energy level/)
  assert.throws(() => createEnergyState(33 as never), /Invalid energy level/)
})

test('core snapshots and configs are frozen', () => {
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

test('hydrate does not override a newer local change', async () => {
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

  assert.deepEqual(engine.getState(), createEnergyState(75, 'manual', engine.getState().timestamp))
  assert.equal(engine.getState().level, 75)
})

test('newer observed external state is applied even while a save is in flight', async () => {
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

test('newer observed external state eventually becomes the durable persisted state', async () => {
  let observeState: ((state: ReturnType<typeof createEnergyState>) => void) | undefined
  let persisted: ReturnType<typeof createEnergyState> | null = null

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
  assert.equal(persisted?.level, 25)
  assert.equal(persisted?.timestamp, 999)
})

test('hydrate load failures are contained without unhandled rejections', async () => {
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

test('invalid observed external state is ignored instead of throwing', () => {
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

test('dispose releases persistence observation and blocks later external updates', () => {
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

test('task complexity guidance stays aligned across levels, metrics, and level definitions', () => {
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

test('dom adapter rejects invalid runtime levels with a domain error', () => {
  const root = {
    dataset: {} as DOMStringMap,
    style: {
      setProperty() {},
    },
  } as unknown as HTMLElement

  assert.throws(() => applyEnergyLevel(33 as never, root), /Invalid energy level/)
})

import assert from 'node:assert/strict'
import test from 'node:test'

void test('built dist root entry is importable in plain Node ESM', async () => {
  const dist = await import(new URL('../dist/index.js', import.meta.url).href)

  assert.equal(typeof dist.createEnergyEngine, 'function')
  assert.equal(typeof dist.taskComplexityStrategy.resolve, 'function')

  const engine = dist.createEnergyEngine({ initialLevel: 100 })
  assert.equal(engine.getState().level, 100)
})

void test('all published JavaScript subpath entries are importable', async () => {
  const [dom, persistence, react] = await Promise.all([
    import(new URL('../dist/dom.js', import.meta.url).href),
    import(new URL('../dist/persistence.js', import.meta.url).href),
    import(new URL('../dist/react.js', import.meta.url).href),
  ])

  assert.equal(typeof dom.applyEnergyLevel, 'function')
  assert.equal(typeof persistence.localStoragePersistence, 'function')
  assert.equal(typeof react.EnergyProvider, 'function')
})

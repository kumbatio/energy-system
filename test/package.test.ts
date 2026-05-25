import assert from 'node:assert/strict'
import test from 'node:test'

test('built dist root entry is importable in plain Node ESM', async () => {
  const dist = await import(new URL('../dist/index.js', import.meta.url).href)

  assert.equal(typeof dist.createEnergyEngine, 'function')
  assert.equal(typeof dist.taskComplexityStrategy.resolve, 'function')

  const engine = dist.createEnergyEngine({ initialLevel: 100 })
  assert.equal(engine.getState().level, 100)
})

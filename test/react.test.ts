import assert from 'node:assert/strict'
import test from 'node:test'

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { EnergyLevel } from '../src/index.ts'
import { createEnergyEngine } from '../src/index.ts'
import { EnergyProvider, useEnergyLevel } from '../src/react.ts'

GlobalRegistrator.register()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let latestSetLevel: ((level: EnergyLevel) => void) | undefined

function LevelProbe() {
  const [level, setLevel] = useEnergyLevel()
  latestSetLevel = setLevel
  return createElement('span', null, String(level))
}

test('provider-owned engine survives StrictMode remounting: changes reach hooks and the DOM', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    // StrictMode runs effect setup -> cleanup -> setup without re-rendering,
    // which disposes the provider's internal engine; the provider must
    // recreate it or every later state change is silently dropped.
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(EnergyProvider, { defaultLevel: 100 }, createElement(LevelProbe)),
        ),
      )
    })

    assert.equal(container.querySelector('span')?.textContent, '100')

    await act(async () => {
      latestSetLevel?.(50)
    })

    assert.equal(container.querySelector('span')?.textContent, '50')
    // applyToDOM defaults to true: the provider mirrors the level to <body>.
    assert.equal(document.body.dataset['energyLevel'], '50')
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})

test('provider never disposes an externally supplied engine', async () => {
  const engine = createEnergyEngine({ initialLevel: 75 })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(EnergyProvider, { engine, applyToDOM: false }, createElement(LevelProbe)),
        ),
      )
    })

    assert.equal(container.querySelector('span')?.textContent, '75')
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }

  // Ownership boundary: the external engine must remain fully functional
  // (state changes and subscriptions) after the provider unmounts.
  const seen: number[] = []
  const unsubscribe = engine.subscribe((state) => {
    seen.push(state.level)
  })
  engine.setLevel(25)
  unsubscribe()

  assert.equal(engine.getState().level, 25)
  assert.deepEqual(seen, [25])
})

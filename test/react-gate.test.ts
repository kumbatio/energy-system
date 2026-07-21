import assert from 'node:assert/strict'
import test from 'node:test'

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { EnergyPresence } from '../src/index.ts'
import { createEnergyEngine, defineEnergyPresence } from '../src/index.ts'
import { EnergyGate, EnergyProvider, useEnergyPresence } from '../src/react.ts'

GlobalRegistrator.register()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

void test('EnergyGate min shorthand hides its subtree below the threshold', async () => {
  const engine = createEnergyEngine({ initialLevel: 100 })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        createElement(EnergyProvider, {
          engine,
          applyToDOM: false,
          children: createElement(EnergyGate, {
            min: 75,
            fallback: createElement('span', null, 'resting'),
            children: createElement('span', null, 'ai-chat'),
          }),
        }),
      )
    })
    assert.equal(container.textContent, 'ai-chat')

    await act(async () => {
      engine.setLevel(50)
    })
    assert.equal(container.textContent, 'resting')

    await act(async () => {
      engine.setLevel(75)
    })
    assert.equal(container.textContent, 'ai-chat')
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    engine.dispose()
  }
})

void test('EnergyGate presence map passes the resolved presence to function children', async () => {
  const engine = createEnergyEngine({ initialLevel: 100 })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const presence = defineEnergyPresence({
    default: 'visible',
    75: 'muted',
    50: 'hidden',
    25: 'hidden',
    0: 'hidden',
  })

  try {
    await act(async () => {
      root.render(
        createElement(EnergyProvider, {
          engine,
          applyToDOM: false,
          children: createElement(EnergyGate, {
            presence,
            children: (resolved: EnergyPresence) =>
              createElement('span', { 'data-energy-presence': resolved }, 'panel'),
          }),
        }),
      )
    })
    assert.equal(container.querySelector('span')?.dataset['energyPresence'], 'visible')

    await act(async () => {
      engine.setLevel(75)
    })
    assert.equal(container.querySelector('span')?.dataset['energyPresence'], 'muted')

    await act(async () => {
      engine.setLevel(50)
    })
    assert.equal(container.querySelector('span'), null)
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    engine.dispose()
  }
})

void test('useEnergyPresence tracks level changes', async () => {
  const engine = createEnergyEngine({ initialLevel: 100 })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const presence = defineEnergyPresence({ default: 'visible', 0: 'hidden' })

  function Probe() {
    const resolved = useEnergyPresence(presence)
    return createElement('span', null, resolved)
  }

  try {
    await act(async () => {
      root.render(
        createElement(EnergyProvider, {
          engine,
          applyToDOM: false,
          children: createElement(Probe),
        }),
      )
    })
    assert.equal(container.textContent, 'visible')

    await act(async () => {
      engine.setLevel(0)
    })
    assert.equal(container.textContent, 'hidden')
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    engine.dispose()
  }
})

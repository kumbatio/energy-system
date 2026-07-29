import assert from 'node:assert/strict'
import test from 'node:test'

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { EnergyPresence } from '../src/index.ts'
import { createEnergyEngine, defineEnergyPresence } from '../src/index.ts'
import { EnergyGate, EnergyProvider, useEnergyPresence } from '../src/react.ts'

GlobalRegistrator.register()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Visible to the user: present in the DOM and not display:none'd by Activity. */
function visibleText(container: HTMLElement): string {
  return [...container.querySelectorAll('span')]
    .filter((element) => element.style.display !== 'none')
    .map((element) => element.textContent)
    .join('')
}

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
    assert.equal(visibleText(container), 'ai-chat')

    await act(async () => {
      engine.setLevel(50)
    })
    // Default 'preserve': the fallback takes over visually, but the gated
    // subtree stays mounted behind display:none rather than being destroyed.
    assert.equal(visibleText(container), 'resting')
    assert.equal(container.textContent, 'restingai-chat')

    await act(async () => {
      engine.setLevel(75)
    })
    assert.equal(visibleText(container), 'ai-chat')
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    engine.dispose()
  }
})

void test('EnergyGate whenHidden="unmount" removes the subtree from the tree', async () => {
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
            whenHidden: 'unmount',
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
    assert.equal(container.querySelectorAll('span').length, 1)

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

void test('a gated subtree keeps its state across a hide/reveal cycle', async () => {
  const engine = createEnergyEngine({ initialLevel: 100 })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let mounts = 0

  function Draft() {
    const [text, setText] = useState('')
    useEffect(() => {
      mounts += 1
    }, [])
    return createElement(
      'span',
      {
        onClick: () => {
          setText((previous) => `${previous}.`)
        },
      },
      `draft:${text}`,
    )
  }

  try {
    await act(async () => {
      root.render(
        createElement(EnergyProvider, {
          engine,
          applyToDOM: false,
          children: createElement(EnergyGate, {
            min: 75,
            whenHidden: 'preserve',
            children: createElement(Draft),
          }),
        }),
      )
    })

    // Type into the draft, drop below the gate, then come back up.
    const draft = container.querySelector('span')
    assert.ok(draft)
    await act(async () => {
      draft.click()
      draft.click()
    })
    assert.equal(visibleText(container), 'draft:..')

    await act(async () => {
      engine.setLevel(50)
    })
    assert.equal(visibleText(container), '')

    await act(async () => {
      engine.setLevel(100)
    })
    // The half-written draft survived: this is the whole point of 'preserve'.
    assert.equal(visibleText(container), 'draft:..')
    // Effects are torn down while hidden and re-run on reveal.
    assert.equal(mounts, 2)
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
    // Under 'preserve' the function child is also called with 'hidden', and the
    // element it returns stays mounted behind display:none.
    const hidden = container.querySelector('span')
    assert.equal(hidden?.dataset['energyPresence'], 'hidden')
    assert.equal(hidden?.style.display, 'none')
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

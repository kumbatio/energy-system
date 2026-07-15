import assert from 'node:assert/strict'
import test from 'node:test'

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { EnergyLevel, EnergySource } from '../src/index.ts'
import { createEnergyEngine } from '../src/index.ts'
import { EnergyProvider, useEnergyLevel, useEnergyState } from '../src/react.ts'

GlobalRegistrator.register()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let latestSetLevel: ((level: EnergyLevel, source?: EnergySource) => void) | undefined

function LevelProbe() {
  const [level, setLevel] = useEnergyLevel()
  const state = useEnergyState()
  latestSetLevel = setLevel
  return createElement('span', { 'data-source': state.source }, String(level))
}

void test('provider-owned engine survives StrictMode remounting: changes reach hooks and the DOM', async () => {
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
          createElement(EnergyProvider, {
            defaultLevel: 100,
            children: createElement(LevelProbe),
          }),
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

void test('provider never disposes an externally supplied engine', async () => {
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
          createElement(EnergyProvider, {
            engine,
            applyToDOM: false,
            children: createElement(LevelProbe),
          }),
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

void test('React setter preserves non-manual state provenance', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        createElement(EnergyProvider, {
          defaultLevel: 100,
          applyToDOM: false,
          children: createElement(LevelProbe),
        }),
      )
    })

    await act(async () => {
      latestSetLevel?.(25, 'inferred')
    })

    const probe = container.querySelector('span')
    assert.equal(probe?.textContent, '25')
    assert.equal(probe?.dataset['source'], 'inferred')
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})

void test('provider restores the DOM state it replaced when it unmounts', async () => {
  const originalAttribute = document.body.getAttribute('data-energy-level')
  const originalOpacity = document.body.style.getPropertyValue('--energy-chrome-opacity')
  document.body.setAttribute('data-energy-level', '75')
  document.body.style.setProperty('--energy-chrome-opacity', '0.37')

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        createElement(EnergyProvider, {
          defaultLevel: 25,
          children: createElement(LevelProbe),
        }),
      )
    })
    assert.equal(document.body.dataset['energyLevel'], '25')
    assert.equal(document.body.style.getPropertyValue('--energy-chrome-opacity'), '0.1')

    await act(async () => {
      root.unmount()
    })

    assert.equal(document.body.dataset['energyLevel'], '75')
    assert.equal(document.body.style.getPropertyValue('--energy-chrome-opacity'), '0.37')
  } finally {
    if (originalAttribute === null) {
      document.body.removeAttribute('data-energy-level')
    } else {
      document.body.setAttribute('data-energy-level', originalAttribute)
    }

    if (originalOpacity === '') {
      document.body.style.removeProperty('--energy-chrome-opacity')
    } else {
      document.body.style.setProperty('--energy-chrome-opacity', originalOpacity)
    }
    container.remove()
  }
})

void test('overlapping providers restore the baseline after out-of-order unmounts', async () => {
  const originalAttribute = document.body.getAttribute('data-energy-level')
  const originalOpacity = document.body.style.getPropertyValue('--energy-chrome-opacity')
  document.body.setAttribute('data-energy-level', '75')
  document.body.style.setProperty('--energy-chrome-opacity', '0.37')

  const firstContainer = document.createElement('div')
  const secondContainer = document.createElement('div')
  document.body.append(firstContainer, secondContainer)
  const firstRoot = createRoot(firstContainer)
  const secondRoot = createRoot(secondContainer)
  const firstEngine = createEnergyEngine({ initialLevel: 25 })
  const secondEngine = createEnergyEngine({ initialLevel: 0 })
  let firstMounted = true
  let secondMounted = true

  try {
    await act(async () => {
      firstRoot.render(
        createElement(EnergyProvider, {
          engine: firstEngine,
          children: createElement('span'),
        }),
      )
    })
    await act(async () => {
      secondRoot.render(
        createElement(EnergyProvider, {
          engine: secondEngine,
          children: createElement('span'),
        }),
      )
    })
    assert.equal(document.body.dataset['energyLevel'], '0')

    await act(async () => {
      firstEngine.setLevel(50)
    })
    assert.equal(document.body.dataset['energyLevel'], '0')

    await act(async () => {
      firstRoot.unmount()
      firstMounted = false
    })
    assert.equal(document.body.dataset['energyLevel'], '0')

    await act(async () => {
      secondRoot.unmount()
      secondMounted = false
    })
    assert.equal(document.body.dataset['energyLevel'], '75')
    assert.equal(document.body.style.getPropertyValue('--energy-chrome-opacity'), '0.37')
  } finally {
    if (firstMounted) {
      await act(async () => {
        firstRoot.unmount()
      })
    }
    if (secondMounted) {
      await act(async () => {
        secondRoot.unmount()
      })
    }
    firstEngine.dispose()
    secondEngine.dispose()

    if (originalAttribute === null) {
      document.body.removeAttribute('data-energy-level')
    } else {
      document.body.setAttribute('data-energy-level', originalAttribute)
    }

    if (originalOpacity === '') {
      document.body.style.removeProperty('--energy-chrome-opacity')
    } else {
      document.body.style.setProperty('--energy-chrome-opacity', originalOpacity)
    }
    firstContainer.remove()
    secondContainer.remove()
  }
})

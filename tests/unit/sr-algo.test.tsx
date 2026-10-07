import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AlgoJson } from '../../src/rules/algoJson'
import { SrAlgo, type AlgoElement } from '../../src/ui/engines/SrAlgo'
import { installAlgoEngines } from '../helpers/engines'

type FullAlgoElement = AlgoElement & { k: number; playing?: boolean; go(k: number): void; play(): void; pause(): void }

const arr: AlgoJson = {
  title: 'demo', structures: { a: { type: 'array', values: [3, 1, 2] } },
  steps: [{ op: 'compare', s: 'a', i: 0, j: 1, say: 'look' }, { op: 'swap', s: 'a', i: 0, j: 1 }],
}
const forest: AlgoJson = { title: 'dsu', structures: { f: { type: 'forest', parent: [0, 0, 1] } }, steps: [{ op: 'mark', s: 'f', i: 2, state: 'done' }] }

describe('SrAlgo', () => {
  beforeAll(installAlgoEngines)

  it('mounts <sr-algo> with the JSON as its data attribute, themed, labelled', () => {
    const { container } = render(<SrAlgo engine="algo" json={arr} label="Demo" testId="p" />)
    const el = container.querySelector('sr-algo') as FullAlgoElement
    expect(JSON.parse(el.getAttribute('data')!)).toEqual(arr)
    expect(el.getAttribute('theme')).toBe('dark')
    expect(el.getAttribute('aria-label')).toBe('Demo')
    expect(el.shadowRoot!.querySelector('.title')!.textContent).toBe('DEMO')
    el.go(2)
    expect(el.k).toBe(2)
    expect(el.shadowRoot!.querySelector('.count')!.textContent).toBe('STEP 2 / 2')
  })

  it('mounts <sr-algo2> for the algo2-only types', () => {
    const { container } = render(<SrAlgo engine="algo2" json={forest} label="DSU" />)
    const el = container.querySelector('sr-algo2') as FullAlgoElement
    expect(el).not.toBeNull()
    expect(el.shadowRoot!.querySelector('.count')!.textContent).toBe('0 / 1')
  })
})

import { describe, expect, it } from 'vitest'
import { engineFor, withoutCode, type AlgoJson } from '../../src/rules/algoJson'

const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ op: 'mark', s: 'a', i: i % 3, state: 'done' }))
const ok: AlgoJson = { title: 't', structures: { a: { type: 'array', values: [1, 2, 3] } }, code: ['x'], steps: steps(15) }

describe('algo JSON contract', () => {
  it('routes algo2-only structure types to <sr-algo2>', () => {
    expect(engineFor(ok)).toBe('algo')
    expect(engineFor({ ...ok, structures: { t: { type: 'tape', values: [] } } })).toBe('algo2')
  })

  it('hides the code panel by emptying code', () => {
    expect(withoutCode(ok).code).toEqual([])
    expect(ok.code).toEqual(['x'])
  })
})

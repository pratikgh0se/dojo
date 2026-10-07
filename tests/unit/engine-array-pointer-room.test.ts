// UAT cu-5 P3-11: in the Picture player an array drew 14 px taller the moment its first pointer was set, so the structure under it
// (the DP row) jumped down at that step and back when the pointer went. A structure pointed at anywhere in the walk keeps that
// room from step 0. jsdom runs the vendored engine as the browser does (tests/helpers/engines).
import { beforeAll, describe, expect, it } from 'vitest'
import { installAlgoEngines } from '../helpers/engines'

type SrAlgo = HTMLElement & { json: unknown; go(k: number): void; shadowRoot: ShadowRoot }

const WALK = {
  title: 'House robber', complexity: 'O(n)',
  structures: { nums: { type: 'array', values: [2, 7, 9, 3, 1] }, dp: { type: 'array', values: [2, 7, 0, 0, 0] }, other: { type: 'array', values: [1, 2] } },
  code: ['dp[0] = nums[0]', 'for i in 2..n-1'],
  steps: [
    { op: 'mark', s: 'nums', i: 0, state: 'done', line: 0, say: 'start' },
    { op: 'pointer', name: 'i', s: 'nums', i: 2, line: 1, say: 'the pointer appears' },
    { op: 'set', s: 'dp', i: 2, v: 11, line: 1 },
    { op: 'pointer', name: 'i', s: 'nums', i: null, line: 1, say: 'and goes' },
  ],
}

/** The svg's drawn height and the y of each structure's caption (NUMS, DP, OTHER), at step k. */
function drawn(el: SrAlgo, k: number) {
  el.go(k)
  const svg = el.shadowRoot.querySelector('svg')!
  const captions = ['NUMS', 'DP', 'OTHER'].map(n => [...svg.querySelectorAll('text')].find(t => t.textContent === n)?.getAttribute('y'))
  return { height: svg.getAttribute('viewBox')!.split(' ')[3], captionYs: captions.join(',') }
}

describe('engine array pointer room', () => {
  beforeAll(installAlgoEngines)

  it('the drawing keeps one height, and the arrays under a pointed-at one keep their places, while a pointer comes and goes', () => {
    const el = document.createElement('sr-algo') as SrAlgo
    document.body.appendChild(el)
    el.json = WALK
    const at = [0, 1, 2, 3, 4].map(k => drawn(el, k))
    expect(new Set(at.map(a => a.height)).size).toBe(1)
    expect(new Set(at.map(a => a.captionYs)).size).toBe(1)
    expect(at[0].captionYs).not.toContain('undefined')
    el.remove()
  })

  it('a structure no step points at keeps its own height (nothing is reserved for it)', () => {
    const el = document.createElement('sr-algo') as SrAlgo
    document.body.appendChild(el)
    const withPtr = { ...WALK }
    const without = { ...WALK, steps: WALK.steps.filter(s => s.op !== 'pointer') }
    el.json = without
    const h0 = Number(drawn(el, 0).height)
    el.json = withPtr
    const h1 = Number(drawn(el, 0).height)
    expect(h1 - h0).toBe(14) // only the pointed-at array (nums) reserves its pointer row
    el.remove()
  })
})

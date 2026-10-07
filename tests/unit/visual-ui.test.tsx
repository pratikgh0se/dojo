// C-VISUAL §3–§4: the panels as the page draws them: order, boxes, captions, testids, data-* states and text
// formats; the scrubber's Home/End (Addendum 1 Q4); a DP-only run shows no family panel.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCode } from '../../src/runner/client'
import DpView from '../../src/runner/DpView'
import { StepsBoundary } from '../../src/runner/StepsBoundary'
import type { Step } from '../../src/runner/types'

const GRAPH: Step[] = [
  { op: 'graph', sid: 0, act: 'new', name: 'g', directed: true, case: 1 },
  { op: 'graph', sid: 0, act: 'edge', u: 1, v: 2, w: 4 },
  { op: 'graph', sid: 0, act: 'edge', u: 1, v: 3, w: 1 },
  { op: 'graph', sid: 0, act: 'edge', u: 3, v: 2, w: 2 },
  { op: 'heap', sid: 1, act: 'new', name: 'pq' },
  { op: 'graph', sid: 0, act: 'dist', u: 1, d: 0 },
  { op: 'heap', sid: 1, act: 'push', key: 1, prio: 0 },
  { op: 'heap', sid: 1, act: 'pop', key: 1, prio: 0 },
  { op: 'graph', sid: 0, act: 'visit', u: 1 },
  { op: 'graph', sid: 0, act: 'relax', u: 1, v: 2, d: 4 },
  { op: 'heap', sid: 1, act: 'push', key: 2, prio: 4 },
  { op: 'graph', sid: 0, act: 'relax', u: 1, v: 3, d: 1 },
  { op: 'heap', sid: 1, act: 'push', key: 3, prio: 1 },
  { op: 'graph', sid: 0, act: 'mark', u: 3, label: 'near' },
]

const counter = () => screen.getByTestId('dp-step-counter')
const prev = () => fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))

describe('family panels (§3–§4)', () => {
  it('opens on Step N with the family panels in order, each box named, the caption for its own panel only', async () => {
    render(<DpView steps={GRAPH} />)
    expect(counter()).toHaveTextContent('Step 14 / 14')
    const view = await screen.findByTestId('graph-view')
    const panels = within(screen.getByTestId('dp-view')).getAllByTestId(/-view$/).map(e => e.dataset.testid)
    expect(panels).toEqual(['graph-view', 'heap-view'])
    expect(screen.queryByTestId('dp-table')).toBeNull()
    expect(screen.queryByTestId('dp-tree')).toBeNull()
    expect(within(view).getByTestId('graph-box')).toHaveAttribute('data-name', 'g')
    expect(screen.getByTestId('graph-caption')).toHaveTextContent('mark 3: near')
    expect(screen.getByTestId('heap-caption').textContent).toBe('')
    const n3 = screen.getByTestId('graph-node-3')
    expect(n3.textContent).toBe('3 · 1 · near')
    expect(n3).toHaveAttribute('data-state', 'current')
    expect(n3).toHaveAttribute('data-mark', 'near')
    expect(screen.getByTestId('graph-node-1')).toHaveAttribute('data-state', 'visited')
    expect(screen.getByTestId('graph-node-2').textContent).toBe('2 · 4')
    expect(screen.getByTestId('graph-node-2')).toHaveAttribute('data-state', 'seen')
    expect(screen.getByTestId('graph-edge-1-2').textContent).toBe('4')
    expect(screen.getByTestId('graph-edge-1-2')).toHaveAttribute('data-state', 'tree')
    expect(screen.getByTestId('graph-edge-3-2')).toHaveAttribute('data-state', 'idle')
    expect(within(screen.getByTestId('heap-array')).getAllByTestId(/^heap-slot-/).map(e => e.textContent)).toEqual(['3 (1)', '2 (4)'])
    expect(within(screen.getByTestId('heap-tree')).getAllByTestId(/^heap-node-/).map(e => e.textContent)).toEqual(['3 (1)', '2 (4)'])
  })

  it('steps back: captions move between panels and current marks only the touched elements', async () => {
    render(<DpView steps={GRAPH} />)
    await screen.findByTestId('graph-view')
    prev()
    expect(counter()).toHaveTextContent('Step 13 / 14')
    expect(screen.getByTestId('heap-caption')).toHaveTextContent('push 3 (1) → slot 0')
    expect(screen.getByTestId('graph-caption').textContent).toBe('')
    expect(screen.getByTestId('heap-slot-0')).toHaveAttribute('data-state', 'current')
    expect(screen.getByTestId('heap-slot-1')).toHaveAttribute('data-state', 'idle')
    expect(screen.getByTestId('graph-node-3')).toHaveAttribute('data-state', 'seen')
    prev()
    expect(screen.getByTestId('graph-caption')).toHaveTextContent('dist[3] = 1 (via 1)')
    expect(screen.getByTestId('graph-edge-1-3')).toHaveAttribute('data-state', 'current')
    expect(screen.getByTestId('graph-node-3')).toHaveAttribute('data-state', 'current')
  })

  const CASE_STEPS: Step[] = [
    { op: 'graph', sid: 0, act: 'new', name: 'g', directed: true, case: 1 },
    { op: 'heap', sid: 1, act: 'new', name: 'pq' },
    { op: 'graph', sid: 0, act: 'edge', u: 1, v: 2, w: 1 },
    { op: 'heap', sid: 1, act: 'push', key: 1, prio: 0 },
    { op: 'graph', sid: 0, act: 'edge', u: 2, v: 3, w: 1 },
    { op: 'heap', sid: 1, act: 'push', key: 2, prio: 1 },
    { op: 'graph', sid: 0, act: 'edge', u: 3, v: 4, w: 1 },
    { op: 'heap', sid: 1, act: 'push', key: 3, prio: 2 },
    { op: 'heap', sid: 1, act: 'push', key: 4, prio: 3 },
    { op: 'heap', sid: 1, act: 'pop', key: 1, prio: 0 },
    { op: 'heap', sid: 1, act: 'pop', key: 2, prio: 1 },
    { op: 'heap', sid: 1, act: 'pop', key: 3, prio: 2 },
    { op: 'heap', sid: 1, act: 'pop', key: 4, prio: 3 },
  ]

  it('UAT r4 (p743): the graph keeps one size and its nodes keep their places while edges are added', async () => {
    render(<DpView steps={CASE_STEPS} />)
    await screen.findByTestId('graph-view')
    const seen = new Set<string>()
    const place = new Map<string, string>()
    for (let k = CASE_STEPS.length; k >= 3; k--) {
      const svg = screen.getByTestId('graph-view').querySelector('svg.fam-graph')!
      seen.add(`${svg.getAttribute('width')}x${svg.getAttribute('height')}`)
      for (const n of screen.getByTestId('graph-view').querySelectorAll('[data-testid^="graph-node-"]')) {
        const r = n.querySelector('rect')!
        const at = `${Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2},${r.getAttribute('y')}`
        const id = n.getAttribute('data-testid')!
        expect(place.get(id) ?? at, `${id} at step ${k}`).toBe(at)
        place.set(id, at)
      }
      prev()
    }
    expect([...seen]).toHaveLength(1) // one drawing size for the whole case
    expect(place.size).toBe(4)
  })

  describe('UAT cu-5 P2-1: a pane holds the room of its tallest step from the first step of the case', () => {
    // jsdom has no layout: a pane is 600 px wide, a probed box is 30 px plus 20 per heap slot it draws, a probed caption 1 px per character
    const spies: { mockRestore: () => void }[] = []
    afterEach(() => { spies.splice(0).forEach(sp => sp.mockRestore()) })
    const stubLayout = () => {
      spies.push(vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600))
      spies.push(vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        let h = 0
        if (this.hasAttribute('data-room')) h = this.tagName === 'P' ? (this.textContent ?? '').length : 30 + 20 * this.querySelectorAll('[data-testid^="heap-slot-"]').length
        return { x: 0, y: 0, left: 0, top: 0, right: 600, bottom: h, width: 600, height: h, toJSON: () => ({}) } as DOMRect
      }))
    }

    it('measures the case once, keeps the largest box and caption, holds a box not declared yet, and leaves no probe behind', async () => {
      stubLayout()
      render(<DpView steps={CASE_STEPS} />)
      await screen.findByTestId('heap-view')
      const heap = () => screen.getByTestId('heap-view')
      expect(heap().querySelectorAll('[data-room]')).toHaveLength(0) // the probes are gone once measured
      expect(screen.getAllByTestId(/^graph-node-/)).toHaveLength(4) // and never a second copy of a drawing
      const room = 30 + 20 * 4 // the most slots the heap draws in the case: four pushes before the first pop
      const heights: string[] = []
      const caps = new Set<string>()
      const longest = Math.max(...['push 1 (0) → slot 0', 'push 2 (1) → slot 1', 'push 3 (2) → slot 2', 'push 4 (3) → slot 3', 'pop 1 (0)', 'pop 4 (3)', 'heap pq'].map(c => c.length))
      for (let k = CASE_STEPS.length; k >= 1; k--) {
        const box = heap().querySelector('.fam-box') as HTMLElement
        heights.push(box.style.minHeight)
        caps.add((screen.getByTestId('heap-caption') as HTMLElement).style.minHeight)
        if (k === 1) {
          // before pq is declared the pane holds its box as an empty one, unseen
          expect(screen.queryByTestId('heap-box')).toBeNull()
          expect(box.className).toContain('fam-ahead')
          expect(box).toHaveAttribute('aria-hidden', 'true')
          expect(box.childElementCount).toBe(0)
        } else expect(box).toHaveAttribute('data-testid', 'heap-box')
        expect(heap().querySelectorAll('[data-room]')).toHaveLength(0)
        if (k > 1) prev()
      }
      expect([...new Set(heights)]).toEqual([`${room}px`])
      expect([...caps]).toEqual([`${longest}px`])
    })

    it('measures again for another case, and for another pane width', async () => {
      stubLayout()
      const two: Step[] = [...CASE_STEPS, { op: 'heap', sid: 2, act: 'new', name: 'pq', case: 2 }, { op: 'heap', sid: 2, act: 'push', key: 1, prio: 1 }]
      render(<DpView steps={two} />)
      await screen.findByTestId('heap-view')
      // case 2 has its own, smaller heap: its box holds that room, not case 1's
      expect((screen.getByTestId('heap-box') as HTMLElement).style.minHeight).toBe('50px')
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Step' }), { key: 'Home' })
      expect((screen.getByTestId('heap-view').querySelector('.fam-box') as HTMLElement).style.minHeight).toBe('110px')
    })
  })

  it('Addendum 1 Q4: the dp-scrubber slider is named Step; Home is Step 1 and End is Step N', async () => {
    render(<DpView steps={GRAPH} />)
    await screen.findByTestId('graph-view')
    const s = screen.getByRole('slider', { name: 'Step' })
    expect(s).toHaveAttribute('data-testid', 'dp-scrubber')
    fireEvent.keyDown(s, { key: 'Home' })
    expect(counter()).toHaveTextContent('Step 1 / 14')
    expect(screen.getByTestId('graph-caption')).toHaveTextContent('graph g (directed)')
    expect(screen.queryByTestId('heap-box')).toBeNull() // the heap is created at step 5
    fireEvent.keyDown(s, { key: 'End' })
    expect(counter()).toHaveTextContent('Step 14 / 14')
  })

  it('draws every other family with its testids and formats', async () => {
    const steps: Step[] = [
      { op: 'queue', sid: 0, act: 'new', name: 'q' }, { op: 'queue', sid: 0, act: 'push', v: 7 }, { op: 'queue', sid: 0, act: 'push', v: 8 },
      { op: 'dsu', sid: 1, act: 'new', name: 'uf', n: 3 }, { op: 'dsu', sid: 1, act: 'union', a: 0, b: 1 },
      { op: 'array', sid: 2, act: 'new', name: 's', values: [97, 98, 99], chars: true }, { op: 'array', sid: 2, act: 'pointer', label: 'lo', i: 1 }, { op: 'array', sid: 2, act: 'window', lo: 1, hi: 2 },
      { op: 'search', sid: 3, act: 'new', name: 'k', lo: 1, hi: 6 }, { op: 'search', sid: 3, act: 'mid', m: 3, pred: false },
      { op: 'list', sid: 4, act: 'new', name: 'l' }, { op: 'list', sid: 4, act: 'node', id: 0, val: 5 }, { op: 'list', sid: 4, act: 'pointer', label: 'curr', id: 0 },
      { op: 'intervals', sid: 5, act: 'new', name: 'in', items: [[1, 3]] }, { op: 'intervals', sid: 5, act: 'mark', i: 0, label: 'new' },
      { op: 'tree', sid: 6, act: 'new', name: 't' }, { op: 'tree', sid: 6, act: 'node', id: 0, val: 1, parent: -1, side: '' }, { op: 'tree', sid: 6, act: 'node', id: 1, val: 2, parent: 0, side: 'L' },
      { op: 'game', sid: 7, act: 'new', name: 'g', states: ['0-0'] }, { op: 'game', sid: 7, act: 'set', state: '0-1', outcome: 'lose', value: -2 },
    ]
    render(<DpView steps={steps} />)
    await screen.findByTestId('queue-view')
    expect(within(screen.getByTestId('dp-view')).getAllByTestId(/-view$/).map(e => e.dataset.testid))
      .toEqual(['queue-view', 'dsu-view', 'array-view', 'search-view', 'list-view', 'intervals-view', 'tree-view', 'game-view'])
    expect(screen.getAllByTestId(/^queue-item-/).map(e => e.textContent)).toEqual(['7', '8'])
    expect(screen.getByTestId('dsu-count').textContent).toBe('2 sets')
    expect(screen.getByTestId('dsu-node-1')).toHaveAttribute('data-parent', '0')
    expect(screen.getByTestId('dsu-node-0')).toHaveAttribute('data-root', 'true')
    expect(screen.getByTestId('dsu-node-1')).toHaveAttribute('data-root', 'false')
    expect(screen.getByTestId('dsu-node-1').textContent).toBe('1')
    expect(screen.getAllByTestId(/^array-cell-/).map(e => [e.textContent, e.dataset.state])).toEqual([['a', 'idle'], ['b', 'window'], ['c', 'window']])
    expect(screen.getByTestId('pointer-lo')).toHaveAttribute('data-index', '1')
    expect(screen.getByTestId('pointer-lo').textContent).toBe('lo')
    expect(screen.getByTestId('search-probe-3')).toHaveAttribute('data-pred', 'false')
    expect(screen.getByTestId('search-mid')).toHaveAttribute('data-value', '3')
    expect(screen.getByTestId('search-lo')).toHaveAttribute('data-value', '1')
    expect(screen.getByTestId('list-node-0')).toHaveAttribute('data-next', 'nil')
    expect(screen.getByTestId('list-node-0').textContent).toBe('5')
    expect(screen.getByTestId('list-pointer-curr')).toHaveAttribute('data-node', '0')
    expect(screen.getByTestId('interval-0').textContent).toBe('[1,3]')
    expect(screen.getByTestId('interval-0')).toHaveAttribute('data-mark', 'new')
    expect(screen.getByTestId('tree-node-1')).toHaveAttribute('data-parent', '0')
    expect(screen.getByTestId('tree-node-1')).toHaveAttribute('data-side', 'L')
    expect(screen.getByTestId('tree-node-1').textContent).toBe('2')
    expect(screen.getByTestId('game-state-0-1').textContent).toBe('0-1 · lose (-2)')
    expect(screen.getByTestId('game-state-0-1')).toHaveAttribute('data-outcome', 'lose')
    expect(screen.getByTestId('game-state-0-1')).toHaveAttribute('data-state', 'current')
    expect(screen.getByTestId('game-state-0-0').textContent).toBe('0-0 · unknown')
    expect(screen.getByTestId('game-caption').textContent).toBe('0-1: lose (-2)')
  })

  it('Addendum 3: 20,000 live structures draw 50 boxes with a note, and 20 Previous presses stay inside §6', async () => {
    const steps: Step[] = []
    for (let i = 0; i < 20000; i++) steps.push({ op: 'queue', sid: i, act: 'new', name: `q${i}` })
    render(<DpView steps={steps} />)
    await screen.findByTestId('queue-view')
    expect(screen.getAllByTestId('queue-box')).toHaveLength(50)
    expect(screen.getByTestId('queue-view')).toHaveTextContent('Showing 50 of 20000 structures')
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) prev()
    const ms = performance.now() - t0
    expect(counter()).toHaveTextContent('Step 19980 / 20000')
    expect(screen.getAllByTestId('queue-box')).toHaveLength(50)
    expect(screen.getByTestId('queue-view')).toHaveTextContent('Showing 50 of 19980 structures')
    console.log(`perf: 20× Previous with 20,000 live structures (jsdom) ${Math.round(ms)} ms`)
    expect(ms).toBeLessThan(4000)
  })

  it('G4 M9: a pointer outside the drawn window shows where it points', async () => {
    render(<DpView steps={[
      { op: 'array', sid: 0, act: 'new', name: 'a', values: Array.from({ length: 100 }, (_, i) => i), chars: false },
      { op: 'array', sid: 0, act: 'pointer', label: 'p', i: 90 }, { op: 'array', sid: 0, act: 'set', i: 0, v: 7 },
    ]} />)
    await screen.findByTestId('array-view')
    expect(screen.queryByTestId('array-cell-90')).toBeNull()
    expect(screen.getByTestId('pointer-p').textContent).toBe('p')
    expect(screen.getByTestId('pointer-p')).toHaveAttribute('data-index', '90')
    expect(screen.getByTestId('array-view')).toHaveTextContent('→ 90')
  })

  it('round 2 Minor 1: no pointer note when the array is drawn whole (a pointer at -1 or n sits beside it)', async () => {
    render(<DpView steps={[
      { op: 'array', sid: 0, act: 'new', name: 'a', values: [1, 2, 3], chars: false },
      { op: 'array', sid: 0, act: 'pointer', label: 'lo', i: -1 }, { op: 'array', sid: 0, act: 'pointer', label: 'hi', i: 3 },
    ]} />)
    await screen.findByTestId('array-view')
    expect(screen.getByTestId('array-box')).not.toHaveTextContent('→') // the caption (outside the box) reads "hi → 3"
  })

  it('final 4a: no empty note, and no note for a pointer at -1 or n beside a window that reaches that end', async () => {
    render(<DpView steps={[
      { op: 'array', sid: 0, act: 'new', name: 'a', values: Array.from({ length: 100 }, (_, i) => i), chars: false },
      { op: 'array', sid: 0, act: 'pointer', label: 'lo', i: -1 }, { op: 'array', sid: 0, act: 'set', i: 0, v: 7 },
    ]} />)
    await screen.findByTestId('array-view')
    expect(screen.getByTestId('array-box')).not.toHaveTextContent('→')
    expect(screen.getByTestId('array-box').querySelector('p.fam-meta')).toBeNull()
  })

  it('G4 M2: Go steps are checked like Python\'s: a bad family step is kept as not shown', async () => {
    const steps = [{ op: 'heap', sid: 0, act: 'new', name: 'h', case: 1 }, { op: 'heap', sid: 0, act: 'push', key: 'x', prio: 1 }, { op: 'exit', v: 1 }]
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', cases: [], errors: [], stdout: '', steps, truncated: false, ms: 1 }), { status: 200 }))
    const out = await runCode({ pack: 'p215', code: '', mode: 'run' }, f as unknown as typeof fetch)
    expect(out.ok && out.result.steps).toEqual([{ op: 'heap', sid: 0, act: 'new', name: 'h', case: 1 }, { op: 'unshown', kind: 'heap' }, { op: 'exit', v: 1 }])
  })

  it('round 2 I1: a server-shaped unshown step keeps its family and case through the client check', async () => {
    const steps = [{ op: 'unshown', kind: 'heap', case: 1 }, { op: 'unshown', kind: 'nope' }, { op: 'unshown', kind: 'graph', case: 'x' }]
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', cases: [], errors: [], stdout: '', steps, truncated: false, ms: 1 }), { status: 200 }))
    const out = await runCode({ pack: 'p215', code: '', mode: 'run' }, f as unknown as typeof fetch)
    expect(out.ok && out.result.steps).toEqual([{ op: 'unshown', kind: 'heap', case: 1 }, { op: 'unshown' }, { op: 'unshown', kind: 'graph' }])
    render(<DpView steps={out.ok ? out.result.steps : []} />)
    expect(await screen.findByTestId('graph-caption')).toHaveTextContent('(event not shown)') // Step N
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Step' }), { key: 'Home' })
    expect(screen.getByTestId('heap-caption')).toHaveTextContent('(event not shown)')
  })

  it('G4 M2: a step view that throws never blanks the screen', () => {
    const Boom = () => { throw new Error('bad step') }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<div><p>still here</p><StepsBoundary><Boom /></StepsBoundary></div>)
    err.mockRestore()
    expect(screen.getByText('still here')).toBeTruthy()
    expect(screen.getByTestId('steps-error')).toHaveTextContent('The step view could not draw this run.')
  })

  it('ui-visual-families V0: panes with a left label, name lines with descriptors, natural-size drawings, tiles with text inside', async () => {
    render(<DpView steps={GRAPH} />)
    await screen.findByTestId('graph-view')
    const gv = screen.getByTestId('graph-view')
    expect(gv.querySelector('.fam-label')?.textContent).toBe('Graph')
    expect(within(screen.getByTestId('graph-box')).getByText('g · directed · 3 nodes')).toBeTruthy()
    expect(within(screen.getByTestId('heap-box')).getByText('pq · 2 items')).toBeTruthy()
    const svg = gv.querySelector('svg.fam-graph') as SVGSVGElement
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`) // V0.3: 1 unit = 1 px
    expect(svg.getAttribute('width')).not.toMatch(/%/)
    const node = screen.getByTestId('graph-node-3')
    expect(node.querySelector('rect')).toBeTruthy()
    expect(node.querySelector('text')?.textContent).toBe('3 · 1 · near') // the text sits inside the tile
    expect(screen.getByTestId('graph-edge-1-2').querySelector('polygon')).toBeTruthy() // a directed edge has its head
    // V0.2: two family panels share a row on desktop; neither spans it
    expect(gv.className).not.toMatch(/fam-span/)
    expect(screen.getByTestId('heap-view').className).not.toMatch(/fam-span/)
  })

  it('V0.8 / V0.9 / V3 / V10: indices under cells, front and back tags, an empty box says empty, game text spacing', async () => {
    render(<DpView steps={[
      { op: 'queue', sid: 0, act: 'new', name: 'q' }, { op: 'queue', sid: 0, act: 'push', v: 7 }, { op: 'queue', sid: 0, act: 'push', v: 8 },
      { op: 'heap', sid: 1, act: 'new', name: 'pq' },
      { op: 'game', sid: 2, act: 'new', name: 'g', states: [] }, { op: 'game', sid: 2, act: 'set', state: '0-3', outcome: 'win', value: 5 },
    ]} />)
    await screen.findByTestId('queue-view')
    const q = screen.getByTestId('queue-box')
    expect([...q.querySelectorAll('.fam-index')].map(e => e.textContent)).toEqual(['0', '1'])
    expect([...q.querySelectorAll('.fam-tag')].map(e => e.textContent)).toEqual(['front', 'back'])
    expect(within(screen.getByTestId('heap-box')).getByText('empty')).toBeTruthy()
    expect(screen.getByTestId('game-state-0-3').textContent).toBe('0-3 · win (5)')
    expect(screen.getByTestId('game-view').className).toMatch(/fam-span/) // the last of an odd count spans the row
  })

  it('UAT cu-5 P3-6: a family trace with several cases says which case is on screen; one case says nothing', async () => {
    const steps: Step[] = [
      { op: 'graph', sid: 0, act: 'new', name: 'g', directed: false, case: 7 }, { op: 'graph', sid: 0, act: 'edge', u: 1, v: 2 },
      { op: 'graph', sid: 1, act: 'new', name: 'g', directed: false, case: 9 }, { op: 'graph', sid: 1, act: 'edge', u: 1, v: 2 },
    ]
    const { unmount } = render(<DpView steps={steps} caseCalls={{ 7: 'f(3)', 9: 'f(4)' }} />)
    await screen.findByTestId('graph-view')
    expect(screen.getByTestId('dp-case')).toHaveTextContent('Case 2 of 2 (4)')
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Step' }), { key: 'Home' })
    expect(screen.getByTestId('dp-case')).toHaveTextContent('Case 1 of 2 (3)')
    unmount()
    render(<DpView steps={steps.slice(0, 2)} caseCalls={{ 7: 'f(3)' }} />)
    await screen.findByTestId('graph-view')
    expect(screen.queryByTestId('dp-case')).toBeNull()
  })

  it('UAT cu-5 P3-4: the step counter is as wide as its widest text, so the slider never moves as the digits grow', async () => {
    render(<DpView steps={GRAPH} />)
    await screen.findByTestId('graph-view')
    expect(counter().style.minWidth).toBe('15ch') // "Step 14 / 14": 12 characters, the 15 ch floor holds
    const many: Step[] = []
    for (let i = 0; i < 12000; i++) many.push({ op: 'queue', sid: i, act: 'new', name: 'q' })
    render(<DpView steps={many} />)
    expect(screen.getAllByTestId('dp-step-counter')[1].style.minWidth).toBe('18ch') // "Step 12000 / 12000"
  })

  it('UAT cu-5 P3-3: an empty heap says so (V0.9), and a heap never shows the two helper lines (V2)', async () => {
    render(<DpView steps={[{ op: 'heap', sid: 0, act: 'new', name: 'pq' }, { op: 'heap', sid: 0, act: 'push', key: 1, prio: 1 }, { op: 'heap', sid: 0, act: 'pop', key: 1, prio: 1 }]} />)
    await screen.findByTestId('heap-view')
    const box = screen.getByTestId('heap-box')
    expect(within(box).getByText('pq · 0 items')).toBeTruthy()
    expect(within(box).getByText('empty')).toBeTruthy()
    expect(screen.queryByTestId('heap-array-label')).toBeNull()
    expect(screen.queryByTestId('heap-tree-label')).toBeNull()
    prev()
    expect(screen.getByTestId('heap-array')).toBeTruthy()
    expect(screen.queryByTestId('heap-array-label')).toBeNull() // V2 lists the array then the tree, no helper lines (cu-r2 A2#24)
    expect(screen.queryByTestId('heap-tree-label')).toBeNull()
    expect(screen.getByTestId('heap-view').textContent).not.toMatch(/slot numbers below|same heap as a tree/i)
  })

  it('a DP-only run shows no family panel', () => {
    render(<DpView steps={[{ op: 'table', t: 0, rows: 1, cols: 2, name: 'dp' }, { op: 'set', t: 0, i: 0, j: 1, v: 1, deps: [] }]} />)
    expect(screen.getByTestId('dp-table')).toBeTruthy()
    expect(screen.queryAllByTestId(/-view$/).filter(e => e.dataset.testid !== 'dp-view')).toHaveLength(0)
  })
})

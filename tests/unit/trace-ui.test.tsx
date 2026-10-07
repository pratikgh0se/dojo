// ui-dp-view.md: the trace band's new testids and rules (index labels, arrows, the tree as a real tree with one
// labelled tree per case, the mapping, the link summary, the selected recurrence, the legend), on the testers'
// fixture: p91, the memo solution that also writes dp, cases "12" and "226".
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DpView from '../../src/runner/DpView'
import { edgePath, layoutForest, LEVEL, tileWidth } from '../../src/runner/treeLayout'
import type { Step } from '../../src/runner/types'

/** The steps tk writes for P91_BOTH (scripts/ui-shots.mjs): f(i) memoised, writing dp[i] as it returns. */
function p91(cases: string[]): Step[] {
  const out: Step[] = []
  cases.forEach((s, ci) => {
    let first = true
    const push = (st: Step) => { out.push(first ? { ...st, case: ci + 1 } : st); first = false }
    const t = ci
    push({ op: 'table', t, rows: 1, cols: s.length + 1, name: 'dp' })
    push({ op: 'link', fn: 'f', table: 'dp' })
    const memo = new Map<number, number>()
    const f = (i: number): number => {
      if (memo.has(i)) { push({ op: 'hit', fn: 'f', args: [i] }); return memo.get(i)! }
      push({ op: 'enter', fn: 'f', args: [i] })
      let v = 0
      if (i <= 1) {
        v = i === 1 && s[0] === '0' ? 0 : 1
        push({ op: 'set', t, i: 0, j: i, v, deps: [] })
      } else {
        const one = s[i - 1] !== '0'
        const two = s[i - 2] === '1' || (s[i - 2] === '2' && s[i - 1] <= '6')
        if (one) v += f(i - 1)
        if (two) v += f(i - 2)
        const deps: [number, number][] = [...(one ? [[0, i - 1] as [number, number]] : []), ...(two ? [[0, i - 2] as [number, number]] : [])]
        push({ op: 'set', t, i: 0, j: i, v, deps, ...(deps.length === 2 ? { rule: '{0} + {1}' } : deps.length ? { rule: '{0}' } : {}) })
      }
      memo.set(i, v)
      push({ op: 'exit', v })
      return v
    }
    f(s.length)
  })
  return out
}
const STEPS = p91(['12', '226'])
const CALLS = { 1: 'numDecodings("12")', 2: 'numDecodings("226")' }
const at = (text: string) => {
  render(<DpView steps={STEPS} caseCalls={CALLS} />)
  const s = screen.getByRole('slider', { name: 'Step' })
  fireEvent.keyDown(s, { key: 'Home' })
  for (let i = 0; i < STEPS.length && screen.getByTestId('dp-recurrence').textContent !== text; i++) fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
  expect(screen.getByTestId('dp-recurrence')).toHaveTextContent(text)
}

describe('the worked example (ui-dp-view): p91 Run, case "226", the step writing dp[3]', () => {
  it('the band is a panel titled Trace with the controls in F6.14 order', () => {
    render(<DpView steps={STEPS} caseCalls={CALLS} />)
    const band = screen.getByTestId('dp-view')
    expect(within(band).getByRole('heading', { level: 2 })).toHaveTextContent('Trace')
    expect(within(band).getAllByRole('button').slice(0, 3).map(b => b.textContent)).toEqual(['Previous step', 'Play', 'Next step'])
    expect(screen.getByTestId('dp-scrubber')).toHaveAccessibleName('Step')
  })

  it('table: values, the current cell, green deps, the index row under the cells, two green arrows', () => {
    at('dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
    const pane = screen.getAllByTestId('dp-table-pane').at(-1)!
    expect(within(pane).getByText('Bottom-up · dp')).toBeTruthy()
    expect(within(pane).getByText('1 × 4')).toBeTruthy()
    expect([0, 1, 2, 3].map(j => within(pane).getByTestId(`dp-cell-0-${j}`).textContent)).toEqual(['1', '1', '2', '3'])
    expect(within(pane).getByTestId('dp-cell-0-3')).toHaveAttribute('data-state', 'current')
    expect(within(pane).getByTestId('dp-cell-0-2')).toHaveAttribute('data-dep', 'true')
    expect(within(pane).getByTestId('dp-cell-0-1')).toHaveAttribute('data-dep', 'true')
    expect([0, 1, 2, 3].map(j => within(pane).getByTestId(`dp-col-${j}`).textContent)).toEqual(['0', '1', '2', '3'])
    const arrows = within(pane).getByTestId('dp-arrows')
    expect(arrows).toHaveAttribute('aria-hidden', 'true')
    expect(within(arrows as unknown as HTMLElement).getByTestId('dp-arrow-0-2-0-3')).toHaveAttribute('data-kind', 'current')
    expect(within(arrows as unknown as HTMLElement).getByTestId('dp-arrow-0-1-0-3')).toHaveAttribute('data-kind', 'current')
    expect(within(pane).queryByTestId('dp-row-0')).toBeNull() // 1-D: no row labels
  })

  it('tree: one labelled tree per case, the cache hit dashed, the counts in the header', () => {
    at('dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
    const pane = screen.getByTestId('dp-tree-pane')
    expect(within(pane).getByText('Top-down · calls')).toBeTruthy()
    expect(within(pane).getByText('8 calls · 1 cache hit')).toBeTruthy()
    expect(screen.getByTestId('dp-root-label-1')).toHaveTextContent('numDecodings("12")')
    expect(screen.getByTestId('dp-root-label-2')).toHaveTextContent('numDecodings("226")')
    const nodes = within(screen.getByTestId('dp-tree')).getAllByRole('treeitem')
    expect(nodes.map(n => n.textContent)).toEqual(['f(2) → 2', 'f(1) → 1', 'f(0) → 1', 'f(3)', 'f(2) → 2', 'f(1) → 1', 'f(0) → 1', 'f(1) (cached)'])
    expect(nodes[7]).toHaveAttribute('data-hit', 'true')
    expect(nodes[3]).toHaveAttribute('data-onstack', 'true') // f(3) has not returned yet at this step
  })

  it('mapping row and legend', () => {
    at('dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
    expect(screen.getByTestId('dp-mapping')).toHaveTextContent('f(i) ↔ dp[i]')
    expect(screen.queryByTestId('dp-link-summary')).toBeNull()
    expect(within(screen.getByTestId('dp-legend')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Written now', 'Depends on', 'Cache hit', 'Selected', 'Linked'])
  })

  it('pressing dp-cell-0-1: linked calls, the link summary, the selected recurrence, a yellow arrow', () => {
    at('dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
    const pane = screen.getAllByTestId('dp-table-pane').at(-1)!
    fireEvent.click(within(pane).getByTestId('dp-cell-0-1'))
    const nodes = within(screen.getByTestId('dp-tree')).getAllByRole('treeitem')
    expect(nodes.filter(n => n.getAttribute('data-linked') === 'true').map(n => n.textContent)).toEqual(['f(1) → 1', 'f(1) → 1', 'f(1) (cached)'])
    expect(screen.getByTestId('dp-link-summary')).toHaveTextContent('dp[1] ↔ f(1): 2 computed calls, 1 cache hit')
    expect(screen.getByTestId('dp-cell-recurrence')).toHaveTextContent('dp[1] = 1')
    expect(within(pane).getByTestId('dp-arrows').querySelectorAll('[data-kind="selected"]')).toHaveLength(0) // dp[1] is a base case: no deps
    fireEvent.click(within(pane).getByTestId('dp-cell-0-2'))
    expect(screen.getByTestId('dp-cell-recurrence')).toHaveTextContent('dp[2] = dp[1] + dp[0] = 1 + 1 = 2')
    expect(within(pane).getByTestId('dp-arrows').querySelector('[data-testid="dp-arrow-0-1-0-2"]')).toHaveAttribute('data-kind', 'selected')
    fireEvent.keyDown(screen.getByTestId('dp-view'), { key: 'Escape' })
    expect(screen.queryByTestId('dp-cell-recurrence')).toBeNull()
  })

  it('pressing a node links its cell and summarises it', () => {
    at('dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
    const hit = within(screen.getByTestId('dp-tree')).getAllByRole('treeitem')[7]
    fireEvent.click(hit)
    const pane = screen.getAllByTestId('dp-table-pane').at(-1)!
    expect(within(pane).getByTestId('dp-cell-0-1')).toHaveAttribute('data-linked', 'true')
    expect(screen.getByTestId('dp-link-summary')).toHaveTextContent('f(1) ↔ dp[1] = 1')
  })

  it('M4: a call or a hit marks its cell live; the band steps with ← → Home End and plays with space', () => {
    render(<DpView steps={STEPS} caseCalls={CALLS} />)
    const band = screen.getByTestId('dp-view')
    fireEvent.keyDown(band, { key: 'Home' })
    expect(screen.getByTestId('dp-step-counter')).toHaveTextContent(`Step 1 / ${STEPS.length}`)
    const hitStep = STEPS.findIndex(s => s.op === 'hit') + 1
    for (let i = 1; i < hitStep; i++) fireEvent.keyDown(band, { key: 'ArrowRight' })
    expect(screen.getByTestId('dp-step-counter')).toHaveTextContent(`Step ${hitStep} / `)
    expect(screen.getAllByTestId('dp-cell-0-1').at(-1)).toHaveAttribute('data-call', 'hit')
    fireEvent.keyDown(band, { key: 'ArrowLeft' })
    fireEvent.keyDown(band, { key: 'End' })
    expect(screen.getByTestId('dp-step-counter')).toHaveTextContent(`Step ${STEPS.length} / ${STEPS.length}`)
    fireEvent.keyDown(band, { key: 'Home' })
    fireEvent.keyDown(band, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('2-D tables: both axes labelled, a corner, diagonal arrows', () => {
  it('draws dp-row-i and dp-col-j with an i \\ j corner, and the diagonal dep arrow', () => {
    const steps: Step[] = [{ op: 'table', t: 0, rows: 3, cols: 3, name: 'dp' }]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) steps.push(i && j ? { op: 'set', t: 0, i, j, v: 1, deps: [[i - 1, j - 1]], rule: '{0} + 1' } : { op: 'set', t: 0, i, j, v: 0, deps: [] })
    render(<DpView steps={steps} />)
    expect([0, 1, 2].map(i => screen.getByTestId(`dp-row-${i}`).textContent)).toEqual(['0', '1', '2'])
    expect([0, 1, 2].map(j => screen.getByTestId(`dp-col-${j}`).textContent)).toEqual(['0', '1', '2'])
    expect(screen.getByText('i \\ j')).toBeTruthy()
    expect(screen.getByTestId('dp-arrow-1-1-2-2')).toHaveAttribute('data-kind', 'current')
    expect(screen.queryByTestId('dp-tree-pane')).toBeNull()
    expect(within(screen.getByTestId('dp-legend')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Written now', 'Depends on', 'Selected'])
  })
})

describe('tree only (a run still in progress)', () => {
  it('the legend names the call, the hit and the call stack; the stack is orange', () => {
    const steps = p91(['226']).filter(s => s.op !== 'table' && s.op !== 'set' && s.op !== 'link')
    render(<DpView steps={steps.slice(0, 6)} caseCalls={{ 1: 'numDecodings("226")' }} />)
    expect(screen.queryByTestId('dp-table-pane')).toBeNull()
    expect(within(screen.getByTestId('dp-legend')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Called now', 'Cache hit', 'On the call stack'])
    expect(screen.queryByTestId('dp-mapping')).toBeNull()
  })
})

describe('treeLayout (TL1–TL2)', () => {
  const w = (s: string) => tileWidth(s)
  it('packs siblings 12 apart, centres a parent over its first and last child, never overlaps a level', () => {
    const lay = layoutForest([
      { key: 1, parent: -1, width: w('f(3)'), group: 1 },
      { key: 2, parent: 0, width: w('f(2) → 2'), group: 1 },
      { key: 3, parent: 1, width: w('f(1) → 1'), group: 1 },
      { key: 4, parent: 1, width: w('f(0) → 1'), group: 1 },
      { key: 5, parent: 0, width: w('f(1) (cached)'), group: 1 },
    ])
    const n = new Map(lay.nodes.map(p => [p.key, p]))
    const cx = (k: number) => n.get(k)!.x + n.get(k)!.width / 2
    expect(n.get(4)!.x - (n.get(3)!.x + n.get(3)!.width)).toBeCloseTo(12)
    expect(cx(2)).toBeCloseTo((cx(3) + cx(4)) / 2)
    expect(cx(1)).toBeCloseTo((cx(2) + cx(5)) / 2)
    expect(n.get(2)!.y - n.get(1)!.y).toBe(LEVEL)
    expect(n.get(5)!.x).toBeGreaterThanOrEqual(n.get(2)!.x + n.get(2)!.width + 12 - 0.001)
    expect(edgePath(n.get(1)!, n.get(2)!).split(' ')).toHaveLength(4) // orthogonal: down, across, down
  })
  it('cases never interleave: each case is a box of its own, 20 apart, with room for its label', () => {
    const lay = layoutForest([
      { key: 1, parent: -1, width: 72, group: 1 }, { key: 2, parent: 0, width: 72, group: 1 }, { key: 3, parent: 0, width: 72, group: 1 },
      { key: 4, parent: -1, width: 72, group: 2 },
    ], new Map([[1, 160], [2, 160]]))
    const [g1, g2] = lay.groups
    expect(g2.left - g1.right).toBeCloseTo(20)
    expect(g1.right - g1.left).toBeGreaterThanOrEqual(160)
    expect(lay.top).toBe(28)
    expect(lay.nodes.every(p => p.y >= 28)).toBe(true)
  })
})

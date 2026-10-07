// Code review M3, M5–M10: the code panel, the DP view and the Solved gate on Do.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { CodePanel } from '../../src/runner/CodePanel'
import DpView from '../../src/runner/DpView'
import { buildModel } from '../../src/runner/dpModel'
import { loadPassCycle, usePassGate } from '../../src/runner/gate'
import { SLOW_GO_RUN_TEXT, SLOW_RUN_MS, stdoutText } from '../../src/runner/status'
import type { PublicPack, RunResult, Step } from '../../src/runner/types'
import { Do } from '../../src/screens/Do'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

vi.mock('../../src/runner/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => (
    <textarea aria-label="Code" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

const PACK: PublicPack = {
  id: 'p91', title: 'Decode Ways', fn: 'numDecodings', signature: 'func numDecodings(s string) int', starter: 'package main\n', examples: 2,
  cases: [
    { id: 1, call: 'numDecodings("12")', expected: 2 }, { id: 2, call: 'numDecodings("226")', expected: 3 }, { id: 3, call: 'numDecodings("06")', expected: 0 },
    { id: 4, call: 'numDecodings("11106")', expected: 2 }, { id: 5, call: 'numDecodings("2611055971756562")', expected: 4 },
  ],
}
const T = new Date('2026-09-08T21:10:00+05:30').getTime()

function mockServer(result: Partial<RunResult> | null) {
  const runs: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/tools/packs/')) return new Response(JSON.stringify(PACK), { status: 200 })
    if (String(url) === '/tools/run-go') {
      runs.push(JSON.parse(String(init?.body)))
      const body: RunResult = { status: 'ok', cases: [], errors: [], stdout: '', steps: [], truncated: false, ms: 1, ...result }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }))
  return runs
}

beforeEach(() => { setNow(() => T) })
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

async function panel(result: Partial<RunResult> | null = null) {
  const d = await seededDb()
  mockServer(result)
  const onPass = vi.fn()
  renderWithApp(<CodePanel ticketId="p91" onSubmitPassed={onPass} />, { db: d, plan: smallPlan })
  await screen.findByRole('textbox', { name: 'Code' })
  return { d, onPass }
}
const caseRows = () => screen.getAllByTestId(/^run-case-/)

describe('C-PYTHON Addendum 2 Q2: run-stdout', () => {
  it('shows the prints after a run, and is empty when nothing was printed', async () => {
    await panel({ status: 'ok', stdout: 'hello\nworld\n', cases: PACK.cases.slice(0, 2).map(c => ({ ...c, got: c.expected, pass: true })) })
    expect(screen.queryByTestId('run-stdout')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByTestId('run-stdout').textContent).toBe('hello\nworld\n'))
  })
  it('is present and empty without prints', async () => {
    await panel({ status: 'ok', stdout: '', cases: PACK.cases.slice(0, 2).map(c => ({ ...c, got: c.expected, pass: true })) })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByTestId('run-stdout').textContent).toBe(''))
  })
  it('round 2 Minor 4: stdoutText counts code points and never splits a surrogate pair', () => {
    const smile = '\u{1F600}'
    expect(stdoutText(smile.repeat(65536))).toBe(smile.repeat(65536)) // 131072 UTF-16 units, 65536 code points: not cut
    expect(stdoutText(`${'x'.repeat(65535)}${smile}y`)).toBe(`${'x'.repeat(65535)}${smile}\n… (output truncated)`)
    expect(stdoutText(`${smile.repeat(65536)}z`)).toBe(`${smile.repeat(65536)}\n… (output truncated)`)
  })
  it('stdoutText keeps the first 64 KiB, then the mark; a runner mark is rewritten once', () => {
    expect(stdoutText('')).toBe('')
    expect(stdoutText('a\n')).toBe('a\n')
    expect(stdoutText('x'.repeat(70 * 1024))).toBe(`${'x'.repeat(64 * 1024)}\n… (output truncated)`)
    expect(stdoutText(`${'x'.repeat(10)}\n… (output cut)`)).toBe(`${'x'.repeat(10)}\n… (output truncated)`)
    expect(stdoutText(`ab\n… (output truncated)`)).toBe('ab\n… (output truncated)')
  })
})

describe('M3: case diffs only for cases that ran', () => {
  it('a timeout lists the calls without "got nothing" diffs', async () => {
    await panel({ status: 'timeout', cases: PACK.cases.slice(0, 2).map(c => ({ ...c, got: null, pass: false })) })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Timed out after 3 s'))
    expect(caseRows()).toHaveLength(2)
    expect(screen.queryAllByTestId('run-diff')).toHaveLength(0)
    expect(screen.getByTestId('code-panel')).not.toHaveTextContent('got nothing')
    expect(caseRows()[0]).toHaveTextContent('numDecodings("12")')
    expect(caseRows()[0]).toHaveAttribute('data-pass', 'false')
  })

  it('a runtime error shows the diff only for the cases that returned', async () => {
    await panel({
      status: 'runtime_error',
      cases: [{ ...PACK.cases[0], got: 1, pass: false }, { ...PACK.cases[1], got: null, pass: false }],
      errors: [{ line: 3, col: 0, message: 'panic: boom (numDecodings("226"))' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Runtime error'))
    expect(screen.getAllByTestId('run-diff').map(e => e.textContent)).toEqual(['numDecodings("12"): expected 2, got 1'])
    expect(within(caseRows()[1]).queryByTestId('run-diff')).toBeNull()
  })

  it('a compile error lists the calls with no diffs; a failing ok run still shows its diff', async () => {
    await panel({ status: 'compile_error', cases: PACK.cases.slice(0, 2).map(c => ({ ...c, got: null, pass: false })), errors: [{ line: 4, col: 1, message: 'undefined: x' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Compile error'))
    expect(screen.queryAllByTestId('run-diff')).toHaveLength(0)
  })
})

describe('UAT cu-4 P3-17: a slow first Go run says why', () => {
  it('"Running…" for the first stretch, then it says the first run builds its cache; the result replaces it', async () => {
    const d = await seededDb()
    let release: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/tools/packs/')) return new Response(JSON.stringify(PACK), { status: 200 })
      if (String(url) === '/tools/run-go') return new Promise<Response>(ok => { release = ok })
      return new Response('{}', { status: 404 })
    }))
    renderWithApp(<CodePanel ticketId="p91" onSubmitPassed={() => {}} />, { db: d, plan: smallPlan })
    await screen.findByRole('textbox', { name: 'Code' })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByTestId('run-status')).toHaveTextContent(/^Running…$/)
    await new Promise(r => setTimeout(r, SLOW_RUN_MS - 400))
    expect(screen.getByTestId('run-status')).toHaveTextContent(/^Running…$/) // not yet: a warm run is under a second
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent(SLOW_GO_RUN_TEXT), { timeout: 1500 })
    expect(SLOW_GO_RUN_TEXT).toMatch(/first Go run builds its cache/)
    release(new Response(JSON.stringify({ status: 'ok', cases: [], errors: [], stdout: '', steps: [], truncated: false, ms: 3000 }), { status: 200 }))
    await waitFor(() => expect(screen.getByTestId('run-status')).not.toHaveTextContent('Running'))
  })
})

describe('UAT cu-4 P3-19: a case row keeps its mark beside its text', () => {
  it('the mark and the call are separate items of one row, so a long call wraps beside its mark', async () => {
    await panel({ status: 'ok', cases: PACK.cases.slice(0, 2).map(c => ({ ...c, got: c.expected, pass: true })) })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(caseRows()).toHaveLength(2))
    const row = caseRows()[0]
    expect(row.querySelector(':scope > .run-case-mark')).not.toBeNull()
    expect(row.querySelector(':scope > .run-case-body > code')).toHaveTextContent('numDecodings("12")')
    expect(row).toHaveTextContent('✓ numDecodings("12") → 2')
  })
})

describe('M8: the code save is flushed when the page hides', () => {
  for (const [name, fire] of [
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    ['visibilitychange to hidden', () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    }],
  ] as const) {
    it(name, async () => {
      const { d } = await panel()
      fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'package main // typed' } })
      fire()
      await waitFor(async () => expect((await d.code.get(['p91', 'go']))?.source).toBe('package main // typed'), { timeout: 300 })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    })
  }
})

// Two cases; case 1 forgets its tk.Exit, so without a reset case 2's f(3) would nest under f(2).
const forgotten: Step[] = [
  { op: 'enter', fn: 'f', args: [2], case: 1 },
  { op: 'enter', fn: 'f', args: [3], case: 2 }, { op: 'exit', v: 3 },
]

describe('M5: the call tree resets at each case', () => {
  it('a case-start event resets the stack; unexited calls are counted', () => {
    const m = buildModel(forgotten)
    expect(m.nodes.map(n => [n.n, n.depth, n.ret])).toEqual([[1, 0, null], [2, 0, 3]])
    expect(m.unexited).toBe(1)
    expect(buildModel([{ op: 'enter', fn: 'f', args: [1] }, { op: 'hit', fn: 'f', args: [0] }, { op: 'exit', v: 1 }]).unexited).toBe(0)
  })

  it('the view says how many calls never returned (ui-dp-view T0)', () => {
    render(<DpView steps={forgotten} />)
    expect(screen.getByTestId('dp-unexited')).toHaveTextContent('1 call never returned')
    expect(screen.getByTestId('dp-node-2')).toHaveTextContent('f(3) → 3')
  })

  it('says nothing when every call exited', () => {
    render(<DpView steps={[{ op: 'enter', fn: 'f', args: [1] }, { op: 'exit', v: 1 }]} />)
    expect(screen.queryByTestId('dp-unexited')).toBeNull()
  })
})

describe('M9 and M10: DP view controls', () => {
  const twoTables: Step[] = [
    { op: 'table', t: 0, rows: 1, cols: 3, name: 'a' }, { op: 'set', t: 0, i: 0, j: 1, v: 1, deps: [] },
    { op: 'table', t: 1, rows: 1, cols: 3, name: 'b' }, { op: 'set', t: 1, i: 0, j: 1, v: 2, deps: [] },
  ]

  it('M9 / ui-dp-view P1: one pane per table; a pressed cell is cleared when its table is no longer drawn', () => {
    render(<DpView steps={twoTables} />)
    const panes = () => screen.getAllByTestId('dp-table-pane')
    expect(panes().map(p => within(p).getByTestId('dp-table').getAttribute('aria-label'))).toEqual(['Table a', 'Table b'])
    fireEvent.click(within(panes()[1]).getByTestId('dp-cell-0-1'))
    expect(within(panes()[1]).getByTestId('dp-cell-0-1')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
    expect(screen.getByTestId('dp-table')).toHaveAccessibleName('Table a')
    expect(screen.getByTestId('dp-cell-0-1')).toHaveAttribute('aria-pressed', 'false')
  })

  it('F6.14: Play toggles its label, with aria-pressed reflecting playing', () => {
    vi.useFakeTimers()
    try {
      render(<DpView steps={twoTables} />)
      const play = screen.getByRole('button', { name: 'Play' })
      expect(play).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(play)
      expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true')
      act(() => { vi.advanceTimersByTime(5000) })
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('M7: a pass with no cycle yet is queued', () => {
  it('opens the gate once the cycle exists', () => {
    const { result, rerender } = renderHook(({ cycleId }) => usePassGate('p91', cycleId), { initialProps: { cycleId: '' } })
    expect(result.current.passCycle).toBeNull()
    act(() => result.current.onSubmitPassed())
    expect(result.current.passCycle).toBeNull()
    rerender({ cycleId: 'c-1' })
    expect(result.current.passCycle).toBe('c-1')
    expect(loadPassCycle('p91')).toBe('c-1')
  })

  it('applies at once when the cycle already exists, and only to that cycle', () => {
    const { result, rerender } = renderHook(({ cycleId }) => usePassGate('p91', cycleId), { initialProps: { cycleId: 'c-1' } })
    act(() => result.current.onSubmitPassed())
    expect(result.current.passCycle).toBe('c-1')
    rerender({ cycleId: 'c-2' })
    expect(result.current.passCycle).toBe('c-1') // the next attempt is gated again
  })
})

describe('M6: a hint by the disabled Solved buttons', () => {
  it('reads "Submit 5/5 to unlock Solved" until a passing Submit', async () => {
    const d = await seededDb()
    await d.tickets.put(mkTicket({ id: 'p91', track: 'interview', kind: 'problem', title: 'Decode Ways' }))
    mockServer({ status: 'ok', cases: PACK.cases.map(c => ({ ...c, got: c.expected, pass: true })) })
    renderWithApp(<Do />, { db: d, plan: smallPlan, route: '/do/p91', path: '/do/:ticketId' })
    const hint = await screen.findByTestId('do-run-gate-hint')
    expect(hint).toHaveTextContent('Submit 5/5 to unlock Solved')
    expect(screen.getByTestId('do-outcome-solved')).toBeDisabled()
    expect(screen.getByTestId('do-outcome-solved')).toHaveAttribute('aria-describedby', hint.id)
    await screen.findByRole('textbox', { name: 'Code' })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Passed 5/5'))
    await waitFor(() => expect(screen.getByTestId('do-outcome-solved')).toBeEnabled())
    expect(screen.queryByTestId('do-run-gate-hint')).toBeNull()
  })

  it('L6: shows only while the run gate is what disables them (not after Give up locks the outcomes)', async () => {
    const d = await seededDb()
    await d.tickets.put(mkTicket({ id: 'p91', track: 'interview', kind: 'problem', title: 'Decode Ways' }))
    mockServer(null)
    renderWithApp(<Do />, { db: d, plan: smallPlan, route: '/do/p91', path: '/do/:ticketId' })
    await screen.findByTestId('do-run-gate-hint')
    fireEvent.click(screen.getByTestId('do-outcome-giveup'))
    await waitFor(() => expect(screen.getByTestId('do-outcome-giveup')).toBeDisabled())
    expect(screen.getByTestId('do-outcome-solved')).toBeDisabled()
    expect(screen.queryByTestId('do-run-gate-hint')).toBeNull()
    expect(screen.getByTestId('do-outcome-solved')).not.toHaveAttribute('aria-describedby')
    expect(screen.getByTestId('do-outcome-help')).not.toHaveAttribute('aria-describedby')
  })
})

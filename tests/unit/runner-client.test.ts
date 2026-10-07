import { describe, expect, it } from 'vitest'
import { buildModel, hasDp, narrate, nodeCell, nodesAt, nodeText, tableAt, tableWindow } from '../../src/runner/dpModel'
import { cellName, recurrenceText } from '../../src/runner/recurrence'
import { diffText, errorText, NO_TOOLCHAIN_TEXT, passesGate, statusText } from '../../src/runner/status'
import type { RunCase, Step } from '../../src/runner/types'

const c = (pass: boolean): RunCase => ({ id: 1, call: 'f(1)', expected: 1, got: pass ? 1 : 2, pass })

describe('status texts (§4)', () => {
  it('are exact', () => {
    expect(statusText({ status: 'ok', cases: [c(true), c(true), c(true), c(true), c(true)] })).toBe('Passed 5/5')
    expect(statusText({ status: 'ok', cases: [c(true), c(false)] })).toBe('Failed 1/2')
    expect(statusText({ status: 'ok', cases: [c(false), c(false)] })).toBe('Failed 0/2')
    expect(statusText({ status: 'compile_error', cases: [] })).toBe('Compile error')
    expect(statusText({ status: 'runtime_error', cases: [] })).toBe('Runtime error')
    expect(statusText({ status: 'timeout', cases: [] })).toBe('Timed out after 3 s')
    expect(statusText({ status: 'output_limit', cases: [] })).toBe('Output too large')
    expect(statusText({ status: 'memory_limit', cases: [] })).toBe('Out of memory')
    expect(statusText({ status: 'no_toolchain', cases: [] })).toBe("Go isn't installed: install it with brew install go")
    expect(NO_TOOLCHAIN_TEXT).toBe("Go isn't installed: install it with brew install go")
  })

  it('diff and error lines', () => {
    expect(diffText({ call: 'numDecodings("226")', expected: 3, got: 4 })).toBe('numDecodings("226"): expected 3, got 4')
    expect(diffText({ call: 'f([1,2])', expected: [1], got: null })).toBe('f([1,2]): expected [1], got nothing')
    expect(errorText({ line: 4, message: 'undefined: x' })).toBe('line 4: undefined: x')
    // cu-final row 14: a missing function is about the whole program, so it carries no meaningless "line 1:"
    expect(errorText({ line: 1, message: 'Define a function named f: def f(x):' })).toBe('Define a function named f: def f(x):')
  })

  it('only a Submit passing 5/5 opens the gate', () => {
    const five = [c(true), c(true), c(true), c(true), c(true)]
    expect(passesGate({ status: 'ok', cases: five }, 'submit')).toBe(true)
    expect(passesGate({ status: 'ok', cases: five }, 'run')).toBe(false)
    expect(passesGate({ status: 'ok', cases: [...five.slice(0, 4), c(false)] }, 'submit')).toBe(false)
    expect(passesGate({ status: 'timeout', cases: five }, 'submit')).toBe(false)
  })
})

describe('recurrence (§5)', () => {
  const dp1 = { name: 'dp', rows: 1, cols: 6 }
  const dp2 = { name: 'dp', rows: 4, cols: 4 }
  it('names cells in 1-D and 2-D', () => {
    expect(cellName(dp1, 0, 3)).toBe('dp[3]')
    expect(cellName(dp2, 2, 3)).toBe('dp[2][3]')
  })
  it('formats the RN-14 example exactly', () => {
    const vals: Record<string, number> = { '0,2': 2, '0,1': 1 }
    expect(recurrenceText(dp1, { i: 0, j: 3, v: 3, deps: [[0, 2], [0, 1]], rule: '{0} + {1}' }, (i, j) => vals[`${i},${j}`] ?? 0))
      .toBe('dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
  })
  it('formats 2-D rules, reused placeholders, no rule and cells outside the table', () => {
    expect(recurrenceText(dp2, { i: 2, j: 3, v: 2, deps: [[1, 3], [2, 2]], rule: 'max({0}, {1})' }, (i, j) => i + j - 2))
      .toBe('dp[2][3] = max(dp[1][3], dp[2][2]) = max(2, 2) = 2')
    expect(recurrenceText(dp1, { i: 0, j: 2, v: 4, deps: [[0, 1]], rule: '{0} + {0}' }, () => 2)).toBe('dp[2] = dp[1] + dp[1] = 2 + 2 = 4')
    expect(recurrenceText(dp1, { i: 0, j: 0, v: 1, deps: [] }, () => 0)).toBe('dp[0] = 1')
    expect(recurrenceText(dp1, { i: 0, j: 1, v: 1, deps: [[0, -1]], rule: '{0} + 1' }, () => null)).toBe('dp[1] = dp[-1] + 1 = ? + 1 = 1')
  })
  it('UAT r4 #11: a single dependency is not repeated: "dp[16] = dp[15] = 4", never "… = 4 = 4"', () => {
    const dp17 = { name: 'dp', rows: 1, cols: 17 }
    expect(recurrenceText(dp17, { i: 0, j: 16, v: 4, deps: [[0, 15]], rule: '{0}' }, () => 4)).toBe('dp[16] = dp[15] = 4')
    expect(recurrenceText(dp17, { i: 0, j: 0, v: 1, deps: [], rule: '1' }, () => 0)).toBe('dp[0] = 1')
    expect(recurrenceText(dp17, { i: 0, j: 2, v: 3, deps: [[0, 1]], rule: '{0}' }, () => 2)).toBe('dp[2] = dp[1] = 2 = 3')
  })
})

// A Fibonacci-shaped bottom-up run: table, two bases, then i=2..n with two reads and a write each.
function bottomUp(n: number, t = 0): Step[] {
  const s: Step[] = [{ op: 'table', t, rows: 1, cols: n + 1, name: 'dp' }, { op: 'set', t, i: 0, j: 0, v: 1, deps: [] }, { op: 'set', t, i: 0, j: 1, v: 1, deps: [] }]
  const v = [1, 1]
  for (let i = 2; i <= n; i++) {
    v[i] = v[i - 1] + v[i - 2]
    s.push({ op: 'get', t, i: 0, j: i - 1, v: v[i - 1] }, { op: 'get', t, i: 0, j: i - 2, v: v[i - 2] })
    s.push({ op: 'set', t, i: 0, j: i, v: v[i], deps: [[0, i - 1], [0, i - 2]], rule: '{0} + {1}' })
  }
  return s
}

describe('DP model (§5)', () => {
  it('knows when there is something to draw', () => {
    expect(hasDp([])).toBe(false)
    expect(hasDp([{ op: 'link', fn: 'f', table: 'dp' }])).toBe(false)
    expect(hasDp(bottomUp(2))).toBe(true)
    expect(hasDp([{ op: 'enter', fn: 'f', args: [1] }])).toBe(true)
  })

  it('shows the table at each step: values, the current cell, its deps and the recurrence', () => {
    const steps = bottomUp(5)
    const m = buildModel(steps)
    expect(m.N).toBe(15)
    const k = steps.findIndex(s => s.op === 'set' && s.j === 3) + 1
    const v = tableAt(m, k)!
    expect(v.current).toEqual([0, 3])
    expect(v.deps).toEqual([[0, 2], [0, 1]])
    expect(v.recurrence).toBe('dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
    expect([...v.values.entries()].sort((a, b) => a[0] - b[0])).toEqual([[0, 1], [1, 1], [2, 2], [3, 3]])
    const before = tableAt(m, k - 1)!
    expect(before.current).toBeNull()
    expect(before.recurrence).toBe('')
    expect(before.values.has(3)).toBe(false)
    expect(tableAt(m, 1)!.values.size).toBe(0)
    expect(tableAt(m, m.N)!.values.get(5)).toBe(8)
  })

  it('follows the table touched last, across cases that recreate it', () => {
    const steps = [...bottomUp(2, 0), ...bottomUp(3, 1)]
    const m = buildModel(steps)
    expect(tableAt(m, 3)!.table.t).toBe(0)
    expect(tableAt(m, m.N)!.table).toMatchObject({ t: 1, cols: 4 })
    expect(tableAt(m, 7)!.values.size).toBe(0) // the second case's fresh table
  })

  it('builds the call tree with hits, depths and returned values', () => {
    const steps: Step[] = [
      { op: 'link', fn: 'f', table: 'dp' },
      { op: 'enter', fn: 'f', args: [3] },
      { op: 'enter', fn: 'f', args: [2] }, { op: 'exit', v: 2 },
      { op: 'hit', fn: 'f', args: [2] },
      { op: 'exit', v: 3 },
      { op: 'enter', fn: 'g', args: [1, 2] }, { op: 'exit', v: 0 },
    ]
    const m = buildModel(steps)
    expect(m.nodes.map(n => [n.n, n.depth, n.hit, n.ret])).toEqual([[2, 0, false, 3], [3, 1, false, 2], [5, 1, true, null], [7, 0, false, 0]])
    expect(nodeText(m.nodes[0], 5)).toBe('f(3)')
    expect(nodeText(m.nodes[0], 6)).toBe('f(3) → 3')
    expect(nodeText(m.nodes[3], 8)).toBe('g(1,2) → 0')
    expect(nodeText(m.nodes[2], 8)).toBe('f(2) (cached)')
    expect(nodesAt(m, 1)).toBe(0)
    expect(nodesAt(m, 4)).toBe(2)
    expect(nodesAt(m, 8)).toBe(4)
    expect(nodeCell(m, m.nodes[0], 'dp')).toEqual([0, 3])
    expect(nodeCell(m, m.nodes[3], 'dp')).toBeNull() // g is not linked
    expect(nodeCell(m, m.nodes[0], 'other')).toBeNull()
    expect(nodeCell(buildModel([{ op: 'link', fn: 'g', table: 'dp' }]), { fn: 'g', args: [1, 2] }, 'dp')).toEqual([1, 2])
    expect(narrate(m, 5)).toBe('cache hit f(2)')
  })

  it('handles 20000 steps quickly', () => {
    const steps: Step[] = [{ op: 'table', t: 0, rows: 1, cols: 10, name: 'dp' }]
    for (let i = 1; i < 20000; i++) steps.push({ op: 'set', t: 0, i: 0, j: i % 10, v: i, deps: [] })
    const t0 = performance.now()
    const m = buildModel(steps)
    for (let k = 19900; k <= 20000; k++) tableAt(m, k)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(tableAt(m, 20000)!.values.get(9)).toBe(19999)
  })

  it('windows a big table around the focus', () => {
    expect(tableWindow({ name: 'dp', rows: 1, cols: 6250 }, [0, 6249], 1, 40)).toEqual({ r0: 0, c0: 6210, R: 1, C: 40 })
    expect(tableWindow({ name: 'dp', rows: 1, cols: 6 }, [0, 3], 1, 40)).toEqual({ r0: 0, c0: 0, R: 1, C: 6 })
    expect(tableWindow({ name: 'dp', rows: 100, cols: 100 }, [50, 0], 20, 20)).toEqual({ r0: 40, c0: 0, R: 20, C: 20 })
  })
})

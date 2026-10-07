// @vitest-environment node
// Security review M1/L2: the verdict is made by the frame from its own cases; the worker's word is display-only.
import { describe, expect, it } from 'vitest'
import { loadJudge, pack, runWorker } from '../helpers/pyRun'

const J = loadJudge()
const CASES = pack('p91').cases.slice(0, 2).map(c => ({ id: c.id, call: c.call, expected: Number(c.expected) }))
const w = (over: Record<string, unknown> = {}) => ({ status: 'ok', cases: [{ id: 1, got: 2 }, { id: 2, got: 3 }], errors: [], stdout: '', steps: [], truncated: false, ms: 5, ...over })

describe('judge: pass is computed from the frame\'s own expected values', () => {
  it('passes a number equal to expected, fails the rest', () => {
    expect(J.judge(CASES, w()).cases.map(c => c.pass)).toEqual([true, true])
    expect(J.judge(CASES, w({ cases: [{ id: 1, got: 2 }, { id: 2, got: 4 }] })).cases.map(c => [c.got, c.pass])).toEqual([[2, true], [4, false]])
    expect(J.judge(CASES, w({ cases: [{ id: 1, got: true }, { id: 2, got: '3' }] })).cases.map(c => c.pass)).toEqual([false, false])
  })
  it('ignores a forged pass or expected from the worker', () => {
    const r = J.judge(CASES, w({ cases: [{ id: 1, got: 99, pass: true, expected: 99 }, { id: 2, got: 98, pass: true }] }))
    expect(r.cases).toEqual([{ id: 1, call: CASES[0].call, expected: 2, got: 99, pass: false }, { id: 2, call: CASES[1].call, expected: 3, got: 98, pass: false }])
  })
  it('a case the worker did not answer is "not run", and a compile error answers nothing', () => {
    expect(J.judge(CASES, w({ cases: [{ id: 1, got: 2 }] })).cases.map(c => [c.got, c.pass])).toEqual([[2, true], [null, false]])
    expect(J.judge(CASES, w({ status: 'compile_error', cases: [{ id: 1, got: 2 }, { id: 2, got: 3 }] })).cases.map(c => c.pass)).toEqual([false, false])
  })
  it('the worker never receives `expected`: the real harness answers with got only', async () => {
    const raw = await runWorker('def numDecodings(s):\n    return 2\n')
    expect(JSON.stringify(raw)).not.toMatch(/expected|"pass"/)
    expect(raw.cases).toEqual([{ id: 1, got: 2 }, { id: 2, got: 2 }])
  })
})

describe('judge: caps (L2)', () => {
  it('an unreadable or unknown result is a runtime error with a message', () => {
    for (const bad of [null, 'x', 5, [], { status: 'weird', steps: [], stdout: '' }, { status: 'ok', steps: 'no', stdout: '' }, { status: 'ok', steps: [], stdout: 3 }]) {
      const r = J.judge(CASES, bad)
      expect(['runtime_error', 'output_limit']).toContain(r.status)
      expect(r.cases.every(c => !c.pass)).toBe(true)
    }
    expect(J.judge(CASES, { status: 'weird', steps: [], stdout: '' }).errors[0].message).toMatch(/unreadable/)
  })
  it('more than 20000 steps, an oversized stdout or message is output_limit, explicitly', () => {
    expect(J.judge(CASES, w({ steps: new Array(20001).fill({ op: 'exit', v: 1 }) })).status).toBe('output_limit')
    expect(J.judge(CASES, w({ steps: new Array(20000).fill({ op: 'exit', v: 1 }) })).status).toBe('ok')
    expect(J.judge(CASES, w({ stdout: 'x'.repeat(J.MAX_STDOUT + 1) })).status).toBe('output_limit')
    expect(J.judge(CASES, w({ errors: [{ line: 1, col: 0, message: 'x'.repeat(13 * 1024 * 1024) }] })).status).toBe('output_limit')
    const r = J.judge(CASES, w({ steps: new Array(20001).fill(0) }))
    expect(r.cases).toHaveLength(2)
  })
  it('long strings and error lists are cut, odd values become null', () => {
    const r = J.judge(CASES, w({ cases: [{ id: 1, got: 'y'.repeat(100000) }, { id: 2, got: { a: 1 } }], errors: Array.from({ length: 80 }, (_, i) => ({ line: i, col: 0, message: 'm'.repeat(10000) })) }))
    expect((r.cases[0].got as string).length).toBe(4096)
    expect(r.cases[1].got).toBeNull()
    expect(r.errors).toHaveLength(50)
    expect(r.errors[0].message.length).toBe(4096)
  })
})

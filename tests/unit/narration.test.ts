// UAT r3 J6 ("Memoization · fib(5)"):
//   - odd steps had a blank caption;
//   - step 1 had no variables and no f5 highlight;
//   - step 7 showed fib(2) on the stack while the tree and the variables were on n = 3.
import { beforeAll, describe, expect, it } from 'vitest'
import type { AlgoJson } from '../../src/rules/algoJson'
import { playerView, viewQuestions } from '../../src/rules/narration'
import { predictQuestions } from '../../src/rules/predict'
import { resolveWalk, type AlgoGlobals } from '../../src/rules/walkthrough'
import { installAlgoEngines } from '../helpers/engines'

/** What the engine shows after `k` engine steps: the top frame, the current tree nodes, the memo row. */
function engineState(raw: AlgoJson, k: number) {
  let frames: string[] = []
  const current = new Set<string>()
  for (const st of raw.steps.slice(0, k)) {
    if (st.op === 'call') frames = [...frames, String(st.frame)]
    if (st.op === 'ret') frames = frames.slice(0, -1)
    if (st.op === 'visit') { if (st.state === 'current') current.add(String(st.n)); else current.delete(String(st.n)) }
  }
  return { top: frames.at(-1) ?? null, current }
}

describe('playerView: the narrated steps the player shows', () => {
  let memo: AlgoJson
  beforeAll(() => {
    installAlgoEngines()
    const r = resolveWalk('memo', undefined, window as unknown as AlgoGlobals)
    if (!r.ok) throw new Error(r.error)
    memo = r.json
  })

  it('memo fib(5): every step has a caption, step 1 is the call with fib(5) highlighted and n = 5', () => {
    const v = playerView(memo)
    // UAT r4 J6: rebuilt to agree with its code (content/pieceOverrides): 9 calls of 3 player steps each
    // UAT r5 J6: fib(5)'s frame stays on the stack for its own return (it has no caller in the code): 50 engine steps
    expect(memo.steps).toHaveLength(50)
    expect(v.json.steps).toHaveLength(27) // frame pushes join their visit, pops their last step, highlight-only steps the next
    expect(v.at).toHaveLength(28)
    expect(v.at[27]).toBe(50)
    expect(v.json.steps.every(s => typeof s.say === 'string' && s.say.length > 0)).toBe(true)
    expect(v.json.steps[0]).toMatchObject({ say: 'Call fib(5).', vars: { n: 5 } })
    const s1 = engineState(memo, v.at[1])
    expect(s1.top).toBe('fib(5)')
    expect(s1.current.has('n0')).toBe(true) // f5
  })

  it('memo fib(5): at every player step the stack top, the caption and n agree', () => {
    const v = playerView(memo)
    const calls = v.json.steps.map((st, i) => [st, i] as const).filter(([st]) => st.op === 'visit' && st.state === 'current')
    expect(calls).toHaveLength(9)
    calls.forEach(([st, i]) => {
      const m = /^Call fib\((\d)\)\.$/.exec(st.say ?? '')!
      const s = engineState(memo, v.at[i + 1])
      expect(s.top, `step ${i + 1}`).toBe(`fib(${m[1]})`)
      expect(st.vars, `step ${i + 1}`).toEqual({ n: Number(m[1]) })
    })
    // the UAT's step 7: one call per step now, so the 4th call (fib(2)) is a step on its own with its own n
    const call2 = v.json.steps.findIndex(s => s.say === 'Call fib(2).')
    expect(engineState(memo, v.at[call2 + 1]).top).toBe('fib(2)')
  })

  it('leaves a fully narrated picture alone, step for step', () => {
    const json: AlgoJson = { structures: { a: { type: 'array', values: [1, 2] } }, steps: [{ op: 'mark', s: 'a', i: 0, say: 'one' }, { op: 'call', s: 'c', frame: 'f', say: 'two' }] }
    const v = playerView(json)
    expect(v.json.steps).toEqual(json.steps)
    expect(v.at).toEqual([0, 1, 2])
  })

  it('memo fib(5): the unnarrated steps say what they did', () => {
    const says = playerView(memo).json.steps.map(s => s.say)
    expect(says.slice(4, 8)).toEqual(['Call fib(1).', 'Base case fib(1) = 1, not stored in memo.', 'fib(1) returns 1.', 'Call fib(0).'])
  })

  it('UAT r4 J6: the walkthrough agrees with its code: base cases return before the memo, only fib(2) and fib(3) are hits', () => {
    const writes = memo.steps.filter(s => s.op === 'set' && s.s === 'memo').map(s => s.i)
    expect(writes).toEqual([2, 3, 4, 5])
    const says = playerView(memo).json.steps.map(s => s.say ?? '')
    expect(says.filter(s => /is in the memo/.test(s))).toEqual(['fib(2) is in the memo: 1. No subtree grows here.', 'fib(3) is in the memo: 2. No subtree grows here.'])
    expect(says.filter(s => s.startsWith('Base case'))).toHaveLength(3) // fib(1), fib(0), and fib(1) again
  })

  it('UAT r4 J6: no two consecutive steps repeat a caption', () => {
    const says = playerView(memo).json.steps.map(s => s.say)
    says.slice(1).forEach((s, i) => expect(s, `steps ${i + 1}/${i + 2}`).not.toBe(says[i]))
  })

  it('UAT r4 J6: on a return the variables are the frame now on top of the stack', () => {
    const v = playerView(memo)
    const ret1 = v.json.steps.findIndex(s => s.say === 'fib(1) returns 1.')
    expect(engineState(memo, v.at[ret1 + 1]).top).toBe('fib(2)')
    expect(v.json.steps[ret1].vars).toEqual({ n: 2 })
    v.json.steps.forEach((st, i) => {
      const top = engineState(memo, v.at[i + 1]).top
      const n = (st.vars as { n?: number } | undefined)?.n
      if (top) expect(`fib(${n})`, `step ${i + 1}: ${st.say}`).toBe(top)
    })
  })

  it('UAT r5 J6: at every step the lit code line belongs to the frame shown (stack top and n); a return shows the caller at its receiving line', () => {
    const v = playerView(memo)
    const code = memo.code ?? []
    const kinds = new Set<string>()
    v.json.steps.forEach((st, i) => {
      const at = `step ${i + 1}: ${st.say}`
      const top = engineState(memo, v.at[i + 1]).top
      const n = (st.vars as { n?: number } | undefined)?.n
      expect(st.line, `${at}: a lit line`).toBeTypeOf('number')
      expect(top, `${at}: a frame on the stack`).not.toBeNull()
      expect(`fib(${n})`, `${at}: n is the stack top's`).toBe(top)
      const say = st.say ?? ''
      const ret = /^fib\((\d)\) returns (\d+)\.$/.exec(say)
      let want: number
      if (/^Call fib\(\d\)\.$/.test(say)) want = 0
      else if (/is in the memo/.test(say)) want = 1
      else if (/^Base case/.test(say)) want = 2
      else if (/^memo\[\d\] = /.test(say)) want = 3
      else if (ret && top !== `fib(${ret[1]})`) want = 3 // back in the caller, on `memo[n] = fib(n-1) + fib(n-2)`
      else if (ret) want = 4 // fib(5), no caller: its own `return memo[n]`
      else throw new Error(`${at}: unexpected caption`)
      kinds.add(ret ? (top === `fib(${ret[1]})` ? 'own return' : 'caller') : String(want))
      expect(st.line, at).toBe(want)
      if (ret && top !== `fib(${ret[1]})`) expect(code[st.line!], at).toMatch(/fib\(n-1\) \+ fib\(n-2\)/)
    })
    expect([...kinds].sort()).toEqual(['0', '1', '2', '3', 'caller', 'own return'])
    expect(v.json.steps.at(-1)).toMatchObject({ say: 'fib(5) returns 5.', line: 4, vars: { n: 5, result: 5 } })
  })

  it('a silent step keeps the last sentence (or the intro) and the last variables; other silent ops keep their own step', () => {
    const json: AlgoJson = {
      intro: 'Start.',
      structures: { a: { type: 'array', values: [1, 2] } },
      steps: [
        { op: 'pointer', s: 'a', name: 'i', i: 0 },
        { op: 'mark', s: 'a', i: 0, state: 'done', say: 'first', vars: { i: 0 }, line: 1 },
        { op: 'pointer', s: 'a', name: 'i', i: 1 },
      ],
    }
    const v = playerView(json)
    expect(v.at).toEqual([0, 1, 2, 3])
    expect(v.json.steps.map(s => s.say)).toEqual(['Start.', 'first', 'first'])
    expect(v.json.steps[2].vars).toBeUndefined() // liveVars carries { i: 0 }
  })

  it('maps each predict question to the player step before its group, first question wins', () => {
    const v = playerView(memo)
    const qs = viewQuestions(predictQuestions(memo), v)
    expect(qs.length).toBeGreaterThan(0)
    const steps = qs.map(q => q.step)
    expect(new Set(steps).size).toBe(steps.length)
    expect(steps.every(s => s >= 0 && s < v.json.steps.length)).toBe(true)
  })
})

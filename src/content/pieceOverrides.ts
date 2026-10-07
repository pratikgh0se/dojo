// UAT r4 J6 #9: Atlas pieces whose worked example disagrees with the code it shows are rebuilt here; the vendored
// pieces (public/engines/atlas-pieces.js) are generated from the design handoff and never edited.
import type { AlgoJson, AlgoStep } from '../rules/algoJson'

/**
 * "Memoization · fib(5)", the same tree, memo row and call stack as the Atlas piece, with the steps the code takes:
 *   - `if n < 2: return n` returns BEFORE any memo write, so memo[1] and memo[0] are never written, and a second
 *     fib(1) is a base case again, not a memo hit (only fib(2) and fib(3) are hits);
 *   - the steps that only move the highlight (the memo cell of a hit, the finished node before its return) join the
 *     step they lead into (`group: 'next'`, rules/narration), so no two steps repeat a caption.
 * UAT r5 J6: the lit code line belongs to the frame shown. A return pops its frame, so "fib(1) returns 1." shows the
 * caller: its stack top, its n and its line that receives the value, `memo[n] = fib(n-1) + fib(n-2)` (the pop carries
 * that line). fib(5) has no caller in the code, so its frame stays on the stack for its own `return memo[n]`.
 */
export function memoFib5(): AlgoJson {
  const steps: AlgoStep[] = []
  const add = (op: string, o: Omit<AlgoStep, 'op'> = {}) => { steps.push({ op, ...o }) }
  const nodes: Record<string, { label: string; children: string[] }> = {}
  let id = 0
  const memo: Record<number, number> = {}
  const code = ['def fib(n):', '  if n in memo: return memo[n]', '  if n < 2: return n', '  memo[n] = fib(n-1) + fib(n-2)', '  return memo[n]']
  /** the caller's line that receives a return value */
  const RECEIVE = 3
  const rec = (n: number, parentId: string | null): number => {
    const me = `n${id++}`
    nodes[me] = { label: `f${n}`, children: [] }
    if (parentId) nodes[parentId].children.push(me)
    // the return of a call: the frame pops back to the caller's receiving line; the root's frame stays for its last line
    const ret = (v: number) => {
      if (parentId) add('ret', { s: 'calls', line: RECEIVE })
      else add('label', { g: 't', n: me, text: v, say: `fib(${n}) returns ${v}.` })
    }
    add('call', { s: 'calls', frame: `fib(${n})`, line: 0 })
    add('visit', { g: 't', n: me, state: 'current', line: 0, say: `Call fib(${n}).`, vars: { n } })
    if (memo[n] !== undefined) {
      add('mark', { s: 'memo', i: n, state: 'visited', line: 1, group: 'next' })
      add('visit', { g: 't', n: me, state: 'visited', line: 1, say: `fib(${n}) is in the memo: ${memo[n]}. No subtree grows here.`, vars: { n, hit: memo[n] } })
      if (parentId) add('label', { g: 't', n: me, text: memo[n] })
      ret(memo[n])
      return memo[n]
    }
    if (n < 2) {
      add('visit', { g: 't', n: me, state: 'done', line: 2, say: `Base case fib(${n}) = ${n}, not stored in memo.` })
      if (parentId) add('label', { g: 't', n: me, text: n })
      ret(n)
      return n
    }
    const a = rec(n - 1, me)
    const b = rec(n - 2, me)
    memo[n] = a + b
    add('set', { s: 'memo', i: n, v: a + b, line: 3, say: `memo[${n}] = ${a} + ${b} = ${a + b}.`, vars: { n, result: a + b } })
    add('visit', { g: 't', n: me, state: 'done', line: 4, group: 'next' })
    if (parentId) add('label', { g: 't', n: me, text: a + b })
    ret(a + b)
    return a + b
  }
  rec(5, null)
  const edges = Object.entries(nodes).flatMap(([p, nd]) => nd.children.map(c => [p, c]))
  return {
    title: 'Memoization · fib(5)',
    complexity: 'O(n) calls · O(n) memo',
    structures: {
      t: { type: 'tree', root: 'n0', nodes, edges, height: 210, caption: 'recursion tree · blue = memo hit' },
      memo: { type: 'array', values: Array(6).fill(null), caption: 'memo[n]' },
      calls: { type: 'stack-frames' },
    },
    code,
    steps,
  }
}

export const PIECE_OVERRIDES: Readonly<Record<string, () => AlgoJson>> = { memo: memoFib5 }

// UAT r3 J6: what the player steps through. The engines apply one op per step, and most walkthroughs
// narrate only some of them, so on "Memoization · fib(5)":
//   - every other caption was blank;
//   - step 1 pushed fib(5) on the call stack with no highlight and no variables;
//   - step 7 showed fib(2) on the stack while the tree and the variables were still on n = 3.
// The player's steps are now groups of engine steps:
//   - an unnarrated `call` (a frame push) joins the step after it, so the push, the highlight, the
//     variables and the sentence arrive together;
//   - an unnarrated `ret` (a frame pop) joins the step before it.
// Every other op keeps its own step. A step with no sentence of its own says what its ops did ("memo[1] = 1.",
// "fib(1) returns 1."), or else keeps the last sentence: the caption never goes blank. The variables carry over
// (liveVars). Pure.
import type { AlgoJson, AlgoStep } from './algoJson'
import type { PredictQuestion } from './predict'

export interface PlayerView {
  /** the steps the player shows (one per group), with the caption, variables and code line of their moment */
  json: AlgoJson
  /** at[k]: how many engine steps are applied at player step k (at[0] = 0, at[n] = every step) */
  at: number[]
}

const silent = (s: AlgoStep) => typeof s.say !== 'string' || s.say.trim() === ''

/** UAT r4 J6: a silent step the walkthrough marks `group: 'next'` (it only moves a highlight) joins the next step. */
const leadsIn = (s: AlgoStep) => silent(s) && (s.op === 'call' || s.group === 'next')

export function playerView(raw: AlgoJson): PlayerView {
  const groups: number[][] = []
  let pending: number[] = []
  raw.steps.forEach((s, i) => {
    if (leadsIn(s)) pending.push(i)
    else if (silent(s) && s.op === 'ret' && pending.length === 0 && groups.length > 0) groups[groups.length - 1].push(i)
    else {
      groups.push([...pending, i])
      pending = []
    }
  })
  if (pending.length > 0) groups.push(pending)

  let said: string | undefined = raw.intro
  let frames: string[] = []
  // UAT r4 J6: with a call stack, the variables are the top frame's: a return shows the caller's again
  const framed = raw.steps.some(s => s.op === 'call' || s.op === 'ret')
  let slots: (AlgoStep['vars'] | undefined)[] = [undefined]
  const steps = groups.map(g => {
    const all = g.map(i => raw.steps[i])
    const lead = [...all].reverse().find(s => !silent(s)) ?? all[all.length - 1]
    const line = [...all].reverse().find(s => s.line != null)?.line
    const before = frames
    for (const st of all) {
      frames = st.op === 'call' ? [...frames, String(st.frame ?? '')] : st.op === 'ret' ? frames.slice(0, -1) : frames
      if (st.op === 'call') slots = [...slots, undefined]
      if (st.vars && Object.keys(st.vars).length > 0) slots = [...slots.slice(0, -1), st.vars]
      if (st.op === 'ret' && slots.length > 1) slots = slots.slice(0, -1)
    }
    const vars = framed ? slots[slots.length - 1] : [...all].reverse().find(s => s.vars && Object.keys(s.vars).length > 0)?.vars
    const own = silent(lead) ? describe(raw, all, before) : lead.say
    const step: AlgoStep = { ...lead }
    if (own) said = own
    if (said !== undefined) step.say = said
    else delete step.say
    if (vars) step.vars = vars
    else delete step.vars
    if (line != null) step.line = line
    return step
  })
  const at = [0]
  for (const g of groups) at.push(g[g.length - 1] + 1)
  return { json: { ...raw, steps }, at }
}

const nodeName = (raw: AlgoJson, g: unknown, n: unknown): string => {
  const nodes = (raw.structures?.[String(g)] as { nodes?: Record<string, { label?: unknown }> } | undefined)?.nodes
  const label = nodes?.[String(n)]?.label
  return label != null && label !== '' ? String(label) : String(n)
}

/** A sentence for a group with no narration of its own, from the ops that change what is read; '' when none. */
function describe(raw: AlgoJson, all: AlgoStep[], frames: string[]): string {
  const out: string[] = []
  const label = all.find(s => s.op === 'label')
  for (const st of all) {
    const on = String(st.s ?? st.g ?? st.on ?? '')
    if (st.op === 'set' && !Array.isArray(st.i)) out.push(`${on}[${String(st.i)}] = ${String(st.v)}.`)
    else if (st.op === 'cell') out.push(`${on}[${String(st.r)}][${String(st.c)}] = ${String(st.v)}.`)
    else if (st.op === 'ret' && frames.length > 0) out.push(`${frames[frames.length - 1]} returns${label ? ` ${String(label.text)}` : ''}.`)
    else if (st.op === 'label' && !all.some(x => x.op === 'ret')) out.push(`${nodeName(raw, st.g ?? st.s, st.n)} = ${String(st.text)}.`)
    else if (st.op === 'push') out.push(`Push ${String(st.v)} onto ${on}.`)
  }
  return out.slice(0, 2).join(' ')
}

/**
 * Predict questions are made from the engine steps (predict.ts replays every op). A question about engine step e
 * is asked at the player step just before the group that contains e; the first question of a group wins.
 */
export function viewQuestions(qs: readonly PredictQuestion[], view: PlayerView): PredictQuestion[] {
  const out = new Map<number, PredictQuestion>()
  for (const q of qs) {
    let p = 0
    while (p + 1 < view.at.length && view.at[p + 1] <= q.step) p++
    if (!out.has(p)) out.set(p, { ...q, step: p })
  }
  return [...out.values()]
}

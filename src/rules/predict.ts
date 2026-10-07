// Predict mode (VISUALIZER "The player → Predict mode"; labs contract §4.4, D-8, D-17).
// The player pauses before the next step and asks what it does. Which steps pause, the question text and
// the choice buttons are derived from that step's op alone, so every walkthrough works without per-entry
// code. Pure: it replays just enough of the step list to know the values on screen.
import type { AlgoJson, AlgoStep } from './algoJson'

/** A run passes at p ≥ 80 (p = correct / Q, rounded down) with at least one question (D-17). */
export const PREDICT_PASS_PERCENT = 80
/** At most this many node buttons on a visit question (D-8). */
export const VISIT_CHOICES = 3

export type PredictKind = 'compare' | 'value' | 'visit' | 'mark' | 'edge'

export interface PredictQuestion {
  /** index of the step asked about: the question is open while the player shows k === step */
  step: number
  kind: PredictKind
  /** the question detail line under "What happens next?" */
  detail: string
  /** button names, in display order */
  choices: string[]
  /** the right button name */
  correct: string
}

const MARK_STATES = ['done', 'bad', 'path', 'pivot'] as const
const MARK_CHOICE: Record<(typeof MARK_STATES)[number], string> = { done: 'Mark done', bad: 'Mark bad', path: 'Mark path', pivot: 'Mark pivot' }

type Cell = unknown
interface SimStruct { values?: Cell[]; rows?: Cell[][]; nodes?: Record<string, { label?: unknown }>; nodeState: Record<string, string> }
type Sim = Record<string, SimStruct>

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const targetOf = (st: AlgoStep) => (st.s ?? st.g ?? st.on) as string | undefined
const isInf = (v: unknown) => v === 'inf' || v === Infinity
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** How the engine prints a value (algo.js `fmt`). */
export const show = (v: unknown): string => (isInf(v) ? '∞' : v == null || v === '' ? '·' : String(v))

function start(json: AlgoJson): Sim {
  const s: Sim = {}
  for (const [name, t] of Object.entries(json.structures ?? {})) {
    const c = clone(t) as unknown as Partial<SimStruct>
    s[name] = { ...c, nodeState: { ...(c.nodeState ?? {}) } }
  }
  return s
}

/** Mirrors algo.js / algo2.js apply() for the ops a later question reads (values, cells, node states). */
function apply(s: Sim, st: AlgoStep): void {
  const t = s[targetOf(st) ?? '']
  if (!t) return
  const i = st.i as number
  switch (st.op) {
    case 'set': if (t.values && !Array.isArray(st.i)) t.values[i] = st.v; break
    case 'swap': if (t.values) { const a = t.values[i]; t.values[i] = t.values[st.j as number]; t.values[st.j as number] = a } break
    case 'push': if (t.values) t.values.push(st.v); break
    case 'pop': if (t.values) t.values.pop(); break
    case 'shift': if (t.values) t.values.shift(); break
    case 'cell': if (t.rows) t.rows[st.r as number][st.c as number] = st.v; break
    case 'visit': for (const n of Array.isArray(st.n) ? st.n : [st.n]) t.nodeState[n as string] = (st.state as string) || 'visited'; break
  }
}

/** ∞ is bigger than any number; strings compare as text; anything else cannot be read off the frame. */
function order(a: unknown, b: unknown): number | null {
  const rank = (v: unknown) => (isInf(v) ? Infinity : isNum(v) ? v : null)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== null && rb !== null) return ra === rb ? 0 : ra > rb ? 1 : -1
  if (typeof a === 'string' && typeof b === 'string' && !isInf(a) && !isInf(b)) return a === b ? 0 : a > b ? 1 : -1
  return null
}

/** v, the slot's current value, v + 1; on a clash v − 1, then v + 2. Numbers ascending, ∞ last. */
function valueChoices(v: unknown, cur: unknown): string[] | null {
  if (isNum(v)) {
    const nums: number[] = [v]
    let inf = false
    if (isInf(cur)) inf = true
    else if (isNum(cur) && cur !== v) nums.push(cur)
    for (const extra of [v + 1, v - 1, v + 2]) {
      if (nums.length + (inf ? 1 : 0) >= 3) break
      if (!nums.includes(extra)) nums.push(extra)
    }
    return [...nums.sort((a, b) => a - b).map(String), ...(inf ? ['∞'] : [])]
  }
  // Non-numeric writes (N-Queens writes "Q" and "."): the value and what the slot holds now, when they differ.
  const a = show(v)
  const b = show(cur)
  return a === b ? null : [a, b].sort()
}

function questionAt(s: Sim, st: AlgoStep, step: number): PredictQuestion | null {
  const t = s[targetOf(st) ?? '']
  if (!t) return null
  switch (st.op) {
    case 'compare': {
      if (st.i === st.j || !t.values) return null
      const x = t.values[st.i as number]
      const y = t.values[st.j as number]
      const o = order(x, y)
      if (o === null) return null
      return {
        step, kind: 'compare',
        detail: `Compare a[${st.i}] = ${show(x)} with a[${st.j}] = ${show(y)}`,
        choices: ['Left bigger', 'Right bigger', 'Equal'],
        correct: o > 0 ? 'Left bigger' : o < 0 ? 'Right bigger' : 'Equal',
      }
    }
    case 'set':
    case 'cell': {
      const cur = st.op === 'set' ? t.values?.[st.i as number] : t.rows?.[st.r as number]?.[st.c as number]
      if (st.op === 'set' && (!t.values || Array.isArray(st.i))) return null
      if (st.op === 'cell' && !t.rows) return null
      const choices = valueChoices(st.v, cur)
      if (!choices) return null
      return { step, kind: 'value', detail: 'What value is written?', choices, correct: show(st.v) }
    }
    case 'visit': {
      const state = (st.state as string) || 'visited'
      if (Array.isArray(st.n) || (state !== 'current' && state !== 'visited')) return null
      const n = st.n as string
      const ids = Object.keys(t.nodes ?? {}).filter(id => id !== n)
      const frontier = ids.filter(id => t.nodeState[id] === 'frontier').sort()
      const fresh = ids.filter(id => !t.nodeState[id]).sort()
      const picked = [n, ...frontier, ...fresh].slice(0, VISIT_CHOICES)
      if (picked.length < 2) return null
      // Buttons show node labels when the picked ones are distinct (memo's n0… read fib(5)…), else ids.
      const labels = picked.map(id => String(t.nodes?.[id]?.label ?? id))
      const name = new Set(labels).size === labels.length ? (id: string) => labels[picked.indexOf(id)] : (id: string) => id
      return { step, kind: 'visit', detail: 'Which node is visited next?', choices: picked.map(name).sort(), correct: name(n) }
    }
    case 'mark':
    case 'cellMark': {
      const state = st.state as (typeof MARK_STATES)[number]
      if (!MARK_STATES.includes(state)) return null
      const others = MARK_STATES.filter(x => x !== state).slice(0, 2)
      const shown = MARK_STATES.filter(x => x === state || others.includes(x))
      return { step, kind: 'mark', detail: 'What happens to this cell?', choices: shown.map(x => MARK_CHOICE[x]), correct: MARK_CHOICE[state] }
    }
    case 'edge': {
      if (st.state !== 'path' && st.state !== 'bad') return null
      return {
        step, kind: 'edge',
        detail: `What happens to edge ${st.u}–${st.v}?`,
        choices: ['Take edge', 'Reject edge', 'Leave edge'],
        correct: st.state === 'path' ? 'Take edge' : 'Reject edge',
      }
    }
    default:
      return null
  }
}

/** Every pausing step of a walkthrough, in step order (Q = the list's length). */
export function predictQuestions(json: AlgoJson): PredictQuestion[] {
  const s = start(json)
  const out: PredictQuestion[] = []
  json.steps.forEach((st, k) => {
    const q = questionAt(s, st, k)
    if (q) out.push(q)
    apply(s, st)
  })
  return out
}

/** `<c> / <Q> · <p>%`, p rounded down; passed when Q ≥ 1 and p ≥ PREDICT_PASS_PERCENT (D-17). */
export function predictResult(correct: number, total: number): { percent: number; passed: boolean } {
  const percent = total > 0 ? Math.floor((correct * 100) / total) : 0
  return { percent, passed: total > 0 && percent >= PREDICT_PASS_PERCENT }
}

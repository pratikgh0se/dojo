// UAT cu-7 P2-1: a model that answers the right question in a slightly wrong shape should not cost the learner a
// failed turn. repairOutput() fixes the shapes seen in practice before validateOutput() judges the result, in the
// client (runJob) and in the helper (parseOutput); whatever it cannot fix still fails validation and is re-asked once.
import { WORD_LIMITS } from './guardrails'
import { LENSES, type JobName } from './types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const SAY_KEYS = ['say', 'message', 'reply', 'text', 'question', 'response'] as const

function numeric(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v)
  return null
}
const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

/** The longest prefix of whole words within the limit, ending where a sentence ends when one does. */
function cutWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= max) return words.join(' ')
  const head = words.slice(0, max).join(' ')
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '))
  return stop > head.length / 2 ? head.slice(0, stop + 1) : head
}

/** An ordinary interview turn: `{say, done:false}`. A model that closes the interview with `done:true`, drops `done`, or names the
 * line differently still said something: use it. */
function repairTurn(o: Obj): Obj {
  if (o.done === false && typeof o.say === 'string' && o.say.trim().split(/\s+/).length <= WORD_LIMITS.interview) return o
  for (const k of SAY_KEYS) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return { say: cutWords(v, WORD_LIMITS.interview), done: false }
  }
  return o
}

/** The final grade: coerce numbers the model wrote as strings or out of range, sum the items for a missing score. */
function repairFinal(o: Obj): Obj {
  const out: Obj = { ...o, done: true }
  if (Array.isArray(o.perItem)) {
    out.perItem = o.perItem
      .filter(isObj)
      .map((p): Obj => ({ ...p, points: numeric(p.points) ?? p.points, note: typeof p.note === 'string' ? p.note : '' }))
      .filter(p => typeof p.item === 'string' && p.item.trim() && typeof p.points === 'number')
  }
  const score = numeric(o.score)
  if (score !== null) out.score = clampInt(score, 0, 20)
  else if (Array.isArray(out.perItem) && out.perItem.length > 0) {
    out.score = clampInt((out.perItem as Obj[]).reduce((a, p) => a + (p.points as number), 0), 0, 20)
  }
  if (Array.isArray(o.deepDives) && o.deepDives.length === 4) {
    out.deepDives = o.deepDives.map(v => { const n = numeric(v); return n === null ? v : clampInt(n, 0, 2) })
  }
  if (isObj(o.lenses)) {
    const lenses: Obj = { ...o.lenses }
    for (const l of LENSES) { const n = numeric(lenses[l]); if (n !== null) lenses[l] = clampInt(n, 0, 2) }
    out.lenses = lenses
  }
  return out
}

/** Pure; never throws. Returns `output` itself when there is nothing to repair. */
export function repairOutput(job: JobName, req: { context?: unknown }, output: unknown): unknown {
  if (job !== 'interview' || !isObj(output)) return output
  const final = isObj(req.context) && req.context.final === true
  return final ? repairFinal(output) : repairTurn(output)
}

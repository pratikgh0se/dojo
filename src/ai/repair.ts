// UAT cu-7 P2-1: a model that answers the right question in a slightly wrong shape should not cost the learner a
// failed turn. repairOutput() fixes the shapes seen in practice before validateOutput() judges the result, in the
// client (runJob) and in the helper (parseOutput); whatever it cannot fix still fails validation and is re-asked once.
import {
  GRADE_EVIDENCE_MAX, GRADE_EVIDENCE_TARGET_MAX, GRADE_FEEDBACK_MAX_WORDS, MISSED_ANSWER_MAX_WORDS, MISSED_MAX, MISSED_QUESTION_MAX_WORDS,
  MISSED_TOPIC_MAX_WORDS, WORD_LIMITS,
} from './guardrails'
import { LENSES, noteEvidenceId, type JobName } from './types'

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

/** F3: a grade item's feedback trimmed to 60 words and its evidence cleaned (unknown notes section, bad shape, empty or oversize target);
 * a field that is missing or unusable is simply absent. */
function repairItemExtras(p: Obj): Obj {
  const out: Obj = { ...p }
  delete out.feedback
  delete out.evidence
  if (typeof p.feedback === 'string' && p.feedback.trim()) out.feedback = cutWords(p.feedback, GRADE_FEEDBACK_MAX_WORDS)
  if (Array.isArray(p.evidence)) {
    const ev: Obj[] = []
    for (const e of p.evidence) {
      if (!isObj(e) || typeof e.target !== 'string' || !e.target.trim()) continue
      if (e.source === 'notes') {
        const id = noteEvidenceId(e.target)
        if (id) ev.push({ source: 'notes', target: id })
      } else if (e.source === 'diagram') ev.push({ source: 'diagram', target: e.target.trim().slice(0, GRADE_EVIDENCE_TARGET_MAX) })
    }
    if (ev.length > 0) out.evidence = ev.slice(0, GRADE_EVIDENCE_MAX)
  }
  return out
}

/** F3: the weak spots, each field trimmed to its word cap; an incomplete entry is dropped and an empty list is absent. */
function repairMissed(v: unknown): Obj[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Obj[] = []
  for (const m of v) {
    if (!isObj(m) || [m.topic, m.question, m.answer].some(x => typeof x !== 'string' || !x.trim())) continue
    out.push({
      topic: cutWords(m.topic as string, MISSED_TOPIC_MAX_WORDS),
      question: cutWords(m.question as string, MISSED_QUESTION_MAX_WORDS),
      answer: cutWords(m.answer as string, MISSED_ANSWER_MAX_WORDS),
    })
  }
  return out.length > 0 ? out.slice(0, MISSED_MAX) : undefined
}

/** The final grade: coerce numbers the model wrote as strings or out of range, sum the items for a missing score. */
function repairFinal(o: Obj): Obj {
  const out: Obj = { ...o, done: true }
  if (Array.isArray(o.perItem)) {
    out.perItem = o.perItem
      .filter(isObj)
      .map((p): Obj => ({ ...p, points: numeric(p.points) ?? p.points, note: typeof p.note === 'string' ? p.note : '' }))
      .filter(p => typeof p.item === 'string' && p.item.trim() && typeof p.points === 'number')
      .map(repairItemExtras)
  }
  delete out.missed
  const missed = repairMissed(o.missed)
  if (missed) out.missed = missed
  const score = numeric(o.score)
  if (score !== null) out.score = clampInt(score, 0, 20)
  // the five items are the score: a model that adds them up wrongly (or leaves the sum out) is corrected, not failed
  if (Array.isArray(out.perItem) && (out.perItem as Obj[]).length > 0) {
    out.score = clampInt((out.perItem as Obj[]).reduce((a, p) => a + (p.points as number), 0), 0, 20)
  }
  for (const [k, max] of [['inconsistencies', 5], ['stronger', 4]] as const) {
    if (Array.isArray(o[k])) out[k] = (o[k] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max)
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

/** Pure; never throws. Returns `output` itself when there is nothing to repair. A design session's final grade comes through the
 * grade job (`context.sessionGrade`); an artifact grade is never touched. */
export function repairOutput(job: JobName, req: { context?: unknown }, output: unknown): unknown {
  if (!isObj(output)) return output
  const ctx = isObj(req.context) ? req.context : {}
  if (job === 'grade') return ctx.sessionGrade === true ? repairFinal(output) : output
  if (job !== 'interview') return output
  return ctx.final === true ? repairFinal(output) : repairTurn(output)
}

// R1 W6: the Design and AI question banks on /banks (contract trees-and-banks.md BANK-04 to BANK-24). Pure: no React, no Dexie.
import type { BankArea, BankExtraRow, BankGrade, BankGradeRow, BankPiece, PlanQuestion, QuestionType, Redo } from '../data/types'
import { addLocalDays, localDayKey } from '../lib/dates'
import type { BankMoreQuestion } from '../ai/types'

export const BANK_AREAS: readonly BankArea[] = ['design', 'ai']
export const QUESTION_TYPES: readonly QuestionType[] = ['concept', 'estimate', 'tradeoff', 'design']
export const LEVELS: readonly number[] = [1, 2, 3, 4, 5]
export const GRADES: readonly BankGrade[] = ['again', 'hard', 'good', 'easy']
export const TYPE_LABEL: Record<QuestionType, string> = { concept: 'Concept', estimate: 'Estimate', tradeoff: 'Trade-off', design: 'Design' }
export const GRADE_LABEL: Record<BankGrade, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' }
export const AREA_LABEL: Record<BankArea, string> = { design: 'Design', ai: 'AI' }
/** BANK-14: a bank question added to Review comes back three local days later. */
export const BANK_REDO_DAYS = 3

/** What the list needs of a plan node. */
export interface NodeRef { id: string; area: string; title: string }

/** A question as the list and the practice panel see it: shipped (from `qbank[]`) or AI-made (a `bankExtra` row). */
export type Question = PlanQuestion & { aiMade?: true }

const isBankArea = (a: string | null): a is BankArea => a === 'design' || a === 'ai'
export const bankAreaOf = (v: string | null): BankArea | null => (isBankArea(v) ? v : null)

/**
 * The questions of one area, shipped plus AI-made, ordered by the node's place in the plan, then difficulty ascending, then id (BANK-04).
 * A question whose node is not in the plan is left out (the list could not name it).
 */
export function questionsOf(area: BankArea, qbank: readonly PlanQuestion[] | undefined, extra: readonly BankExtraRow[] | undefined, nodes: readonly NodeRef[]): Question[] {
  const rank = new Map(nodes.map((n, i) => [n.id, i]))
  const shipped: Question[] = (qbank ?? []).filter(q => q.area === area).map(q => ({ ...q }))
  const made: Question[] = (extra ?? []).filter(q => q.area === area).map(({ aiMade, at: _at, ...q }): Question => ({ ...q, ...(aiMade ? { aiMade: true as const } : {}) }))
  return [...shipped, ...made]
    .filter(q => rank.has(q.node))
    .sort((a, b) => rank.get(a.node)! - rank.get(b.node)! || a.difficulty - b.difficulty || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** TREE-22, TREE-23, TREE-25: how many questions a node has (shipped plus AI-made). A DSA node has none (TREE-24); a node's bank is Design for a Design node, AI for any other. */
export function nodeQuestionCount(node: { id: string; area: string }, qbank: readonly PlanQuestion[] | undefined, extra: readonly BankExtraRow[] | undefined): { area: BankArea; count: number } | null {
  if (node.area === 'dsa') return null
  const area: BankArea = node.area === 'design' ? 'design' : 'ai'
  const mine = (q: { node: string; area: string }): boolean => q.node === node.id && q.area === area
  return { area, count: (qbank ?? []).filter(mine).length + (extra ?? []).filter(mine).length }
}

/** The nodes of the area that have at least one question, in plan order (the options of `banks-q-filter-node`). */
export function nodesWithQuestions(qs: readonly Question[], nodes: readonly NodeRef[]): NodeRef[] {
  const has = new Set(qs.map(q => q.node))
  return nodes.filter(n => has.has(n.id))
}

export interface QFilters { node: string; type: string; level: string }
export const NO_FILTERS: QFilters = { node: '', type: '', level: '' }
export const filtersSet = (f: QFilters): boolean => f.node !== '' || f.type !== '' || f.level !== ''

/** The three filters out of the address (BANK-06: `node`, `type`, `diff`; absent means all) (`node`, `type`, `diff`). A value the area does not offer reads as "all". */
export function filtersFromParams(p: URLSearchParams, qs: readonly Question[]): QFilters {
  const nodes = new Set(qs.map(q => q.node))
  const node = p.get('node') ?? ''
  const type = p.get('type') ?? ''
  const level = p.get('diff') ?? ''
  return {
    node: nodes.has(node) ? node : '',
    type: (QUESTION_TYPES as readonly string[]).includes(type) ? type : '',
    level: LEVELS.map(String).includes(level) ? level : '',
  }
}

/** The address with the filters written (a filter that is "all" is left out); every other parameter is kept. */
export function paramsWithFilters(p: URLSearchParams, f: QFilters): URLSearchParams {
  const next = new URLSearchParams(p)
  for (const [k, v] of [['node', f.node], ['type', f.type], ['diff', f.level]] as const) {
    if (v) next.set(k, v)
    else next.delete(k)
  }
  return next
}

/** BANK-05: a question must match every chosen filter. */
export const applyFilters = (qs: readonly Question[], f: QFilters): Question[] =>
  qs.filter(q => (!f.node || q.node === f.node) && (!f.type || q.type === f.type) && (!f.level || String(q.difficulty) === f.level))

const gradeById = (grades: readonly BankGradeRow[]): Map<string, BankGradeRow> => new Map(grades.map(g => [g.id, g]))

/** BANK-17: seen is the number of questions of the list that have a grade row (a grade whose question is gone does not count). */
export function progressOf(qs: readonly Question[], grades: readonly BankGradeRow[]): { seen: number; total: number } {
  const by = gradeById(grades)
  return { seen: qs.filter(q => by.has(q.id)).length, total: qs.length }
}
export function nodeProgress(qs: readonly Question[], grades: readonly BankGradeRow[], node: string): { seen: number; total: number } {
  return progressOf(qs.filter(q => q.node === node), grades)
}

/** BANK-04: "Not seen" or "Last: Again|Hard|Good|Easy". */
export const statusText = (g: Pick<BankGradeRow, 'grade'> | undefined): string => (g ? `Last: ${GRADE_LABEL[g.grade]}` : 'Not seen')

/** BANK-11, BANK-12: the one grade row of a question. A first grade has tries 1; a regrade keeps the id and adds one try. */
export function gradeRow(prev: BankGradeRow | undefined, q: Pick<Question, 'id' | 'area' | 'node'>, grade: BankGrade, at: number): BankGradeRow {
  return { id: q.id, area: q.area, node: q.node, grade, at, tries: (prev?.tries ?? 0) + 1 }
}

/** BANK-13: Again and Hard offer Add to Review. */
export const offersReview = (g: BankGrade): boolean => g === 'again' || g === 'hard'

export const bankRedoId = (qid: string, at: number): string => `r-bankq-${qid}-${at}`

/** BANK-14: the check redo for a question: source `bank_q`, `ticketId` the question id, stage 0, due three local days after `now`. */
export function bankRedoFor(q: Pick<Question, 'id' | 'question' | 'answer'>, topic: string, now: number): Redo {
  const piece: BankPiece = { topic, question: q.question, answer: q.answer, qid: q.id }
  return { id: bankRedoId(q.id, now), ticketId: q.id, source: 'bank_q', createdAt: now, stage: 0, due: localDayKey(addLocalDays(now, BANK_REDO_DAYS)), passed: [], helpCost: 0, refunded: 0, piece }
}

/** At most one open `bank_q` redo per question (BANK-14). */
export const openBankRedo = (redos: readonly Redo[], qid: string): Redo | undefined =>
  redos.find(r => r.source === 'bank_q' && r.ticketId === qid && r.closedAt === undefined)

export const isBankRedo = (r: Pick<Redo, 'source'>): boolean => r.source === 'bank_q'

/** The piece of a `bank_q` redo, when it holds one. */
export function bankPieceOf(r: Pick<Redo, 'piece'>): BankPiece | null {
  const p = r.piece
  return p && typeof p === 'object' && 'qid' in p && typeof p.qid === 'string' && typeof p.question === 'string' && typeof p.answer === 'string' ? (p as BankPiece) : null
}

/**
 * BANK-19: the `bankExtra` rows for what the job returned. Ids are `x-<node>-<time>-<n>` and never equal an id in `taken`
 * (every shipped and AI-made id), so they stay unique across `qbank[]` and `bankExtra`.
 */
export function extraRowsFrom(out: readonly BankMoreQuestion[], where: { area: BankArea; node: string }, at: number, taken: ReadonlySet<string>): BankExtraRow[] {
  const used = new Set(taken)
  return out.map((q, i): BankExtraRow => {
    let n = i + 1
    let id = `x-${where.node}-${at.toString(36)}-${n}`
    while (used.has(id)) id = `x-${where.node}-${at.toString(36)}-${++n}`
    used.add(id)
    return { id, area: where.area, node: where.node, type: q.type, difficulty: q.difficulty, question: q.question.trim(), answer: q.answer.trim(), checklist: q.checklist.map(c => c.trim()), aiMade: true, at }
  })
}

/** What the job is told to avoid repeating: the text of the node's questions, each clipped. */
export function avoidList(qs: readonly Question[], node: string, max = 40, clip = 160): string[] {
  return qs.filter(q => q.node === node).slice(0, max).map(q => (q.question.length > clip ? `${q.question.slice(0, clip - 1)}…` : q.question))
}

/** Where a `bank_q` card finds its question's area: by question id, then (when the question has been deleted) by the node title it was filed under. */
export type BankAreaOf = (qid: string, topic: string) => BankArea
export function bankAreaResolver(qbank: readonly PlanQuestion[] | undefined, extra: readonly BankExtraRow[] | undefined, nodes: readonly NodeRef[]): BankAreaOf {
  const byId = new Map<string, BankArea>([...(qbank ?? []).map(q => [q.id, q.area] as const), ...(extra ?? []).map(q => [q.id, q.area] as const)])
  return (qid, topic) => {
    const known = byId.get(qid)
    if (known) return known
    const node = nodes.find(n => n.title === topic)
    return node?.area === 'design' ? 'design' : 'ai'
  }
}

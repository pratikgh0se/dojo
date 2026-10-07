// Output validation for every job and either provider (spec §4.4). An empty list means valid.
// Engine constants are copies of the frozen lab sources; ai-validate.test.ts re-derives them from
// the handoff files so they cannot drift.
import { isAtlasPattern } from '../content/patterns'
import { PICTURE_LIMITS, SRALGO2_OPS, SRALGO2_TYPES, SRALGO_OPS, SRALGO_TYPES } from './engineSpec'

export { PICTURE_LIMITS, SRALGO2_OPS, SRALGO2_TYPES, SRALGO_OPS, SRALGO_TYPES }
import { SOLUTION_PSEUDOCODE_MAX_LINES, WORD_LIMITS, wordCount } from './guardrails'
import { DAY_TYPES, DELIVERABLE_KINDS, LENSES, type JobName, type SrAlgoJson } from './types'

export const DIAGRAM_KINDS = [
  'browser', 'phone', 'desktop', 'cli', 'cdn', 'dns', 'gateway', 'lb', 'webhook', 'service', 'function', 'worker', 'cron', 'process',
  'queue', 'stream', 'cache', 'sql', 'nosql', 'vector', 'search', 'storage', 'fs', 'table', 'auth', 'secrets', 'config', 'monitor',
  'llm', 'agent', 'gpu', 'external', 'human', 'state', 'start', 'end', 'decision', 'doc',
] as const
export const LINK_KINDS = ['sync', 'async', 'stream', 'batch', 'replication', 'cacheHit', 'cacheMiss', 'retry', 'timeout', 'failover', 'talk', 'read', 'write'] as const
export const PACKET_KINDS = ['json', 'row', 'blob', 'envelope', 'token', 'event', 'error', 'request', 'response', 'file'] as const
export const ZONE_KINDS = ['region', 'az', 'vpc', 'trust', 'tenant', 'team', 'system', 'boundary'] as const
export const DIAGRAM_LAYOUTS = ['layered', 'grid', 'manual'] as const

export const DIAGRAM_MAX_NODES = 14

const OPS = new Set<string>([...SRALGO_OPS, ...SRALGO2_OPS])
const TYPES = new Set<string>([...SRALGO_TYPES, ...SRALGO2_TYPES])
const ALGO2_ONLY = new Set<string>(SRALGO2_TYPES)
const KINDS = new Set<string>(DIAGRAM_KINDS)
const LINKS = new Set<string>(LINK_KINDS)
const PACKETS = new Set<string>(PACKET_KINDS)
const ZONES = new Set<string>(ZONE_KINDS)
/** SEC-D-01: no markup in the picture's header text. Code lines and narration may say `a < b`: they are only ever text. */
const ANGLE = /[<>]/
/** VISUALIZER: pseudocode only, no language keywords beyond for / while / if / return. */
const NOT_PSEUDOCODE = /\b(def|function|const|let|var|class|import|lambda|public|static)\b|=>/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const is012 = (v: unknown) => v === 0 || v === 1 || v === 2
const isInt = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

function headerText(e: string[], field: string, v: string, max: number) {
  if (v.length > max) e.push(`${field} is ${v.length} characters (max ${max})`)
  if (ANGLE.test(v)) e.push(`${field} contains < or >`)
}

export function validatePicture(j: unknown): string[] {
  if (!isObj(j)) return ['picture is not an object']
  const e: string[] = []
  if (!isStr(j.title)) e.push('title missing')
  else headerText(e, 'title', j.title, PICTURE_LIMITS.titleChars)
  if (j.complexity != null) {
    if (typeof j.complexity !== 'string') e.push('complexity is not a string')
    else headerText(e, 'complexity', j.complexity, PICTURE_LIMITS.complexityChars)
  }
  const structs = isObj(j.structures) ? Object.entries(j.structures) : []
  if (structs.length === 0) e.push('structures missing')
  if (structs.length > PICTURE_LIMITS.structures) e.push(`${structs.length} structures (max ${PICTURE_LIMITS.structures})`)
  else {
    for (const [name, s] of structs) {
      if (!isObj(s) || typeof s.type !== 'string' || !TYPES.has(s.type)) {
        e.push(`structure ${name}: unknown type ${isObj(s) ? String(s.type) : '?'}`)
        continue
      }
      if (Array.isArray(s.values) && s.values.length > PICTURE_LIMITS.arrayItems) e.push(`structure ${name}: ${s.values.length} items (max ${PICTURE_LIMITS.arrayItems})`)
      const nodes = Array.isArray(s.nodes) ? s.nodes.length : isObj(s.nodes) ? Object.keys(s.nodes).length : 0
      if ((s.type === 'graph' || s.type === 'tree') && nodes > PICTURE_LIMITS.nodes) e.push(`structure ${name}: ${nodes} nodes (max ${PICTURE_LIMITS.nodes})`)
      if (s.type === 'grid' && Array.isArray(s.rows)) {
        const rows = s.rows as unknown[]
        if (rows.length > PICTURE_LIMITS.gridSide || rows.some(r => Array.isArray(r) && r.length > PICTURE_LIMITS.gridSide)) {
          e.push(`structure ${name}: grid larger than ${PICTURE_LIMITS.gridSide}×${PICTURE_LIMITS.gridSide}`)
        }
      }
    }
  }
  if (!Array.isArray(j.steps)) e.push('steps missing')
  else {
    const n = j.steps.length
    if (n < PICTURE_LIMITS.minSteps || n > PICTURE_LIMITS.maxSteps) e.push(`${n} steps (need ${PICTURE_LIMITS.minSteps}–${PICTURE_LIMITS.maxSteps})`)
    j.steps.forEach((st: unknown, i: number) => {
      if (!isObj(st) || typeof st.op !== 'string' || !OPS.has(st.op)) e.push(`step ${i + 1}: unknown op ${isObj(st) ? String(st.op) : '?'}`)
      else if (!isStr(st.say)) e.push(`step ${i + 1}: say missing`)
    })
  }
  if (j.code !== undefined) {
    if (!isStrList(j.code)) e.push('code is not a list of lines')
    else {
      if (j.code.length > PICTURE_LIMITS.codeLines) e.push(`${j.code.length} code lines (max ${PICTURE_LIMITS.codeLines})`)
      const bad = j.code.find(l => NOT_PSEUDOCODE.test(l))
      if (bad !== undefined) e.push(`code is not pseudocode: ${bad}`)
    }
  }
  return e
}

/** sr-algo2 renders only its five extra structure types; everything else is sr-algo. */
export function pictureEngine(j: SrAlgoJson): 'algo' | 'algo2' {
  return Object.values(j.structures).some(s => ALGO2_ONLY.has(s.type)) ? 'algo2' : 'algo'
}

export function validateDiagram(j: unknown, maxNodes: number = DIAGRAM_MAX_NODES): string[] {
  if (!isObj(j)) return ['diagram is not an object']
  const e: string[] = []
  if (!(DIAGRAM_LAYOUTS as readonly unknown[]).includes(j.layout)) e.push(`layout ${String(j.layout)} (need layered, grid or manual)`)
  const nodes = Array.isArray(j.nodes) ? j.nodes : []
  if (nodes.length < 1 || nodes.length > maxNodes) e.push(`${nodes.length} nodes (need 1–${maxNodes})`)
  const ids = new Set<string>()
  for (const n of nodes) {
    if (!isObj(n) || !isStr(n.id)) { e.push('node without id'); continue }
    if (typeof n.kind !== 'string' || !KINDS.has(n.kind)) e.push(`node ${n.id}: unknown kind ${String(n.kind)}`)
    if (typeof n.label !== 'string') e.push(`node ${n.id}: label missing`)
    if (ids.has(n.id)) e.push(`duplicate node id ${n.id}`)
    ids.add(n.id)
  }
  if (!Array.isArray(j.links)) e.push('links missing')
  else for (const l of j.links) {
    if (!isObj(l)) { e.push('link is not an object'); continue }
    const name = `link ${String(l.from)}→${String(l.to)}`
    if (!ids.has(String(l.from)) || !ids.has(String(l.to))) e.push(`${name}: unknown node`)
    if (typeof l.kind !== 'string' || !LINKS.has(l.kind)) e.push(`${name}: unknown kind ${String(l.kind)}`)
  }
  if (j.zones !== undefined) {
    if (!Array.isArray(j.zones)) e.push('zones is not a list')
    else for (const z of j.zones) {
      if (!isObj(z)) { e.push('zone is not an object'); continue }
      if (typeof z.kind !== 'string' || !ZONES.has(z.kind)) e.push(`zone ${String(z.label)}: unknown kind ${String(z.kind)}`)
      for (const id of Array.isArray(z.nodes) ? z.nodes : []) if (!ids.has(String(id))) e.push(`zone ${String(z.label)}: unknown node ${String(id)}`)
    }
  }
  if (j.flows !== undefined) {
    if (!Array.isArray(j.flows)) e.push('flows is not a list')
    else j.flows.forEach((f: unknown, i: number) => {
      if (!isObj(f) || !Array.isArray(f.path)) { e.push(`flow ${i + 1}: path missing`); return }
      for (const id of f.path) if (!ids.has(String(id))) e.push(`flow ${i + 1}: unknown node ${String(id)}`)
      if (f.packet !== undefined && (typeof f.packet !== 'string' || !PACKETS.has(f.packet))) e.push(`flow ${i + 1}: unknown packet ${String(f.packet)}`)
    })
  }
  return e
}

const isReasonList = (v: unknown) => Array.isArray(v) && v.every(r => isObj(r) && isStr(r.id) && isStr(r.reason))

function validateInterview(o: Obj): string[] {
  if (o.done === false) {
    if (!isStr(o.say)) return ['say missing']
    const n = wordCount(o.say)
    return n > WORD_LIMITS.interview ? [`say is ${n} words (max ${WORD_LIMITS.interview})`] : []
  }
  if (o.done !== true) return ['done must be true or false']
  const e: string[] = []
  if (!isInt(o.score, 0, 20)) e.push('score must be 0–20')
  if (!Array.isArray(o.perItem) || !o.perItem.every(p => isObj(p) && isStr(p.item) && typeof p.points === 'number' && typeof p.note === 'string')) e.push('perItem must be a list of {item, points, note}')
  if (typeof o.oneThingToStudy !== 'string') e.push('oneThingToStudy missing')
  if (!Array.isArray(o.deepDives) || o.deepDives.length !== 4 || !o.deepDives.every(is012)) e.push('deepDives must be four 0/1/2 scores')
  if (!isObj(o.lenses) || !LENSES.every(l => is012((o.lenses as Obj)[l]))) e.push('lenses must score all seven lenses 0/1/2')
  return e
}

function validateGrade(o: Obj): string[] {
  const e: string[] = []
  if (!isInt(o.score, 0, 5)) e.push('score must be 0–5')
  if (o.max !== 5) e.push('max must be 5')
  if (typeof o.passed !== 'boolean' || o.passed !== (typeof o.score === 'number' && o.score >= 3 && o.score <= 5)) e.push('passed must be score ≥ 3')
  if (!isStrList(o.feedback)) e.push('feedback must be a list of strings')
  else {
    if (o.feedback.length > 3) e.push(`feedback has ${o.feedback.length} items (max 3)`)
    const words = wordCount(o.feedback.join(' '))
    if (words > WORD_LIMITS.grade) e.push(`feedback is ${words} words (max ${WORD_LIMITS.grade})`)
  }
  if (!isStrList(o.missing)) e.push('missing must be a list of strings')
  if (o.commitFound !== undefined && typeof o.commitFound !== 'boolean') e.push('commitFound must be a boolean')
  return e
}

function validateSolution(o: Obj): string[] {
  const e: string[] = []
  if (!isStr(o.approach)) e.push('approach missing')
  else if (wordCount(o.approach) > WORD_LIMITS.solution) e.push(`approach is ${wordCount(o.approach)} words (max ${WORD_LIMITS.solution})`)
  if (!isStrList(o.pseudocode)) e.push('pseudocode must be a list of lines')
  else if (o.pseudocode.length > SOLUTION_PSEUDOCODE_MAX_LINES) e.push(`${o.pseudocode.length} pseudocode lines (max ${SOLUTION_PSEUDOCODE_MAX_LINES})`)
  if (!isStr(o.complexity)) e.push('complexity missing')
  if (!Array.isArray(o.quiz) || o.quiz.length !== 3 || !o.quiz.every(q => isObj(q) && isStr(q.q) && isStr(q.a))) e.push('quiz must have 3 {q, a} items')
  return e
}

function validateClassify(o: Obj): string[] {
  const e: string[] = []
  if (!isStr(o.title)) e.push('title missing')
  if (!isAtlasPattern(o.pattern)) e.push(`pattern ${String(o.pattern)} is not an Atlas label`)
  if (o.difficulty !== 'E' && o.difficulty !== 'M' && o.difficulty !== 'H') e.push('difficulty must be E, M or H')
  if (!isStr(o.source)) e.push('source missing')
  if (o.note !== undefined && typeof o.note !== 'string') e.push('note must be a string')
  if (o.approaches !== undefined) {
    if (!Array.isArray(o.approaches) || o.approaches.length < 2 || o.approaches.length > 4) e.push('approaches must have 2–4 entries')
    else o.approaches.forEach((a: unknown, i: number) => {
      if (!isObj(a) || !isStr(a.name) || !isStr(a.complexity)) { e.push(`approach ${i + 1}: needs name and complexity`); return }
      if (wordCount(a.name) > 4) e.push(`approach ${i + 1}: name over 4 words`)
      if (a.pattern !== null && !isAtlasPattern(a.pattern)) e.push(`approach ${i + 1}: pattern ${String(a.pattern)} is not an Atlas label`)
    })
  }
  return e
}

const isHttpUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v)
export const BRIEF_LIMITS = { steps: 12, minMinutes: 5, maxMinutes: 480, splitMin: 2, splitMax: 8, splitPartMin: 10, splitPartMax: 180 } as const
export const REVIEW_MAX_WORDS = 250

export function validateBrief(o: Obj): string[] {
  const e: string[] = []
  if (!isStr(o.goal)) e.push('goal missing')
  if (!Array.isArray(o.steps) || o.steps.length < 1 || o.steps.length > BRIEF_LIMITS.steps) e.push(`steps must be 1-${BRIEF_LIMITS.steps} items`)
  else o.steps.forEach((st: unknown, i: number) => {
    if (!isObj(st) || !isStr(st.text)) e.push(`step ${i + 1}: text missing`)
    else if (st.url !== undefined && !isHttpUrl(st.url)) e.push(`step ${i + 1}: url must be http(s)`)
  })
  if (!isInt(o.minutes, BRIEF_LIMITS.minMinutes, BRIEF_LIMITS.maxMinutes)) e.push(`minutes must be ${BRIEF_LIMITS.minMinutes}-${BRIEF_LIMITS.maxMinutes}`)
  if (!(DAY_TYPES as readonly unknown[]).includes(o.dayType)) e.push('dayType must be focus, light or long')
  if (!isStrList(o.learn)) e.push('learn must be a list of strings')
  if (!isStr(o.outcome)) e.push('outcome missing')
  const d = o.deliverable
  if (!isObj(d) || !(DELIVERABLE_KINDS as readonly unknown[]).includes(d.kind) || !isStr(d.prompt)) e.push('deliverable needs a kind and a prompt')
  const qs = Array.isArray(o.questions) ? o.questions : null
  if (!qs) e.push('questions must be a list')
  else {
    const ids = new Set<string>()
    for (const q of qs) {
      if (!isObj(q) || !isStr(q.id) || !isStr(q.q) || (q.kind !== 'open' && q.kind !== 'mcq')) { e.push('question needs id, kind and q'); continue }
      if (ids.has(q.id)) e.push(`duplicate question id ${q.id}`)
      ids.add(q.id)
      if (q.keyIdeas !== undefined && !isStrList(q.keyIdeas)) e.push(`question ${q.id}: keyIdeas must be a list of strings`)
      if (q.kind === 'mcq') {
        const ch = Array.isArray(q.choices) ? q.choices : []
        if (ch.length < 2 || !ch.every(isStr)) e.push(`question ${q.id}: an mcq needs at least 2 choices`)
        else if (!isInt(q.correct, 0, ch.length - 1)) e.push(`question ${q.id}: correct must index a choice`)
      }
    }
    if (isObj(d) && d.kind === 'answers' && qs.length === 0) e.push('an answers deliverable needs at least one question')
  }
  if (o.split !== undefined) {
    const sp = o.split
    if (!Array.isArray(sp) || sp.length < BRIEF_LIMITS.splitMin || sp.length > BRIEF_LIMITS.splitMax) e.push(`split needs ${BRIEF_LIMITS.splitMin}-${BRIEF_LIMITS.splitMax} parts`)
    else if (!sp.every(p => isObj(p) && isStr(p.title) && isInt(p.minutes, BRIEF_LIMITS.splitPartMin, BRIEF_LIMITS.splitPartMax))) e.push('every split part needs a title and minutes')
  }
  return e
}

const VERDICTS = ['pass', 'partial', 'fail']
function validateCheck(o: Obj): string[] {
  if (!Array.isArray(o.results) || o.results.length === 0) return ['results must be a non-empty list']
  const e: string[] = []
  o.results.forEach((r: unknown, i: number) => {
    if (!isObj(r) || !isStr(r.id)) { e.push(`result ${i + 1}: id missing`); return }
    if (typeof r.verdict !== 'string' || !VERDICTS.includes(r.verdict)) e.push(`result ${i + 1}: verdict must be pass, partial or fail`)
    if (typeof r.correction !== 'string' || typeof r.pointer !== 'string') e.push(`result ${i + 1}: correction and pointer must be strings`)
  })
  return e
}

export function validateOutput(job: JobName, output: unknown): string[] {
  if (job === 'picture') return validatePicture(output)
  if (job === 'diagram') return validateDiagram(output)
  if (!isObj(output)) return [`${job} output is not an object`]
  switch (job) {
    case 'hint': {
      if (!isStr(output.hint)) return ['hint missing']
      const n = wordCount(output.hint)
      return n > WORD_LIMITS.hint ? [`hint is ${n} words (max ${WORD_LIMITS.hint})`] : []
    }
    case 'interview': return validateInterview(output)
    case 'grade': return validateGrade(output)
    case 'solution': return validateSolution(output)
    case 'suggest_slide': {
      const e: string[] = []
      if (!isReasonList(output.slide)) e.push('slide must be a list of {id, reason}')
      if (!isReasonList(output.keep)) e.push('keep must be a list of {id, reason}')
      return e
    }
    case 'classify': return validateClassify(output)
    case 'brief': return validateBrief(output)
    case 'check': return validateCheck(output)
    case 'review_sprint': {
      if (!isStr(output.prose)) return ['prose missing']
      const e: string[] = []
      const n = wordCount(output.prose)
      if (n > REVIEW_MAX_WORDS) e.push(`prose is ${n} words (max ${REVIEW_MAX_WORDS})`)
      if (output.doBetter !== undefined && !(Array.isArray(output.doBetter) && output.doBetter.every(isStr))) e.push('doBetter must be a list of strings')
      return e
    }
    default: return [`unknown job ${String(job)}`]
  }
}

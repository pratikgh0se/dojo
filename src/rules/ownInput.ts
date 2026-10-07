// Parses an own-input form (labs contract §4.6) into the input `SRAlgo.run(key, input)` expects, or the
// first failing rule (in the contract's table order) with its exact message and the field to flag.
import { walkDef } from '../content/atlas'
import { DIRECTED, INPUT_ERRORS as E, INPUT_FIELDS, INPUT_LIMITS as LIM, POSITIONAL, WEIGHTED } from '../content/libraryInputs'

export type Parsed = { ok: true; value: unknown } | { ok: false; field: string; error: string }

class Invalid extends Error {
  field: string
  constructor(field: string, message: string) {
    super(message)
    this.field = field
  }
}
const fail = (field: string, message: string): never => {
  throw new Invalid(field, message)
}

const INT = /^-?\d+$/
const tokens = (raw: string) => raw.split(/[\s,]+/).filter(Boolean)

function int(field: string, raw: string, min: number, max: number, message: string): number {
  const s = raw.trim()
  if (!INT.test(s)) fail(field, message)
  const n = Number(s)
  if (n < min || n > max) fail(field, message)
  return n
}

/** Whole numbers −999…999, at most 12 (rules 1–2). */
function ints(field: string, raw: string): number[] {
  const t = tokens(raw)
  if (t.length === 0 || t.some(x => !INT.test(x) || Math.abs(Number(x)) > LIM.intAbs)) fail(field, E.ints)
  if (t.length > LIM.items) fail(field, E.tooMany)
  return t.map(Number)
}

type Edge = [string, string] | [string, string, number]
interface Graph { directed: boolean; nodes: Record<string, Record<string, never>>; edges: Edge[] }
const EDGE = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)(?::(-?\d+))?$/

/** `A-B` or `A-B:4`, one per line or comma-separated; node cap before shape (table order). */
function edges(key: string, raw: string): Graph {
  const parts = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
  const matched = parts.map(p => EDGE.exec(p))
  const names: string[] = []
  for (const m of matched) if (m) for (const n of [m[1], m[2]]) if (!names.includes(n)) names.push(n)
  if (names.length > LIM.nodes) fail('edges', E.nodes)
  if (parts.length === 0 || matched.some(m => !m || (m[3] !== undefined && Math.abs(Number(m[3])) > LIM.intAbs))) fail('edges', E.edge)
  const weighted = WEIGHTED.includes(key)
  const list: Edge[] = matched.map(m => {
    const [, u, v, w] = m as RegExpExecArray
    if (w !== undefined) return [u, v, Number(w)]
    return weighted ? [u, v, 1] : [u, v]
  })
  return { directed: DIRECTED.includes(key), nodes: Object.fromEntries(names.map(n => [n, {}])), edges: list }
}

function hasCycle(g: Graph): boolean {
  const indeg = new Map(Object.keys(g.nodes).map(n => [n, 0]))
  for (const [, v] of g.edges) indeg.set(v, (indeg.get(v) ?? 0) + 1)
  const ready = [...indeg].filter(([, d]) => d === 0).map(([n]) => n)
  let seen = 0
  while (ready.length) {
    const u = ready.shift() as string
    seen += 1
    for (const [a, b] of g.edges) {
      if (a !== u) continue
      indeg.set(b, (indeg.get(b) ?? 0) - 1)
      if (indeg.get(b) === 0) ready.push(b)
    }
  }
  return seen < indeg.size
}

function grid(raw: string): string[][] {
  const rows = raw.split('\n').map(r => r.trim()).filter(Boolean)
  if (rows.length === 0 || rows.length > LIM.grid || rows.some(r => r.length > LIM.grid)) fail('grid', E.gridSize)
  if (rows.some(r => r.length !== rows[0].length)) fail('grid', E.gridRagged)
  if (rows.some(r => /[^SE.#]/.test(r))) fail('grid', E.gridChars)
  const all = rows.join('')
  if (all.split('S').length !== 2 || all.split('E').length !== 2) fail('grid', E.gridEnds)
  return rows.map(r => r.split(''))
}

function build(key: string, r: Record<string, string>): unknown {
  const kind = walkDef(key)?.input
  const v = (name: string) => r[name] ?? ''
  switch (kind) {
    case 'ints': {
      const values = ints('values', v('values'))
      return POSITIONAL.includes(key) ? values : { values }
    }
    case 'sortedTarget': {
      const a = ints('values', v('values'))
      if (a.some((x, i) => i > 0 && x < a[i - 1])) fail('values', E.sorted)
      return { a, target: int('target', v('target'), -LIM.intAbs, LIM.intAbs, E.target) }
    }
    case 'intsK': {
      const a = ints('values', v('values'))
      return { a, k: int('k', v('k'), 1, a.length, E.k) }
    }
    case 'graphStart': {
      const g = edges(key, v('edges'))
      const start = v('start').trim()
      if (!(start in g.nodes)) fail('start', E.start)
      if (key === 'dijkstra' && g.edges.some(e => (e[2] ?? 0) < 0)) fail('edges', E.negative)
      return { graph: g, start }
    }
    case 'graph':
      return { graph: edges(key, v('edges')) }
    case 'dag': {
      const g = edges(key, v('edges'))
      if (hasCycle(g)) fail('edges', E.cycle)
      return { graph: g }
    }
    case 'grid':
      return { rows: grid(v('grid')) }
    case 'items': {
      const t = tokens(v('items'))
      const items = t.map(s => /^(\d+):(\d+)$/.exec(s)).map(m => (m && Number(m[1]) >= 1 && Number(m[1]) <= LIM.intAbs && Number(m[2]) <= LIM.intAbs ? { w: Number(m[1]), v: Number(m[2]) } : null))
      if (t.length === 0 || t.length > LIM.knapsackItems || items.some(x => !x)) fail('items', E.items)
      return { items, W: int('capacity', v('capacity'), 1, LIM.capacity, E.capacity) }
    }
    case 'strings': {
      const a = v('first').trim()
      const b = v('second').trim()
      if (a.length < 1 || a.length > LIM.lcsLength) fail('first', E.strings)
      if (b.length < 1 || b.length > LIM.lcsLength) fail('second', E.strings)
      return { a, b }
    }
    case 'coins': {
      const t = tokens(v('coins'))
      if (t.length === 0 || t.some(x => !/^\d+$/.test(x) || Number(x) < 1 || Number(x) > LIM.intAbs)) fail('coins', E.coins)
      if (t.length > LIM.items) fail('coins', E.tooMany)
      return { coins: t.map(Number), amount: int('amount', v('amount'), 1, LIM.amount, E.amount) }
    }
    case 'board':
      return { n: int('n', v('n'), LIM.boardMin, LIM.boardMax, E.board) }
    case 'intervals': {
      const t = tokens(v('intervals'))
      if (t.length > LIM.items) fail('intervals', E.tooMany)
      const iv = t.map(s => /^(\d+)-(\d+)$/.exec(s))
      if (t.length === 0 || iv.some(m => !m || Number(m[1]) > Number(m[2]) || Number(m[2]) > LIM.intAbs)) fail('intervals', E.interval)
      return { intervals: iv.map(m => [Number((m as RegExpExecArray)[1]), Number((m as RegExpExecArray)[2])]) }
    }
    case 'number':
      return { n: int('number', v('number'), 0, LIM.number, E.number) }
    case 'brackets': {
      const s = v('brackets').replace(/\s+/g, '')
      if (s.length > LIM.items) fail('brackets', E.tooMany)
      if (/[^()[\]{}]/.test(s)) fail('brackets', E.brackets)
      return { s }
    }
    case 'keys': {
      const keys = tokens(v('keys'))
      if (keys.length > LIM.items) fail('keys', E.tooMany)
      return { keys, buckets: int('buckets', v('buckets'), 1, LIM.buckets, E.buckets) }
    }
    default:
      return fail(INPUT_FIELDS.ints[0].name, 'Fixed example: no own input.')
  }
}

/** Raw form text → generator input, or the first failing rule's field and message. */
export function parseOwnInput(key: string, raw: Record<string, string>): Parsed {
  try {
    return { ok: true, value: build(key, raw) }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, field: e.field, error: e.message }
    throw e
  }
}

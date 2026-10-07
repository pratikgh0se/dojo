// C-VISUAL §3–§4: the family half of the one step model. Built once per run: every family event is applied in
// order, and each element's history goes into a Timeline, so the state at any step k is a few binary searches
// per drawn element (no replay from step 1: 20,000 steps stay responsive, §6). For every step the model also
// keeps the panel it belongs to, its pinned caption and the elements it touched ("current").
import { FAMILY_OPS } from '../../../shared/stepShape.mjs'
import type { FamilyOp, FamilyStep, Step } from '../types'
import { countAt, Timeline, windowIndices } from './timeline'

export type Kind = FamilyOp
export const KINDS = FAMILY_OPS as Kind[]

/** C-VISUAL §4.11: the largest window each view draws. */
export const WINDOW = { graph: 300, heapLevels: 5, heapSlots: 128, queue: 40, dsu: 200, array: 40, search: 200, list: 40, intervals: 100, tree: 127, game: 200, edges: 600 }

const isFamily = (s: Step): s is FamilyStep & { case?: number } => (KINDS as string[]).includes(s.op)

/** C-VISUAL Addendum 3: the caption of a step the page cannot draw. */
export const NOT_SHOWN = '(event not shown)'

interface Base {
  sid: number
  kind: Kind
  name: string
  createdAt: number
  /** the step that created a same-kind, same-name structure, replacing this one */
  endAt: number
}

// ---------------------------------------------------------------- per family

export interface GraphInst extends Base {
  kind: 'graph'
  directed: boolean
  order: number[]
  addedAt: number[]
  index: Map<number, number>
  dist: Map<number, Timeline<number>>
  mark: Map<number, Timeline<string>>
  visitedAt: Map<number, number>
  edges: { key: string; u: number; v: number; addedAt: number; w: Timeline<number | null> }[]
  edgeIdx: Map<string, number>
  relaxFrom: Map<number, Timeline<number>>
}
export interface HeapInst extends Base { kind: 'heap'; slots: Timeline<[number, number]>[]; len: Timeline<number>; sim: [number, number][] }
export interface QueueInst extends Base { kind: 'queue'; log: number[]; head: Timeline<number>; tail: Timeline<number>; h: number }
/** Addendum 3: sparse: only touched elements cost memory (a missing parent is the element itself, a missing size 1). */
export interface DsuInst extends Base { kind: 'dsu'; n: number; parent: Map<number, Timeline<number>>; count: Timeline<number>; p: Map<number, number>; size: Map<number, number> }
/** Addendum 3: the initial values in one typed array; only written cells get a Timeline. */
export interface ArrayInst extends Base {
  kind: 'array'; n: number; chars: boolean; initial: Float64Array; cells: Map<number, Timeline<number>>; labels: string[]; pointers: Map<string, Timeline<number>>
  window: Timeline<[number, number] | null>
}
export interface SearchInst extends Base {
  kind: 'search'; lo: Timeline<number>; hi: Timeline<number>; mid: Timeline<number | null>
  probes: Map<number, { firstAt: number; pred: Timeline<boolean> }>; probeOrder: number[]
  since: { m: number; pred: boolean } | null; curLo: number; curHi: number
}
export interface ListInst extends Base {
  kind: 'list'; order: number[]; addedAt: number[]; val: Map<number, Timeline<number>>; next: Map<number, Timeline<number>>
  labels: string[]; pointers: Map<string, Timeline<number>>
}
/** Addendum 3: the initial items in one typed array (s, e pairs); only changed or added items get a Timeline. */
export interface IntervalsInst extends Base {
  kind: 'intervals'; initial: number; start: Float64Array; createdAt: number; added: number[]; count: number
  items: Map<number, Timeline<[number, number]>>; marks: Map<number, Timeline<string>>
}
export interface TreeInst extends Base {
  kind: 'tree'; order: number[]; addedAt: number[]; info: Map<number, { val: number; parent: number; side: string }>
  visitedAt: Map<number, number>; mark: Map<number, Timeline<string>>
}
export interface GameInst extends Base {
  kind: 'game'; order: string[]; addedAt: number[]; outcome: Map<string, Timeline<string>>; value: Map<string, Timeline<number | null>>
}
export type Inst = GraphInst | HeapInst | QueueInst | DsuInst | ArrayInst | SearchInst | ListInst | IntervalsInst | TreeInst | GameInst

export interface FamilyModel {
  N: number
  insts: Inst[]
  bySid: Map<number, Inst>
  kinds: Kind[]
  /** per step (index k-1): the panel its event belongs to (null: a DP step or an ignored one) */
  kindAt: (Kind | null)[]
  sidAt: Int32Array
  caption: string[]
  /** per step: the element keys it touched (see each view's key names) */
  current: (string[] | null)[]
  /** per kind: its structures in creation order, and the steps that replaced them (ascending) */
  byKind: Map<Kind, KindIndex>
  /** UAT r4: the steps that start a case (a step carrying a case id), ascending */
  caseStarts: number[]
}

/**
 * A kind's structures in creation order, with what boxesAt needs to find the live ones at a step without
 * scanning the dead: blockEnd[b] is the latest replacement step in block b of BLOCK structures.
 */
export interface KindIndex { insts: Inst[]; createdAt: number[]; endAts: number[]; blockEnd: number[] }
const BLOCK = 64

/** Addendum 3: a panel draws at most this many boxes (the most recent live ones), plus one with a current element. */
export const MAX_BOXES = 50

const tl = <T>(m: Map<number | string, Timeline<T>>, key: number | string): Timeline<T> => {
  let t = m.get(key)
  if (!t) m.set(key, (t = new Timeline<T>()))
  return t
}
const ch = (chars: boolean, v: number) => (chars ? String.fromCodePoint(Math.max(0, Math.min(0x10ffff, v))) : String(v))
const heapLess = (a: [number, number], b: [number, number]) => a[1] < b[1] || (a[1] === b[1] && a[0] < b[0])
export const edgeKey = (directed: boolean, u: number, v: number) => (directed || u <= v ? `${u}-${v}` : `${v}-${u}`)
/** The two ends of an edge key ("3-2"); node ids are never negative, so the dash only separates. */
const edgeEnds = (key: string): [number, number] => { const i = key.indexOf('-'); return [Number(key.slice(0, i)), Number(key.slice(i + 1))] }

function create(ev: FamilyStep, k: number): Inst | null {
  const base = { sid: ev.sid, createdAt: k, endAt: Infinity }
  switch (ev.op) {
    case 'graph':
      if (ev.act !== 'new') return null
      return { ...base, kind: 'graph', name: ev.name, directed: ev.directed, order: [], addedAt: [], index: new Map(), dist: new Map(), mark: new Map(), visitedAt: new Map(), edges: [], edgeIdx: new Map(), relaxFrom: new Map() }
    case 'heap':
      if (ev.act !== 'new') return null
      return { ...base, kind: 'heap', name: ev.name, slots: [], len: new Timeline(), sim: [] }
    case 'queue':
      if (ev.act !== 'new') return null
      return { ...base, kind: 'queue', name: ev.name, log: [], head: new Timeline(), tail: new Timeline(), h: 0 }
    case 'dsu': {
      if (ev.act !== 'new') return null
      const n = Math.max(0, ev.n)
      const d: DsuInst = { ...base, kind: 'dsu', name: ev.name, n, parent: new Map(), count: new Timeline(), p: new Map(), size: new Map() }
      d.count.set(k, n)
      return d
    }
    case 'array': {
      if (ev.act !== 'new') return null
      return { ...base, kind: 'array', name: ev.name, n: ev.values.length, chars: ev.chars, initial: Float64Array.from(ev.values), cells: new Map(), labels: [], pointers: new Map(), window: new Timeline() }
    }
    case 'search': {
      if (ev.act !== 'new') return null
      const s: SearchInst = { ...base, kind: 'search', name: ev.name, lo: new Timeline(), hi: new Timeline(), mid: new Timeline(), probes: new Map(), probeOrder: [], since: null, curLo: ev.lo, curHi: ev.hi }
      s.lo.set(k, ev.lo)
      s.hi.set(k, ev.hi)
      return s
    }
    case 'list':
      if (ev.act !== 'new') return null
      return { ...base, kind: 'list', name: ev.name, order: [], addedAt: [], val: new Map(), next: new Map(), labels: [], pointers: new Map() }
    case 'intervals': {
      if (ev.act !== 'new') return null
      const start = new Float64Array(ev.items.length * 2)
      ev.items.forEach(([s, e], i) => { start[2 * i] = s; start[2 * i + 1] = e })
      return { ...base, kind: 'intervals', name: ev.name, initial: ev.items.length, start, createdAt: k, added: [], count: ev.items.length, items: new Map(), marks: new Map() }
    }
    case 'tree':
      if (ev.act !== 'new') return null
      return { ...base, kind: 'tree', name: ev.name, order: [], addedAt: [], info: new Map(), visitedAt: new Map(), mark: new Map() }
    case 'game': {
      if (ev.act !== 'new') return null
      const g: GameInst = { ...base, kind: 'game', name: ev.name, order: [], addedAt: [], outcome: new Map(), value: new Map() }
      for (const s of ev.states) if (!g.outcome.has(s)) { g.order.push(s); g.addedAt.push(k); g.outcome.set(s, new Timeline()); g.value.set(s, new Timeline()) }
      return g
    }
  }
}

function createCaption(x: Inst): string {
  switch (x.kind) {
    case 'graph': return `graph ${x.name} (${x.directed ? 'directed' : 'undirected'})`
    case 'heap': return `heap ${x.name}`
    case 'queue': return `queue ${x.name}`
    case 'dsu': return `dsu ${x.name} (${x.n})`
    case 'array': return `array ${x.name} (${x.n})`
    case 'search': return `search ${x.name} in [${x.curLo}..${x.curHi}]`
    case 'list': return `list ${x.name}`
    case 'intervals': return `intervals ${x.name} (${x.initial})`
    case 'tree': return `tree ${x.name}`
    case 'game': return `game ${x.name}`
  }
}

type Applied = { caption: string; current: string[] }

const badNode = (...us: number[]) => us.some(u => !Number.isInteger(u) || u < 0)

function graphNode(g: GraphInst, u: number, k: number) {
  if (!g.index.has(u)) {
    g.index.set(u, g.order.length)
    g.order.push(u)
    g.addedAt.push(k)
  }
}

function applyGraph(g: GraphInst, ev: Extract<FamilyStep, { op: 'graph' }>, k: number): Applied | null {
  // Addendum 3: negative node ids are a misuse in both toolkits; the page never draws one
  if (ev.act !== 'new' && badNode(ev.u, 'v' in ev ? ev.v : 0)) return null
  switch (ev.act) {
    case 'node': graphNode(g, ev.u, k); return { caption: `node ${ev.u}`, current: [`node:${ev.u}`] }
    case 'edge': {
      graphNode(g, ev.u, k)
      graphNode(g, ev.v, k)
      const key = edgeKey(g.directed, ev.u, ev.v)
      let i = g.edgeIdx.get(key)
      if (i === undefined) {
        i = g.edges.length
        g.edgeIdx.set(key, i)
        const [u, v] = edgeEnds(key)
        g.edges.push({ key, u, v, addedAt: k, w: new Timeline() })
      }
      g.edges[i].w.set(k, ev.w ?? null)
      const arrow = g.directed ? '→' : '—'
      return { caption: ev.w === undefined ? `edge ${ev.u} ${arrow} ${ev.v}` : `edge ${ev.u} ${arrow} ${ev.v} (w ${ev.w})`, current: [`edge:${key}`] }
    }
    case 'visit':
      graphNode(g, ev.u, k)
      if (!g.visitedAt.has(ev.u)) g.visitedAt.set(ev.u, k)
      return { caption: `visit ${ev.u}`, current: [`node:${ev.u}`] }
    case 'dist':
      graphNode(g, ev.u, k)
      tl(g.dist, ev.u).set(k, ev.d)
      return { caption: `dist[${ev.u}] = ${ev.d}`, current: [`node:${ev.u}`] }
    case 'relax': {
      graphNode(g, ev.u, k)
      graphNode(g, ev.v, k)
      tl(g.dist, ev.v).set(k, ev.d)
      tl(g.relaxFrom, ev.v).set(k, ev.u)
      return { caption: `dist[${ev.v}] = ${ev.d} (via ${ev.u})`, current: [`node:${ev.v}`, `edge:${edgeKey(g.directed, ev.u, ev.v)}`, `from:${ev.u}`] }
    }
    case 'mark':
      graphNode(g, ev.u, k)
      tl(g.mark, ev.u).set(k, ev.label)
      return { caption: `mark ${ev.u}: ${ev.label}`, current: [`node:${ev.u}`] }
    default: return null
  }
}

function applyHeap(h: HeapInst, ev: Extract<FamilyStep, { op: 'heap' }>, k: number): Applied | null {
  const a = h.sim
  const put = (i: number, it: [number, number]) => {
    a[i] = it
    while (h.slots.length <= i) h.slots.push(new Timeline())
    h.slots[i].set(k, it)
  }
  if (ev.act === 'push') {
    const it: [number, number] = [ev.key, ev.prio]
    let i = a.length
    put(i, it)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!heapLess(it, a[p])) break
      const parent = a[p]
      put(i, parent)
      put(p, it)
      i = p
    }
    h.len.set(k, a.length)
    return { caption: `push ${ev.key} (${ev.prio}) → slot ${i}`, current: [`slot:${i}`] }
  }
  if (ev.act === 'pop') {
    if (a.length > 0) {
      const last = a.pop() as [number, number]
      if (a.length > 0) {
        put(0, last)
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          const r = l + 1
          if (l >= a.length) break
          const c = r < a.length && heapLess(a[r], a[l]) ? r : l
          if (!heapLess(a[c], a[i])) break
          const child = a[c]
          put(c, a[i])
          put(i, child)
          i = c
        }
      }
    }
    h.len.set(k, a.length)
    return { caption: `pop ${ev.key} (${ev.prio})`, current: a.length > 0 ? ['slot:0'] : [] }
  }
  return null
}

function applyQueue(q: QueueInst, ev: Extract<FamilyStep, { op: 'queue' }>, k: number): Applied | null {
  if (ev.act === 'push') {
    q.log.push(ev.v)
    q.tail.set(k, q.log.length)
    return { caption: `push ${ev.v}`, current: [`item:${q.log.length - 1 - q.h}`] }
  }
  if (ev.act === 'pop') {
    if (q.h < q.log.length) q.h++
    q.head.set(k, q.h)
    return { caption: `pop ${ev.v}`, current: [] }
  }
  return null
}

function applyDsu(d: DsuInst, ev: Extract<FamilyStep, { op: 'dsu' }>, k: number): Applied | null {
  const ok = (x: number) => x >= 0 && x < d.n
  const par = (x: number) => d.p.get(x) ?? x
  const size = (x: number) => d.size.get(x) ?? 1
  const setP = (x: number, p: number) => { d.p.set(x, p); tl(d.parent, x).set(k, p) }
  const find = (x: number) => {
    let r = x
    while (par(r) !== r) r = par(r)
    while (par(x) !== r) { const nx = par(x); setP(x, r); x = nx }
    return r
  }
  if (ev.act === 'union') {
    if (!ok(ev.a) || !ok(ev.b)) return null
    let ra = find(ev.a)
    let rb = find(ev.b)
    if (ra === rb) return { caption: `union(${ev.a}, ${ev.b}): already joined (root ${ra})`, current: [`node:${ev.a}`, `node:${ev.b}`] }
    if (size(ra) < size(rb)) [ra, rb] = [rb, ra]
    setP(rb, ra)
    d.size.set(ra, size(ra) + size(rb))
    d.count.set(k, (d.count.last() ?? d.n) - 1)
    return { caption: `union(${ev.a}, ${ev.b}): ${rb} now under ${ra}`, current: [`node:${ev.a}`, `node:${ev.b}`] }
  }
  if (ev.act === 'find') {
    if (!ok(ev.x)) return null
    return { caption: `find(${ev.x}) = ${find(ev.x)}`, current: [`node:${ev.x}`] }
  }
  return null
}

/** A cell's value after events 1..k: its own timeline once written, else the initial value. */
function cellAt(a: ArrayInst, i: number, k: number): number {
  return a.cells.get(i)?.at(k) ?? a.initial[i]
}

/** An interval after events 1..k (null before an added one exists). */
function itemAt(iv: IntervalsInst, i: number, k: number): [number, number] {
  const t = iv.items.get(i)?.at(k)
  if (t) return t
  return i < iv.initial ? [iv.start[2 * i], iv.start[2 * i + 1]] : [0, 0]
}

/** How many intervals exist at step k. */
function intervalsAt(iv: IntervalsInst, k: number): number {
  return k < iv.createdAt ? 0 : iv.initial + countAt(iv.added, k)
}

function applyArray(a: ArrayInst, ev: Extract<FamilyStep, { op: 'array' }>, k: number): Applied | null {
  const ok = (i: number) => i >= 0 && i < a.n
  const cell = (i: number) => tl(a.cells, i)
  switch (ev.act) {
    case 'set':
      if (!ok(ev.i)) return null
      cell(ev.i).set(k, ev.v)
      return { caption: `${a.name}[${ev.i}] = ${ch(a.chars, ev.v)}`, current: [`cell:${ev.i}`] }
    case 'swap': {
      if (!ok(ev.i) || !ok(ev.j)) return null
      const vi = cellAt(a, ev.i, k)
      const vj = cellAt(a, ev.j, k)
      cell(ev.i).set(k, vj)
      cell(ev.j).set(k, vi)
      return { caption: `swap ${a.name}[${ev.i}] ↔ ${a.name}[${ev.j}]`, current: [`cell:${ev.i}`, `cell:${ev.j}`] }
    }
    case 'pointer': {
      let t = a.pointers.get(ev.label)
      if (!t) { a.pointers.set(ev.label, (t = new Timeline())); a.labels.push(ev.label) }
      t.set(k, ev.i)
      return { caption: `${ev.label} → ${ev.i}`, current: [`pointer:${ev.label}`] }
    }
    case 'window':
      a.window.set(k, [ev.lo, ev.hi])
      return { caption: ev.hi < ev.lo ? 'window empty' : `window [${ev.lo}..${ev.hi}] (len ${ev.hi - ev.lo + 1})`, current: [] }
    default: return null
  }
}

function applySearch(s: SearchInst, ev: Extract<FamilyStep, { op: 'search' }>, k: number): Applied | null {
  if (ev.act === 'mid') {
    let p = s.probes.get(ev.m)
    if (!p) { s.probes.set(ev.m, (p = { firstAt: k, pred: new Timeline() })); s.probeOrder.push(ev.m) }
    p.pred.set(k, ev.pred)
    s.mid.set(k, ev.m)
    s.since = { m: ev.m, pred: ev.pred }
    return { caption: `lo=${s.curLo} mid=${ev.m} hi=${s.curHi} · pred(${ev.m})=${ev.pred}`, current: [`probe:${ev.m}`, 'mid'] }
  }
  if (ev.act === 'lo' || ev.act === 'hi') {
    const head = s.since ? `lo=${s.curLo} mid=${s.since.m} hi=${s.curHi} · pred(${s.since.m})=${s.since.pred}` : `lo=${s.curLo} hi=${s.curHi}`
    if (ev.act === 'lo') { s.curLo = ev.v; s.lo.set(k, ev.v) } else { s.curHi = ev.v; s.hi.set(k, ev.v) }
    s.since = null
    return { caption: `${head} → ${ev.act}=${ev.v}`, current: [ev.act] }
  }
  return null
}

function applyList(l: ListInst, ev: Extract<FamilyStep, { op: 'list' }>, k: number): Applied | null {
  const nil = (id: number) => (id === -1 ? 'nil' : String(id))
  switch (ev.act) {
    case 'node':
      if (!l.val.has(ev.id)) { l.order.push(ev.id); l.addedAt.push(k) }
      tl(l.val, ev.id).set(k, ev.val)
      return { caption: `node ${ev.id} = ${ev.val}`, current: [`node:${ev.id}`] }
    case 'next':
      if (!l.val.has(ev.id)) return null
      tl(l.next, ev.id).set(k, ev.next)
      return { caption: `next(${ev.id}) = ${nil(ev.next)}`, current: [`node:${ev.id}`] }
    case 'pointer': {
      let t = l.pointers.get(ev.label)
      if (!t) { l.pointers.set(ev.label, (t = new Timeline())); l.labels.push(ev.label) }
      t.set(k, ev.id)
      return { caption: `${ev.label} = ${nil(ev.id)}`, current: [`pointer:${ev.label}`] }
    }
    default: return null
  }
}

function applyIntervals(iv: IntervalsInst, ev: Extract<FamilyStep, { op: 'intervals' }>, k: number): Applied | null {
  const ok = (i: number) => i >= 0 && i < iv.count
  switch (ev.act) {
    case 'add': {
      const i = iv.count++
      tl(iv.items, i).set(k, [ev.s, ev.e])
      iv.added.push(k)
      return { caption: `${iv.name} + [${ev.s},${ev.e}]`, current: [`interval:${i}`] }
    }
    case 'set':
      if (!ok(ev.i)) return null
      tl(iv.items, ev.i).set(k, [ev.s, ev.e])
      return { caption: `${iv.name}[${ev.i}] = [${ev.s},${ev.e}]`, current: [`interval:${ev.i}`] }
    case 'mark': {
      if (!ok(ev.i)) return null
      tl(iv.marks, ev.i).set(k, ev.label)
      const [s, e] = itemAt(iv, ev.i, k)
      return { caption: `${iv.name}[${ev.i}] [${s},${e}]: ${ev.label}`, current: [`interval:${ev.i}`] }
    }
    default: return null
  }
}

function applyTree(t: TreeInst, ev: Extract<FamilyStep, { op: 'tree' }>, k: number): Applied | null {
  switch (ev.act) {
    case 'node':
      if (t.info.has(ev.id)) return null
      t.info.set(ev.id, { val: ev.val, parent: ev.parent, side: ev.side })
      t.order.push(ev.id)
      t.addedAt.push(k)
      return { caption: `node ${ev.id} = ${ev.val}`, current: [`node:${ev.id}`] }
    case 'visit': {
      const n = t.info.get(ev.id)
      if (!n) return null
      if (!t.visitedAt.has(ev.id)) t.visitedAt.set(ev.id, k)
      return { caption: `visit ${ev.id} (${n.val})`, current: [`node:${ev.id}`] }
    }
    case 'mark': {
      const n = t.info.get(ev.id)
      if (!n) return null
      tl(t.mark, ev.id).set(k, ev.label)
      return { caption: `${ev.id} (${n.val}): ${ev.label}`, current: [`node:${ev.id}`] }
    }
    default: return null
  }
}

function applyGame(g: GameInst, ev: Extract<FamilyStep, { op: 'game' }>, k: number): Applied | null {
  if (ev.act !== 'set') return null
  if (!g.outcome.has(ev.state)) { g.order.push(ev.state); g.addedAt.push(k); g.outcome.set(ev.state, new Timeline()); g.value.set(ev.state, new Timeline()) }
  g.outcome.get(ev.state)!.set(k, ev.outcome)
  g.value.get(ev.state)!.set(k, ev.value ?? null)
  return { caption: ev.value === undefined ? `${ev.state}: ${ev.outcome}` : `${ev.state}: ${ev.outcome} (${ev.value})`, current: [`state:${ev.state}`] }
}

function apply(x: Inst, ev: FamilyStep, k: number): Applied | null {
  switch (x.kind) {
    case 'graph': return ev.op === 'graph' ? applyGraph(x, ev, k) : null
    case 'heap': return ev.op === 'heap' ? applyHeap(x, ev, k) : null
    case 'queue': return ev.op === 'queue' ? applyQueue(x, ev, k) : null
    case 'dsu': return ev.op === 'dsu' ? applyDsu(x, ev, k) : null
    case 'array': return ev.op === 'array' ? applyArray(x, ev, k) : null
    case 'search': return ev.op === 'search' ? applySearch(x, ev, k) : null
    case 'list': return ev.op === 'list' ? applyList(x, ev, k) : null
    case 'intervals': return ev.op === 'intervals' ? applyIntervals(x, ev, k) : null
    case 'tree': return ev.op === 'tree' ? applyTree(x, ev, k) : null
    case 'game': return ev.op === 'game' ? applyGame(x, ev, k) : null
  }
}

export function buildFamilyModel(steps: Step[]): FamilyModel {
  const N = steps.length
  const insts: Inst[] = []
  const bySid = new Map<number, Inst>()
  const live = new Map<string, Inst>()
  const kindAt: (Kind | null)[] = new Array(N).fill(null)
  const sidAt = new Int32Array(N).fill(-1)
  const caption: string[] = new Array(N).fill('')
  const current: (string[] | null)[] = new Array(N).fill(null)
  const present = new Set<Kind>()
  const caseStarts: number[] = []
  for (let k = 1; k <= N; k++) {
    const raw = steps[k - 1]
    if ((raw as { case?: number }).case !== undefined) caseStarts.push(k)
    if (raw.op === 'unshown') {
      if (raw.kind && (KINDS as string[]).includes(raw.kind)) {
        present.add(raw.kind)
        kindAt[k - 1] = raw.kind
        caption[k - 1] = NOT_SHOWN
      }
      continue
    }
    if (!isFamily(raw)) continue
    const ev = raw
    present.add(ev.op)
    kindAt[k - 1] = ev.op
    sidAt[k - 1] = ev.sid
    caption[k - 1] = NOT_SHOWN // until the event is drawn below
    if (ev.act === 'new') {
      if (bySid.has(ev.sid)) continue
      const x = create(ev, k)
      if (!x) continue
      const key = `${x.kind}\u0000${x.name}`
      const old = live.get(key)
      if (old) old.endAt = k
      live.set(key, x)
      insts.push(x)
      bySid.set(x.sid, x)
      caption[k - 1] = createCaption(x)
      current[k - 1] = []
      continue
    }
    const x = bySid.get(ev.sid)
    if (!x) continue
    const r = apply(x, ev, k)
    if (!r) continue
    caption[k - 1] = r.caption
    current[k - 1] = r.current
  }
  const byKind: FamilyModel['byKind'] = new Map()
  for (const x of insts) {
    let e = byKind.get(x.kind)
    if (!e) byKind.set(x.kind, (e = { insts: [], createdAt: [], endAts: [], blockEnd: [] }))
    e.insts.push(x)
    e.createdAt.push(x.createdAt)
    if (x.endAt !== Infinity) e.endAts.push(x.endAt)
  }
  for (const e of byKind.values()) {
    e.endAts.sort((a, b) => a - b)
    for (let i = 0; i < e.insts.length; i++) {
      const b = Math.floor(i / BLOCK)
      e.blockEnd[b] = Math.max(e.blockEnd[b] ?? -Infinity, e.insts[i].endAt)
    }
  }
  return { N, insts, bySid, kinds: KINDS.filter(kd => present.has(kd)), kindAt, sidAt, caption, current, byKind, caseStarts }
}

/** UAT r4: the first and last step of the case that step k belongs to (the whole run when it has no cases). */
export function caseRange(m: FamilyModel, k: number): [number, number] {
  const i = countAt(m.caseStarts, k) - 1
  const start = i >= 0 ? m.caseStarts[i] : 1
  const end = i + 1 < m.caseStarts.length ? m.caseStarts[i + 1] - 1 : m.N
  return [start, end]
}

/** How far back a reservation looks for structures still alive in a case (a run with thousands of them stays cheap). */
const RESERVE_SCAN = 64
/** A pane reserves room for at most this many structures (names) at once; a run with more keeps its panes unreserved. */
export const MAX_SLOTS = 8
/** The most steps one structure is measured at (UAT cu-5 P2-1). */
export const PROBE_MAX = 24
/** Instances of one name measured in a case (a structure re-declared in a loop). */
const PROBE_INSTANCES = 12
/** The most steps scanned for one structure's events in one case. */
const PROBE_SCAN = 4000

/** One structure of a pane over a case: its name, the step it first shows from, and its instances (a re-declared name replaces one). */
export interface Slot { name: string; first: number; insts: Inst[] }
export interface CasePlan {
  /** the first and last step of the case */
  cs: number
  ce: number
  /** the structures the pane holds room for in this case, in the order they first appear; [] when there are too many */
  slots: Slot[]
  /** the longest captions the pane's steps in this case show */
  captions: string[]
}
const planCache = new WeakMap<FamilyModel, Map<string, CasePlan>>()

/**
 * UAT cu-5 P2-1 (V0.3, "one size per case"): what a pane of `kind` has to hold in k's case. Every structure that is alive
 * at any step of the case is a slot, so a structure declared later in the case, or replaced by a same-named one, keeps its
 * room from the case's first step. Cached per model, kind and case.
 */
export function casePlan(m: FamilyModel, kind: Kind, k: number): CasePlan {
  const [cs, ce] = caseRange(m, k)
  let cache = planCache.get(m)
  if (!cache) planCache.set(m, (cache = new Map()))
  const key = `${kind}:${cs}`
  const hit = cache.get(key)
  if (hit) return hit
  const slots: Slot[] = []
  const e = m.byKind.get(kind)
  if (e) {
    const byName = new Map<string, Slot>()
    const hi = countAt(e.createdAt, ce)
    for (let i = hi - 1, n = 0; i >= 0 && n < RESERVE_SCAN; i--, n++) {
      const x = e.insts[i]
      if (x.endAt <= cs) continue
      let s = byName.get(x.name)
      if (!s) { byName.set(x.name, (s = { name: x.name, first: Infinity, insts: [] })) }
      s.insts.unshift(x)
      s.first = Math.min(s.first, Math.max(cs, x.createdAt))
    }
    slots.push(...[...byName.values()].sort((a, b) => a.first - b.first || a.insts[0].createdAt - b.insts[0].createdAt))
  }
  const captions: string[] = []
  for (let j = cs; j <= ce && j <= m.N; j++) if (m.kindAt[j - 1] === kind && m.caption[j - 1]) captions.push(m.caption[j - 1])
  const longest = [...new Set(captions)].sort((a, b) => b.length - a.length).slice(0, 3)
  const plan: CasePlan = { cs, ce, slots: slots.length > MAX_SLOTS ? [] : slots, captions: longest }
  cache.set(key, plan)
  return plan
}

/** How tall a structure is at step j, as a number only (the steps worth measuring come first); never a pixel size. */
function weight(x: Inst, j: number): number {
  switch (x.kind) {
    case 'graph': return countAt(x.addedAt, j) * 1000 + x.edges.filter(ed => ed.addedAt <= j).length
    case 'heap': return x.len.at(j, 0)
    case 'queue': return Math.max(0, x.tail.at(j, 0) - x.head.at(j, 0))
    case 'dsu': return dsuDepth(x, j) * 1000 + (x.count.at(j, x.n))
    case 'array': return x.labels.reduce((n, l) => n + (x.pointers.get(l)!.at(j) !== undefined ? 2 : 0), 0) + (x.window.at(j, null) ? 1 : 0)
    case 'search': {
      const lo = x.lo.at(j, 0), hi = x.hi.at(j, 0), mid = x.mid.at(j, null)
      return (mid !== null && (mid === lo ? 1 : 0) + (mid === hi ? 1 : 0) + (lo === hi ? 1 : 0)) || 0
    }
    case 'list': return countAt(x.addedAt, j) * 10 + x.labels.length
    case 'intervals': return intervalsAt(x, j)
    case 'tree': return countAt(x.addedAt, j)
    case 'game': return countAt(x.addedAt, j)
  }
}

/** A union-find's tallest tree at step j (a few parent steps per element; only touched elements have any). */
function dsuDepth(d: DsuInst, j: number): number {
  const par = (x: number) => d.parent.get(x)?.at(j) ?? x
  let best = 0
  for (const x of d.parent.keys()) {
    let depth = 0
    for (let r = x; par(r) !== r && depth < 64; r = par(r)) depth++
    best = Math.max(best, depth)
  }
  return best
}

/**
 * The steps at which a slot's structures are measured: where one starts being shown in the case, where it ends, and
 * the steps its own events change it, the tallest first. The pane keeps room for the tallest of them.
 */
export function slotProbes(m: FamilyModel, plan: CasePlan, slot: Slot): { x: Inst; at: number }[] {
  const all: { x: Inst; at: number; w: number }[] = []
  for (const x of slot.insts.slice(-PROBE_INSTANCES)) {
    const a = Math.max(plan.cs, x.createdAt)
    const b = Math.min(plan.ce, x.endAt - 1, m.N)
    if (b < a) continue
    const seen = new Set<number>([a, b])
    const stride = Math.max(1, Math.ceil((b - a + 1) / PROBE_SCAN))
    for (let j = a; j <= b; j += stride) if (m.sidAt[j - 1] === x.sid) seen.add(j)
    for (const j of seen) all.push({ x, at: j, w: 0 })
  }
  if (all.length <= PROBE_MAX) return all.map(({ x, at }) => ({ x, at }))
  for (const p of all) p.w = weight(p.x, p.at)
  // the ends, the tallest, then evenly spread over the rest
  const pick = new Map<string, { x: Inst; at: number }>()
  const add = (p: { x: Inst; at: number }) => { if (pick.size < PROBE_MAX) pick.set(`${p.x.sid}:${p.at}`, p) }
  for (const x of slot.insts.slice(-PROBE_INSTANCES)) {
    // a Set keeps insertion order: the instance's first and last step in the case come first
    for (const p of all.filter(q => q.x === x).slice(0, 2)) add(p)
  }
  for (const p of [...all].sort((p, q) => q.w - p.w || q.at - p.at).slice(0, 8)) add(p)
  const step = Math.max(1, Math.floor(all.length / (PROBE_MAX - pick.size + 1)))
  for (let i = 0; i < all.length && pick.size < PROBE_MAX; i += step) add(all[i])
  return [...pick.values()]
}

/** The widest and tallest of an intervals structure's values over its whole life: its axis never changes inside a case. */
export function intervalsExtent(iv: IntervalsInst): [number, number] {
  let lo = 0
  let hi = 1
  const see = (s: number, e: number) => { lo = Math.min(lo, s, e); hi = Math.max(hi, s, e) }
  for (let i = 0; i < iv.initial; i++) see(iv.start[2 * i], iv.start[2 * i + 1])
  for (const t of iv.items.values()) for (const [s, e] of t.vs) see(s, e)
  return [lo, Math.max(lo + 1, hi)]
}

/** The structures of a kind alive at step k (created at or before k, not yet replaced), in creation order. */
export function liveAt(m: FamilyModel, kind: Kind, k: number): Inst[] {
  const e = m.byKind.get(kind)
  if (!e) return []
  return e.insts.slice(0, countAt(e.createdAt, k)).filter(x => k < x.endAt)
}

/**
 * Addendum 3: the boxes a panel draws at step k: the MAX_BOXES most recent live structures, plus the one the
 * step's event touched, in creation order; `total` is how many are alive.
 */
export function boxesAt(m: FamilyModel, kind: Kind, k: number): { boxes: Inst[]; total: number } {
  const e = m.byKind.get(kind)
  if (!e) return { boxes: [], total: 0 }
  const c = countAt(e.createdAt, k)
  const total = c - countAt(e.endAts, k)
  const boxes: Inst[] = []
  let i = c - 1
  while (i >= 0 && boxes.length < MAX_BOXES) {
    // a whole block replaced by step k holds no live structure: skip it
    if (i % BLOCK === BLOCK - 1 && e.blockEnd[Math.floor(i / BLOCK)] <= k) { i -= BLOCK; continue }
    if (k < e.insts[i].endAt) boxes.push(e.insts[i])
    i--
  }
  boxes.reverse()
  const sid = k >= 1 && k <= m.N && m.kindAt[k - 1] === kind ? m.sidAt[k - 1] : -1
  const x = sid >= 0 ? m.bySid.get(sid) : undefined
  // Addendum 4: the structure the current event touched is drawn for that step, even once replaced
  if (x && x.kind === kind && x.createdAt <= k && !boxes.includes(x)) {
    boxes.push(x)
    boxes.sort((a, b) => a.createdAt - b.createdAt)
  }
  return { boxes, total }
}

/** The panel caption at step k: the step's pinned text when its event belongs to the panel, else empty. */
export function captionAt(m: FamilyModel, kind: Kind, k: number): string {
  return k >= 1 && k <= m.N && m.kindAt[k - 1] === kind ? m.caption[k - 1] : ''
}

/** The element keys of structure sid touched at step k. */
export function currentAt(m: FamilyModel, sid: number, k: number): Set<string> {
  if (k < 1 || k > m.N || m.sidAt[k - 1] !== sid) return new Set()
  return new Set(m.current[k - 1] ?? [])
}

// ---------------------------------------------------------------- views at step k

export type ElState = 'current' | 'visited' | 'seen' | 'idle' | 'tree' | 'window'

export interface GraphView {
  nodes: { id: number; text: string; state: ElState; mark: string; slot: number }[]
  edges: { key: string; u: number; v: number; text: string; state: ElState }[]
  total: number
  directed: boolean
}

export function graphView(g: GraphInst, k: number, cur: Set<string>): GraphView {
  const count = countAt(g.addedAt, k)
  const must: number[] = []
  for (const c of cur) {
    const [tag, rest] = c.split(':')
    if (tag === 'node' || tag === 'from') { const i = g.index.get(Number(rest)); if (i !== undefined) must.push(i) }
    if (tag === 'edge') for (const part of edgeEnds(rest)) { const i = g.index.get(part); if (i !== undefined) must.push(i) }
  }
  const idx = windowIndices(count, WINDOW.graph, must)
  const drawn = new Set(idx.map(i => g.order[i]))
  const nodes = idx.map((i, slot) => {
    const id = g.order[i]
    const d = g.dist.get(id)?.at(k)
    const mark = g.mark.get(id)?.at(k) ?? ''
    const visited = (g.visitedAt.get(id) ?? Infinity) <= k
    const state: ElState = cur.has(`node:${id}`) ? 'current' : visited ? 'visited' : d !== undefined || mark !== '' ? 'seen' : 'idle'
    return { id, text: `${id}${d !== undefined ? ` · ${d}` : ''}${mark !== '' ? ` · ${mark}` : ''}`, state, mark, slot }
  })
  const isTree = (u: number, v: number) => g.relaxFrom.get(v)?.at(k) === u || (!g.directed && g.relaxFrom.get(u)?.at(k) === v)
  const edges: GraphView['edges'] = []
  let curEdge: GraphView['edges'][number] | null = null
  for (const e of g.edges) {
    if (e.addedAt > k) break
    if (!drawn.has(e.u) || !drawn.has(e.v)) continue
    const w = e.w.at(k, null)
    const state: ElState = cur.has(`edge:${e.key}`) ? 'current' : isTree(e.u, e.v) ? 'tree' : 'idle'
    const item = { key: e.key, u: e.u, v: e.v, text: w === null ? '' : String(w), state }
    if (state === 'current') curEdge = item
    if (edges.length < WINDOW.edges) edges.push(item)
    else if (state !== 'current') continue
  }
  if (curEdge && !edges.includes(curEdge)) edges.push(curEdge)
  return { nodes, edges, total: count, directed: g.directed }
}

export interface HeapView { slots: { i: number; text: string; current: boolean }[]; tree: { i: number; text: string; current: boolean }[]; len: number }

export function heapView(h: HeapInst, k: number, cur: Set<string>): HeapView {
  const len = h.len.at(k, 0)
  let curSlot = -1
  for (const c of cur) if (c.startsWith('slot:')) curSlot = Number(c.slice(5))
  const item = (i: number) => {
    const [key, prio] = h.slots[i].at(k, [0, 0])
    return { i, text: `${key} (${prio})`, current: i === curSlot }
  }
  const slots = windowIndices(len, WINDOW.heapSlots, curSlot >= 0 ? [curSlot] : []).map(item)
  // the tree form: 5 levels from the ancestor 4 levels above the current slot (or from the root)
  let root = 0
  if (curSlot >= 0) {
    let up = curSlot
    for (let d = 0; d < WINDOW.heapLevels - 1 && up > 0; d++) up = (up - 1) >> 1
    root = up
  }
  const tree: HeapView['tree'] = []
  let level = [root]
  for (let d = 0; d < WINDOW.heapLevels && level.length; d++) {
    const next: number[] = []
    for (const i of level) {
      if (i >= len) continue
      tree.push(item(i))
      next.push(2 * i + 1, 2 * i + 2)
    }
    level = next
  }
  return { slots, tree, len }
}

export function queueView(q: QueueInst, k: number, cur: Set<string>) {
  const head = q.head.at(k, 0)
  const tail = q.tail.at(k, 0)
  const len = Math.max(0, tail - head)
  let curItem = -1
  for (const c of cur) if (c.startsWith('item:')) curItem = Number(c.slice(5))
  return { len, items: windowIndices(len, WINDOW.queue, curItem >= 0 ? [curItem] : []).map(i => ({ i, text: String(q.log[head + i]), current: i === curItem })) }
}

export function dsuView(d: DsuInst, k: number, cur: Set<string>) {
  const must: number[] = []
  for (const c of cur) if (c.startsWith('node:')) must.push(Number(c.slice(5)))
  const parentOf = (x: number) => d.parent.get(x)?.at(k) ?? x
  const nodes = windowIndices(d.n, WINDOW.dsu, must).map(x => {
    const p = parentOf(x)
    return { x, parent: p, root: p === x, current: cur.has(`node:${x}`) }
  })
  const count = d.count.at(k, d.n)
  return { nodes, count: count === 1 ? '1 set' : `${count} sets`, n: d.n }
}

export function arrayView(a: ArrayInst, k: number, cur: Set<string>) {
  const must: number[] = []
  for (const c of cur) if (c.startsWith('cell:')) must.push(Number(c.slice(5)))
  const win = a.window.at(k, null)
  const pointers = a.labels.map(label => ({ label, index: a.pointers.get(label)!.at(k) })).filter((p): p is { label: string; index: number } => p.index !== undefined)
  // with nothing written now, a big array centres on the first pointer, else on the window
  const anchor = must.length ? must : pointers.length ? [Math.max(0, Math.min(a.n - 1, pointers[0].index))] : win ? [Math.max(0, win[0])] : []
  const cells = windowIndices(a.n, WINDOW.array, anchor.concat(must.slice(1))).map(i => {
    const v = cellAt(a, i, k)
    const state: ElState = cur.has(`cell:${i}`) ? 'current' : win && win[0] <= i && i <= win[1] ? 'window' : 'idle'
    return { i, text: ch(a.chars, v), state }
  })
  return { cells, pointers: pointers.map(p => ({ ...p, current: cur.has(`pointer:${p.label}`) })), n: a.n }
}

export function searchView(s: SearchInst, k: number, cur: Set<string>) {
  const lo = s.lo.at(k, 0)
  const hi = s.hi.at(k, 0)
  const mid = s.mid.at(k, null)
  const shown = s.probeOrder.filter(m => s.probes.get(m)!.firstAt <= k).sort((a, b) => a - b)
  let curProbe = -1
  for (const c of cur) if (c.startsWith('probe:')) curProbe = shown.indexOf(Number(c.slice(6)))
  const probes = windowIndices(shown.length, WINDOW.search, curProbe >= 0 ? [curProbe] : []).map(i => {
    const m = shown[i]
    return { m, pred: s.probes.get(m)!.pred.at(k, false), current: cur.has(`probe:${m}`) }
  })
  return { lo, hi, mid, probes, cur }
}

export function listView(l: ListInst, k: number, cur: Set<string>) {
  const count = countAt(l.addedAt, k)
  const must: number[] = []
  for (const c of cur) if (c.startsWith('node:')) { const i = l.order.indexOf(Number(c.slice(5))); if (i >= 0) must.push(i) }
  const nodes = windowIndices(count, WINDOW.list, must).map(i => {
    const id = l.order[i]
    const next = l.next.get(id)?.at(k) ?? -1
    return { id, text: String(l.val.get(id)!.at(k, 0)), next: next === -1 ? 'nil' : String(next), current: cur.has(`node:${id}`) }
  })
  const pointers = l.labels.map(label => ({ label, node: l.pointers.get(label)!.at(k) })).filter((p): p is { label: string; node: number } => p.node !== undefined)
    .map(p => ({ label: p.label, node: p.node === -1 ? 'nil' : String(p.node), current: cur.has(`pointer:${p.label}`) }))
  return { nodes, pointers, count }
}

export function intervalsView(iv: IntervalsInst, k: number, cur: Set<string>) {
  const count = intervalsAt(iv, k)
  const must: number[] = []
  for (const c of cur) if (c.startsWith('interval:')) must.push(Number(c.slice(9)))
  return {
    count,
    items: windowIndices(count, WINDOW.intervals, must).map(i => {
      const [s, e] = itemAt(iv, i, k)
      return { i, text: `[${s},${e}]`, mark: iv.marks.get(i)?.at(k) ?? '', current: cur.has(`interval:${i}`) }
    }),
  }
}

export function treeView(t: TreeInst, k: number, cur: Set<string>) {
  const count = countAt(t.addedAt, k)
  const must: number[] = []
  for (const c of cur) if (c.startsWith('node:')) { const i = t.order.indexOf(Number(c.slice(5))); if (i >= 0) must.push(i) }
  const nodes = windowIndices(count, WINDOW.tree, must).map(i => {
    const id = t.order[i]
    const n = t.info.get(id)!
    const mark = t.mark.get(id)?.at(k) ?? ''
    const state: ElState = cur.has(`node:${id}`) ? 'current' : (t.visitedAt.get(id) ?? Infinity) <= k ? 'visited' : 'idle'
    return { id, val: n.val, parent: n.parent, side: n.side, mark, state, text: `${n.val}${mark !== '' ? ` · ${mark}` : ''}` }
  })
  return { nodes, count }
}

export function gameView(g: GameInst, k: number, cur: Set<string>) {
  const count = countAt(g.addedAt, k)
  const must: number[] = []
  for (const c of cur) if (c.startsWith('state:')) { const i = g.order.indexOf(c.slice(6)); if (i >= 0) must.push(i) }
  return {
    count,
    states: windowIndices(count, WINDOW.game, must).map(i => {
      const state = g.order[i]
      const outcome = g.outcome.get(state)!.at(k) ?? 'unknown'
      const value = g.value.get(state)!.at(k, null)
      return { state, outcome, text: value === null ? `${state} · ${outcome}` : `${state} · ${outcome} (${value})`, current: cur.has(`state:${state}`) }
    }),
  }
}

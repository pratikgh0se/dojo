// C-RUNNER §5: the DP view's model. Built once per run from the toolkit steps; each step's view is then
// derived on demand (cheap enough for 20000 steps: a table replays only its own writes).
import { isFamilyOp } from '../../shared/stepShape.mjs'
import { cellName, recurrenceText, type TableShape } from './recurrence'
import type { Step } from './types'

export interface TableInst extends TableShape { t: number; at: number }
export interface TreeNode {
  /** the step (event order, from 1) that created this node: its test id is dp-node-<n> */
  n: number
  fn: string
  args: number[]
  hit: boolean
  depth: number
  exitAt: number | null
  ret: number | null
  /** index (in nodes) of the call this one was made from; -1 for a top-level call */
  parent: number
  /** the case this call ran in (its case marker's id; 0 before any marker) */
  caseId: number
}
interface SetRec { k: number; i: number; j: number; v: number }

export interface DpModel {
  steps: Step[]
  N: number
  tables: Map<number, TableInst>
  firstTable: number | null
  /** active[k]: the table touched last at or before step k (-1: none yet) */
  active: Int32Array
  sets: Map<number, SetRec[]>
  links: { fn: string; table: string }[]
  nodes: TreeNode[]
  hasTable: boolean
  hasTree: boolean
  /** calls (not cache hits) that never got their tk.Exit: a forgotten Exit, or a panic mid-call */
  unexited: number
}

export function buildModel(steps: Step[]): DpModel {
  const N = steps.length
  const tables = new Map<number, TableInst>()
  const sets = new Map<number, SetRec[]>()
  const links: { fn: string; table: string }[] = []
  const nodes: TreeNode[] = []
  const active = new Int32Array(N + 1).fill(-1)
  const stack: number[] = []
  let firstTable: number | null = null
  let cur = -1
  let caseId = 0
  for (let k = 1; k <= N; k++) {
    const ev = steps[k - 1]
    // M5: a new case starts a new call tree, whatever the last case left open.
    if (ev.case !== undefined) { stack.length = 0; caseId = ev.case }
    const parent = stack.length ? stack[stack.length - 1] : -1
    switch (ev.op) {
      case 'table':
        tables.set(ev.t, { t: ev.t, name: ev.name, rows: ev.rows, cols: ev.cols, at: k })
        if (firstTable === null) firstTable = ev.t
        cur = ev.t
        break
      case 'set': {
        cur = ev.t
        let list = sets.get(ev.t)
        if (!list) sets.set(ev.t, (list = []))
        list.push({ k, i: ev.i, j: ev.j, v: ev.v })
        break
      }
      case 'get':
        cur = ev.t
        break
      case 'enter':
        nodes.push({ n: k, fn: ev.fn, args: ev.args, hit: false, depth: stack.length, exitAt: null, ret: null, parent, caseId })
        stack.push(nodes.length - 1)
        break
      case 'hit':
        nodes.push({ n: k, fn: ev.fn, args: ev.args, hit: true, depth: stack.length, exitAt: null, ret: null, parent, caseId })
        break
      case 'exit': {
        const at = stack.pop()
        if (at !== undefined) {
          nodes[at].exitAt = k
          nodes[at].ret = ev.v
        }
        break
      }
      case 'link':
        links.push({ fn: ev.fn, table: ev.table })
        break
      default:
        break
    }
    active[k] = cur
  }
  const unexited = nodes.reduce((n, x) => n + (!x.hit && x.exitAt === null ? 1 : 0), 0)
  return { steps, N, tables, firstTable, active, sets, links, nodes, hasTable: tables.size > 0, hasTree: nodes.length > 0, unexited }
}

/** The view has something to draw: a table or a call tree (C-RUNNER §5). */
export function hasDp(steps: Step[]): boolean {
  return steps.some(s => s.op === 'table' || s.op === 'set' || s.op === 'get' || s.op === 'enter' || s.op === 'hit' || s.op === 'exit')
}

/** C-VISUAL §3: Do shows the step container after any run with a DP or family step. */
export function hasSteps(steps: Step[]): boolean {
  return hasDp(steps) || steps.some(s => isFamilyOp(s.op) || s.op === 'unshown')
}

export interface TableView {
  table: TableInst
  /** cell index (i*cols+j) → value at this step; a missing key is an unset cell */
  values: Map<number, number>
  current: [number, number] | null
  deps: [number, number][]
  /** the recurrence of the write at this step, or '' when this step writes nothing */
  recurrence: string
  /** the cell written last at or before this step (where a big table's window centres) */
  focus: [number, number] | null
}

const inside = (t: TableShape, i: number, j: number) => i >= 0 && i < t.rows && j >= 0 && j < t.cols

export function tableAt(m: DpModel, k: number): TableView | null {
  const id = k >= 1 && k <= m.N && m.active[k] >= 0 ? m.active[k] : m.firstTable
  if (id === null) return null
  return tableViewFor(m, id, k)
}

/**
 * ui-dp-view P1: the tables drawn at step k, one pane each, in creation order: every table created at or
 * before k, a same-name re-creation replacing the earlier one (runner Addendum 1 Q4). Before the first
 * table exists, the first one (empty).
 */
export function tablesAt(m: DpModel, k: number): number[] {
  const byName = new Map<string, TableInst>()
  for (const t of m.tables.values()) if (t.at <= k) byName.set(t.name, t)
  const ids = [...byName.values()].sort((a, b) => a.at - b.at).map(t => t.t)
  return ids.length || m.firstTable === null ? ids : [m.firstTable]
}

/** The step of the latest write to (i, j) of table id at or before step k, or null. */
export function latestWrite(m: DpModel, id: number, i: number, j: number, k: number): number | null {
  let at: number | null = null
  for (const r of m.sets.get(id) ?? []) {
    if (r.k > k) break
    if (r.i === i && r.j === j) at = r.k
  }
  return at
}

/** The table id's view at step k (its values after events 1..k; the write at k is current when it is this table's). */
export function tableViewFor(m: DpModel, id: number, k: number): TableView {
  const table = m.tables.get(id) ?? { t: id, name: '?', rows: 1, cols: 1, at: 0 }
  const values = new Map<number, number>()
  let focus: [number, number] | null = null
  for (const r of m.sets.get(id) ?? []) {
    if (r.k >= k) break
    if (inside(table, r.i, r.j)) {
      values.set(r.i * table.cols + r.j, r.v)
      focus = [r.i, r.j]
    }
  }
  const ev = m.steps[k - 1]
  if (!ev || ev.op !== 'set' || ev.t !== id) return { table, values, current: null, deps: [], recurrence: '', focus }
  const recurrence = recurrenceText(table, ev, (i, j) => (inside(table, i, j) ? values.get(i * table.cols + j) ?? 0 : null))
  if (inside(table, ev.i, ev.j)) values.set(ev.i * table.cols + ev.j, ev.v)
  return { table, values, current: [ev.i, ev.j], deps: ev.deps, recurrence, focus: [ev.i, ev.j] }
}

const call = (fn: string, args: number[]) => `${fn}(${args.join(',')})`

/** Node text: `fn(a)` / `fn(a,b)`, plus ` → v` once it has returned at this step; a hit is `f(3) (cached)` (Addendum 1 Q6). */
export function nodeText(node: TreeNode, k: number): string {
  const head = call(node.fn, node.args)
  if (node.hit) return `${head} (cached)`
  return node.exitAt !== null && node.exitAt <= k && node.ret !== null ? `${head} → ${node.ret}` : head
}

/** How many nodes exist at step k (nodes are in step order). */
export function nodesAt(m: DpModel, k: number): number {
  let lo = 0
  let hi = m.nodes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (m.nodes[mid].n <= k) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** tk.Link: fn(a) is cell (0,a) and fn(a,b) is cell (a,b) of the linked table; null when unlinked. */
export function nodeCell(m: DpModel, node: Pick<TreeNode, 'fn' | 'args'>, tableName: string): [number, number] | null {
  if (!m.links.some(l => l.fn === node.fn && l.table === tableName)) return null
  if (node.args.length === 1) return [0, node.args[0]]
  if (node.args.length === 2) return [node.args[0], node.args[1]]
  return null
}

/** A line saying what step k did. */
export function narrate(m: DpModel, k: number): string {
  const ev = m.steps[k - 1]
  if (!ev) return ''
  const shape = (t: number): TableShape => m.tables.get(t) ?? { name: '?', rows: 1, cols: 1 }
  switch (ev.op) {
    case 'table': return `new table ${ev.name}: ${ev.rows}×${ev.cols}`
    case 'set': return `write ${cellName(shape(ev.t), ev.i, ev.j)} ← ${ev.v}`
    case 'get': return `read ${cellName(shape(ev.t), ev.i, ev.j)} → ${ev.v}`
    case 'enter': return `call ${call(ev.fn, ev.args)}`
    case 'hit': return `cache hit ${call(ev.fn, ev.args)}`
    case 'exit': return `return ${ev.v}`
    case 'link': return `link ${ev.fn} ↔ ${ev.table}`
    default: return '' // a family step: its panel's caption says what it did
  }
}

/** The window of a big table that is drawn: at most maxR×maxC cells, around `focus`. */
export function tableWindow(t: TableShape, focus: [number, number] | null, maxR: number, maxC: number) {
  const R = Math.min(t.rows, maxR)
  const C = Math.min(t.cols, maxC)
  const [fi, fj] = focus ?? [0, 0]
  const clamp = (x: number, n: number, w: number) => Math.max(0, Math.min(n - w, x - Math.floor(w / 2)))
  return { r0: clamp(fi, t.rows, R), c0: clamp(fj, t.cols, C), R, C }
}

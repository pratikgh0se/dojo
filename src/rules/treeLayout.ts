import type { PlanNode } from '../data/planV2'
import { CN_LINE, depthsOf, preEdges, titleLines, TREE_GRID, type Box, type TextWidth } from './skillView'

/**
 * The DSA and Design trees (trees-and-banks.md, TREE-05 and TREE-06): nodes in rows by prerequisite depth, read top to bottom like the AI
 * maps. A node is in row 0 when its `pre` is empty, else one row below the deepest of its `pre`; a depth with more than `perRow` nodes
 * wraps into several rows before the next depth starts, so every arrow runs from a higher row to a lower one. The cells of the shipped
 * trees are hard-coded in `TREE_GRID` (reviewable, deterministic); `computeTreeGrid` is the rule that produced them and the fallback for a
 * plan whose nodes the table does not cover, or for a canvas narrower than five columns.
 */

export const TREE_MAX_PER_ROW = 5
export interface GridCell { r: number; c: number }

type Pre = (id: string) => readonly string[]

/** The depth rule of the contract: 0 for an empty `pre`, else 1 + the deepest `pre` (a `pre` outside the list does not count). */
export function treeDepths(nodes: readonly PlanNode[]): Map<string, number> {
  return depthsOf(nodes.map(n => n.id), id => nodes.find(n => n.id === id)?.pre ?? [])
}

/** The sizes of the rows a depth of `n` nodes wraps into: as few rows as `perRow` allows, as even as possible. */
export function chunkSizes(n: number, perRow: number): number[] {
  const rows = Math.max(1, Math.ceil(n / perRow))
  return Array.from({ length: rows }, (_, i) => Math.floor(n / rows) + (i < n % rows ? 1 : 0))
}

/** Increasing columns 0..cols-1, one per ideal position, that stay as close to the ideals as the order allows (DP over the columns). */
function placeInRow(ideals: readonly number[], cols: number): number[] {
  const k = ideals.length
  const INF = 1e9
  const cost: number[][] = Array.from({ length: k + 1 }, () => Array<number>(cols + 1).fill(INF))
  const take: number[][] = Array.from({ length: k + 1 }, () => Array<number>(cols + 1).fill(-1))
  cost[0].fill(0)
  for (let i = 1; i <= k; i++) {
    for (let c = i; c <= cols; c++) {
      const here = cost[i - 1][c - 1] + Math.abs(c - 1 - ideals[i - 1])
      const skip = cost[i][c - 1]
      if (here <= skip) { cost[i][c] = here; take[i][c] = 1 } else { cost[i][c] = skip; take[i][c] = 0 }
    }
  }
  const out: number[] = []
  let c = cols
  for (let i = k; i >= 1;) {
    if (take[i][c] === 1) { out.unshift(c - 1); i--; c-- } else c--
  }
  return out
}

/** Whether the straight segments p-q and s-t cross at a point inside both. */
function cross(p: [number, number], q: [number, number], s: [number, number], t: [number, number]): boolean {
  const o = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = o(p, q, s), d2 = o(p, q, t), d3 = o(s, t, p), d4 = o(s, t, q)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * The cells of one tree: rows by depth (wrapping at `perRow`), columns ordered to cross as little as possible. Layers are swept down by the
 * average column of the parents and up by that of the children, from a few seeded starting orders; the least-crossing result wins
 * (ties: the shortest arrows, then the earliest start), so the same plan always gives the same cells. Rows and columns are 1-based.
 */
export function computeTreeGrid(nodes: readonly PlanNode[], perRow = TREE_MAX_PER_ROW): Map<string, GridCell> {
  const ids = nodes.map(n => n.id)
  const known = new Set(ids)
  const depth = treeDepths(nodes)
  const pre = new Map(nodes.map(n => [n.id, n.pre.filter(p => known.has(p) && p !== n.id)]))
  const kids = new Map<string, string[]>(ids.map(i => [i, []]))
  for (const [id, ps] of pre) for (const p of ps) kids.get(p)!.push(id)
  const maxD = Math.max(0, ...depth.values())
  const layers: string[][] = Array.from({ length: maxD + 1 }, () => [])
  for (const id of ids) layers[depth.get(id) ?? 0].push(id)
  const edges = preEdges(ids, id => pre.get(id) ?? [])

  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

  /** Lay one layer out: sort by ideal, wrap into even rows, place each row in the columns. Returns row-major cells. */
  const placeLayer = (layer: readonly string[], ideal: (id: string) => number): { id: string; row: number; col: number }[] => {
    const order = [...layer].sort((a, b) => ideal(a) - ideal(b))
    const out: { id: string; row: number; col: number }[] = []
    let at = 0
    chunkSizes(order.length, perRow).forEach((size, row) => {
      const chunk = order.slice(at, at + size)
      at += size
      const cols = placeInRow(chunk.map(ideal), perRow)
      chunk.forEach((id, i) => out.push({ id, row, col: cols[i] }))
    })
    return out
  }

  interface State { col: Map<string, number>; sub: Map<string, number> }
  const crossings = (st: State): number => {
    // rows of a node: the layer's first row plus its sub-row; the y of the picture is the running row number
    const rowBase: number[] = []
    let rows = 0
    layers.forEach((l, d) => { rowBase[d] = rows; rows += Math.max(1, ...l.map(id => (st.sub.get(id) ?? 0) + 1)) })
    const pt = (id: string): [number, number] => [st.col.get(id) ?? 0, rowBase[depth.get(id) ?? 0] + (st.sub.get(id) ?? 0)]
    let n = 0
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const [a, b] = edges[i], [c, d] = edges[j]
        if (a === c || b === d || a === d || b === c) continue
        if (cross(pt(a), pt(b), pt(c), pt(d))) n++
      }
    }
    return n
  }
  const length = (st: State): number => edges.reduce((s, [a, b]) => s + Math.abs((st.col.get(a) ?? 0) - (st.col.get(b) ?? 0)), 0)

  let best: { st: State; x: number; len: number } | null = null
  const starts = 24
  for (let s = 0; s < starts; s++) {
    const st: State = { col: new Map(), sub: new Map() }
    // starting order: plan order for the first start, shuffled afterwards
    const startIdeal = new Map(ids.map(id => [id, s === 0 ? ids.indexOf(id) : rnd() * perRow]))
    layers.forEach(l => placeLayer(l, id => startIdeal.get(id)!).forEach(p => { st.col.set(p.id, p.col); st.sub.set(p.id, p.row) }))
    for (let sweep = 0; sweep < 6; sweep++) {
      const down = sweep % 2 === 0
      const order = down ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i)
      for (const d of order) {
        const ideal = (id: string): number => {
          const ns = down ? pre.get(id)! : kids.get(id)!
          if (ns.length === 0) return st.col.get(id) ?? 0
          return ns.reduce((a, n) => a + (st.col.get(n) ?? 0), 0) / ns.length
        }
        placeLayer(layers[d], ideal).forEach(p => { st.col.set(p.id, p.col); st.sub.set(p.id, p.row) })
      }
    }
    const x = crossings(st)
    const len = length(st)
    if (!best || x < best.x || (x === best.x && len < best.len)) best = { st, x, len }
  }
  const out = new Map<string, GridCell>()
  if (!best) return out
  // a map narrower than `perRow` sits in the middle of the width, not against the left or right edge
  const cols = [...best.st.col.values()]
  const shift = cols.length === 0 ? 0 : Math.floor((perRow - (Math.max(...cols) - Math.min(...cols) + 1)) / 2) - Math.min(...cols)
  let rows = 0
  layers.forEach(l => {
    const rowsHere = Math.max(1, ...l.map(id => (best!.st.sub.get(id) ?? 0) + 1))
    for (const id of l) out.set(id, { r: rows + (best!.st.sub.get(id) ?? 0) + 1, c: (best!.st.col.get(id) ?? 0) + shift + 1 })
    rows += rowsHere
  })
  return out
}

/** The cells of a hard-coded picture (`TREE_GRID`): row and column of every token that is not `.`, both 1-based. */
export function parseGrid(rows: readonly string[]): Map<string, GridCell> {
  const out = new Map<string, GridCell>()
  rows.forEach((row, r) => row.trim().split(/\s+/).forEach((tok, c) => { if (tok !== '.') out.set(tok, { r: r + 1, c: c + 1 }) }))
  return out
}

/** The cells to draw: the hard-coded picture of the area for exactly `perRow` columns when it covers exactly these nodes, else the rule. */
export function treeGridFor(nodes: readonly PlanNode[], perRow: number): Map<string, GridCell> {
  const area = nodes[0]?.area
  const rows = area ? TREE_GRID[area]?.[perRow] : undefined
  if (rows) {
    const cells = parseGrid(rows)
    if (cells.size === nodes.length && nodes.every(n => cells.has(n.id))) return cells
  }
  return computeTreeGrid(nodes, perRow)
}

export const TREE_MIN_W = 120
export const TREE_MAX_W = 160
/** The box width below which the narrower gutter is taken, so a long word of a title ("communication") keeps to one line. */
const TREE_ROOMY = 136
export const TREE_PAD = 14
const TREE_GX = [36, 28]
const TREE_LANE_STEP = 8
const TREE_GAP_MIN = 56
const HEAD = 6
/** Space the box chrome takes besides the title lines: padding, the glyph and meter row, borders. */
const CHROME = 46
/** Horizontal room the title text has inside a box: 14 px left padding, 6 px right, 2 px borders, and a little slack. */
const TEXT_INSET = 28

export interface TreeSize { perRow: number; w: number; gx: number }
/** How many columns of how wide a box fit in `avail` px: five when they can (the contract's row width), else fewer, never fewer than two. */
export function treeSize(avail: number): TreeSize {
  for (let perRow = TREE_MAX_PER_ROW; perRow >= 2; perRow--) {
    const sized = TREE_GX.map(gx => ({ gx, w: Math.floor((avail - 2 * TREE_PAD - (perRow - 1) * gx) / perRow) }))
    // the wide gutter while the boxes stay roomy enough for a long word of a title (TREE_ROOMY), else the narrow one: the box wins
    const pick = sized.find(s => s.w >= TREE_ROOMY) ?? sized.reduce((a, b) => (b.w > a.w ? b : a))
    if (pick.w >= TREE_MIN_W) return { perRow, w: Math.min(TREE_MAX_W, pick.w), gx: pick.gx }
  }
  return { perRow: 2, w: TREE_MIN_W, gx: TREE_GX[1] }
}

export interface TreePlaced { node: PlanNode; x: number; y: number; w: number; h: number; row: number; col: number }
export interface TreePath { d: string; hx: number; hy: number }
export interface TreeLayout {
  placed: TreePlaced[]; edges: [string, string][]; paths: Map<string, TreePath>; width: number; height: number
  /** The node ids of each row, left to right, top to bottom: the rows of the contract. */
  rows: string[][]
  obstacles: Box[]
  /** Every arrow as the orthogonal points it runs through, for tests. */
  polylines: Map<string, [number, number][]>
}

type Kind = 'adj' | 'A' | 'B' | 'G'
interface Route {
  key: string; a: TreePlaced; b: TreePlaced; kind: Kind
  /** the gutter an arrow runs down (kind G only), else -1 */
  g: number
  /** x of the vertical run in the gutter (kind G only) */
  xg: number
}
/** One horizontal run in a gap between two rows: the lane of a source (`out`, leaving its node) or of a target (`in`, entering its node). */
interface Lane { key: string; gap: number; end: 'out' | 'in'; node: TreePlaced; upper: number[]; lower: number[]; y: number }

const half = (n: number): number => Math.round(n * 2) / 2

/**
 * Lays the nodes of a tree out in rows and routes one arrow per `pre`, drawn like a tree diagram: the arrows leaving one node share one
 * stem out of its bottom centre and one lane under its row; the arrows entering one node share one lane above its row and one stem into
 * its top centre. An arrow never crosses a box: it drops straight only through column cells that are empty, otherwise it runs down the
 * gutter between two columns, with its own x per source node. Lanes in a gap are ordered to cross as little as possible.
 */
export function layoutTree(nodes: readonly PlanNode[], size: TreeSize, measure?: TextWidth): TreeLayout {
  const { perRow, w: W, gx: GX } = size
  const textW = W - TEXT_INSET
  const ids = nodes.map(n => n.id)
  const grid = treeGridFor(nodes, perRow)
  const edges = preEdges(ids, id => nodes.find(n => n.id === id)?.pre ?? [])
  const heightOf = (n: PlanNode): number => Math.round(CHROME + Math.max(2, titleLines(n.title, textW, measure)) * CN_LINE)

  const rowCount = Math.max(1, ...ids.map(id => grid.get(id)!.r))
  const colCount = Math.max(1, ...ids.map(id => grid.get(id)!.c))
  const rowH = Array.from({ length: rowCount }, (_, i) => Math.max(0, ...nodes.filter(n => grid.get(n.id)!.r === i + 1).map(heightOf)))
  const colLeft = (c: number) => TREE_PAD + c * (W + GX)
  const width = 2 * TREE_PAD + colCount * W + (colCount - 1) * GX
  const cell = new Set(ids.map(id => `${grid.get(id)!.r - 1}:${grid.get(id)!.c - 1}`))
  const colFree = (c: number, r0: number, r1: number): boolean => {
    for (let r = r0; r <= r1; r++) if (cell.has(`${r}:${c}`)) return false
    return true
  }
  const placed: TreePlaced[] = nodes.map(node => {
    const g = grid.get(node.id)!
    return { node, x: colLeft(g.c - 1), y: 0, w: W, h: rowH[g.r - 1], row: g.r - 1, col: g.c - 1 }
  })
  const at = new Map(placed.map(p => [p.node.id, p]))
  const cx = (p: TreePlaced) => p.x + W / 2

  // 1. route kinds, from the grid alone
  const routes: Route[] = []
  for (const [from, to] of edges) {
    const a = at.get(from)!, b = at.get(to)!
    if (b.row <= a.row) continue
    let kind: Kind = 'adj'
    if (b.row > a.row + 1) kind = colFree(a.col, a.row + 1, b.row - 1) ? 'A' : colFree(b.col, a.row + 1, b.row - 1) ? 'B' : 'G'
    routes.push({ key: `${from}>${to}`, a, b, kind, g: -1, xg: 0 })
  }
  // gutters for the G arrows: those between the two columns (beside the column when both are the same), the least loaded, then the nearest the middle
  const usedG = Math.max(0, colCount - 2)
  const load = new Map<number, number>()
  const gOf = new Map<string, number>() // `${source}:${gutter}` -> already chosen for that source: arrows of one source prefer to share
  const pending = routes.filter(r => r.kind === 'G').sort((p, q) => (q.b.row - q.a.row) - (p.b.row - p.a.row) || p.key.localeCompare(q.key))
  for (const r of pending) {
    const lo = Math.min(r.a.col, r.b.col), hi = Math.max(r.a.col, r.b.col)
    let cands = lo === hi ? [lo - 1, lo] : Array.from({ length: hi - lo }, (_, i) => lo + i)
    cands = cands.filter(g => g >= 0 && g <= usedG)
    if (cands.length === 0) cands = [Math.min(usedG, Math.max(0, lo))]
    const mid = (r.a.col + r.b.col) / 2
    const mine = (g: number) => (gOf.has(`${r.a.node.id}:${g}`) ? 0 : 1)
    cands.sort((p, q) => mine(p) - mine(q) || (load.get(p) ?? 0) - (load.get(q) ?? 0) || Math.abs(p + 0.5 - mid) - Math.abs(q + 0.5 - mid) || p - q)
    r.g = cands[0]
    if (!gOf.has(`${r.a.node.id}:${r.g}`)) load.set(r.g, (load.get(r.g) ?? 0) + 1)
    gOf.set(`${r.a.node.id}:${r.g}`, r.g)
  }
  const gutterBox = (g: number) => ({ lo: colLeft(g) + W + 6, hi: colLeft(g + 1) - 6 })
  for (const r of routes) if (r.kind === 'G') r.xg = (gutterBox(r.g).lo + gutterBox(r.g).hi) / 2

  // 2. lanes: one per source node (gap just below its row) and one per target node (gap just above its row), where an arrow needs one
  const lanes = new Map<string, Lane>()
  const lane = (node: TreePlaced, end: 'out' | 'in'): Lane => {
    const key = `${node.node.id}:${end}`
    let l = lanes.get(key)
    if (!l) { l = { key, gap: end === 'out' ? node.row : node.row - 1, end, node, upper: [], lower: [], y: 0 }; lanes.set(key, l) }
    return l
  }
  for (const r of routes) {
    const ax = cx(r.a), bx = cx(r.b)
    if (r.kind === 'A') {
      if (ax !== bx) { const l = lane(r.b, 'in'); l.upper.push(ax); l.lower.push(bx) }
    } else if (r.kind === 'G') {
      const o = lane(r.a, 'out'); o.upper.push(ax); o.lower.push(r.xg)
      const i = lane(r.b, 'in'); i.upper.push(r.xg); i.lower.push(bx)
    } else if (ax !== bx) { const o = lane(r.a, 'out'); o.upper.push(ax); o.lower.push(bx) }
  }
  const span = (l: Lane): [number, number] => { const xs = [...l.upper, ...l.lower]; return [Math.min(...xs), Math.max(...xs)] }
  const orderGap = (ls: Lane[]): Lane[] => {
    const inside = (x: number, l: Lane) => { const [lo, hi] = span(l); return x > lo && x < hi }
    const pair = (i: Lane, j: Lane) => j.upper.filter(x => inside(x, i)).length + i.lower.filter(x => inside(x, j)).length
    const cost = (o: Lane[]) => o.reduce((sum, l, p) => sum + o.slice(p + 1).reduce((s, q) => s + pair(l, q), 0), 0)
    const order = [...ls].sort((p, q) => Math.max(...q.upper) - Math.max(...p.upper) || p.key.localeCompare(q.key))
    for (let pass = 0; pass < 40; pass++) {
      let better = false
      for (let i = 0; i + 1 < order.length; i++) {
        const before = cost(order)
        ;[order[i], order[i + 1]] = [order[i + 1], order[i]]
        if (cost(order) < before) better = true
        else [order[i], order[i + 1]] = [order[i + 1], order[i]]
      }
      if (!better) break
    }
    return order
  }
  const rank = new Map<Lane, number>()
  const laneN: number[] = Array.from({ length: rowCount }, () => 0)
  for (let k = 0; k < rowCount - 1; k++) {
    const mine = orderGap([...lanes.values()].filter(l => l.gap === k))
    mine.forEach((l, i) => rank.set(l, i))
    laneN[k] = mine.length
  }
  const gapH = (k: number): number => Math.max(TREE_GAP_MIN, 12 + 24 + Math.max(0, laneN[k] - 1) * TREE_LANE_STEP)

  // 3. y of every row and lane
  const rowY: number[] = []
  let y = HEAD + 8
  for (let k = 0; k < rowCount; k++) {
    rowY.push(y)
    y += rowH[k] + (k < rowCount - 1 ? gapH(k) : 0)
  }
  const height = y
  for (const p of placed) p.y = rowY[p.row]
  for (const l of lanes.values()) l.y = rowY[l.gap] + rowH[l.gap] + 12 + (rank.get(l) ?? 0) * TREE_LANE_STEP

  // 4. the polyline of every arrow, then the x of each source's run in each gutter: the order that crosses least
  const polyOf = (r: Route): [number, number][] => {
    const ax = cx(r.a), bx = cx(r.b), y0 = r.a.y + r.a.h, y1 = r.b.y - HEAD
    if (r.kind === 'G') {
      const o = lanes.get(`${r.a.node.id}:out`)!.y, i = lanes.get(`${r.b.node.id}:in`)!.y
      return [[ax, y0], [ax, o], [r.xg, o], [r.xg, i], [bx, i], [bx, y1]]
    }
    if (ax === bx) return [[ax, y0], [bx, y1]]
    const ly = (r.kind === 'A' ? lanes.get(`${r.b.node.id}:in`) : lanes.get(`${r.a.node.id}:out`))!.y
    return [[ax, y0], [ax, ly], [bx, ly], [bx, y1]]
  }
  const crossCount = (a: [number, number][], b: [number, number][]): number => {
    let n = 0
    for (let i = 0; i + 1 < a.length; i++) {
      for (let j = 0; j + 1 < b.length; j++) {
        const [p, q, s, t] = [a[i], a[i + 1], b[j], b[j + 1]]
        const pv = p[0] === q[0], sv = s[0] === t[0]
        if (pv === sv) continue
        const [v1, v2, h1, h2] = pv ? [p, q, s, t] : [s, t, p, q]
        if (v1[0] > Math.min(h1[0], h2[0]) && v1[0] < Math.max(h1[0], h2[0]) && h1[1] > Math.min(v1[1], v2[1]) && h1[1] < Math.max(v1[1], v2[1])) n++
      }
    }
    return n
  }
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest])))
  for (let g = 0; g <= usedG; g++) {
    const inG = routes.filter(r => r.kind === 'G' && r.g === g)
    const groups = [...new Set(inG.map(r => r.a.node.id))].sort()
    if (groups.length === 0) continue
    const { lo, hi } = gutterBox(g)
    const n = groups.length
    const slot = (i: number) => half(n === 1 ? (lo + hi) / 2 : lo + (i * (hi - lo)) / (n - 1))
    const setOrder = (order: string[]) => { for (const r of inG) r.xg = slot(order.indexOf(r.a.node.id)) }
    let best = groups
    if (n > 1 && n <= 7) {
      let bestCost = Infinity
      for (const order of perms(groups)) {
        setOrder(order)
        const polys = inG.map(r => ({ r, p: polyOf(r) }))
        let cost = 0
        for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (polys[i].r.a !== polys[j].r.a) cost += crossCount(polys[i].p, polys[j].p)
        if (cost < bestCost) { bestCost = cost; best = order }
      }
    }
    setOrder(best)
  }

  // 5. paths
  const paths = new Map<string, TreePath>()
  const polylines = new Map<string, [number, number][]>()
  for (const r of routes) {
    const p = polyOf(r)
    polylines.set(r.key, p)
    const last = p[p.length - 1]
    paths.set(r.key, { d: p.map((q, i) => `${i === 0 ? 'M' : 'L'}${q[0]} ${q[1]}`).join(' '), hx: last[0] - HEAD / 2, hy: last[1] - HEAD / 2 })
  }
  const rows: string[][] = Array.from({ length: rowCount }, () => [])
  for (const p of [...placed].sort((a, b) => a.col - b.col)) rows[p.row].push(p.node.id)
  return { placed, edges, paths, width, height, rows, polylines, obstacles: placed.map(({ x, y: py, w, h }) => ({ x, y: py, w, h })) }
}

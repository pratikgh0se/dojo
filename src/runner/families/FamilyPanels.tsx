// The family panels inside the trace band (ui-visual-families.md; C-VISUAL §3–§4): each `<kind>-view` is a trace
// pane (a well) with its label, its caption and one box per live structure. Drawings are at their natural pixel
// size (1 SVG unit = 1 CSS px, text at 14 px), with labels inside square tiles; a drawing wider than its box
// scrolls inside it with the current element kept in view. Loaded lazily, only after a run with family steps.
import { useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { edgePath, layoutForest, NODE_H, tileWidth, type Layout } from '../treeLayout'
import {
  arrayView, boxesAt, captionAt, casePlan, currentAt, dsuView, gameView, graphView, heapView, intervalsExtent, intervalsView, listView, MAX_BOXES, queueView, searchView, slotProbes, treeView,
  type ArrayInst, type CasePlan, type DsuInst, type FamilyModel, type GameInst, type GraphInst, type GraphView, type HeapInst, type Inst, type IntervalsInst, type Kind,
  type ListInst, type QueueInst, type SearchInst, type Slot, type TreeInst,
} from './model'
import './families.css'

const TITLES: Record<Kind, string> = {
  graph: 'Graph', heap: 'Heap', queue: 'Queue', dsu: 'Union-find', array: 'Array', search: 'Binary search', list: 'Linked list', intervals: 'Intervals', tree: 'Tree', game: 'Game table',
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const st = (current: boolean) => (current ? 'current' : 'idle')
/** V0.4: a tile's width for its text (Space Mono 14, padding 0 8, border 2). */
const tw = (text: string, min = 36) => tileWidth(text, min)

export default function FamilyPanels({ m, k }: { m: FamilyModel; k: number }) {
  // V0.2: two to a row on desktop; a panel spans the row when it is alone, the last of an odd count, or a big graph or tree
  // UAT r4 (p743) / cu-5 P2-1: judged on every structure the pane holds in this case, at its end, so a panel never changes span mid-case
  const big = (kind: Kind) => {
    if (kind !== 'graph' && kind !== 'tree') return false
    const plan = casePlan(m, kind, k)
    return plan.slots.some(sl => sl.insts.some(x => countNodes(x, Math.min(plan.ce, x.endAt - 1, m.N)) > 12))
  }
  return (
    <>
      {m.kinds.map((kind, i) => {
        const span = m.kinds.length === 1 || (i === m.kinds.length - 1 && m.kinds.length % 2 === 1) || big(kind)
        return <Pane key={kind} m={m} kind={kind} k={k} span={span} />
      })}
    </>
  )
}

function countNodes(x: Inst, k: number): number {
  if (x.kind === 'graph') return graphView(x, k, new Set()).total
  if (x.kind === 'tree') return treeView(x, k, new Set()).count
  return 0
}

const NONE = new Set<string>()
/** What a pane has measured per model: the room (px) one caption or one structure needs in one case at one pane width. */
const roomCache = new WeakMap<FamilyModel, Map<string, number>>()

/**
 * UAT cu-5 P2-1 (V0.3, "one size per case"): a pane keeps one width and one height for a whole case. Its width is its grid
 * cell. Its height is the room its caption and each structure need at the tallest step of the case, found once per case
 * and pane width by drawing a few of the case's steps unseen (`fam-probe`: hidden, outside the flow, gone again before the
 * first paint) and measuring them. Each structure's box then keeps that height from the case's first step, a structure
 * declared later in the case holds its place as an empty box until it appears, and the caption line holds the room of the
 * longest caption.
 */
function Pane({ m, kind, k, span }: { m: FamilyModel; kind: Kind; k: number; span: boolean }) {
  const plan = casePlan(m, kind, k)
  const section = useRef<HTMLElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  let room = roomCache.get(m)
  if (!room) roomCache.set(m, (room = new Map()))
  const wk = Math.round(width)
  const capKey = `${kind}\u0000cap\u0000${plan.cs}\u0000${wk}`
  const slotKey = (name: string) => `${kind}\u0000${name}\u0000${plan.cs}\u0000${wk}`
  const capMissing = wk > 0 && !room.has(capKey)
  const slotsMissing = wk > 0 ? plan.slots.filter(sl => !room!.has(slotKey(sl.name))) : []
  const measuring = capMissing || slotsMissing.length > 0

  useLayoutEffect(() => {
    const el = section.current
    if (!el) return
    const read = () => setWidth(el.clientWidth)
    read()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  // after the probes are drawn: the tallest of each key, kept; the probes are dropped by the render that follows
  useLayoutEffect(() => {
    const host = probe.current
    if (!host || !measuring) return
    const best = new Map<string, number>()
    for (const el of host.querySelectorAll<HTMLElement>('[data-room]')) {
      const key = el.dataset.room as string
      best.set(key, Math.max(best.get(key) ?? 0, Math.ceil(el.getBoundingClientRect().height)))
    }
    if (capMissing) room!.set(capKey, best.get(capKey) ?? 0)
    for (const sl of slotsMissing) room!.set(slotKey(sl.name), best.get(slotKey(sl.name)) ?? 0)
    bump()
  })

  const capRoom = room.get(capKey)
  return (
    <section ref={section} className={`fam-panel fam-pane-${kind}${span ? ' fam-span' : ''}`} data-testid={`${kind}-view`} aria-label={TITLES[kind]}>
      <h3 className="fam-label">{TITLES[kind]}</h3>
      <p className="fam-caption" data-testid={`${kind}-caption`} aria-live="polite" style={capRoom ? { minHeight: capRoom } : undefined}>{captionAt(m, kind, k)}</p>
      <Boxes m={m} kind={kind} k={k} plan={plan} roomOf={name => room!.get(slotKey(name))} />
      {measuring && (
        <div ref={probe} className="fam-probe" aria-hidden="true">
          {capMissing && plan.captions.map(c => <p key={c} className="fam-caption" data-room={capKey}>{c}</p>)}
          {slotsMissing.flatMap(sl => slotProbes(m, plan, sl).map(({ x, at }) => (
            <div key={`${sl.name}:${x.sid}:${at}`} className="fam-box" data-room={slotKey(sl.name)}>
              <Box x={x} k={at} cur={NONE} last={Math.min(m.N, x.endAt)} />
            </div>
          )))}
        </div>
      )}
    </section>
  )
}

/** The boxes a pane draws at step k, in the order its structures first show in the case, a not yet declared one as an empty box that holds its room. */
function boxEntries(plan: CasePlan, boxes: Inst[]): { x?: Inst; slot?: Slot }[] {
  if (plan.slots.length === 0) return boxes.map(x => ({ x }))
  const out: { x?: Inst; slot?: Slot }[] = []
  for (const sl of plan.slots) {
    const live = boxes.filter(x => x.name === sl.name)
    if (live.length) out.push(...live.map(x => ({ x })))
    else out.push({ slot: sl })
  }
  const named = new Set(plan.slots.map(sl => sl.name))
  out.push(...boxes.filter(x => !named.has(x.name)).map(x => ({ x })))
  return out
}

function Boxes({ m, kind, k, plan, roomOf }: { m: FamilyModel; kind: Kind; k: number; plan: CasePlan; roomOf: (name: string) => number | undefined }) {
  const { boxes, total } = boxesAt(m, kind, k)
  return (
    <>
      {total > MAX_BOXES && <p className="fam-note" data-testid={`${kind}-note`}>Showing {MAX_BOXES} of {total} structures</p>}
      {boxEntries(plan, boxes).map(({ x, slot }) => {
        if (!x) {
          // not declared yet in this case: its room is held from the first step, unseen
          const h = roomOf(slot!.name)
          return h ? <div key={`ahead-${slot!.name}`} className="fam-box fam-ahead" aria-hidden="true" style={{ minHeight: h }} /> : null
        }
        const h = roomOf(x.name)
        return (
          <div key={x.sid} className="fam-box" data-testid={`${kind}-box`} data-name={x.name} style={h ? { minHeight: h } : undefined}>
            {/* UAT r4 (open since r3): a structure's last step, so its drawing can keep one size for its whole case */}
            <Box x={x} k={k} cur={currentAt(m, x.sid, k)} last={Math.min(m.N, x.endAt)} />
          </div>
        )
      })}
    </>
  )
}

function Box({ x, k, cur, last }: { x: Inst; k: number; cur: Set<string>; last: number }): ReactNode {
  switch (x.kind) {
    case 'graph': return <GraphBox g={x} k={k} cur={cur} last={last} />
    case 'heap': return <HeapBox h={x} k={k} cur={cur} />
    case 'queue': return <QueueBox q={x} k={k} cur={cur} />
    case 'dsu': return <DsuBox d={x} k={k} cur={cur} />
    case 'array': return <ArrayBox a={x} k={k} cur={cur} />
    case 'search': return <SearchBox s={x} k={k} cur={cur} />
    case 'list': return <ListBox l={x} k={k} cur={cur} />
    case 'intervals': return <IntervalsBox iv={x} k={k} cur={cur} />
    case 'tree': return <TreeBox t={x} k={k} cur={cur} last={last} />
    case 'game': return <GameBox g={x} k={k} cur={cur} />
  }
}

const Name = ({ name, desc }: { name: string; desc: string }) => <p className="fam-name">{name} · {desc}</p>
const Empty = () => <p className="fam-empty">empty</p>
const Note = ({ kind, children }: { kind: Kind; children: ReactNode }) => <p className="fam-note" data-testid={`${kind}-note`}>{children}</p>

/** A box's own scroller: a drawing wider than the box scrolls inside it, the current element kept in view. */
function Scroll({ children, dep }: { children: ReactNode; dep: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const sc = ref.current
    const el = sc?.querySelector<HTMLElement | SVGElement>('[data-state="current"]')
    if (!sc || !el) return
    const s = sc.getBoundingClientRect()
    const e = el.getBoundingClientRect()
    if (e.right > s.left + sc.clientWidth - 8) sc.scrollLeft += e.right - (s.left + sc.clientWidth) + 12
    if (e.left < s.left + 8) sc.scrollLeft -= s.left - e.left + 12
  }, [dep])
  return <div ref={ref} className="fam-sc sc">{children}</div>
}

// ---------------------------------------------------------------- V1 graph

type Pt = { x: number; y: number; w: number }

/** V1: a layered layout: directed by BFS depth from the lowest id; undirected on a circle up to 8 nodes, else layered. */
function graphLayout(v: GraphView): { pos: Map<number, Pt>; width: number; height: number } {
  const ids = v.nodes.map(n => n.id)
  const w = new Map(v.nodes.map(n => [n.id, tw(n.text)]))
  const pos = new Map<number, Pt>()
  const M = 24
  if (!v.directed && ids.length <= 8 && ids.length > 2) {
    const maxW = Math.max(...ids.map(i => w.get(i)!))
    const R = Math.max(60, (ids.length * (maxW + 24)) / (2 * Math.PI))
    const sorted = [...ids].sort((a, b) => a - b)
    sorted.forEach((id, i) => {
      const a = (2 * Math.PI * i) / sorted.length - Math.PI / 2
      pos.set(id, { x: M + maxW / 2 + R + R * Math.cos(a), y: M + 16 + R + R * Math.sin(a), w: w.get(id)! })
    })
    return { pos, width: Math.ceil(2 * (M + R) + maxW), height: Math.ceil(2 * (M + R) + 32) }
  }
  const adj = new Map<number, number[]>(ids.map(i => [i, []]))
  for (const e of v.edges) {
    adj.get(e.u)?.push(e.v)
    if (!v.directed) adj.get(e.v)?.push(e.u)
  }
  const depth = new Map<number, number>()
  const order: number[] = []
  for (const start of [...ids].sort((a, b) => a - b)) {
    if (depth.has(start)) continue
    depth.set(start, 0)
    const q = [start]
    while (q.length) {
      const u = q.shift() as number
      order.push(u)
      for (const x of adj.get(u) ?? []) if (!depth.has(x)) { depth.set(x, depth.get(u)! + 1); q.push(x) }
    }
  }
  const rows: number[][] = []
  for (const id of order) (rows[depth.get(id)!] ??= []).push(id)
  // node pitch ≥ tile width + 24 (V1); 64 leaves room for a weight chip on an edge within a row
  const GAP = 64
  const rowW = rows.map(r => r.reduce((s, id) => s + w.get(id)! + GAP, -GAP))
  const W = Math.max(0, ...rowW)
  rows.forEach((r, d) => {
    let x = M + (W - rowW[d]) / 2
    for (const id of r) { const ww = w.get(id)!; pos.set(id, { x: x + ww / 2, y: M + d * 72 + 16, w: ww }); x += ww + GAP }
  })
  return { pos, width: Math.ceil(W + 2 * M), height: Math.max(1, rows.length) * 72 - 40 + 2 * M }
}

/** Where the segment from a's centre toward b's leaves a's tile (a 32 px tall, w wide rectangle). */
function borderPoint(a: Pt, b: Pt): [number, number] {
  const dx = b.x - a.x, dy = b.y - a.y
  if (!dx && !dy) return [a.x, a.y]
  const sx = dx ? a.w / 2 / Math.abs(dx) : Infinity
  const sy = dy ? NODE_H / 2 / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return [a.x + dx * s, a.y + dy * s]
}

/**
 * UAT r4 (open since r3, p743): the graph is laid out once, from its final state in this case, so nodes keep their
 * places and the drawing keeps one size while edges are added; a tile only takes the width of its text at step k.
 * A step whose nodes the final layout doesn't hold (a windowed big graph) falls back to its own layout.
 */
function stableGraphLayout(v: GraphView, fin: ReturnType<typeof graphLayout> | null): ReturnType<typeof graphLayout> {
  if (!fin || !v.nodes.every(n => fin.pos.has(n.id))) return graphLayout(v)
  const pos = new Map<number, Pt>()
  for (const n of v.nodes) pos.set(n.id, { ...fin.pos.get(n.id)!, w: tw(n.text) })
  return { pos, width: fin.width, height: fin.height }
}

function GraphBox({ g, k, cur, last }: { g: GraphInst; k: number; cur: Set<string>; last: number }) {
  const v = graphView(g, k, cur)
  const fin = useMemo(() => {
    const end = graphView(g, last, new Set())
    return end.total > 0 ? graphLayout(end) : null
  }, [g, last])
  const { pos, width, height } = stableGraphLayout(v, fin)
  return (
    <>
      <Name name={g.name} desc={`${g.directed ? 'directed' : 'undirected'} · ${plural(v.total, 'node', 'nodes')}`} />
      {v.nodes.length < v.total && <Note kind="graph">Showing {v.nodes.length} of {v.total} nodes around the current one</Note>}
      {v.total === 0 ? <Empty /> : (
        <Scroll dep={k}>
          <svg className="fam-svg fam-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Graph ${g.name}`}>
            {v.edges.map(e => {
              const a = pos.get(e.u), b = pos.get(e.v)
              if (!a || !b) return null
              const [x1, y1] = borderPoint(a, b)
              const [x2, y2] = borderPoint(b, a)
              const len = Math.hypot(x2 - x1, y2 - y1) || 1
              const ux = (x2 - x1) / len, uy = (y2 - y1) / len
              const hx = x2 - ux * 8, hy = y2 - uy * 8
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
              const lw = e.text ? e.text.length * 8.6 + 8 : 0
              return (
                <g key={e.key} className="fam-edge" data-testid={`graph-edge-${e.key}`} data-state={e.state}>
                  <line x1={x1} y1={y1} x2={g.directed ? hx : x2} y2={g.directed ? hy : y2} />
                  {g.directed && <polygon className="fam-head" points={`${x2},${y2} ${hx + uy * 4},${hy - ux * 4} ${hx - uy * 4},${hy + ux * 4}`} />}
                  {e.text && <rect className="fam-chip" x={mx - lw / 2} y={my - 11} width={lw} height={22} />}
                  {e.text && <text x={mx} y={my + 5} textAnchor="middle">{e.text}</text>}
                </g>
              )
            })}
            {v.nodes.map(n => {
              const p = pos.get(n.id)!
              return (
                <g key={n.id} className="fam-tile" data-testid={`graph-node-${n.id}`} data-state={n.state} data-mark={n.mark}>
                  <rect x={p.x - p.w / 2} y={p.y - 16} width={p.w} height={32} />
                  <text x={p.x} y={p.y + 5} textAnchor="middle">{n.text}</text>
                </g>
              )
            })}
          </svg>
        </Scroll>
      )}
    </>
  )
}

// ---------------------------------------------------------------- V2 heap, V3 queue

/**
 * A small tree of tiles (heap tree, DSU sets, Tree): the DP tree's tidy layout and orthogonal edges. With `fixed`, the
 * layout of the structure's final shape (UAT cu-5 P2-1): every tile sits where it will sit in the end, so tiles
 * keep their places and the drawing its size while nodes appear. A node the fixed layout doesn't hold falls back to a
 * layout of the nodes drawn now.
 */
function TileTree({ nodes, testid, ariaLabel, fixed }: {
  nodes: { key: number; parent: number; text: string; state: string; attrs?: Record<string, string> }[]
  testid: (key: number) => string; ariaLabel: string; fixed?: Layout | null
}) {
  const use = fixed && nodes.every(n => fixed.nodes.some(p => p.key === n.key)) ? fixed : null
  const lay = use ?? layoutForest(nodes.map(n => ({ key: n.key, parent: n.parent, width: tw(n.text), group: 0 })))
  const at = new Map(lay.nodes.map(p => [p.key, p]))
  return (
    <div className="fam-tree" role="img" aria-label={ariaLabel} style={{ width: lay.width, height: lay.height }}>
      <svg className="fam-tree-edges" aria-hidden="true" width={lay.width} height={lay.height} viewBox={`0 0 ${lay.width || 1} ${lay.height || 1}`}>
        {nodes.map(n => {
          const p = n.parent >= 0 ? at.get(nodes[n.parent].key) : undefined
          const c = at.get(n.key)
          return p && c ? <polyline key={n.key} points={edgePath(p, c)} fill="none" /> : null
        })}
      </svg>
      {nodes.map(n => {
        const p = at.get(n.key)!
        return <span key={n.key} className="fam-node" data-testid={testid(n.key)} data-state={n.state} {...(n.attrs ?? {})} style={{ left: p.x, top: p.y, width: p.width }}>{n.text}</span>
      })}
    </div>
  )
}

function HeapBox({ h, k, cur }: { h: HeapInst; k: number; cur: Set<string> }) {
  const v = heapView(h, k, cur)
  const idx = new Map(v.tree.map((t, i) => [t.i, i]))
  return (
    <>
      <Name name={h.name} desc={plural(v.len, 'item', 'items')} />
      {v.slots.length < v.len && <Note kind="heap">Showing slots {v.slots[0].i}–{v.slots[v.slots.length - 1].i} of {v.len}</Note>}
      {v.len === 0 ? <Empty /> : (
        <>
          <Scroll dep={k}>
            <ol className="fam-cells heap-array" data-testid="heap-array" aria-label={`Heap ${h.name} as an array`}>
              {v.slots.map(s => (
                <li key={s.i} className="fam-col">
                  <span className="fam-cell fam-wide" data-testid={`heap-slot-${s.i}`} data-state={st(s.current)}>{s.text}</span>
                  <span className="fam-index" aria-hidden="true">{s.i}</span>
                </li>
              ))}
            </ol>
          </Scroll>
          <Scroll dep={k}>
            <div className="heap-tree" data-testid="heap-tree">
              <TileTree
                ariaLabel={`Heap ${h.name} as a tree`} testid={i => `heap-node-${i}`}
                nodes={v.tree.map(t => ({ key: t.i, parent: t.i > 0 ? idx.get((t.i - 1) >> 1) ?? -1 : -1, text: t.text, state: st(t.current) }))}
              />
            </div>
          </Scroll>
        </>
      )}
    </>
  )
}

function QueueBox({ q, k, cur }: { q: QueueInst; k: number; cur: Set<string> }) {
  const v = queueView(q, k, cur)
  return (
    <>
      <Name name={q.name} desc={plural(v.len, 'item', 'items')} />
      {v.items.length < v.len && <Note kind="queue">Showing {v.items.length} of {v.len} items</Note>}
      {v.len === 0 ? <Empty /> : (
        <ol className="fam-cells fam-wrap" aria-label={`Queue ${q.name}, front first`}>
          {v.items.map(it => (
            <li key={it.i} className="fam-col">
              <span className="fam-tags" aria-hidden="true">
                {it.i === 0 && <span className="fam-tag">front</span>}
                {it.i === v.len - 1 && <span className="fam-tag">back</span>}
              </span>
              <span className="fam-cell" data-testid={`queue-item-${it.i}`} data-state={st(it.current)}>{it.text}</span>
              <span className="fam-index" aria-hidden="true">{it.i}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

// ---------------------------------------------------------------- V4 union-find

function DsuBox({ d, k, cur }: { d: DsuInst; k: number; cur: Set<string> }) {
  const v = dsuView(d, k, cur)
  // V4: each set a small tree, root on top; sets left to right in root order, wrapping
  const byX = new Map(v.nodes.map(n => [n.x, n]))
  const rootOf = (x: number) => {
    let r = x
    for (let g = 0; g < 64; g++) {
      const n = byX.get(r)
      if (!n || n.parent === r || !byX.has(n.parent)) break
      r = n.parent
    }
    return r
  }
  const sets = new Map<number, typeof v.nodes>()
  for (const n of v.nodes) { const r = rootOf(n.x); sets.set(r, [...(sets.get(r) ?? []), n]) }
  return (
    <>
      <Name name={d.name} desc={plural(v.n, 'element', 'elements')} />
      <p className="fam-count" data-testid="dsu-count">{v.count}</p>
      {v.nodes.length < v.n && <Note kind="dsu">Showing {v.nodes.length} of {v.n} elements</Note>}
      {v.n === 0 ? <Empty /> : (
        <div className="fam-forest" aria-label={`Union-find ${d.name}`}>
          {[...sets.entries()].sort((a, b) => a[0] - b[0]).map(([r, ns]) => {
            const ordered = [...ns].sort((a, b) => (a.x === r ? -1 : b.x === r ? 1 : a.x - b.x))
            const at = new Map(ordered.map((n, i) => [n.x, i]))
            return (
              <TileTree
                key={r} ariaLabel={`Set of ${r}`} testid={x => `dsu-node-${x}`}
                nodes={ordered.map(n => ({
                  key: n.x, parent: n.x === r ? -1 : at.get(n.parent) ?? -1, text: String(n.x), state: st(n.current),
                  attrs: { 'data-parent': String(n.parent), 'data-root': n.root ? 'true' : 'false' },
                }))}
              />
            )
          })}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- V5 array, V6 binary search

function ArrayBox({ a, k, cur }: { a: ArrayInst; k: number; cur: Set<string> }) {
  const v = arrayView(a, k, cur)
  const win = a.window.at(k, null)
  // the grid: a ghost column for -1, the drawn cells, a ghost column for n
  const colOf = (index: number) => {
    const x = v.cells.findIndex(c => c.i >= index)
    if (x < 0) return v.cells.length + 2
    return v.cells[x].i === index || x > 0 ? x + 2 : 1
  }
  const offWindow = v.cells.length < v.n ? v.pointers.filter(p => {
    if (v.cells.some(c => c.i === p.index)) return false
    if (p.index === -1 && v.cells[0]?.i === 0) return false
    if (p.index === v.n && v.cells[v.cells.length - 1]?.i === v.n - 1) return false
    return true
  }) : []
  const inWin = win && win[1] >= win[0] ? v.cells.map((c, x) => (c.i >= win[0] && c.i <= win[1] ? x : -1)).filter(x => x >= 0) : []
  return (
    <>
      <Name name={a.name} desc={a.chars ? plural(v.n, 'char', 'chars') : plural(v.n, 'value', 'values')} />
      {v.cells.length < v.n && <Note kind="array">Showing cells {v.cells[0]?.i}–{v.cells[v.cells.length - 1]?.i} of {v.n}</Note>}
      {v.n === 0 ? <Empty /> : (
        <Scroll dep={k}>
          <div className="fam-array" style={{ gridTemplateColumns: `repeat(${v.cells.length + 2}, minmax(40px, max-content))` }}>
            {v.cells.map((c, x) => (
              <span key={c.i} className="fam-cell fam-sq" style={{ gridColumn: x + 2, gridRow: 1 }} data-testid={`array-cell-${c.i}`} data-state={c.state}>{c.text}</span>
            ))}
            {v.cells.map((c, x) => <span key={`i${c.i}`} className="fam-index" style={{ gridColumn: x + 2, gridRow: 2 }} aria-hidden="true">{c.i}</span>)}
            {inWin.length > 0 && (
              <span className="fam-bracket" style={{ gridColumn: `${inWin[0] + 2} / ${inWin[inWin.length - 1] + 3}`, gridRow: 3 }} aria-hidden="true">len {win![1] - win![0] + 1}</span>
            )}
            {v.pointers.map((p, r) => (
              <span
                key={p.label} className="fam-ptr" style={{ gridColumn: colOf(p.index), gridRow: 4 + r }}
                data-testid={`pointer-${p.label}`} data-index={p.index} data-state={st(p.current)}
              >{p.label}</span>
            ))}
          </div>
        </Scroll>
      )}
      {offWindow.length > 0 && (
        <p className="fam-meta">{offWindow.map(p => <span key={p.label} className="fam-off">{p.label} → {p.index} </span>)}</p>
      )}
    </>
  )
}

function SearchBox({ s, k, cur }: { s: SearchInst; k: number; cur: Set<string> }) {
  const v = searchView(s, k, cur)
  // columns: every probe and the lo / hi (and mid) positions, in value order
  const values = [...new Set([...v.probes.map(p => p.m), v.lo, v.hi, ...(v.mid === null ? [] : [v.mid])])].sort((a, b) => a - b)
  const col = (x: number) => values.indexOf(x) + 1
  const probeAt = new Map(v.probes.map(p => [p.m, p]))
  const markers: [string, string, number][] = [['lo', 'search-lo', v.lo], ...(v.mid === null ? [] : [['mid', 'search-mid', v.mid] as [string, string, number]]), ['hi', 'search-hi', v.hi]]
  return (
    <>
      <Name name={s.name} desc={plural(v.probes.length, 'probe', 'probes')} />
      <Scroll dep={k}>
        <div className="fam-search" data-testid="search-line" aria-label={`Binary search ${s.name}`} style={{ gridTemplateColumns: `repeat(${values.length}, minmax(40px, max-content))` }}>
          {values.map(x => (
            <span key={`m${x}`} className="fam-marks" style={{ gridColumn: col(x), gridRow: 1 }}>
              {markers.filter(mk => mk[2] === x).map(([label, testid, value]) => (
                <span key={testid} className="fam-ptr" data-testid={testid} data-value={value} data-state={st(cur.has(label))}>{label} {value}</span>
              ))}
            </span>
          ))}
          {v.lo <= v.hi && <span className="fam-range" style={{ gridColumn: `${col(v.lo)} / ${col(v.hi) + 1}`, gridRow: 2 }} aria-hidden="true" />}
          {values.map(x => {
            const p = probeAt.get(x)
            return p ? (
              <span
                key={`p${x}`} className={`fam-cell fam-sq fam-probe${x >= v.lo && x <= v.hi ? '' : ' fam-outside'}`} style={{ gridColumn: col(x), gridRow: 3 }}
                data-testid={`search-probe-${x}`} data-pred={p.pred ? 'true' : 'false'} data-state={st(p.current)}
              >{p.pred ? 'T' : 'F'}</span>
            ) : <span key={`p${x}`} className="fam-ghost" style={{ gridColumn: col(x), gridRow: 3 }} aria-hidden="true" />
          })}
          {values.map(x => <span key={`i${x}`} className="fam-index" style={{ gridColumn: col(x), gridRow: 4 }} aria-hidden="true">{x}</span>)}
        </div>
      </Scroll>
    </>
  )
}

// ---------------------------------------------------------------- V7 linked list, V8 intervals

function ListBox({ l, k, cur }: { l: ListInst; k: number; cur: Set<string> }) {
  const v = listView(l, k, cur)
  // V7: chain order from the node no other node points to; unreachable nodes at the end
  const byId = new Map(v.nodes.map(n => [String(n.id), n]))
  const pointedAt = new Set(v.nodes.map(n => n.next))
  const order: typeof v.nodes = []
  const seen = new Set<string>()
  for (const start of v.nodes.filter(n => !pointedAt.has(String(n.id))).concat(v.nodes)) {
    let n: typeof v.nodes[number] | undefined = start
    while (n && !seen.has(String(n.id))) { seen.add(String(n.id)); order.push(n); n = byId.get(n.next) }
  }
  const ptrsAt = (id: string) => v.pointers.filter(p => p.node === id)
  const nilPtrs = ptrsAt('nil')
  return (
    <>
      <Name name={l.name} desc={plural(v.count, 'node', 'nodes')} />
      {v.nodes.length < v.count && <Note kind="list">Showing {v.nodes.length} of {v.count} nodes</Note>}
      {v.count === 0 && nilPtrs.length === 0 ? <Empty /> : (
        <ol className="fam-chain" aria-label={`List ${l.name}`}>
          {order.map(n => (
            <li key={n.id} className="fam-link">
              <span className="fam-col">
                <span className="fam-cell" data-testid={`list-node-${n.id}`} data-next={n.next} data-state={st(n.current)}>{n.text}</span>
                {ptrsAt(String(n.id)).map(p => <span key={p.label} className="fam-ptr" data-testid={`list-pointer-${p.label}`} data-node={p.node} data-state={st(p.current)}>{p.label}</span>)}
              </span>
              <span className="fam-arrow" aria-hidden="true" />
              {n.next === 'nil' && <span className="fam-nil" aria-hidden="true">nil</span>}
            </li>
          ))}
          {nilPtrs.length > 0 && (
            <li className="fam-link">
              <span className="fam-col">
                <span className="fam-nil" aria-hidden="true">nil</span>
                {nilPtrs.map(p => <span key={p.label} className="fam-ptr" data-testid={`list-pointer-${p.label}`} data-node="nil" data-state={st(p.current)}>{p.label}</span>)}
              </span>
            </li>
          )}
        </ol>
      )}
    </>
  )
}

function IntervalsBox({ iv, k, cur }: { iv: IntervalsInst; k: number; cur: Set<string> }) {
  const v = intervalsView(iv, k, cur)
  const pairs = v.items.map(it => it.text.slice(1, -1).split(',').map(Number) as [number, number])
  // UAT cu-5 P2-1: the axis spans every value the structure ever holds, so it is not rescaled step by step
  const [lo, hi] = useMemo(() => intervalsExtent(iv), [iv])
  // V8: one unit ≥ 16 px; ticks every 1, 2, 5 or 10 units (and on), whichever leaves ≥ 40 px between them
  const unit = Math.max(16, Math.min(48, 480 / (hi - lo)))
  const step = [1, 2, 5, 10, 20, 50, 100, 1000, 10000, 100000].find(s => s * unit >= 40) ?? Math.ceil(40 / unit)
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)
  const W = (hi - lo) * unit
  return (
    <>
      <Name name={iv.name} desc={plural(v.count, 'interval', 'intervals')} />
      {v.items.length < v.count && <Note kind="intervals">Showing {v.items.length} of {v.count} intervals</Note>}
      {v.count === 0 ? <Empty /> : (
        <Scroll dep={k}>
          <div className="fam-ivs" style={{ width: W + 140 }}>
            {v.items.map((it, n) => {
              const [s, e] = pairs[n]
              const left = (Math.min(s, e) - lo) * unit
              const width = Math.max(8, Math.abs(e - s) * unit)
              const fits = it.text.length * 8.6 + 8 <= width
              return (
                <div key={it.i} className="fam-iv-row">
                  <span
                    className={`fam-bar${fits ? '' : ' fam-bar-out'}`} style={{ left, width }}
                    data-testid={`interval-${it.i}`} data-mark={it.mark} data-state={st(it.current)}
                  ><span className="fam-bar-text">{it.text}</span></span>
                  {it.mark && <span className="fam-mark" style={{ left: left + width + (fits ? 8 : it.text.length * 8.6 + 16) }} aria-hidden="true">{it.mark}</span>}
                </div>
              )
            })}
            <div className="fam-axis" style={{ width: W }} aria-hidden="true">
              {ticks.map(t => <span key={t} className="fam-tick" style={{ left: (t - lo) * unit }}>{t}</span>)}
            </div>
          </div>
        </Scroll>
      )}
    </>
  )
}

// ---------------------------------------------------------------- V9 tree, V10 game table

/** V9: L before R; a node whose parent is not drawn is a root of its own. */
function treeNodes(v: ReturnType<typeof treeView>) {
  const ordered = [...v.nodes].sort((a, b) => (a.side === 'R' ? 1 : 0) - (b.side === 'R' ? 1 : 0))
  const at = new Map(ordered.map((n, i) => [n.id, i]))
  return ordered.map(n => ({
    key: n.id, parent: at.get(n.parent) ?? -1, text: n.text, state: n.state,
    attrs: { 'data-parent': String(n.parent), 'data-side': n.side, 'data-mark': n.mark },
  }))
}

function TreeBox({ t, k, cur, last }: { t: TreeInst; k: number; cur: Set<string>; last: number }) {
  const v = treeView(t, k, cur)
  // UAT cu-5 P2-1: laid out once, from the tree's final shape in this case, so a node keeps its place as the tree grows
  const fixed = useMemo(() => {
    const end = treeNodes(treeView(t, last, NONE))
    return end.length ? layoutForest(end.map(n => ({ key: n.key, parent: n.parent, width: tw(n.text), group: 0 }))) : null
  }, [t, last])
  return (
    <>
      <Name name={t.name} desc={plural(v.count, 'node', 'nodes')} />
      {v.nodes.length < v.count && <Note kind="tree">Showing {v.nodes.length} of {v.count} nodes around the current one</Note>}
      {v.count === 0 ? <Empty /> : (
        <Scroll dep={k}>
          <TileTree ariaLabel={`Tree ${t.name}`} testid={id => `tree-node-${id}`} nodes={treeNodes(v)} fixed={fixed} />
        </Scroll>
      )}
    </>
  )
}

function GameBox({ g, k, cur }: { g: GameInst; k: number; cur: Set<string> }) {
  const v = gameView(g, k, cur)
  return (
    <>
      <Name name={g.name} desc={plural(v.count, 'state', 'states')} />
      {v.states.length < v.count && <Note kind="game">Showing {v.states.length} of {v.count} states</Note>}
      {v.count === 0 ? <Empty /> : (
        <ol className="fam-games" aria-label={`Game table ${g.name}`}>
          {v.states.map(s => (
            <li key={s.state} className="fam-cell fam-game" data-testid={`game-state-${s.state}`} data-outcome={s.outcome} data-state={st(s.current)}>
              <span>{s.state} · <span className="fam-outcome">{s.outcome}</span>{s.text.slice(`${s.state} · ${s.outcome}`.length)}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

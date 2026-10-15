import { DEFAULT_LINK_KIND, KIT_GRID, KIT_KINDS, KIT_NODE_H, KIT_NODE_W, LINK_KINDS } from '../content/diagramKit'
import type { DesignNotes } from './designDigest'
import { addTable, fieldLine, renameTable, tableById } from './designNotes'

/** `custom` is the learner's own component; it is not a kit kind (a test mirrors the kit against the engine). */
export const CUSTOM_KIND = 'custom'
export const DEFAULT_GLYPH = 'process'
export const CUSTOM_SUB_MAX = 80
export const STICKY_MAX = 20
export const STICKY_TEXT_MAX = 280
export const FRAMES_MAX = 8
export const FRAME_LABEL_MAX = 40
export const FRAME_KINDS = ['system', 'region', 'az', 'vpc', 'trust', 'tenant', 'team'] as const

export interface KitNode { id: string; kind: string; label: string; x: number; y: number; sub?: string; glyph?: string; schemaId?: string }
export interface KitLink { from: string; to: string; kind: string }
export interface CanvasNote { id: string; x: number; y: number; text: string }
export interface KitZone { id: string; label: string; kind: string; nodes: string[] }
/** The session canvas: an sr-diagram graph JSON with manual layout (C-DESIGN §3), plus text notes the engine never draws. */
export interface KitCanvas { layout: 'manual'; nodes: KitNode[]; links: KitLink[]; zones: KitZone[]; notes: CanvasNote[]; flows: never[] }

/** Click-add slots: 7×5 cells (a node is 112 to about 160 px wide once its label is measured, 4.7 to 6.7 cells, plus room for a link between), 4 per row, first at (1, 1). */
export const SLOT_W = 7
export const SLOT_H = 5
export const SLOTS_PER_ROW = 4

export function emptyCanvas(): KitCanvas {
  return { layout: 'manual', nodes: [], links: [], zones: [], notes: [], flows: [] }
}

const toCell = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)
const isLinkKind = (k: unknown): k is string => typeof k === 'string' && (LINK_KINDS as readonly string[]).includes(k)
const isKind = (k: unknown): k is string => typeof k === 'string' && KIT_KINDS.includes(k)
const isStoredKind = (k: unknown): k is string => k === CUSTOM_KIND || isKind(k)
const isFrameKind = (k: unknown): boolean => typeof k === 'string' && (FRAME_KINDS as readonly string[]).includes(k)

/**
 * Any stored JSON → a valid canvas: unknown kinds, duplicate ids, self/dangling/duplicate links dropped; cells integer ≥ 0;
 * new keys defaulted (an old session has none); frame members that no longer exist dropped (a frame may be empty).
 * `lenientLinks` keeps whatever link kind is stored (the digest reads what is there, it does not repair it).
 */
export function normalizeCanvas(raw: unknown, opts: { lenientLinks?: boolean } = {}): KitCanvas {
  const c = emptyCanvas()
  if (!raw || typeof raw !== 'object') return c
  const r = raw as { nodes?: unknown; links?: unknown; zones?: unknown; notes?: unknown }
  const ids = new Set<string>()
  for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
    if (!n || typeof n !== 'object') continue
    const { id, kind, label, x, y, sub, glyph, schemaId } = n as Record<string, unknown>
    if (typeof id !== 'string' || !id || ids.has(id) || !isStoredKind(kind)) continue
    ids.add(id)
    const node: KitNode = { id, kind, label: typeof label === 'string' && label.trim() ? label : id, x: toCell(x), y: toCell(y) }
    if (kind === CUSTOM_KIND) {
      node.glyph = isKind(glyph) ? glyph : DEFAULT_GLYPH
      const s = typeof sub === 'string' ? sub.trim().slice(0, CUSTOM_SUB_MAX) : ''
      if (s) node.sub = s
    }
    if (kind === 'table' && typeof schemaId === 'string' && schemaId) node.schemaId = schemaId
    c.nodes.push(node)
  }
  const pairs = new Set<string>()
  for (const l of Array.isArray(r.links) ? r.links : []) {
    if (!l || typeof l !== 'object') continue
    const { from, to, kind } = l as Record<string, unknown>
    if (typeof from !== 'string' || typeof to !== 'string' || from === to || !ids.has(from) || !ids.has(to)) continue
    const key = `${from}>${to}`
    if (pairs.has(key)) continue
    pairs.add(key)
    const keep = opts.lenientLinks && typeof kind === 'string' && kind
    c.links.push({ from, to, kind: keep ? (kind as string) : isLinkKind(kind) ? kind : DEFAULT_LINK_KIND })
  }
  const claimed = new Set<string>()
  const frameIds = new Set<string>()
  for (const z of Array.isArray(r.zones) ? r.zones : []) {
    if (c.zones.length >= FRAMES_MAX) break
    if (!z || typeof z !== 'object') continue
    const { id, label, kind, nodes } = z as Record<string, unknown>
    const members = [...new Set((Array.isArray(nodes) ? nodes : []).filter((m): m is string => typeof m === 'string' && ids.has(m) && !claimed.has(m)))]
    members.forEach(m => claimed.add(m))
    let fid = typeof id === 'string' && id && !frameIds.has(id) ? id : ''
    if (!fid) { let n = 1; while (frameIds.has(`frame-${n}`)) n++; fid = `frame-${n}` }
    frameIds.add(fid)
    c.zones.push({
      id: fid, label: typeof label === 'string' && label.trim() ? label.trim().slice(0, FRAME_LABEL_MAX) : 'Frame',
      kind: isFrameKind(kind) ? (kind as string) : 'system', nodes: members,
    })
  }
  const noteIds = new Set<string>()
  for (const m of Array.isArray(r.notes) ? r.notes : []) {
    if (c.notes.length >= STICKY_MAX) break
    if (!m || typeof m !== 'object') continue
    const { id, x, y, text } = m as Record<string, unknown>
    if (typeof id !== 'string' || !id || noteIds.has(id)) continue
    noteIds.add(id)
    c.notes.push({ id, x: toCell(x), y: toCell(y), text: typeof text === 'string' ? text.slice(0, STICKY_TEXT_MAX) : '' })
  }
  return c
}

export function kindTitle(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** 1 + the highest n among `<kind>-<n>` ids (kinds are plain lowercase words, safe in a RegExp). */
export function nextNodeNumber(c: KitCanvas, kind: string): number {
  const re = new RegExp(`^${kind}-(\\d+)$`)
  return 1 + c.nodes.reduce((m, n) => {
    const hit = re.exec(n.id)
    return hit ? Math.max(m, Number(hit[1])) : m
  }, 0)
}

/** Pixels of air kept between a node's drawn rectangle and the next one: 24 across (a link needs a lane), 32 down. */
const GAP_W_PX = 24
const GAP_H_PX = 32
export interface Footprint { w: number; h: number }
/** What a plain tile claims in cells: the 7 × 5 slot (its drawn 112 × 88 px plus air, rounded up to the slot grid). */
export const PLAIN_FOOTPRINT: Footprint = { w: SLOT_W, h: SLOT_H }

/**
 * The rectangle <sr-diagram> draws for a node (public/engines/diagram.js `layout`): width grows with the longest of the
 * label and the description (measured text, never narrower than the per-character estimate used here), height with the
 * description line and each table column line. A plain tile stays 112 × 88.
 */
export function drawnSize(n: KitNode, notes?: DesignNotes): { w: number; h: number } {
  const v = nodeView(n, notes)
  const sub = v.sub ?? ''
  const text = Math.max(v.label.toUpperCase().length * 9.4, sub.length * 8.8)
  return {
    w: Math.max(KIT_NODE_W, Math.ceil((28 + text + 12) / 8) * 8),
    h: KIT_NODE_H + (sub ? 18 : 0) + (v.fields.length ? v.fields.length * 12 + 4 : 0),
  }
}
/** The cells a node claims: its drawn rectangle plus air, in whole cells, never less than a plain tile's slot. */
export function footprintOf(n: KitNode, notes?: DesignNotes): Footprint {
  const d = drawnSize(n, notes)
  return { w: Math.max(PLAIN_FOOTPRINT.w, Math.ceil((d.w + GAP_W_PX) / KIT_GRID)), h: Math.max(PLAIN_FOOTPRINT.h, Math.ceil((d.h + GAP_H_PX) / KIT_GRID)) }
}

/**
 * The first click-add slot (4 per row, 7 × 5 cells apart) whose rectangle clears every existing node's drawn rectangle.
 * `size` is what the new node will claim (a plain tile by default); `notes` lets table blocks count their column lines.
 * Nothing existing moves, and the result is always whole cells.
 */
export function freeCell(c: KitCanvas, notes?: DesignNotes, size: Footprint = PLAIN_FOOTPRINT): { x: number; y: number } {
  const claims = c.nodes.map(n => ({ n, f: footprintOf(n, notes) }))
  for (let i = 0; i < 10_000; i++) {
    const x = 1 + (i % SLOTS_PER_ROW) * SLOT_W
    const y = 1 + Math.floor(i / SLOTS_PER_ROW) * SLOT_H
    if (!claims.some(({ n, f }) => x < n.x + f.w && n.x < x + size.w && y < n.y + f.h && n.y < y + size.h)) return { x, y }
  }
  return { x: 1, y: 1 }
}

export function addNode(c: KitCanvas, kind: string, at?: { x: number; y: number }, notes?: DesignNotes): { canvas: KitCanvas; id: string } {
  if (!isKind(kind)) throw new Error(`unknown kind ${kind}`)
  const n = nextNodeNumber(c, kind)
  const id = `${kind}-${n}`
  const pos = at ? { x: toCell(at.x), y: toCell(at.y) } : freeCell(c, notes)
  return { canvas: { ...c, nodes: [...c.nodes, { id, kind, label: `${kindTitle(kind)} ${n}`, ...pos }] }, id }
}

export function moveNode(c: KitCanvas, id: string, dx: number, dy: number): KitCanvas {
  return { ...c, nodes: c.nodes.map(n => (n.id === id ? { ...n, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) } : n)) }
}

export function renameNode(c: KitCanvas, id: string, label: string): KitCanvas {
  const next = label.trim()
  const node = c.nodes.find(n => n.id === id)
  if (!node || !next || node.label === next) return c
  return { ...c, nodes: c.nodes.map(n => (n.id === id ? { ...n, label: next } : n)) }
}

export function removeNode(c: KitCanvas, id: string): KitCanvas {
  return {
    ...c, nodes: c.nodes.filter(n => n.id !== id), links: c.links.filter(l => l.from !== id && l.to !== id),
    zones: c.zones.map(z => (z.nodes.includes(id) ? { ...z, nodes: z.nodes.filter(m => m !== id) } : z)),
  }
}

export function addLink(c: KitCanvas, from: string, to: string): { canvas: KitCanvas; added: boolean } {
  const has = (id: string) => c.nodes.some(n => n.id === id)
  if (from === to || !has(from) || !has(to) || c.links.some(l => l.from === from && l.to === to)) return { canvas: c, added: false }
  return { canvas: { ...c, links: [...c.links, { from, to, kind: DEFAULT_LINK_KIND }] }, added: true }
}

export function setLinkKind(c: KitCanvas, from: string, to: string, kind: string): KitCanvas {
  if (!isLinkKind(kind)) return c
  return { ...c, links: c.links.map(l => (l.from === from && l.to === to ? { ...l, kind } : l)) }
}

export function removeLink(c: KitCanvas, from: string, to: string): KitCanvas {
  return { ...c, links: c.links.filter(l => !(l.from === from && l.to === to)) }
}

export function countText(c: KitCanvas): string {
  return `${c.nodes.length} nodes · ${c.links.length} links`
}

export function nodeLabel(c: KitCanvas, id: string): string {
  return c.nodes.find(n => n.id === id)?.label ?? id
}

export function nodeName(n: KitNode): string {
  return `${n.label} · ${n.kind}`
}

export function linkName(c: KitCanvas, l: KitLink): string {
  return `${nodeLabel(c, l.from)} to ${nodeLabel(c, l.to)} · ${l.kind}`
}

export interface NodeView { label: string; kind: string; sub?: string; fields: string[] }
/** What a node is drawn as: a custom box wears its glyph; a table block linked to the schema takes the table's name and columns. */
export function nodeView(n: KitNode, notes?: DesignNotes): NodeView {
  if (n.kind === CUSTOM_KIND) return { label: n.label, kind: n.glyph ?? DEFAULT_GLYPH, sub: n.sub, fields: [] }
  const t = n.kind === 'table' && n.schemaId && notes ? tableById(notes, n.schemaId) : undefined
  if (t) return { label: t.name || n.label, kind: 'table', sub: undefined, fields: t.cols.map(fieldLine).filter(Boolean) }
  return { label: n.label, kind: n.kind, sub: undefined, fields: [] }
}

export interface EngineNode { id: string; kind: string; label: string; x: number; y: number; sub?: string; fields?: string[] }
export interface EngineJson { layout: 'manual'; nodes: EngineNode[]; links: KitLink[]; zones: { label: string; kind: string; nodes: string[] }[]; flows: never[] }

/** The JSON <sr-diagram> draws. Stickies are an HTML overlay and never go to the engine. */
export function toEngineJson(c: KitCanvas, notes?: DesignNotes): EngineJson {
  return {
    layout: 'manual',
    nodes: c.nodes.map(n => {
      const v = nodeView(n, notes)
      const out: EngineNode = { id: n.id, kind: v.kind, label: v.label, x: n.x, y: n.y }
      if (v.sub) out.sub = v.sub
      if (v.fields.length) out.fields = v.fields
      return out
    }),
    links: c.links,
    zones: c.zones.map(z => ({ label: z.label, kind: z.kind, nodes: z.nodes })),
    flows: [],
  }
}

export function addCustom(c: KitCanvas, at?: { x: number; y: number }, notes?: DesignNotes): { canvas: KitCanvas; id: string } {
  const n = nextNodeNumber(c, CUSTOM_KIND)
  const id = `${CUSTOM_KIND}-${n}`
  const pos = at ? { x: toCell(at.x), y: toCell(at.y) } : freeCell(c, notes)
  return { canvas: { ...c, nodes: [...c.nodes, { id, kind: CUSTOM_KIND, label: `Custom ${n}`, glyph: DEFAULT_GLYPH, ...pos }] }, id }
}

const mapNode = (c: KitCanvas, id: string, fn: (n: KitNode) => KitNode): KitCanvas => ({ ...c, nodes: c.nodes.map(n => (n.id === id ? fn(n) : n)) })

/** Keystroke-level rename: no trimming (a space typed mid-word must survive); an empty label keeps the old one. */
export function setNodeLabel(c: KitCanvas, id: string, label: string): KitCanvas {
  const next = label.slice(0, 40)
  const node = c.nodes.find(n => n.id === id)
  if (!node || !next.trim() || node.label === next) return c
  return mapNode(c, id, n => ({ ...n, label: next }))
}

export function setSub(c: KitCanvas, id: string, sub: string): KitCanvas {
  const node = c.nodes.find(n => n.id === id)
  if (!node || node.kind !== CUSTOM_KIND) return c
  const next = sub.slice(0, CUSTOM_SUB_MAX)
  if ((node.sub ?? '') === next) return c
  return mapNode(c, id, n => { const { sub: _drop, ...rest } = n; return next ? { ...rest, sub: next } : rest })
}

export function setGlyph(c: KitCanvas, id: string, glyph: string): KitCanvas {
  const node = c.nodes.find(n => n.id === id)
  if (!node || node.kind !== CUSTOM_KIND || !isKind(glyph) || node.glyph === glyph) return c
  return mapNode(c, id, n => ({ ...n, glyph }))
}

/** A table block and its schema table are made together, linked by schemaId; the block's label is the table's name. */
export function addTableBlock(c: KitCanvas, notes: DesignNotes, at?: { x: number; y: number }): { canvas: KitCanvas; notes: DesignNotes; nodeId: string | null } {
  const t = addTable(notes)
  if (!t.id) return { canvas: c, notes, nodeId: null }
  const n = nextNodeNumber(c, 'table')
  const id = `table-${n}`
  const name = t.notes.schema.find(x => x.id === t.id)!.name
  const block: KitNode = { id, kind: 'table', label: name, schemaId: t.id, x: 0, y: 0 }
  const pos = at ? { x: toCell(at.x), y: toCell(at.y) } : freeCell(c, t.notes, footprintOf(block, t.notes))
  return { canvas: { ...c, nodes: [...c.nodes, { id, kind: 'table', label: name, schemaId: t.id, ...pos }] }, notes: t.notes, nodeId: id }
}

export function setSchemaLink(c: KitCanvas, nodeId: string, schemaId: string | null, notes: DesignNotes): KitCanvas {
  const node = c.nodes.find(n => n.id === nodeId)
  if (!node || node.kind !== 'table') return c
  if (!schemaId) { const { schemaId: _x, ...rest } = node; return mapNode(c, nodeId, () => rest) }
  const t = tableById(notes, schemaId)
  return t ? mapNode(c, nodeId, n => ({ ...n, schemaId, label: t.name || n.label })) : c
}

/** After any notes change: linked blocks take the table's name; a block whose table is gone becomes a plain table node (the stale schemaId is cleared, so a reused table id never re-attaches). */
export function syncTableNodes(c: KitCanvas, notes: DesignNotes): KitCanvas {
  let changed = false
  const nodes = c.nodes.map(n => {
    if (n.kind !== 'table' || !n.schemaId) return n
    const t = tableById(notes, n.schemaId)
    if (!t) { changed = true; const { schemaId: _x, ...rest } = n; return rest }
    if (t.name && t.name !== n.label) { changed = true; return { ...n, label: t.name } }
    return n
  })
  return changed ? { ...c, nodes } : c
}

/** Renaming a linked block on the canvas renames its schema table too (either side edits both). */
export function renameTableNode(c: KitCanvas, notes: DesignNotes, nodeId: string, label: string): { canvas: KitCanvas; notes: DesignNotes } {
  const node = c.nodes.find(n => n.id === nodeId)
  if (node?.kind === 'table' && node.schemaId) {
    const nextNotes = renameTable(notes, node.schemaId, label)
    return { canvas: syncTableNodes(c, nextNotes), notes: nextNotes }
  }
  return { canvas: renameNode(c, nodeId, label), notes }
}

// ---- Stickies and frames ----

const stickyCell = (count: number) => ({ x: 1 + (count % 4) * 8, y: 22 + Math.floor(count / 4) * 3 })

export function addSticky(c: KitCanvas, at?: { x: number; y: number }): { canvas: KitCanvas; id: string | null } {
  if (c.notes.length >= STICKY_MAX) return { canvas: c, id: null }
  const hi = c.notes.reduce((m, n) => { const hit = /^note-(\d+)$/.exec(n.id); return hit ? Math.max(m, Number(hit[1])) : m }, 0)
  const id = `note-${hi + 1}`
  const pos = at ? { x: toCell(at.x), y: toCell(at.y) } : stickyCell(c.notes.length)
  return { canvas: { ...c, notes: [...c.notes, { id, text: '', ...pos }] }, id }
}
const mapSticky = (c: KitCanvas, id: string, fn: (n: CanvasNote) => CanvasNote): KitCanvas => ({ ...c, notes: c.notes.map(n => (n.id === id ? fn(n) : n)) })
export const editSticky = (c: KitCanvas, id: string, text: string): KitCanvas => mapSticky(c, id, n => ({ ...n, text: text.slice(0, STICKY_TEXT_MAX) }))
export const moveSticky = (c: KitCanvas, id: string, dx: number, dy: number): KitCanvas =>
  mapSticky(c, id, n => ({ ...n, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) }))
export const removeSticky = (c: KitCanvas, id: string): KitCanvas => ({ ...c, notes: c.notes.filter(n => n.id !== id) })

export const frameOf = (c: KitCanvas, nodeId: string): KitZone | null => c.zones.find(z => z.nodes.includes(nodeId)) ?? null
const withoutNode = (c: KitCanvas, nodeId: string): KitZone[] => c.zones.map(z => (z.nodes.includes(nodeId) ? { ...z, nodes: z.nodes.filter(m => m !== nodeId) } : z))

export function addFrame(c: KitCanvas): { canvas: KitCanvas; id: string | null } {
  if (c.zones.length >= FRAMES_MAX) return { canvas: c, id: null }
  const hi = c.zones.reduce((m, z) => { const hit = /^frame-(\d+)$/.exec(z.id); return hit ? Math.max(m, Number(hit[1])) : m }, 0)
  const id = `frame-${hi + 1}`
  return { canvas: { ...c, zones: [...c.zones, { id, label: `Frame ${hi + 1}`, kind: 'system', nodes: [] }] }, id }
}

/** G: ONE new frame holding every given block (taken out of any frame it was in). Unknown ids are ignored; at the cap or with none left nothing happens. */
export function groupNodes(c: KitCanvas, nodeIds: string[]): { canvas: KitCanvas; id: string | null } {
  const ids = [...new Set(nodeIds)].filter(id => c.nodes.some(n => n.id === id))
  if (ids.length === 0) return { canvas: c, id: null }
  const added = addFrame({ ...c, zones: ids.reduce((zones, id) => withoutNode({ ...c, zones }, id), c.zones) })
  if (!added.id) return { canvas: c, id: null }
  return { canvas: { ...added.canvas, zones: added.canvas.zones.map(z => (z.id === added.id ? { ...z, nodes: ids } : z)) }, id: added.id }
}
export const groupNode = (c: KitCanvas, nodeId: string): { canvas: KitCanvas; id: string | null } => groupNodes(c, [nodeId])

export function setFrame(c: KitCanvas, nodeId: string, frameId: string | null): KitCanvas {
  if (!c.nodes.some(n => n.id === nodeId)) return c
  if (frameId !== null && !c.zones.some(z => z.id === frameId)) return c
  const zones = withoutNode(c, nodeId).map(z => (z.id === frameId ? { ...z, nodes: [...z.nodes, nodeId] } : z))
  return { ...c, zones }
}

export const removeFrame = (c: KitCanvas, frameId: string): KitCanvas => ({ ...c, zones: c.zones.filter(z => z.id !== frameId) })
/** Shift+G: the node's frame is deleted and every node in it stays. */
export function ungroupNode(c: KitCanvas, nodeId: string): KitCanvas {
  const f = frameOf(c, nodeId)
  return f ? removeFrame(c, f.id) : c
}
export function renameFrame(c: KitCanvas, frameId: string, label: string): KitCanvas {
  const next = label.slice(0, FRAME_LABEL_MAX)
  const f = c.zones.find(z => z.id === frameId)
  if (!f || !next.trim() || f.label === next) return c
  return { ...c, zones: c.zones.map(z => (z.id === frameId ? { ...z, label: next } : z)) }
}
export function setFrameKind(c: KitCanvas, frameId: string, kind: string): KitCanvas {
  if (!isFrameKind(kind)) return c
  return { ...c, zones: c.zones.map(z => (z.id === frameId ? { ...z, kind } : z)) }
}

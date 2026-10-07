import { DEFAULT_LINK_KIND, KIT_KINDS, LINK_KINDS } from '../content/diagramKit'

export interface KitNode { id: string; kind: string; label: string; x: number; y: number }
export interface KitLink { from: string; to: string; kind: string }
/** The session canvas: an sr-diagram graph JSON with manual layout (C-DESIGN §3). */
export interface KitCanvas { layout: 'manual'; nodes: KitNode[]; links: KitLink[]; zones: never[]; flows: never[] }

/** Click-add slots: 7×5 cells (a node is 112 to about 160 px wide once its label is measured, 4.7 to 6.7 cells, plus room for a link between), 4 per row, first at (1, 1). */
export const SLOT_W = 7
export const SLOT_H = 5
export const SLOTS_PER_ROW = 4

export function emptyCanvas(): KitCanvas {
  return { layout: 'manual', nodes: [], links: [], zones: [], flows: [] }
}

const toCell = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)
const isKind = (k: unknown): k is string => typeof k === 'string' && KIT_KINDS.includes(k)
const isLinkKind = (k: unknown): k is string => typeof k === 'string' && (LINK_KINDS as readonly string[]).includes(k)

/** Any stored JSON → a valid canvas: unknown kinds, duplicate ids, self/dangling/duplicate links dropped; cells integer ≥ 0. */
export function normalizeCanvas(raw: unknown): KitCanvas {
  const c = emptyCanvas()
  if (!raw || typeof raw !== 'object') return c
  const r = raw as { nodes?: unknown; links?: unknown }
  const ids = new Set<string>()
  for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
    if (!n || typeof n !== 'object') continue
    const { id, kind, label, x, y } = n as Record<string, unknown>
    if (typeof id !== 'string' || !id || ids.has(id) || !isKind(kind)) continue
    ids.add(id)
    c.nodes.push({ id, kind, label: typeof label === 'string' && label.trim() ? label : id, x: toCell(x), y: toCell(y) })
  }
  const pairs = new Set<string>()
  for (const l of Array.isArray(r.links) ? r.links : []) {
    if (!l || typeof l !== 'object') continue
    const { from, to, kind } = l as Record<string, unknown>
    if (typeof from !== 'string' || typeof to !== 'string' || from === to || !ids.has(from) || !ids.has(to)) continue
    const key = `${from}>${to}`
    if (pairs.has(key)) continue
    pairs.add(key)
    c.links.push({ from, to, kind: isLinkKind(kind) ? kind : DEFAULT_LINK_KIND })
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

export function freeCell(c: KitCanvas): { x: number; y: number } {
  for (let i = 0; i < 10_000; i++) {
    const x = 1 + (i % SLOTS_PER_ROW) * SLOT_W
    const y = 1 + Math.floor(i / SLOTS_PER_ROW) * SLOT_H
    if (!c.nodes.some(n => Math.abs(n.x - x) < SLOT_W && Math.abs(n.y - y) < SLOT_H)) return { x, y }
  }
  return { x: 1, y: 1 }
}

export function addNode(c: KitCanvas, kind: string, at?: { x: number; y: number }): { canvas: KitCanvas; id: string } {
  if (!isKind(kind)) throw new Error(`unknown kind ${kind}`)
  const n = nextNodeNumber(c, kind)
  const id = `${kind}-${n}`
  const pos = at ? { x: toCell(at.x), y: toCell(at.y) } : freeCell(c)
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
  return { ...c, nodes: c.nodes.filter(n => n.id !== id), links: c.links.filter(l => l.from !== id && l.to !== id) }
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

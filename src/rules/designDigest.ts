import type { DesignSession } from '../data/types'
import { nodeView, normalizeCanvas } from './designCanvas'
import { fieldLine, normalizeNotes } from './designNotes'

export type DesignMode = 'solo' | 'ai-partner' | 'human-partner'
export interface SchemaTable {
  id: string; name: string
  cols: { name: string; type: string; key?: 'PK' | 'FK' | 'unique' | 'index'; note?: string }[]
}
export interface DesignNotes {
  reqFn: string; reqNfr: string; assumptions: string; api: string; dataModel: string
  tradeoffs: string; open: string; schema: SchemaTable[]
}

export const DIGEST_MAX = 8000
export const DIGEST_TURN_MAX = 3000
export const NOT_WRITTEN = 'not written'
export const CLIPPED = '[clipped]'

interface Sec { head: string; body: string }

function diagramBody(session: DesignSession, notes: DesignNotes): string {
  const c = normalizeCanvas(session.canvas, { lenientLinks: true })
  if (c.nodes.length === 0) return NOT_WRITTEN
  const label = (id: string) => { const n = c.nodes.find(x => x.id === id); return n ? nodeView(n, notes).label : id }
  const out = ['nodes:']
  for (const n of c.nodes) {
    const v = nodeView(n, notes)
    const kind = n.kind === 'custom' ? `custom, drawn as ${v.kind}` : v.kind
    const cols = v.fields.length ? ` (columns: ${v.fields.join(', ')})` : ''
    out.push(`- ${v.label} [${kind}]${v.sub ? ` - ${v.sub}` : ''}${cols}`)
  }
  out.push('links:')
  out.push(...(c.links.length ? c.links.map(l => `- ${label(l.from)} -${l.kind}-> ${label(l.to)}`) : ['- none']))
  out.push('frames:')
  out.push(...(c.zones.length ? c.zones.map(z => `- ${z.label} (${z.kind}): ${z.nodes.map(label).join(', ') || 'empty'}`) : ['- none']))
  return out.join('\n')
}

function sections(session: DesignSession): Sec[] {
  const notes = normalizeNotes(session.notes)
  const c = normalizeCanvas(session.canvas, { lenientLinks: true })
  const text = (v: string) => (v.trim() ? v.trim() : NOT_WRITTEN)
  const schema = notes.schema.map(t => [`TABLE ${t.name || t.id}`, ...t.cols.filter(col => fieldLine(col)).map(col => `  ${fieldLine(col)}${col.note ? ` -- ${col.note}` : ''}`)].join('\n')).join('\n')
  const dm = [notes.dataModel.trim(), schema].filter(Boolean).join('\n')
  return [
    { head: 'DIAGRAM', body: diagramBody(session, notes) },
    { head: 'CANVAS NOTES', body: c.notes.length ? c.notes.map(n => `- ${n.text.trim() || '(empty)'}`).join('\n') : NOT_WRITTEN },
    { head: 'REQUIREMENTS - FUNCTIONAL', body: text(notes.reqFn) },
    { head: 'REQUIREMENTS - NON-FUNCTIONAL', body: text(notes.reqNfr) },
    { head: 'ASSUMPTIONS AND ESTIMATES', body: text(notes.assumptions) },
    { head: 'API', body: text(notes.api) },
    { head: 'DATA MODEL', body: dm || NOT_WRITTEN },
    { head: 'TRADE-OFFS', body: text(notes.tradeoffs) },
    { head: 'OPEN QUESTIONS', body: text(notes.open) },
  ]
}

const render = (secs: Sec[], bodies: string[]) => secs.map((s, i) => `${s.head}\n${bodies[i]}`).join('\n\n')

/**
 * The design as one plain-text block: diagram, canvas notes, the six sections and the schema. Pure and deterministic.
 * Over `max` the longest bodies are cut down evenly (so every heading survives) and the text ends with "[clipped]".
 * The AI layer fences it as learner text; the partner card shows it read-only.
 */
export function designDigest(session: DesignSession, max: number = DIGEST_MAX): string {
  const secs = sections(session)
  let bodies = secs.map(s => s.body)
  const full = render(secs, bodies)
  if (full.length <= max) return full
  const tail = `\n\n${CLIPPED}`
  const room = Math.max(0, max - tail.length - render(secs, bodies.map(() => '')).length)
  let lo = 0
  let hi = Math.max(...bodies.map(b => b.length))
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (bodies.reduce((a, b) => a + Math.min(b.length, mid), 0) <= room) lo = mid
    else hi = mid - 1
  }
  bodies = bodies.map(b => (b.length > lo ? `${b.slice(0, Math.max(0, lo - 1))}…` : b))
  const out = `${render(secs, bodies)}${tail}`
  return out.length <= max ? out : `${out.slice(0, max - CLIPPED.length)}${CLIPPED}`
}

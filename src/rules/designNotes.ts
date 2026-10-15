import type { DesignNotes, SchemaTable } from './designDigest'

export const NOTE_TEXT_MAX = 2000
export const SCHEMA_MAX_TABLES = 12
export const SCHEMA_MAX_COLS = 16
export const SCHEMA_NAME_MAX = 40
export const SCHEMA_TYPE_MAX = 30
export const SCHEMA_NOTE_MAX = 80
export const SCHEMA_KEYS = ['PK', 'FK', 'unique', 'index'] as const

export type SchemaCol = SchemaTable['cols'][number]
export type NoteTextKey = 'reqFn' | 'reqNfr' | 'assumptions' | 'api' | 'dataModel' | 'tradeoffs' | 'open'
export interface NoteField { key: NoteTextKey; id: string; label: string; placeholder: string }
export interface NoteSection { id: 'requirements' | 'assumptions' | 'api' | 'data-model' | 'tradeoffs' | 'open'; title: string; fields: NoteField[] }

export const NOTE_SECTIONS: readonly NoteSection[] = [
  { id: 'requirements', title: 'Requirements', fields: [
    { key: 'reqFn', id: 'req-fn', label: 'Functional', placeholder: 'What the system must do, and what it will not do' },
    { key: 'reqNfr', id: 'req-nfr', label: 'Non-functional', placeholder: 'Scale, latency, availability, consistency, cost' },
  ] },
  { id: 'assumptions', title: 'Assumptions and estimates', fields: [
    { key: 'assumptions', id: 'assumptions', label: 'Numbers and sums', placeholder: 'Daily users, requests per second, bytes per item, with the arithmetic' },
  ] },
  { id: 'api', title: 'API', fields: [{ key: 'api', id: 'api', label: 'Calls', placeholder: 'POST /photos, GET /photos/{id}: who calls, what comes back' }] },
  { id: 'data-model', title: 'Data model', fields: [{ key: 'dataModel', id: 'data-model', label: 'Notes', placeholder: 'What is stored where, who owns it, how it is keyed' }] },
  { id: 'tradeoffs', title: 'Trade-offs', fields: [{ key: 'tradeoffs', id: 'tradeoffs', label: 'Choices', placeholder: 'I chose X over Y because Z, and it costs ...' }] },
  { id: 'open', title: 'Open questions', fields: [{ key: 'open', id: 'open', label: 'Questions', placeholder: 'What you would ask next or test first' }] },
]
export const NOTE_TEXT_KEYS: readonly NoteTextKey[] = NOTE_SECTIONS.flatMap(s => s.fields.map(f => f.key))

/** Lines of a notes box that hold something (blank lines do not count). */
export const noteLines = (text: string): number => text.split('\n').filter(l => l.trim() !== '').length

/** The accordion's count for a section: the non-blank lines across its boxes; Data model shows its tables ("1 table") when it has any. "0" when empty. */
export function sectionCount(n: DesignNotes, id: NoteSection['id']): string {
  const section = NOTE_SECTIONS.find(s => s.id === id)
  if (id === 'data-model' && n.schema.length > 0) return `${n.schema.length} ${n.schema.length === 1 ? 'table' : 'tables'}`
  return String((section?.fields ?? []).reduce((sum, f) => sum + noteLines(n[f.key]), 0))
}

export function emptyNotes(): DesignNotes {
  return { reqFn: '', reqNfr: '', assumptions: '', api: '', dataModel: '', tradeoffs: '', open: '', schema: [] }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function normalizeCol(raw: unknown): SchemaCol | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const col: SchemaCol = { name: str(r.name, SCHEMA_NAME_MAX), type: str(r.type, SCHEMA_TYPE_MAX) }
  if (typeof r.key === 'string' && (SCHEMA_KEYS as readonly string[]).includes(r.key)) col.key = r.key as SchemaCol['key']
  const note = str(r.note, SCHEMA_NOTE_MAX)
  if (note) col.note = note
  return col
}

/** Any stored value to valid notes: a session from before v2 has none, so it reads as empty texts. */
export function normalizeNotes(raw: unknown): DesignNotes {
  const n = emptyNotes()
  if (!raw || typeof raw !== 'object') return n
  const r = raw as Record<string, unknown>
  for (const k of NOTE_TEXT_KEYS) n[k] = str(r[k], NOTE_TEXT_MAX)
  const ids = new Set<string>()
  for (const t of Array.isArray(r.schema) ? r.schema : []) {
    if (n.schema.length >= SCHEMA_MAX_TABLES) break
    if (!t || typeof t !== 'object') continue
    const tr = t as Record<string, unknown>
    if (typeof tr.id !== 'string' || !tr.id || ids.has(tr.id)) continue
    ids.add(tr.id)
    const cols = (Array.isArray(tr.cols) ? tr.cols : []).map(normalizeCol).filter((c): c is SchemaCol => c !== null).slice(0, SCHEMA_MAX_COLS)
    n.schema.push({ id: tr.id, name: str(tr.name, SCHEMA_NAME_MAX), cols })
  }
  return n
}

export const tableById = (n: DesignNotes, id: string): SchemaTable | undefined => n.schema.find(t => t.id === id)
const mapTable = (n: DesignNotes, id: string, fn: (t: SchemaTable) => SchemaTable): DesignNotes => ({ ...n, schema: n.schema.map(t => (t.id === id ? fn(t) : t)) })

export function setNoteText(n: DesignNotes, key: NoteTextKey, value: string): DesignNotes {
  const v = value.slice(0, NOTE_TEXT_MAX)
  return n[key] === v ? n : { ...n, [key]: v }
}

function nextTableId(n: DesignNotes): string {
  const hi = n.schema.reduce((m, t) => { const hit = /^s(\d+)$/.exec(t.id); return hit ? Math.max(m, Number(hit[1])) : m }, 0)
  return `s${hi + 1}`
}

/** A new table has no columns: the learner adds each one (DESIGN-19 to DESIGN-21 count from zero). */
export function addTable(n: DesignNotes, name?: string): { notes: DesignNotes; id: string | null } {
  if (n.schema.length >= SCHEMA_MAX_TABLES) return { notes: n, id: null }
  const id = nextTableId(n)
  const label = (name?.trim() || `table_${id.slice(1)}`).slice(0, SCHEMA_NAME_MAX)
  return { notes: { ...n, schema: [...n.schema, { id, name: label, cols: [] }] }, id }
}

export function renameTable(n: DesignNotes, id: string, name: string): DesignNotes {
  const next = name.trim().slice(0, SCHEMA_NAME_MAX)
  const t = tableById(n, id)
  if (!t || !next || t.name === next) return n
  return mapTable(n, id, x => ({ ...x, name: next }))
}

export const removeTable = (n: DesignNotes, id: string): DesignNotes => ({ ...n, schema: n.schema.filter(t => t.id !== id) })

export function addColumn(n: DesignNotes, tableId: string): DesignNotes {
  const t = tableById(n, tableId)
  if (!t || t.cols.length >= SCHEMA_MAX_COLS) return n
  return mapTable(n, tableId, x => ({ ...x, cols: [...x.cols, { name: '', type: 'text' }] }))
}

export type ColPatch = { name?: string; type?: string; key?: SchemaCol['key'] | ''; note?: string }
export function updateColumn(n: DesignNotes, tableId: string, index: number, patch: ColPatch): DesignNotes {
  return mapTable(n, tableId, t => ({
    ...t,
    cols: t.cols.map((c, i) => {
      if (i !== index) return c
      const next: SchemaCol = { ...c }
      if (patch.name !== undefined) next.name = patch.name.slice(0, SCHEMA_NAME_MAX)
      if (patch.type !== undefined) next.type = patch.type.slice(0, SCHEMA_TYPE_MAX)
      if (patch.key !== undefined) {
        if (patch.key && (SCHEMA_KEYS as readonly string[]).includes(patch.key)) next.key = patch.key
        else delete next.key
      }
      if (patch.note !== undefined) {
        const note = patch.note.slice(0, SCHEMA_NOTE_MAX)
        if (note) next.note = note
        else delete next.note
      }
      return next
    }),
  }))
}

export const removeColumn = (n: DesignNotes, tableId: string, index: number): DesignNotes =>
  mapTable(n, tableId, t => ({ ...t, cols: t.cols.filter((_, i) => i !== index) }))

/** The line the engine draws and the digest prints: "user_id uuid FK". Blank-named columns give ''. */
export function fieldLine(c: SchemaCol): string {
  const name = c.name.trim()
  return name ? [name, c.type.trim(), c.key].filter(Boolean).join(' ') : ''
}

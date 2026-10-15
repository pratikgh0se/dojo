import { describe, expect, it } from 'vitest'
import {
  addColumn, addTable, emptyNotes, fieldLine, NOTE_SECTIONS, NOTE_TEXT_MAX, normalizeNotes, removeColumn, removeTable, renameTable,
  SCHEMA_MAX_COLS, SCHEMA_MAX_TABLES, setNoteText, updateColumn,
} from '../../src/rules/designNotes'

describe('sections', () => {
  it('has six sections in the contract order with the contract hook ids', () => {
    expect(NOTE_SECTIONS.map(s => s.id)).toEqual(['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open'])
    expect(NOTE_SECTIONS.map(s => s.title)).toEqual(['Requirements', 'Assumptions and estimates', 'API', 'Data model', 'Trade-offs', 'Open questions'])
    expect(NOTE_SECTIONS.flatMap(s => s.fields.map(f => f.id))).toEqual(['req-fn', 'req-nfr', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open'])
  })
})

describe('normalizeNotes', () => {
  it('turns a session without notes into empty texts and no tables', () => {
    expect(normalizeNotes(undefined)).toEqual(emptyNotes())
    expect(normalizeNotes('x')).toEqual(emptyNotes())
  })
  it('caps text at 2,000 and drops junk tables, duplicate ids and bad keys', () => {
    const n = normalizeNotes({
      api: 'x'.repeat(3000), reqFn: 7,
      schema: [
        { id: 's1', name: 'layers', cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'z', type: 'int', key: 'bogus' }, 5] },
        { id: 's1', name: 'dup', cols: [] }, { name: 'no id' }, null,
      ],
    })
    expect(n.api).toHaveLength(NOTE_TEXT_MAX)
    expect(n.reqFn).toBe('')
    expect(n.schema).toEqual([{ id: 's1', name: 'layers', cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'z', type: 'int' }] }])
  })
  it('keeps at most 12 tables and 16 columns', () => {
    const tables = Array.from({ length: 15 }, (_, i) => ({ id: `s${i + 1}`, name: `t${i}`, cols: Array.from({ length: 20 }, (_, j) => ({ name: `c${j}`, type: 'int' })) }))
    const n = normalizeNotes({ schema: tables })
    expect(n.schema).toHaveLength(SCHEMA_MAX_TABLES)
    expect(n.schema[0].cols).toHaveLength(SCHEMA_MAX_COLS)
  })
})

describe('setNoteText', () => {
  it('caps at 2,000 and returns the same object when nothing changes', () => {
    const n = emptyNotes()
    expect(setNoteText(n, 'open', 'y'.repeat(2500)).open).toHaveLength(2000)
    expect(setNoteText(n, 'open', '')).toBe(n)
  })
})

describe('schema reducers', () => {
  it('adds tables with unique ids and no columns, and refuses a 13th', () => {
    let n = emptyNotes()
    const ids: string[] = []
    for (let i = 0; i < SCHEMA_MAX_TABLES; i++) { const r = addTable(n); n = r.notes; ids.push(r.id!) }
    expect(new Set(ids).size).toBe(12)
    expect(n.schema[0].cols).toEqual([])
    const over = addTable(n)
    expect(over.id).toBeNull()
    expect(over.notes).toBe(n)
  })
  it('falls back to the default name when the given name is blank', () => {
    expect(addTable(emptyNotes(), '').notes.schema[0].name).toBe('table_1')
    expect(addTable(emptyNotes(), '   ').notes.schema[0].name).toBe('table_1')
    expect(addTable(emptyNotes(), '  users ').notes.schema[0].name).toBe('users')
  })
  it('renames, trims and ignores a blank name', () => {
    const { notes, id } = addTable(emptyNotes())
    expect(renameTable(notes, id!, '  layers ').schema[0].name).toBe('layers')
    expect(renameTable(notes, id!, '   ')).toBe(notes)
  })
  it('edits columns, treats key none as no key, and caps columns at 16', () => {
    let { notes, id } = addTable(emptyNotes(), 'layers')
    notes = addColumn(notes, id!)
    notes = updateColumn(notes, id!, 0, { name: 'doc_id', type: 'uuid', key: 'FK', note: 'owner' })
    expect(notes.schema[0].cols[0]).toEqual({ name: 'doc_id', type: 'uuid', key: 'FK', note: 'owner' })
    notes = updateColumn(notes, id!, 0, { key: '' })
    expect(notes.schema[0].cols[0]).toEqual({ name: 'doc_id', type: 'uuid', note: 'owner' })
    for (let i = 0; i < 20; i++) notes = addColumn(notes, id!)
    expect(notes.schema[0].cols).toHaveLength(SCHEMA_MAX_COLS)
    expect(removeColumn(notes, id!, 0).schema[0].cols).toHaveLength(15)
  })
  it('removes a table', () => {
    const { notes, id } = addTable(emptyNotes())
    expect(removeTable(notes, id!).schema).toEqual([])
  })
  it('writes a field line like the engine draws: name type key', () => {
    expect(fieldLine({ name: 'user_id', type: 'uuid', key: 'FK' })).toBe('user_id uuid FK')
    expect(fieldLine({ name: 'z', type: 'int' })).toBe('z int')
    expect(fieldLine({ name: '', type: 'int' })).toBe('')
  })
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DesignNotes } from '../../src/rules/designDigest'
import { addColumn, addTable, emptyNotes } from '../../src/rules/designNotes'
import { NotesPanel } from '../../src/screens/designSession/NotesPanel'

let last: DesignNotes = emptyNotes()
function Harness({ locked = false, initial = emptyNotes(), linked = [] as string[], onEscape = () => {} }) {
  const [n, setN] = useState(initial)
  last = n
  return <NotesPanel notes={n} locked={locked} linkedIds={new Set(linked)} onChange={setN} onEscape={onEscape} />
}
const tid = (id: string) => screen.getByTestId(id)

describe('NotesPanel layout (DESIGN-13)', () => {
  it('has exactly six sections in order with the contract headings and boxes', () => {
    render(<Harness />)
    const ids = [...tid('notes-panel').querySelectorAll('[data-testid^="notes-section-"]:not([data-testid$="-title"]):not([data-testid$="-toggle"]):not([data-testid$="-count"])')].map(e => e.getAttribute('data-testid'))
    expect(ids).toEqual(['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open'].map(i => `notes-section-${i}`))
    expect([...tid('notes-panel').querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Requirements', 'Assumptions and estimates', 'API', 'Data model', 'Trade-offs', 'Open questions'])
    for (const i of ['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']) {
      expect(tid(`notes-section-${i}-title`).tagName).toBe('H3')
    }
    expect(tid('notes-section-assumptions-title')).toHaveTextContent(/^Assumptions and estimates$/)
    for (const f of ['req-fn', 'req-nfr', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']) expect(tid(`notes-field-${f}`).tagName).toBe('TEXTAREA')
    expect(within(tid('notes-section-requirements')).getAllByRole('textbox')).toHaveLength(2)
  })
  it('puts the schema editor before the free-text box in Data model', () => {
    render(<Harness />)
    const section = tid('notes-section-data-model')
    const editor = within(section).getByTestId('schema-editor')
    const box = within(section).getByTestId('notes-field-data-model')
    expect(editor.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('caps and counters (DESIGN-14)', () => {
  it('holds 2,000 characters and says so', () => {
    render(<Harness />)
    fireEvent.change(tid('notes-field-api'), { target: { value: 'x'.repeat(2500) } })
    expect(last.api).toHaveLength(2000)
    expect(tid('notes-counter-api')).toHaveTextContent('2000 / 2000')
    expect(tid('notes-field-api')).toHaveAttribute('maxlength', '2000')
  })
})

describe('typing never triggers shortcuts (DESIGN-18, Review Focus 2)', () => {
  it('no key of n c t g l ? 1 2 3 4 is cancelled in a notes box', () => {
    render(<Harness />)
    const box = tid('notes-field-open')
    for (const key of 'nctgl?1234'.split('')) expect(fireEvent.keyDown(box, { key }), key).toBe(true)
    fireEvent.change(box, { target: { value: 'n c t g l ? 1 2 3 4' } })
    expect(last.open).toBe('n c t g l ? 1 2 3 4')
  })
  it('letters and digits typed in a schema cell are not cancelled either', () => {
    const { notes: bare, id } = addTable(emptyNotes(), 'layers')
    const notes = addColumn(bare, id!)
    render(<Harness initial={notes} />)
    for (const cell of [`schema-table-name-${id}`, `schema-col-name-${id}-1`, `schema-col-type-${id}-1`, `schema-col-note-${id}-1`]) {
      for (const key of 'nctgl?1234'.split('')) expect(fireEvent.keyDown(tid(cell), { key }), `${cell} ${key}`).toBe(true)
    }
    expect(tid('notes-panel')).toContainElement(tid(`schema-col-name-${id}-1`))
  })
  it('the panel opts out of global number keys and Esc hands focus back', () => {
    const onEscape = vi.fn()
    render(<Harness onEscape={onEscape} />)
    expect(tid('notes-panel')).toHaveAttribute('data-no-global-keys')
    fireEvent.keyDown(tid('notes-field-api'), { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
})

describe('locked (DESIGN-17)', () => {
  it('makes every box and the schema editor read-only but still selectable', () => {
    const { notes } = addTable({ ...emptyNotes(), api: 'POST /x' })
    render(<Harness locked initial={notes} />)
    expect(tid('notes-field-api')).toHaveAttribute('readonly')
    expect(tid('notes-field-api')).not.toBeDisabled()
    expect(tid('schema-add-table')).toBeDisabled()
    expect(tid(`schema-table-name-${notes.schema[0].id}`)).toHaveAttribute('readonly')
    expect(tid(`schema-add-col-${notes.schema[0].id}`)).toBeDisabled()
  })
})

describe('schema editor (DESIGN-19 to 22)', () => {
  it('adds a table with a unique id and edits its name', () => {
    render(<Harness />)
    fireEvent.click(tid('schema-add-table'))
    fireEvent.click(tid('schema-add-table'))
    const ids = last.schema.map(t => t.id)
    expect(new Set(ids).size).toBe(2)
    fireEvent.change(tid(`schema-table-name-${ids[0]}`), { target: { value: 'layers' } })
    expect(last.schema[0].name).toBe('layers')
    expect(tid(`schema-table-${ids[0]}`)).toBeInTheDocument()
  })
  it('a column row has four inputs; the key select offers none, PK, FK, unique, index; none stores no key', () => {
    const { notes, id } = addTable(emptyNotes(), 'layers')
    render(<Harness initial={notes} />)
    fireEvent.click(tid('notes-section-data-model-toggle')) // a closed section's controls are hidden from the accessibility tree
    fireEvent.click(tid(`schema-add-col-${id}`))
    expect(last.schema[0].cols).toHaveLength(1) // a new table has no columns, so the first one added is n = 1 (DESIGN-20)
    fireEvent.change(tid(`schema-col-name-${id}-1`), { target: { value: 'doc_id' } })
    fireEvent.change(tid(`schema-col-type-${id}-1`), { target: { value: 'uuid' } })
    fireEvent.change(tid(`schema-col-key-${id}-1`), { target: { value: 'FK' } })
    fireEvent.change(tid(`schema-col-note-${id}-1`), { target: { value: 'owner' } })
    expect(last.schema[0].cols[0]).toEqual({ name: 'doc_id', type: 'uuid', key: 'FK', note: 'owner' })
    expect(within(tid(`schema-col-key-${id}-1`)).getAllByRole('option').map(o => o.textContent)).toEqual(['none', 'PK', 'FK', 'unique', 'index'])
    fireEvent.change(tid(`schema-col-key-${id}-1`), { target: { value: '' } })
    expect(last.schema[0].cols[0]).not.toHaveProperty('key')
  })
  it('removes a column (1-based n) and then the table', () => {
    const { notes, id } = addTable(emptyNotes(), 'layers')
    render(<Harness initial={{ ...notes, schema: [{ ...notes.schema[0], cols: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }] }] }} />)
    fireEvent.click(tid(`schema-col-remove-${id}-1`))
    expect(last.schema[0].cols.map(c => c.name)).toEqual(['b'])
    fireEvent.click(tid(`schema-table-remove-${id}`))
    expect(last.schema).toEqual([])
    expect(screen.queryByTestId(`schema-table-${id}`)).toBeNull()
  })
  it('caps: 12 tables and 16 columns disable the add buttons and show the counters', () => {
    const tables = Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, name: `t${i}`, cols: i === 0 ? Array.from({ length: 16 }, (_, j) => ({ name: `c${j}`, type: 'int' })) : [] }))
    render(<Harness initial={{ ...emptyNotes(), schema: tables }} />)
    expect(tid('schema-add-table')).toBeDisabled()
    expect(tid('schema-count-tables')).toHaveTextContent('12 of 12 tables')
    expect(tid('schema-add-col-s1')).toBeDisabled()
    expect(tid('schema-count-cols-s1')).toHaveTextContent('16 of 16 columns')
  })
  it('counters read "n of 12 tables" and "n of 16 columns" at every count', () => {
    const { notes, id } = addTable(emptyNotes(), 'layers')
    render(<Harness initial={notes} />)
    expect(tid('schema-count-tables')).toHaveTextContent(/^1 of 12 tables$/)
    expect(tid(`schema-count-cols-${id}`)).toHaveTextContent(/^0 of 16 columns$/)
    fireEvent.click(tid(`schema-add-col-${id}`))
    expect(tid(`schema-count-cols-${id}`)).toHaveTextContent(/^1 of 16 columns$/)
    fireEvent.click(tid(`schema-add-col-${id}`))
    expect(tid(`schema-count-cols-${id}`)).toHaveTextContent(/^2 of 16 columns$/)
  })
  it('an emptied table name falls back to the id on blur (a nameless table would draw nothing)', () => {
    const { notes, id } = addTable(emptyNotes(), 'layers')
    render(<Harness initial={notes} />)
    fireEvent.change(tid(`schema-table-name-${id}`), { target: { value: '' } })
    fireEvent.blur(tid(`schema-table-name-${id}`))
    expect(last.schema[0].name).toBe(id)
  })
  it('marks a table that is linked to a canvas block', () => {
    const { notes, id } = addTable(emptyNotes(), 'layers')
    render(<Harness initial={notes} linked={[id!]} />)
    expect(within(tid(`schema-table-${id}`)).getByText('linked to canvas block')).toBeInTheDocument()
  })
})

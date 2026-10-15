import type { DesignNotes } from '../../rules/designDigest'
import {
  addColumn, addTable, removeColumn, removeTable, renameTable, SCHEMA_KEYS, SCHEMA_MAX_COLS, SCHEMA_MAX_TABLES, updateColumn,
} from '../../rules/designNotes'
import { Button } from '../../ui/primitives'

export interface SchemaEditorProps {
  notes: DesignNotes
  locked: boolean
  linkedIds: ReadonlySet<string>
  onChange: (next: DesignNotes) => void
}

/** Per table: a name and rows of column, type (free text), key and note. A table can be drawn on the canvas as a linked block. */
export function SchemaEditor({ notes, locked, linkedIds, onChange }: SchemaEditorProps) {
  return (
    <div className="sch" data-testid="schema-editor">
      <div className="sch-head">
        <span className="sch-title">Schema</span>
        <span className="sch-count" data-testid="schema-count-tables">{notes.schema.length} of {SCHEMA_MAX_TABLES} tables</span>
        <Button data-testid="schema-add-table" disabled={locked || notes.schema.length >= SCHEMA_MAX_TABLES} onClick={() => onChange(addTable(notes).notes)}>Add table</Button>
      </div>
      {notes.schema.map(t => (
        <div key={t.id} role="group" aria-label={`Table ${t.name || t.id}`} className="sch-table" data-testid={`schema-table-${t.id}`}>
          <div className="sch-trow">
            <input
              type="text" aria-label="Table name" data-testid={`schema-table-name-${t.id}`} maxLength={40} readOnly={locked} value={t.name}
              onChange={e => onChange({ ...notes, schema: notes.schema.map(x => (x.id === t.id ? { ...x, name: e.target.value.slice(0, 40) } : x)) })}
              onBlur={e => { if (!locked && !e.target.value.trim()) onChange(renameTable(notes, t.id, t.id)) }}
            />
            {linkedIds.has(t.id) && <span className="sch-linked">linked to canvas block</span>}
            <Button data-testid={`schema-table-remove-${t.id}`} aria-label={`Remove table ${t.name || t.id}`} disabled={locked} onClick={() => onChange(removeTable(notes, t.id))}>Remove table</Button>
          </div>
          <div className="sch-cols">
            {t.cols.map((c, i) => {
              const n = i + 1
              return (
                <div key={i} className="sch-row" role="group" aria-label={`Column ${n} of ${t.name || t.id}`}>
                  <input type="text" aria-label="Column name" placeholder="Column" data-testid={`schema-col-name-${t.id}-${n}`} readOnly={locked} value={c.name} onChange={e => onChange(updateColumn(notes, t.id, i, { name: e.target.value }))} />
                  <input type="text" aria-label="Column type" placeholder="Type" data-testid={`schema-col-type-${t.id}-${n}`} readOnly={locked} value={c.type} onChange={e => onChange(updateColumn(notes, t.id, i, { type: e.target.value }))} />
                  <select aria-label="Column key" data-testid={`schema-col-key-${t.id}-${n}`} disabled={locked} value={c.key ?? ''} onChange={e => onChange(updateColumn(notes, t.id, i, { key: e.target.value as '' }))}>
                    <option value="">none</option>
                    {SCHEMA_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input type="text" aria-label="Column note" placeholder="Note" data-testid={`schema-col-note-${t.id}-${n}`} readOnly={locked} value={c.note ?? ''} onChange={e => onChange(updateColumn(notes, t.id, i, { note: e.target.value }))} />
                  <Button data-testid={`schema-col-remove-${t.id}-${n}`} aria-label={`Remove column ${n}`} disabled={locked} onClick={() => onChange(removeColumn(notes, t.id, i))}>Remove</Button>
                </div>
              )
            })}
          </div>
          <div className="sch-trow">
            <Button data-testid={`schema-add-col-${t.id}`} disabled={locked || t.cols.length >= SCHEMA_MAX_COLS} onClick={() => onChange(addColumn(notes, t.id))}>Add column</Button>
            <span className="sch-count" data-testid={`schema-count-cols-${t.id}`}>{t.cols.length} of {SCHEMA_MAX_COLS} columns</span>
          </div>
        </div>
      ))}
    </div>
  )
}

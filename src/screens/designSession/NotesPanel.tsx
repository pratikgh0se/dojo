import type { KeyboardEvent } from 'react'
import type { DesignNotes } from '../../rules/designDigest'
import { NOTE_SECTIONS, NOTE_TEXT_MAX, sectionCount, setNoteText } from '../../rules/designNotes'
import { useNotesOpen, type NotesOpen } from './notesOpen'
import { SchemaEditor } from './SchemaEditor'

export interface NotesPanelProps {
  notes: DesignNotes
  locked: boolean
  linkedIds: ReadonlySet<string>
  onChange: (next: DesignNotes) => void
  /** Esc in a notes box: the caller moves focus back to the canvas */
  onEscape: () => void
  /** The open sections (the caller keeps them so Ctrl/Cmd+. can open one); without it the panel keeps its own, in memory */
  accordion?: NotesOpen
  /** Close and Score: every section is open (and read-only, `locked`) */
  allOpen?: boolean
}

/**
 * Six fixed sections as an accordion (F2): a header button per section (chevron, title, count) and the section's boxes below it.
 * A closed section keeps its boxes mounted but hidden. Free text graded with the diagram; locked with the canvas, stays readable in Close and Score.
 */
export function NotesPanel({ notes, locked, linkedIds, onChange, onEscape, accordion, allOpen = false }: NotesPanelProps) {
  const own = useNotesOpen(null)
  const acc = accordion ?? own
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onEscape() }
  }
  let first = true
  return (
    <aside className="nt-panel" data-testid="notes-panel" aria-label="Design notes" data-no-global-keys="" data-focus-zone="notes" onKeyDown={onKey}>
      <p className="nt-lead"><span className="nt-cap">Design notes</span><span className="nt-meta">graded with the diagram</span></p>
      {NOTE_SECTIONS.map(s => {
        const open = allOpen || acc.open.has(s.id)
        return (
          <section key={s.id} className="nt-section" data-open={open ? 'true' : 'false'} data-testid={`notes-section-${s.id}`}>
            <button
              type="button" className="nt-toggle" id={`nt-t-${s.id}`} data-testid={`notes-section-${s.id}-toggle`}
              aria-expanded={open} aria-controls={`nt-b-${s.id}`} onClick={() => { if (!allOpen) acc.toggle(s.id) }}
            >
              <span className="nt-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
              <h3 className="nt-h" data-testid={`notes-section-${s.id}-title`}>{s.title}</h3>
              <span className="nt-n" data-testid={`notes-section-${s.id}-count`}>{sectionCount(notes, s.id)}</span>
            </button>
            <div className="nt-body" id={`nt-b-${s.id}`} role="group" aria-labelledby={`nt-t-${s.id}`} hidden={!open}>
              {s.id === 'data-model' && <SchemaEditor notes={notes} locked={locked} linkedIds={linkedIds} onChange={onChange} />}
              {s.fields.map(f => {
                const focusFirst = first
                first = false
                return (
                  <div key={f.id} className="nt-field">
                    <label htmlFor={`nt-f-${f.id}`} className="nt-label">{f.label}</label>
                    <textarea
                      id={`nt-f-${f.id}`} data-testid={`notes-field-${f.id}`} {...(focusFirst ? { 'data-focus-first': '' } : {})}
                      rows={4} maxLength={NOTE_TEXT_MAX} readOnly={locked} placeholder={f.placeholder} value={notes[f.key]}
                      onChange={e => onChange(setNoteText(notes, f.key, e.target.value))}
                    />
                    <span className="nt-count" data-testid={`notes-counter-${f.id}`} aria-hidden="true">{notes[f.key].length} / {NOTE_TEXT_MAX}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </aside>
  )
}

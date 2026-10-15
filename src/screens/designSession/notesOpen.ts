import { useCallback, useState } from 'react'
import { NOTE_SECTIONS, type NoteSection } from '../../rules/designNotes'

type SectionId = NoteSection['id']
const KNOWN: readonly string[] = NOTE_SECTIONS.map(s => s.id)

/** On a session's first view only Requirements is open. */
export const DEFAULT_OPEN: readonly SectionId[] = ['requirements']

/** The open sections of a session's notes accordion live per browser tab (sessionStorage), one key per session id. */
export const notesOpenKey = (sessionId: string): string => `dojo.design.notes-open.${sessionId}`

/** The stored open set; nothing stored, or a value that is not a list of section ids, reads as the default. */
export function readOpen(sessionId: string): SectionId[] {
  try {
    const raw = sessionStorage.getItem(notesOpenKey(sessionId))
    if (raw === null) return [...DEFAULT_OPEN]
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return [...DEFAULT_OPEN]
    return v.filter((x): x is SectionId => typeof x === 'string' && KNOWN.includes(x))
  } catch {
    return [...DEFAULT_OPEN]
  }
}

function writeOpen(sessionId: string, ids: readonly string[]): void {
  try { sessionStorage.setItem(notesOpenKey(sessionId), JSON.stringify(ids)) } catch { /* storage off: the open set still works for this view */ }
}

export interface NotesOpen {
  open: ReadonlySet<string>
  toggle: (id: string) => void
  /** open a section if it is closed (Ctrl/Cmd+. opens Requirements) */
  ensure: (id: string) => void
}

/** Which sections are open. Writes storage only on a user action (toggle, ensure), never on load. `sessionId` null keeps it in memory only. */
export function useNotesOpen(sessionId: string | null): NotesOpen {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(sessionId ? readOpen(sessionId) : DEFAULT_OPEN))
  const commit = useCallback((next: Set<string>) => {
    setOpen(next)
    if (sessionId) writeOpen(sessionId, [...next])
  }, [sessionId])
  const toggle = useCallback((id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    commit(next)
  }, [open, commit])
  const ensure = useCallback((id: string) => {
    if (open.has(id)) return
    commit(new Set(open).add(id))
  }, [open, commit])
  return { open, toggle, ensure }
}

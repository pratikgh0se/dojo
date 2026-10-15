import { useCallback, useEffect, useRef, useState } from 'react'
import { useDb } from '../app/providers'
import { EXPLAIN_RESPONSE_MAX, LEARNER_NOTES_MAX, setExplainResponse, setLearnerNotes, setSelfMark, type LearnerResult } from '../data/learnerActions'
import { safeWrite } from '../data/safeWrite'
import type { Ticket } from '../data/types'
import { isReadOnly } from '../data/writer'
import { now } from '../lib/clock'
import { useToast } from '../ui/primitives'

export type SelfMark = NonNullable<Ticket['selfMark']>
/** Quiet time after the last keystroke before a draft is written. */
export const AUTOSAVE_MS = 250
/** The limits of the stored fields, for the textareas' `maxLength` (the same numbers the learner-work actions enforce). */
export { EXPLAIN_RESPONSE_MAX, LEARNER_NOTES_MAX }
const SAVE_FAILED = 'Could not save your work. Try again.'

export interface TicketWork {
  notes: string
  answers: string[]
  selfMark: SelfMark | undefined
  /** Reference answers opened this visit (not stored; the answers themselves are). */
  revealed: boolean
  setNotes: (v: string) => void
  setAnswer: (i: number, v: string) => void
  setSelfMark: (m: SelfMark | undefined) => void
  reveal: () => void
  /** Write any pending draft now. Resolves when the writes are done. */
  flush: () => Promise<void>
}

const padTo = (xs: string[] | undefined, n: number): string[] => Array.from({ length: n }, (_, i) => (typeof xs?.[i] === 'string' ? xs[i] : ''))

/**
 * A learner's own work on one ticket: free notes, one answer per explain question, the build self-mark. The draft
 * lives in memory while typing, so the screen never waits for the database; it is saved to the ticket row through
 * S2's learner-work actions after AUTOSAVE_MS of quiet, on flush (Done), and when the screen is left. The fields are
 * learner-owned (master D11): plan refresh keeps them, and they sync and back up like the rest of the row.
 */
export function useTicketWork(ticket: Ticket): TicketWork {
  const d = useDb()
  const id = ticket.id
  const questions = ticket.explain?.length ?? 0
  const [notes, setNotesState] = useState(ticket.learnerNotes ?? '')
  const [answers, setAnswers] = useState(() => padTo(ticket.explainResponses, questions))
  const [selfMark, setMarkState] = useState<SelfMark | undefined>(ticket.selfMark)
  const [revealed, setRevealed] = useState(false)
  const pending = useRef<{ notes?: string; answers: Map<number, string> }>({ answers: new Map() })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // the toast function changes with its provider; the write paths below must stay stable
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const report = useCallback((m: string) => toastRef.current(m, 'danger'), [])

  /** One write, answered honestly: a refusal or a thrown error is a toast and `false`, never an unhandled rejection. */
  const write = useCallback(async (fn: () => Promise<LearnerResult>): Promise<boolean> => {
    try {
      const r = await safeWrite(fn, report) // quota and read-only refusals are toasted by safeWrite itself
      if (r === undefined) return false
      if (!r.ok) { report(r.message); return false }
      return true
    } catch {
      report(SAVE_FAILED)
      return false
    }
  }, [report])

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined }
    const p = pending.current
    pending.current = { answers: new Map() }
    if (isReadOnly()) return
    const at = now()
    // what could not be written goes back, unless the learner has typed something newer meanwhile
    if (p.notes !== undefined && !(await write(() => setLearnerNotes(d, id, p.notes!, at))) && pending.current.notes === undefined) pending.current.notes = p.notes
    for (const [i, v] of p.answers) {
      if (!(await write(() => setExplainResponse(d, id, i, v, at))) && !pending.current.answers.has(i)) pending.current.answers.set(i, v)
    }
  }, [d, id, write])

  const later = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS)
  }, [flush])

  useEffect(() => () => { void flush() }, [flush])
  // a reload or closed tab runs no React cleanup: write the draft as the page goes away (TICKET-17)
  useEffect(() => {
    const away = () => { void flush() }
    const hidden = () => { if (document.visibilityState === 'hidden') void flush() }
    window.addEventListener('pagehide', away)
    document.addEventListener('visibilitychange', hidden)
    return () => { window.removeEventListener('pagehide', away); document.removeEventListener('visibilitychange', hidden) }
  }, [flush])

  return {
    notes, answers, selfMark, revealed,
    setNotes: v => { setNotesState(v); pending.current.notes = v; later() },
    setAnswer: (i, v) => { setAnswers(a => a.map((x, j) => (j === i ? v : x))); pending.current.answers.set(i, v); later() },
    setSelfMark: m => {
      const before = selfMark
      setMarkState(m)
      void write(() => setSelfMark(d, id, m ?? null, now())).then(ok => { if (!ok) setMarkState(before) })
    },
    reveal: () => setRevealed(true),
    flush,
  }
}

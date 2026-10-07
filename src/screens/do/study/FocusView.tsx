import { useEffect, useRef } from 'react'
import type { Ticket } from '../../../data/types'
import type { Study } from '../../../rules/studySession'
import { Button } from '../../../ui/primitives'
import { isCoarsePointer } from '../../../lib/coarsePointer'
import { Brief, Clock } from './SessionPanel'
import './study.css'

/**
 * UX-08: full-screen focus mode. Only the brief, the timer, a Notes pad, "End session" and "Exit focus mode"
 * are on screen: no rail, no links, no ladder. Esc leaves focus mode and the session keeps running.
 */
export function FocusView({
  study, now, cards, notes, onNotes, onEnd, onExit,
}: {
  study: Study; now: number; cards: Ticket[]; notes: string; onNotes: (v: string) => void; onEnd: () => void; onExit: () => void
}) {
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  // entering focus mode puts the cursor in Notes; on touch the screen itself takes focus (ruling 18 F3: no keyboard)
  useEffect(() => { if (isCoarsePointer()) mainRef.current?.focus(); else notesRef.current?.focus() }, [])
  return (
    <main ref={mainRef} tabIndex={-1} className="do do-focus" data-testid="focus-screen" data-focus="true">
      <div className="focus-view">
        <Brief study={study} cards={cards} focus />
        <Clock study={study} now={now} />
        <label className="study-notes">
          Notes
          <textarea ref={notesRef} data-testid="session-notes" value={notes} onChange={e => onNotes(e.target.value)} />
        </label>
        <div className="study-actions">
          <Button variant="quiet" data-testid="session-end" onClick={onEnd}>End session</Button>
          <Button variant="quiet" data-testid="focus-exit" onClick={onExit}>Exit focus mode</Button>
        </div>
      </div>
    </main>
  )
}

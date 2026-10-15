import { useCallback, useState } from 'react'
import { useDb } from '../../../app/providers'
import { savePartner } from '../../../data/designSessionActions'
import type { DesignSession, PartnerScores } from '../../../data/types'
import { now } from '../../../lib/clock'
import type { PlanDesignRef } from '../../../rules/designs'
import { Button } from '../../../ui/primitives'
import { openPartnerWindow, partnerWindowState } from './openPartnerWindow'
import { PartnerCard } from './PartnerCard'

/** The Partner tab of a With someone session: open the card in a second window, or show the same card here if a window is blocked. */
export function PartnerTab({ item, session, onOpened }: { item: PlanDesignRef; session: DesignSession; onOpened?: () => void }) {
  const d = useDb()
  const [opened, setOpened] = useState(partnerWindowState(session.id))
  const [inline, setInline] = useState(opened === 'blocked')
  // The card now has its own window: the host goes back to the notes (DESIGN-61 edits them while the card follows)
  const open = () => { const r = openPartnerWindow(session.id); setOpened(r); setInline(r === 'blocked'); if (r === 'opened') onOpened?.() }
  const onSave = useCallback(async (patch: { name: string; scores: PartnerScores; notes?: string }) => {
    const ok = await savePartner(d, session.id, patch, now())
    if (!ok) throw new Error('not saved')
  }, [d, session.id])
  return (
    <div className="ptt" data-testid="partner-tab">
      <p className="ptt-lead">Your friend plays the person across the table. The card opens in a second window so they can read it while you draw.</p>
      <div className="ptt-actions">
        <Button data-testid="partner-open-window" onClick={open}>Open card in a second window</Button>
        <Button data-testid="partner-toggle" aria-pressed={inline} onClick={() => setInline(v => !v)}>{inline ? 'Hide card here' : 'Show card here'}</Button>
      </div>
      {opened === 'opened' && !inline && <p className="ptt-note" role="status">The card is open in another window.</p>}
      {opened === 'blocked' && <p className="ptt-note" role="status">The window was blocked, so the card is here instead.</p>}
      {inline && <PartnerCard item={item} session={session} accent={false} onSave={onSave} />}
    </div>
  )
}

import { useCallback } from 'react'
import { useDb, usePlan } from '../../../app/providers'
import { syncGate } from '../../../data/db'
import { savePartner } from '../../../data/designSessionActions'
import { useDesignSession } from '../../../data/designHooks'
import { useTicket } from '../../../data/hooks'
import type { PartnerScores } from '../../../data/types'
import { now } from '../../../lib/clock'
import { IDLE_TICK_MS, useSecondsNow } from '../../../lib/useNow'
import { readDesignMode } from '../../../rules/designMode'
import { designRefFromTicket, findDesign } from '../../../rules/designs'
import { clockText, remainingMs } from '../../../rules/designSession'
import { Loading } from '../../../ui/Loading'
import '../session.css'
import { PartnerCard } from './PartnerCard'

/** The whole page behind `#/partner/<sessionId>`: the card only. Same origin and database as the main window, so it follows live. */
export function PartnerWindow({ sessionId, readOnly = !!syncGate.readOnly }: { sessionId: string; readOnly?: boolean }) {
  const d = useDb()
  const plan = usePlan()
  const session = useDesignSession(sessionId)
  const t = useSecondsNow(session ? session.at + (session.pausedMs ?? 0) : undefined, IDLE_TICK_MS)
  const ticket = useTicket(session?.designId ?? '__none__')
  const onSave = useCallback(async (patch: { name: string; scores: PartnerScores; notes?: string }) => {
    const ok = await savePartner(d, sessionId, patch, now())
    if (!ok) throw new Error('not saved')
  }, [d, sessionId])
  if (session === undefined || ticket === undefined) return <Loading />
  const item = session ? (findDesign(plan, session.designId) ?? (ticket ? designRefFromTicket(ticket) : null)) : null
  if (!session || !item || readDesignMode(session.mode) !== 'human-partner') {
    return (
      <main className="ptw" data-testid="screen-partner" data-ready="true">
        <p className="ptw-missing" data-testid="partner-missing">That session was not found.</p>
      </main>
    )
  }
  return (
    <main className="ptw" data-testid="screen-partner" data-ready="true">
      <header className="ptw-head">
        <span className="ptw-title">Partner card</span>
        <span className="ptc-meta">Only you can see this card</span>
        <span className="ptw-clock" data-testid="partner-clock" role="timer" aria-label="Time left">{clockText(remainingMs(session, t))}</span>
      </header>
      <PartnerCard item={item} session={session} readOnly={readOnly} onSave={onSave} />
    </main>
  )
}

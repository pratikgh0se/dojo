import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useDb, usePlan } from '../../app/providers'
import { useDesignSessions } from '../../data/designHooks'
import { useTicket } from '../../data/hooks'
import { syncGate } from '../../data/db'
import { applyPending, blockPending, readPending, sweepPending, type PendingDrawing, type Resolved } from '../../data/designPending'
import { discardDesignSession, flushThenLock, newDesignSessionRow, startDesignSession } from '../../data/designSessionActions'
import { lockAt } from '../../rules/designSession'
import { safeWrite } from '../../data/safeWrite'
import type { DesignSession } from '../../data/types'
import { now } from '../../lib/clock'
import { outstandingFor } from '../../rules/designEvidence'
import type { DesignMode } from '../../rules/designDigest'
import { readDesignMode } from '../../rules/designMode'
import { designRefFromTicket, findDesign, type PlanDesignRef } from '../../rules/designs'
import { useToast } from '../../ui/primitives'
import { ConfirmDialog } from './ConfirmDialog'
import { AiPartnerNote, AiPartnerPanel } from './AiPartnerPanel'
import { DoneView } from './DoneView'
import { LiveSession } from './LiveSession'
import { PartnerTab } from './partner/PartnerTab'
import { SessionDock } from '../../study/SessionPill'
import { SessionRail } from './SessionRail'
import { SetupPanel } from './SetupPanel'
import { useWriteQueue } from './useWriteQueue'
import './session.css'
import { Loading } from '../../ui/Loading'

const PHASE_RANK: Record<DesignSession['phase'], number> = { setup: -1, drawing: 0, close: 1, score: 2, done: 3 }

export function DesignSessionScreen() {
  const { designId = '' } = useParams()
  const [search] = useSearchParams()
  const plan = usePlan()
  // The route serves design-bank ids and design / write-up ticket ids (F9)
  const ticket = useTicket(designId)
  const sessions = useDesignSessions(designId)
  const d = useDb()
  // A stash left for a session that is over (finished, locked, discarded) is of no use: remove it.
  useEffect(() => { void sweepPending(d).catch(() => {}) }, [d])
  if (ticket === undefined || sessions === undefined) return <Loading />
  const item = findDesign(plan, designId) ?? (ticket && (ticket.kind === 'design' || ticket.kind === 'writeup') ? designRefFromTicket(ticket) : null)
  if (!item) return <Missing title="Design not found" />
  const wanted = search.get('session')
  // The plain route shows the live session; with none, the most recent finished one (its summary, grade and diagram), so a finished
  // session is always reachable by the ticket's own route (DESIGN-81). `?new=1` always shows the setup screen; Start then drops it from the URL.
  const latestDone = sessions.filter(s => s.phase === 'done').sort((a, b) => b.at - a.at)[0] ?? null
  const current = wanted ? sessions.find(s => s.id === wanted) ?? null : search.get('new') === '1' ? null : sessions.find(s => s.phase !== 'done') ?? latestDone
  if (wanted && !current) return <Missing title="Session not found" />
  return <SessionView item={item} text={ticket?.text} session={current} sessions={sessions} />
}

function Missing({ title }: { title: string }) {
  return (
    <div className="ds-missing">
      <h1 className="screen-title">{title}</h1>
      <Link to="/designs">Back to Designs</Link>
    </div>
  )
}

/**
 * A reload or close right after the last keystroke leaves the unsaved parts (notes / canvas / view) in a stash the page wrote
 * while going away (designPending). Apply it to the stored session before the live session shows, so the boxes open with the
 * text and the data holds it. The stash is applied only when the stored row is still what it was made from (otherwise another
 * window wrote newer data and the stash is dropped), and never in a read-only browser. Returns the session to show (the parts
 * that were applied laid over it) or null while the stash is still being applied. A failed write keeps the stash for the next
 * load and shows the stored session.
 */
function useHandedOver(session: DesignSession | null, onError: (m: string) => void): DesignSession | null {
  const d = useDb()
  const id = session?.phase === 'drawing' && !syncGate.readOnly ? session.id : null
  const read = useRef<{ id: string; slot: PendingDrawing | null } | null>(null)
  if (id && read.current?.id !== id) read.current = { id, slot: readPending(id) }
  const slot = id ? read.current!.slot : null
  const [settled, setSettled] = useState<{ id: string; parts: Resolved } | null>(null)
  useEffect(() => {
    if (!id || !slot || settled?.id === id) return
    let parts: Resolved = {}
    void safeWrite(() => applyPending(d, id, slot), onError)
      .then(r => { if (r) parts = r })
      .catch(() => { /* kept for the next load */ })
      .finally(() => setSettled({ id, parts }))
  }, [d, id, slot, settled, onError])
  return useMemo(() => {
    if (!session || !slot || session.phase !== 'drawing') return session
    return settled?.id === session.id ? { ...session, ...settled.parts } : null
  }, [session, slot, settled])
}

function SessionView({ item, text, session: stored, sessions }: { item: PlanDesignRef; text?: string; session: DesignSession | null; sessions: DesignSession[] }) {
  const d = useDb()
  const toast = useToast()
  const navigate = useNavigate()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // Ids of sessions just discarded from the setup screen: the stored row may outlive the click by a moment, and the note must not flash back.
  const [gone, setGone] = useState<string[]>([])
  const onError = useCallback((m: string) => toast(m, 'danger'), [toast])
  const { push, flush, flushNow, savedAt } = useWriteQueue(onError)
  // The session just started is shown at once (not after the stored row comes back through the live query): Start is one step, and what
  // the screen shows right after it is the drawing, never the setup for a moment. The stored row replaces it as soon as it is read.
  const [pending, setPending] = useState<DesignSession | null>(null)
  useEffect(() => { if (pending && stored?.id === pending.id) setPending(null) }, [pending, stored?.id])
  // The same for the steps that follow (CLOSE · DESIGN, NEXT · SCORE): the next phase shows as the button is pressed, laid over the stored
  // row until the stored row has caught up; a write that did not land takes it back. Completing is not one of them: the done view
  // draws the reference and stores it, which needs the stored row to be done.
  const [advance, setAdvance] = useState<{ id: string; patch: Partial<DesignSession> & { phase: DesignSession['phase'] } } | null>(null)
  const base = pending ?? stored
  const ahead = !!(base && advance && advance.id === base.id && PHASE_RANK[advance.patch.phase] > PHASE_RANK[base.phase])
  useEffect(() => { if (advance && !ahead && (!base || base.id !== advance.id || PHASE_RANK[base.phase] >= PHASE_RANK[advance.patch.phase])) setAdvance(null) }, [advance, ahead, base])
  const session = ahead && base && advance ? { ...base, ...advance.patch } : base
  /** `written` is the write that makes the move real; the screen moves after that write has been started, so what the new phase reads is queued behind it. */
  const moveTo = useCallback((id: string, patch: Partial<DesignSession> & { phase: DesignSession['phase'] }, written: Promise<unknown>) => {
    setAdvance({ id, patch })
    void written.then(ok => { if (!ok) setAdvance(null) }, () => setAdvance(null))
  }, [])
  const phase = session?.phase ?? 'setup'
  // ?new=1 on a design that has a live session: the setup shows a note with Resume and Discard in place of Start (DESIGN-81)
  const liveRow = phase === 'setup' ? sessions.find(s => s.phase !== 'done' && !gone.includes(s.id)) ?? null : null
  const shown = useHandedOver(session, onError)
  const start = (mode: DesignMode) => {
    const args = { designId: item.id, mode, deepDives: item.deepDives, nowMs: now() }
    const row = newDesignSessionRow(sessions, args)
    if (!row) return
    // the write starts first (its transaction is queued before anything the new screen reads), then the screen switches
    const written = safeWrite(() => startDesignSession(d, { ...args, row }), onError)
    setPending(row)
    navigate(`/designs/session/${item.id}`, { replace: true }) // leaves ?new=1: the route shows the live session from here on
    void written.then(r => { if (!r || r.id !== row.id) setPending(null) }, () => setPending(null))
  }
  // A change is queued (not written synchronously): don't lose the last edit — canvas, Close answer,
  // or Score answer — if the tab is hidden/closed or the session view unmounts (route change) before
  // that write lands (D-23, extended to Close/Score). Registered once here since the queue itself is
  // shared by the canvas, Close form and Score form; the 45:00 auto-lock and End-drawing confirm also
  // flush this same queue before locking, since saveCanvas is guarded by patchIf(['drawing']) and
  // would otherwise silently drop a write that's still queued once the lock has moved the session
  // past 'drawing'.
  useEffect(() => {
    // A page that is going away cannot finish a promise chain: start the newest notes and canvas snapshots at once
    // (their IndexedDB requests are issued now), then wait on whatever is still running.
    const onVisibility = () => { if (document.visibilityState === 'hidden') { flushNow(); void flush() } }
    const onPageHide = () => { flushNow(); void flush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      void flush()
    }
  }, [flush, flushNow])
  // CLOSE · DESIGN ends the drawing at once (no confirm, R-F2). Flush the write queue first (D-23
  // addendum) so a still-queued canvas or notes edit lands before the lock moves the session past
  // 'drawing' and patchIf(['drawing']) would otherwise drop it.
  const endDrawing = () => {
    if (!session) return
    const at = now()
    const written = safeWrite(() => flushThenLock(d, session.id, at, flush), onError)
    moveTo(session.id, { phase: 'close', ...lockAt(session, at) }, written)
  }
  const discard = () => {
    setConfirmDiscard(false)
    const target = session ?? liveRow
    if (!target) return
    blockPending(target.id)
    setPending(null)
    setAdvance(null)
    if (!session) setGone(g => [...g, target.id])
    // a discarded session leaves the setup screen of the same ticket, even when the ticket has an earlier finished session (DESIGN-80);
    // ?new=1 first, so the earlier finished session never shows (and never draws its reference) between the delete and the route change
    navigate(`/designs/session/${item.id}?new=1`, { replace: true })
    void safeWrite(() => discardDesignSession(d, target.id), onError).then(r => { if (r === undefined) setGone(g => g.filter(x => x !== target.id)) }, () => setGone(g => g.filter(x => x !== target.id)))
  }
  return (
    <div className="ds" data-phase={phase}>
      <SessionRail
        item={item} session={session}
        onDiscard={() => setConfirmDiscard(true)}
      />
      {/* ruling 24 S1: a study session running meanwhile stays in view */}
      <SessionDock />
      {phase === 'setup' && <SetupPanel item={item} text={text} redo={outstandingFor(sessions, item.id)} onStart={start}
        live={liveRow ? { onResume: () => navigate(`/designs/session/${item.id}`), onDiscard: () => setConfirmDiscard(true) } : undefined} />}
      {session && phase === 'done' && <DoneView item={item} session={session} />}
      {session && shown && phase !== 'done' && (
        <LiveSession
          key={session.id} item={item} session={shown} push={push} flush={flush} savedAt={savedAt} onEnd={endDrawing} onAdvance={(patch, written) => moveTo(session.id, patch, written)}
          dock={readDesignMode(session.mode) === 'ai-partner' ? <AiPartnerPanel item={item} session={session} flush={flush} /> : undefined}
          partnerPane={
            readDesignMode(session.mode) === 'ai-partner' ? <AiPartnerNote session={session} />
              : readDesignMode(session.mode) === 'human-partner' ? ({ showNotes }) => <PartnerTab item={item} session={session} onOpened={showNotes} /> : undefined
          }
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog title="Discard this session?" confirmLabel="Discard" cancelLabel="Cancel" tone="danger"
          confirmTestId="session-discard-confirm" cancelTestId="session-discard-cancel"
          onConfirm={discard} onCancel={() => setConfirmDiscard(false)} />
      )}
    </div>
  )
}

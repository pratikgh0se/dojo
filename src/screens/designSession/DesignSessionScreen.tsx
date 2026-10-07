import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useDb, usePlan } from '../../app/providers'
import { useDesignSessions } from '../../data/designHooks'
import { discardDesignSession, flushThenLock, startDesignSession } from '../../data/designSessionActions'
import { safeWrite } from '../../data/safeWrite'
import type { DesignSession } from '../../data/types'
import { now } from '../../lib/clock'
import { outstandingFor } from '../../rules/designEvidence'
import { findDesign, type PlanDesignRef } from '../../rules/designs'
import { useToast } from '../../ui/primitives'
import { ConfirmDialog } from './ConfirmDialog'
import { DoneView } from './DoneView'
import { LiveSession } from './LiveSession'
import { SessionDock } from '../../study/SessionPill'
import { SessionRail } from './SessionRail'
import { SetupPanel } from './SetupPanel'
import { useWriteQueue } from './useWriteQueue'
import './session.css'
import { Loading } from '../../ui/Loading'

export function DesignSessionScreen() {
  const { designId = '' } = useParams()
  const [search] = useSearchParams()
  const plan = usePlan()
  const item = findDesign(plan, designId)
  const sessions = useDesignSessions(designId)
  if (!item) return <Missing title="Design not found" />
  if (sessions === undefined) return <Loading />
  const wanted = search.get('session')
  const current = wanted ? sessions.find(s => s.id === wanted) ?? null : sessions.find(s => s.phase !== 'done') ?? null
  if (wanted && !current) return <Missing title="Session not found" />
  return <SessionView item={item} session={current} sessions={sessions} />
}

function Missing({ title }: { title: string }) {
  return (
    <div className="ds-missing">
      <h1 className="screen-title">{title}</h1>
      <Link to="/designs">Back to Designs</Link>
    </div>
  )
}

function SessionView({ item, session, sessions }: { item: PlanDesignRef; session: DesignSession | null; sessions: DesignSession[] }) {
  const d = useDb()
  const toast = useToast()
  const [confirm, setConfirm] = useState<{ kind: 'end' | 'discard'; at: number } | null>(null)
  const onError = useCallback((m: string) => toast(m, 'danger'), [toast])
  const { push, flush } = useWriteQueue(onError)
  const phase = session?.phase ?? 'setup'
  const start = (mode: 'solo' | 'interviewer') =>
    void safeWrite(() => startDesignSession(d, { designId: item.id, mode, deepDives: item.deepDives, nowMs: now() }), onError)
  // A change is queued (not written synchronously): don't lose the last edit — canvas, Close answer,
  // or Score answer — if the tab is hidden/closed or the session view unmounts (route change) before
  // that write lands (D-23, extended to Close/Score). Registered once here since the queue itself is
  // shared by the canvas, Close form and Score form; the 45:00 auto-lock and End-drawing confirm also
  // flush this same queue before locking, since saveCanvas is guarded by patchIf(['drawing']) and
  // would otherwise silently drop a write that's still queued once the lock has moved the session
  // past 'drawing'.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush() }
    const onPageHide = () => { void flush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      void flush()
    }
  }, [flush])
  // The drawing ends when the learner decided (the dialog opened), not when they confirmed. Flush
  // the write queue first (D-23 addendum) so a still-queued canvas edit lands before the lock moves
  // the session past 'drawing' and patchIf(['drawing']) would otherwise drop it.
  const endDrawing = (at: number) => {
    setConfirm(null)
    if (session) void safeWrite(() => flushThenLock(d, session.id, at, flush), onError)
  }
  const discard = () => {
    setConfirm(null)
    if (session) void safeWrite(() => discardDesignSession(d, session.id), onError)
  }
  return (
    <div className="ds" data-phase={phase}>
      <SessionRail
        item={item} session={session}
        onEnd={() => setConfirm({ kind: 'end', at: now() })}
        onDiscard={() => setConfirm({ kind: 'discard', at: now() })}
      />
      {/* ruling 24 S1: a study session running meanwhile stays in view */}
      <SessionDock />
      {phase === 'setup' && <SetupPanel item={item} redo={outstandingFor(sessions, item.id)} onStart={start} />}
      {session && phase === 'done' && <DoneView item={item} session={session} />}
      {session && phase !== 'done' && <LiveSession key={session.id} item={item} session={session} push={push} flush={flush} />}
      {confirm?.kind === 'end' && (
        <ConfirmDialog title="End drawing now?" confirmLabel="End drawing" cancelLabel="Keep going"
          onConfirm={() => endDrawing(confirm.at)} onCancel={() => setConfirm(null)} />
      )}
      {confirm?.kind === 'discard' && (
        <ConfirmDialog title="Discard this session?" confirmLabel="Discard" cancelLabel="Cancel" tone="danger"
          onConfirm={discard} onCancel={() => setConfirm(null)} />
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useDb } from '../../app/providers'
import { flushThenLock, saveCanvas, saveView } from '../../data/designSessionActions'
import { safeWrite } from '../../data/safeWrite'
import type { DesignSession } from '../../data/types'
import { useNow } from '../../lib/useNow'
import { normalizeCanvas, type KitCanvas as Canvas } from '../../rules/designCanvas'
import type { PlanDesignRef } from '../../rules/designs'
import { interviewStage, isOverdue, lockReason, lockStatusText, pngName } from '../../rules/designSession'
import { Panel, useToast } from '../../ui/primitives'
import { CloseForm } from './CloseForm'
import { CloseSummary } from './CloseSummary'
import { DeepDiveList } from './DeepDiveList'
import { InterviewerPanel } from './InterviewerPanel'
import { KitCanvas } from './kit/KitCanvas'
import { ScoreForm } from './ScoreForm'

/** A session in drawing, close or score. Locks itself at 45:00 (and on load when found later).
 * `push`/`flush` come from the parent's write queue (shared across the canvas, the Close form, the
 * Score form, and the End-drawing confirm) so the auto-lock below, the manual End-drawing action,
 * and the top-level pagehide/visibilitychange/unmount flush (D-23, extended to Close/Score) all
 * flush the same queue before locking or before the tab closes. */
export function LiveSession({
  item, session, push, flush,
}: { item: PlanDesignRef; session: DesignSession; push: (job: () => Promise<unknown>) => void; flush: () => Promise<void> }) {
  const d = useDb()
  const toast = useToast()
  const t = useNow(1000)
  const onError = useCallback((m: string) => toast(m, 'danger'), [toast])
  const [canvas, setCanvas] = useState(() => normalizeCanvas(session.canvas))
  const [view, setView] = useState<'2d' | 'iso'>(session.view ?? '2d')
  useEffect(() => {
    if (isOverdue(session, t)) void safeWrite(() => flushThenLock(d, session.id, t, flush), onError)
  }, [d, session, t, onError, flush])
  const change = useCallback((next: Canvas) => {
    setCanvas(next)
    push(() => saveCanvas(d, session.id, next))
  }, [d, push, session.id])
  const changeView = useCallback((v: '2d' | 'iso') => {
    setView(v)
    push(() => saveView(d, session.id, v))
  }, [d, push, session.id])
  const reason = lockReason(session)
  const stage = session.interview ? interviewStage(session.interview.messages) : null
  return (
    <div className="ds-body">
      <div className="ds-left">
        {reason && <p role="status" className="ds-locked">{lockStatusText(reason)}</p>}
        <KitCanvas
          canvas={canvas} view={view} locked={session.phase !== 'drawing'}
          exportName={pngName(item.id, session.at)} onChange={change} onView={changeView}
        />
      </div>
      <div className="ds-right">
        {session.phase === 'drawing' && (
          <Panel title="Deep dives" className="ds-checklist">
            <DeepDiveList dives={item.deepDives} active={stage?.activeDive ?? 0} />
          </Panel>
        )}
        {session.mode === 'interviewer' && <InterviewerPanel item={item} session={session} />}
        {session.phase === 'close' && <CloseForm item={item} session={session} push={push} flush={flush} />}
        {session.phase === 'score' && (
          <>
            <CloseSummary close={session.close} dives={item.deepDives} />
            <ScoreForm item={item} session={session} push={push} flush={flush} />
          </>
        )}
      </div>
    </div>
  )
}

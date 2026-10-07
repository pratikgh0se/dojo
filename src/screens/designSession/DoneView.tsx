import { useCallback, useEffect, useRef, useState } from 'react'
import { useDb } from '../../app/providers'
import { saveReference } from '../../data/designSessionActions'
import type { DesignSession } from '../../data/types'
import { localDayKey } from '../../lib/dates'
import { exportDiagramPng } from '../../lib/exportPng'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { normalizeCanvas } from '../../rules/designCanvas'
import { diffDiagrams } from '../../rules/designDiff'
import type { PlanDesignRef } from '../../rules/designs'
import { divesText, lensText, pngName, summaryText, tradeoffComplete } from '../../rules/designSession'
import { FitDiagram, REFERENCE_MIN_SCALE } from '../../ui/engines/FitDiagram'
import { Button } from '../../ui/primitives'
import { BlockLoader } from './BlockLoader'
import { CloseSummary } from './CloseSummary'
import { drawReference, once } from './designAi'
import { DiffPanel } from './DiffPanel'
import { GradeView } from './GradeView'
import { TranscriptLog } from './InterviewerPanel'

/** A completed session, read-only: summary, the learner's diagram beside the reference (never over it), the diff. */
export function DoneView({ item, session }: { item: PlanDesignRef; session: DesignSession }) {
  const d = useDb()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  // A9: labels keep their room from tablet up (the well scrolls); a phone still fits the whole drawing, nothing scrolls sideways (cu-7 P3-5)
  const roomy = useMediaQuery('(min-width: 641px)')
  const [loading, setLoading] = useState(!session.reference)
  const [refError, setRefError] = useState('')
  const [play, setPlay] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const yoursWell = useRef<HTMLDivElement>(null)
  const refWell = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setRefError('')
    const r = await once(`reference:${session.id}`, async () => {
      const res = await drawReference(d, item)
      if (res.ok) await saveReference(d, session.id, res.value)
      return res
    })
    setLoading(false)
    if (!r.ok) setRefError(r.error)
  }, [d, item, session.id])

  useEffect(() => {
    if (!session.reference) void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = normalizeCanvas(session.canvas)
  const reference = session.reference
  const diff = reference ? diffDiagrams(mine, reference) : null
  const exportFrom = (well: HTMLDivElement | null, name: string) =>
    void exportDiagramPng(well?.querySelector('sr-diagram') ?? null, name)

  return (
    <div className="ds-done">
      <section className="sr-panel ds-summary" data-testid="session-summary" aria-label="Summary">
        <h2 className="sr-panel-title">Session</h2>
        <p className="ds-summary-line">{summaryText(session)}</p>
        <p>Deep dives {divesText(session.deepDives)}</p>
        <p>{lensText(session.lenses)}</p>
        <ul className="ds-trades">
          {session.tradeoffs.filter(tradeoffComplete).map((t, i) => (
            <li key={i}>Chose {t.chose} over {t.over} because {t.because}</li>
          ))}
        </ul>
        {session.redesignDue != null && (
          <p className="ds-redesign" data-testid="session-redesign">Redesign due {localDayKey(session.redesignDue)}</p>
        )}
      </section>
      <div className="ds-compare">
        <section className="sr-panel ds-yours" data-testid="session-yours" aria-label="Your diagram">
          <h2 className="sr-panel-title">Your diagram</h2>
          <div className="ds-well" ref={yoursWell} tabIndex={0}>
            {mine.nodes.length > 0
              ? <FitDiagram data={mine} view="2d" label="Your diagram, read-only" />
              : <p className="empty">Empty canvas</p>}
          </div>
          <div className="ds-ref-bar">
            <Button onClick={() => exportFrom(yoursWell.current, pngName(item.id, session.at))}>Export PNG</Button>
          </div>
        </section>
        <section className="sr-panel ds-reference" data-testid="session-reference" aria-label="Reference">
          <h2 className="sr-panel-title">Reference</h2>
          {!reference && loading && <BlockLoader label="Drawing the reference" testId="session-reference-loading" />}
          {refError && (
            <p className="ds-ai-error" data-testid="session-ai-error">
              {refError} <Button onClick={() => void load()}>Retry</Button>
            </p>
          )}
          {reference && (
            <>
              <div className="ds-well" ref={refWell} tabIndex={0}>
                <FitDiagram data={reference} view="2d" minScale={roomy ? REFERENCE_MIN_SCALE : undefined} play={play && !reduced} label="Reference architecture" />
              </div>
              <div className="ds-ref-bar">
                <Button aria-pressed={play} onClick={() => setPlay(p => !p)}>Play flows</Button>
                <Button aria-expanded={showJson} onClick={() => setShowJson(v => !v)}>JSON</Button>
                <Button onClick={() => exportFrom(refWell.current, pngName(item.id, session.at, 'reference'))}>Export reference PNG</Button>
              </div>
              {showJson && <pre className="ds-json" data-testid="session-reference-json" tabIndex={0}>{JSON.stringify(reference, null, 2)}</pre>}
            </>
          )}
        </section>
      </div>
      {diff && <DiffPanel diff={diff} />}
      {session.interview?.final && (
        <section className="sr-panel" aria-label="Interview grade">
          <h2 className="sr-panel-title">Interview grade</h2>
          <GradeView final={session.interview.final} />
        </section>
      )}
      {session.interview && (
        <details className="sr-panel ds-transcript">
          <summary>Transcript</summary>
          <TranscriptLog messages={session.interview.messages} />
        </details>
      )}
      <CloseSummary close={session.close} dives={item.deepDives} />
    </div>
  )
}

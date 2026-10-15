import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../../app/providers'
import { saveReference, startDesignSession } from '../../data/designSessionActions'
import { syncGate } from '../../data/db'
import { safeWrite } from '../../data/safeWrite'
import { isReadOnlyError } from '../../data/writer'
import type { DesignSession } from '../../data/types'
import { now } from '../../lib/clock'
import { localDayKey } from '../../lib/dates'
import { exportDiagramPng } from '../../lib/exportPng'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { normalizeCanvas, toEngineJson } from '../../rules/designCanvas'
import { diffDiagrams } from '../../rules/designDiff'
import { canvasLabels } from '../../rules/gradeEvidence'
import { readDesignMode } from '../../rules/designMode'
import { normalizeNotes } from '../../rules/designNotes'
import type { PlanDesignRef } from '../../rules/designs'
import { divesText, lensText, pngName, summaryText, tradeoffComplete } from '../../rules/designSession'
import { FitDiagram, REFERENCE_MIN_SCALE } from '../../ui/engines/FitDiagram'
import { Button, useToast } from '../../ui/primitives'
import { BlockLoader } from './BlockLoader'
import { CloseSummary } from './CloseSummary'
import { drawReference, once, thrownMessage } from './designAi'
import { DiffPanel } from './DiffPanel'
import { GradeView, ScoredGradeView } from './GradeView'
import { KeepPanel } from './KeepPanel'
import { TranscriptLog } from './AiPartnerPanel'

/** A completed session, read-only: summary, the learner's diagram beside the reference (never over it), the diff. */
export function DoneView({ item, session }: { item: PlanDesignRef; session: DesignSession }) {
  const d = useDb()
  const navigate = useNavigate()
  const toast = useToast()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  // A9: labels keep their room from tablet up (the well scrolls); a phone still fits the whole drawing, nothing scrolls sideways (cu-7 P3-5)
  const roomy = useMediaQuery('(min-width: 641px)')
  // DESIGN-54: a With someone session uses no AI anywhere, so its done view draws no reference (the learner's own drawing and the stored data stand).
  const usesAi = readDesignMode(session.mode) !== 'human-partner'
  // A read-only browser (no writer URL) cannot store a reference and the AI job is for the writer only (DESIGN-79): it draws none.
  const readOnly = !!syncGate.readOnly
  const [loading, setLoading] = useState(usesAi && !session.reference && !readOnly)
  const [refError, setRefError] = useState('')
  const [play, setPlay] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const yoursWell = useRef<HTMLDivElement>(null)
  const refWell = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setRefError('')
    try {
      const r = await once(`reference:${session.id}`, async () => {
        const res = await drawReference(d, item)
        if (res.ok) await saveReference(d, session.id, res.value)
        return res
      })
      if (!r.ok) setRefError(r.error)
    } catch (e) {
      // a refused write in a read-only browser is not an error to show; any other failed write is the plain sentence with Retry
      if (!isReadOnlyError(e)) setRefError(thrownMessage(e, 'diagram'))
    } finally {
      setLoading(false)
    }
  }, [d, item, session.id])

  useEffect(() => {
    if (usesAi && !session.reference && !readOnly) void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = normalizeCanvas(session.canvas)
  // The engine draws, and the diff compares, what toEngineJson makes of the canvas and the schema: a custom box wears its glyph, a table block its columns.
  const engine = toEngineJson(mine, normalizeNotes(session.notes))
  const reference = session.reference
  const diff = reference ? diffDiagrams(engine, reference) : null

  /** REDO · DESIGN: a new session at once, drawing, in the same mode, naming this one (DESIGN-73). It starts with empty notes. */
  const redo = async () => {
    // like every other writer: a refused write (read-only browser, full disk) is a toast, never an unhandled rejection
    const fresh = await safeWrite(
      () => startDesignSession(d, { designId: item.id, mode: readDesignMode(session.mode), deepDives: item.deepDives, nowMs: now(), redesignOf: session.id }),
      m => toast(m, 'danger'),
    )
    if (fresh) navigate(`/designs/session/${item.id}`, { replace: true })
  }
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
        <div className="ds-actions">
          <Button data-testid="session-new" onClick={() => navigate(`/designs/session/${item.id}?new=1`)}>New session on this design</Button>
        </div>
        {session.redesignDue != null && (
          <div className="ds-redo">
            <p className="ds-redesign" data-testid="session-redesign-due">Redesign due {localDayKey(session.redesignDue)}</p>
            <Button variant="accent" data-testid="session-redesign" data-accent="primary" onClick={() => void redo()}>REDO · DESIGN</Button>
          </div>
        )}
      </section>
      {session.interview?.final ? (
        <section className="sr-panel ds-done-grade" aria-label="Grade">
          <h2 className="sr-panel-title">Grade</h2>
          <GradeView final={session.interview.final} labels={canvasLabels(session)}>
            {usesAi && <KeepPanel session={session} />}
          </GradeView>
        </section>
      ) : session.rubric != null && (
        <section className="sr-panel ds-done-grade" aria-label="Grade">
          <h2 className="sr-panel-title">Grade</h2>
          <ScoredGradeView session={session} />
        </section>
      )}
      <CloseSummary close={session.close} dives={item.deepDives} />
      <div className="ds-compare">
        <section className="sr-panel ds-yours" data-testid="session-yours" aria-label="Your diagram">
          <h2 className="sr-panel-title">Your diagram</h2>
          <div className="ds-well" ref={yoursWell} tabIndex={0}>
            {mine.nodes.length > 0
              ? <FitDiagram data={engine} view="2d" label="Your diagram, read-only" />
              : <p className="empty">Empty canvas</p>}
          </div>
          <div className="ds-ref-bar">
            <Button onClick={() => exportFrom(yoursWell.current, pngName(item.id, session.at))}>Export PNG</Button>
          </div>
        </section>
        <section className="sr-panel ds-reference" data-testid="session-reference" aria-label="Reference">
          <h2 className="sr-panel-title">Reference</h2>
          {!reference && !usesAi && <p className="hint" data-testid="session-reference-none">The reference diagram needs the AI; this session used none.</p>}
          {!reference && usesAi && readOnly && <p className="hint" data-testid="session-reference-readonly">Open Dojo from the Dojo app to draw the reference diagram.</p>}
          {!reference && loading && <BlockLoader label="Drawing the reference" testId="session-reference-loading" />}
          {refError && (
            <p className="ds-ai-error" data-testid="session-ai-error">
              {refError} <Button data-testid="ai-retry" onClick={() => void load()}>Retry</Button>
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
      {session.interview && (
        <details className="sr-panel ds-transcript" open>
          <summary>Conversation</summary>
          <TranscriptLog messages={session.interview.messages} />
        </details>
      )}
    </div>
  )
}

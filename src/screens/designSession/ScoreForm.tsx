import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LENSES, type Lens, type Score012 } from '../../ai/types'
import { useDb } from '../../app/providers'
import { syncGate } from '../../data/db'
import { completeDesignSession, saveFinal, saveScore } from '../../data/designSessionActions'
import { safeWrite } from '../../data/safeWrite'
import type { DeepDive, DesignSession, Tradeoff } from '../../data/types'
import { now } from '../../lib/clock'
import type { PlanDesignRef } from '../../rules/designs'
import { DIGEST_MAX } from '../../rules/designDigest'
import { readDesignMode } from '../../rules/designMode'
import { partnerNotesText, prefillFromPartner } from '../../rules/partnerScores'
import { cappedDive, DIVE_WORDS, EMPTY_TRADEOFF, LENS_LABELS, parseRubric, RUBRIC_BREAKDOWN, scoreReady } from '../../rules/designSession'
import { Button, useFlash, usePowerUp, useToast } from '../../ui/primitives'
import { BlockLoader } from './BlockLoader'
import { TextField } from './CloseForm'
import { freshDigest, gradeInterview, once, thrownMessage } from './designAi'
import { GradeView, PartnerNotes } from './GradeView'
import { canvasLabels } from '../../rules/gradeEvidence'

const SCORES: Score012[] = [0, 1, 2]

function ScoreGroup({
  name, value, cap2 = false, describe = false, testId, onPick,
}: { name: string; value: Score012 | null | undefined; cap2?: boolean; describe?: boolean; testId?: string; onPick: (v: Score012) => void }) {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={name} className="ds-score-row" data-testid={testId}>
      <span className="ds-score-name" aria-hidden="true">{name}</span>
      {/* UAT cu-7 P3-7: the three choices are one group that wraps as a unit, never 0 beside the question and 1, 2 below it */}
      <div className="ds-score-opts" data-described={describe || undefined}>
        {SCORES.map(v => (
          <label key={v} className="ds-radio">
            <input
              type="radio" name={id} aria-label={String(v)} data-testid={testId ? `${testId}-${v}` : undefined} aria-describedby={describe ? `${id}-${v}` : undefined}
              checked={value === v} disabled={v === 2 && cap2} onChange={() => onPick(v)}
            />
            <span aria-hidden="true">{v}</span>
            {describe && <span id={`${id}-${v}`} className="ds-radio-desc">{DIVE_WORDS[v]}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}

/** TRACKING §1 scoring: 4 deep dives 0/1/2 and rubric 0–20 are required; the 7 lenses and the trade-off rows are optional (DESIGN-66, DESIGN-72). Interviewer mode prefills from the model.
 * `push`/`flush` come from the parent's write queue (shared with the canvas and Close form) so the
 * pagehide/visibilitychange/unmount flush registered once at the top level (D-23, extended to
 * Close/Score) also covers a Score answer typed just before the tab closes. */
export function ScoreForm({
  item, session, push, flush,
}: { item: PlanDesignRef; session: DesignSession; push: (job: () => Promise<unknown>) => void; flush: () => Promise<void> }) {
  const d = useDb()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  const navigate = useNavigate()
  const onError = useCallback((m: string) => toast(m, 'danger'), [toast])
  const cap = cappedDive(session.close)
  const [dives, setDives] = useState<DeepDive[]>(session.deepDives)
  const [lenses, setLenses] = useState(session.lenses)
  const [trades, setTrades] = useState<Tradeoff[]>(session.tradeoffs)
  const [rubricText, setRubricText] = useState(session.rubric === null ? '' : String(session.rubric))
  const [rubricBy, setRubricBy] = useState(session.rubricBy)
  // the loader is there from the first paint when the grade is about to run (no frame of an ungraded form first); a read-only browser runs none (DESIGN-79)
  const autoGrade = () => readDesignMode(session.mode) === 'ai-partner' && !session.interview?.final && !syncGate.readOnly
  const [grading, setGrading] = useState(autoGrade)
  const [gradeError, setGradeError] = useState('')
  const [busy, setBusy] = useState(false)
  const final = session.interview?.final
  const mode = readDesignMode(session.mode)
  const partnerScores = mode === 'human-partner' ? session.partner?.scores : undefined
  const [partnerAdopted, setPartnerAdopted] = useState(!!partnerScores)
  // What the host has done to the partner's values. A dive the partner scored and the host then changed, or a rubric typed by hand, ends the prefill's claim to the partner.
  const rubricPrefilled = useRef(mode === 'human-partner' && session.rubricBy === 'partner')
  const rubricTouched = useRef(mode === 'human-partner' && session.rubric !== null && session.rubricBy === 'self')
  const partnerDiveEdited = useRef(!!partnerScores && session.rubricBy === 'self' && partnerScores.deepDives.some((v, i) => v !== null && session.deepDives[i]?.by === 'self'))
  const divesRef = useRef(dives)
  divesRef.current = dives // the render's value; pickDive and the adoption below move it ahead of the render so neither loses the other's change
  const adoptedSheet = useRef<string | null>(null)

  /** A write that throws (quota, IndexedDB, read-only) is the same sentence with Retry as an unusable grade, and the form is never left grading. */
  const runGrade = useCallback(async () => {
    setGrading(true)
    setGradeError('')
    const messages = session.interview?.messages ?? []
    try {
      const r = await once(`grade:${session.id}`, async () => {
        await flush()
        const design = await freshDigest(d, session.id, DIGEST_MAX)
        const res = await gradeInterview(d, item, messages, design)
        if (res.ok) await saveFinal(d, session.id, res.value)
        return res
      })
      if (!r.ok) setGradeError(r.error)
    } catch (e) {
      setGradeError(thrownMessage(e, 'grade'))
    } finally {
      setGrading(false)
    }
  }, [d, flush, item, session.id, session.interview])

  useEffect(() => {
    if (autoGrade()) void runGrade()
    // once per mount; `once` makes the StrictMode double run a single call
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The model grade arrives through the live query: adopt its prefill once.
  const adopted = useRef(!!final)
  useEffect(() => {
    if (!final || adopted.current) return
    adopted.current = true
    setDives(session.deepDives)
    setLenses(session.lenses)
    setRubricBy(session.rubricBy)
    if (session.rubric !== null) setRubricText(String(session.rubric))
  }, [final, session])

  // The friend's sheet arrives through the live query (they may still be scoring). The query emits a new object on every write to the row,
  // including this effect's own, so it keys on the sheet's content and adopts each distinct sheet once, never what the host has already scored.
  const sheetKey = partnerScores ? JSON.stringify(partnerScores) : null
  useEffect(() => {
    if (!partnerScores || sheetKey === adoptedSheet.current) return
    adoptedSheet.current = sheetKey
    setPartnerAdopted(true)
    const cur = divesRef.current
    const p = prefillFromPartner(partnerScores, cur, cap)
    const hostScored = cur.map(x => x.by === 'self' && x.answered !== null)
    const nextDives = p.deepDives.map((x, i) => (hostScored[i] ? cur[i] : x))
    if (partnerScores.deepDives.some((v, i) => v !== null && hostScored[i])) partnerDiveEdited.current = true
    const setRubricNow = p.rubric !== null && !rubricTouched.current
    const dirty = JSON.stringify(nextDives) !== JSON.stringify(cur) || (setRubricNow && (session.rubric !== p.rubric || session.rubricBy !== 'partner'))
    if (!dirty) { if (setRubricNow) rubricPrefilled.current = true; return }
    divesRef.current = nextDives
    setDives(nextDives)
    if (setRubricNow) { rubricPrefilled.current = true; setRubricText(String(p.rubric)); setRubricBy('partner') }
    push(() => saveScore(d, session.id, { deepDives: nextDives, ...(setRubricNow ? { rubric: p.rubric, rubricBy: 'partner' as const } : {}) }))
  }, [sheetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickDive = (i: number, v: Score012) => {
    const cur = divesRef.current
    const edited = cur[i].by === 'partner'
    if (edited) partnerDiveEdited.current = true
    const next = cur.map((x, j) => (j === i ? { ...x, answered: v, by: 'self' as const } : x))
    divesRef.current = next
    setDives(next)
    if (edited && rubricPrefilled.current) setRubricBy('self')
    push(() => saveScore(d, session.id, { deepDives: next, ...(edited && rubricPrefilled.current ? { rubricBy: 'self' as const } : {}) }))
  }
  const pickLens = (l: Lens, v: Score012) => {
    const next = { ...lenses, [l]: v }
    setLenses(next)
    push(() => saveScore(d, session.id, { lenses: next }))
  }
  const setTrade = (i: number, k: keyof Tradeoff, v: string) => {
    const next = trades.map((t, j) => (j === i ? { ...t, [k]: v } : t))
    setTrades(next)
    push(() => saveScore(d, session.id, { tradeoffs: next }))
  }
  const addTrade = () => {
    const next = [...trades, { ...EMPTY_TRADEOFF }]
    setTrades(next)
    push(() => saveScore(d, session.id, { tradeoffs: next }))
  }
  const parsed = parseRubric(rubricText)
  const setRubric = (text: string) => {
    rubricTouched.current = true
    setRubricText(text)
    setRubricBy('self')
    const p = parseRubric(text)
    push(() => saveScore(d, session.id, { rubric: p.value, rubricBy: 'self' }))
  }
  const draft = { deepDives: dives, lenses, tradeoffs: trades, rubric: parsed.value }
  const ready = scoreReady(draft) && !parsed.invalid && !grading && !busy

  const complete = async () => {
    if (!ready) return
    setBusy(true)
    await flush()
    // DESIGN-67: the partner's only if the rubric was prefilled from a complete sheet and neither it nor a dive they scored was changed
    const by = mode === 'human-partner' ? (rubricPrefilled.current && !rubricTouched.current && !partnerDiveEdited.current ? 'partner' : 'self') : rubricBy ?? 'self'
    await safeWrite(() => saveScore(d, session.id, { ...draft, rubricBy: by }), onError)
    navigate(`/designs/session/${item.id}?session=${session.id}`, { replace: true })
    const r = await safeWrite(() => completeDesignSession(d, session.id, now()), onError)
    setBusy(false)
    if (!r) return
    if (!r.ok) {
      toast('Score every item before completing', 'danger')
      return
    }
    if (r.xpDelta > 0) {
      flash()
      powerUp()
      toast(`+${r.xpDelta} xp · Saved`)
    } else toast('Saved')
  }

  return (
    <form className="sr-panel ds-score" data-testid="session-score" aria-label="Score the session" noValidate onSubmit={e => e.preventDefault()}>
      <h2 className="sr-panel-title">Score the session</h2>
      {grading && <BlockLoader label="Grading the session" testId="session-score-loading" />}
      {gradeError && (
        <p className="ds-ai-error" data-testid="session-ai-error">
          {gradeError} <Button data-testid="ai-retry" onClick={() => void runGrade()}>Retry</Button>
        </p>
      )}
      {final && <GradeView final={final} labels={canvasLabels(session)} />}
      {partnerAdopted && (
        <p className="ds-prefilled" data-testid="session-score-prefilled">
          Prefilled from your partner{session.partner?.name ? `, ${session.partner.name}` : ''}. Change anything before you confirm; rows they left empty are yours to fill.
        </p>
      )}
      {mode === 'human-partner' && partnerNotesText(session.partner?.notes).trim() !== '' && (
        <PartnerNotes text={partnerNotesText(session.partner?.notes)} />
      )}
      <h3 className="ds-sub">Deep dives</h3>
      {dives.map((dv, i) => (
        <ScoreGroup key={i} name={dv.q} value={dv.answered} cap2={cap === i} describe testId={`session-dive-score-${i + 1}`} onPick={v => pickDive(i, v)} />
      ))}
      <h3 className="ds-sub">Lenses (optional)</h3>
      {LENSES.map(l => <ScoreGroup key={l} name={LENS_LABELS[l]} value={lenses[l]} onPick={v => pickLens(l, v)} />)}
      <h3 className="ds-sub">Trade-offs</h3>
      {trades.map((t, i) => (
        <div key={i} className="ds-trade" role="group" aria-label={`Trade-off ${i + 1}`} data-testid={`session-tradeoff-row-${i + 1}`}>
          <TextField label="Chose" value={t.chose} onChange={v => setTrade(i, 'chose', v)} />
          <TextField label="Over" value={t.over} onChange={v => setTrade(i, 'over', v)} />
          <TextField label="Because" value={t.because} onChange={v => setTrade(i, 'because', v)} />
        </div>
      ))}
      <Button onClick={addTrade}>Add trade-off</Button>
      <label className="ds-rubric">
        <span aria-hidden="true">Rubric (0–20)</span>
        <input
          type="number" inputMode="numeric" min={0} max={20} step={1} aria-label="Rubric (0–20)" data-testid="session-rubric"
          aria-invalid={parsed.invalid || undefined} aria-describedby={parsed.invalid ? 'session-rubric-error' : undefined}
          value={rubricText} onChange={e => setRubric(e.target.value)}
        />
      </label>
      {/* UAT cu-7 P3-12: a red outline alone does not say what is wrong */}
      {parsed.invalid && <p id="session-rubric-error" className="form-error" role="alert" data-testid="session-rubric-error">The rubric is a whole number from 0 to 20.</p>}
      <p className="ds-breakdown">{RUBRIC_BREAKDOWN}</p>
      <Button variant="accent" data-testid="session-complete" data-accent="primary" disabled={!ready} onClick={() => void complete()}>COMPLETE · SESSION</Button>
    </form>
  )
}

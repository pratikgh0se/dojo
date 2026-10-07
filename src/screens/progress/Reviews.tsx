import { useState } from 'react'
import type { ReviewStats } from '../../ai/types'
import { useDb } from '../../app/providers'
import { buildReview } from '../../data/reviewActions'
import { safeWrite } from '../../data/safeWrite'
import { isReadOnly, READ_ONLY_MESSAGE } from '../../data/writer'
import { useReviews, useSettings } from '../../data/hooks'
import type { ReviewRow } from '../../data/types'
import { now } from '../../lib/clock'
import { fmtClock, fmtDayMonYear } from '../../lib/fmtDate'
import { useNow } from '../../lib/useNow'
import { daysText, pctText } from '../../rules/review'
import { currentSprint } from '../../rules/sprint'
import { AiError, AiLoader, type AiFailure } from '../../ui/ai/AiStates'
import { Button, Panel, useToast } from '../../ui/primitives'
import { tipProps } from '../../ui/Tip'
import '../brief/brief.css'

function Numbers({ stats, ids }: { stats: ReviewStats; ids: boolean }) {
  const id = (k: string) => (ids ? { 'data-testid': k } : {})
  return (
    <dl className="rvw-stats">
      <div className="rvw-stat"><dt {...tipProps("The sprint's own plan items, a split card once (the Board's \"own\" count). Today's tasks count AI and interview items only.")}>Planned</dt><dd>{stats.planned}</dd></div>
      <div className="rvw-stat"><dt>Done</dt><dd {...id('rv-done')}>{stats.done}</dd></div>
      <div className="rvw-stat"><dt>Focus days</dt><dd {...id('rv-days')}>{daysText(stats.focusDays.length)}</dd></div>
      <div className="rvw-stat"><dt>Slipped</dt><dd {...id('rv-slipped')}>{stats.slipped.length}</dd></div>
      <div className="rvw-stat"><dt>Longest streak</dt><dd>{daysText(stats.longestStreak)}</dd></div>
      <div className="rvw-stat"><dt>Redo pass rate</dt><dd>{pctText(stats.redoPassRate)}</dd></div>
      <div className="rvw-stat"><dt>Check pass rate</dt><dd>{pctText(stats.checkPassRate)}</dd></div>
    </dl>
  )
}

function Detail({ r, latest, sameDay }: { r: ReviewRow; latest: boolean; sameDay: boolean }) {
  return (
    <article data-testid={latest ? 'review-latest' : 'review-earlier'}>
      {/* UAT cu-3p P3-10: two reviews of one sprint on one day (Build review pressed twice) would read alike: the time tells them apart */}
      <h3 className="brief-sub">Sprint {r.sprint} · {fmtDayMonYear(r.at)}{sameDay ? ` · ${fmtClock(r.at)}` : ''}</h3>
      <Numbers stats={r.stats} ids={latest} />
      {r.stats.gaps.length > 0 && <p className="brief-meta">Gaps: {r.stats.gaps.join(', ')}</p>}
      {r.stats.slipped.length > 0 && <p className="brief-meta">Slipped: {r.stats.slipped.map(s => `${s.title} (${s.rolled}×)`).join(', ')}</p>}
      {r.prose ? <p className="rvw-prose" data-testid={latest ? 'review-prose' : undefined}>{r.prose}</p> : <p className="brief-note">The numbers were built automatically when the sprint ended; the prose could not be written. Build review writes it again.</p>}
      {/* P1 #9 / ruling 8 S4: the list renders only when the review has items. */}
      {r.doBetter && r.doBetter.length > 0 && (
        <>
          <h4 className="rvw-better-title" id={`rvw-better-${r.id}`}>Do better next sprint</h4>
          <ol className="rvw-better" aria-labelledby={`rvw-better-${r.id}`} data-testid={latest ? 'review-better' : undefined}>
            {r.doBetter.map((item, i) => <li key={i}>{item}</li>)}
          </ol>
        </>
      )}
    </article>
  )
}

/** Progress → Reviews (briefs spec §4): "Build review" for a sprint. Numbers come from code; the AI writes the prose. */
export function Reviews() {
  const d = useDb()
  const toast = useToast()
  const reviews = useReviews()
  const settings = useSettings()
  const t = useNow(60_000)
  const [picked, setPicked] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AiFailure | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const cur = settings?.startDate ? currentSprint(t, settings.startDate) : 1
  const sprint = picked ?? cur
  const ended = cur - 1
  const missing = ended >= 1 && reviews && !reviews.some(r => r.sprint === ended) ? ended : undefined

  async function build() {
    if (busy) return
    if (isReadOnly()) return void toast(READ_ONLY_MESSAGE, 'danger')
    setBusy(true)
    setFailure(null)
    setMessage(null)
    try {
      const r = await safeWrite(() => buildReview(d, sprint, now()), m => toast(m, 'danger'))
      if (!r) return
      if (r.ok) return
      if (r.code === 'no_start') setMessage(r.error)
      else setFailure({ code: r.code, message: r.error })
    } finally {
      setBusy(false)
    }
  }

  // reviews of one sprint built on one day: their headings carry the time
  const day = (r: ReviewRow) => `${r.sprint}|${fmtDayMonYear(r.at)}`
  const alike = new Map<string, number>()
  for (const r of reviews ?? []) alike.set(day(r), (alike.get(day(r)) ?? 0) + 1)
  const sameDay = (r: ReviewRow) => (alike.get(day(r)) ?? 0) > 1

  return (
    <Panel title="Reviews" className="rvw" aria-label="Reviews" id="reviews">
      <div className="rvw-head">
        <label>
          Sprint
          <select value={sprint} onChange={e => setPicked(Number(e.target.value))}>
            {Array.from({ length: cur }, (_, i) => i + 1).map(n => <option key={n} value={n}>Sprint {n}</option>)}
          </select>
        </label>
        <Button variant="accent" disabled={busy} onClick={() => void build()}>{busy ? 'Building…' : 'Build review'}</Button>
      </div>
      {missing !== undefined && <p className="brief-note">Sprint {missing} has ended without a review.</p>}
      {busy && <AiLoader />}
      {failure && <AiError failure={failure} onRetry={() => void build()} />}
      {message && <p className="brief-err" role="alert">{message}</p>}
      {reviews && reviews.length === 0 && <p className="empty" data-testid="no-reviews">No reviews yet.</p>}
      {reviews && reviews.length > 0 && (
        <>
          <Detail r={reviews[0]} latest sameDay={sameDay(reviews[0])} />
          {reviews.length > 1 && (
            <ul className="rvw-list" aria-label="Earlier reviews">
              {reviews.slice(1).map(r => <li key={r.id}><Detail r={r} latest={false} sameDay={sameDay(r)} /></li>)}
            </ul>
          )}
        </>
      )}
    </Panel>
  )
}

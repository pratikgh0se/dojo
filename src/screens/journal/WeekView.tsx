import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useDb, usePlanV2 } from '../../app/providers'
import { useJournalRows, useRedos, useSessions, useSettings, useTickets } from '../../data/hooks'
import { labInfoCall } from '../../data/labClient'
import { safeWrite } from '../../data/safeWrite'
import type { WeeklyReviewRow } from '../../data/types'
import { saveWeeklyReview } from '../../data/weeklyActions'
import { useWeeklyReviews } from '../../data/weeklyHooks'
import { isReadOnly } from '../../data/writer'
import { now } from '../../lib/clock'
import { JOURNAL_LINE_MAX, JOURNAL_TEXT_MAX } from '../../rules/journal'
import { budgetsOf, weeklyTotal } from '../../rules/prefs'
import { ritualTicketId, WEEKLY_REVIEW_ID } from '../../rules/ritualPeriod'
import {
  nextWeekKey, prevWeekKey, weekRangeLabel, weekSummary, weeklyBlank, weeklyFormFromRow, weeklySaved, type WeeklyForm, type WeekSummary,
} from '../../rules/weekly'
import { useCompleteTicket } from '../../study/useCompleteTicket'
import { Loading } from '../../ui/Loading'
import { Button, useToast } from '../../ui/primitives'

type LabTitle = { title: string; closingTicket: string }

/**
 * The titles and closing tickets of the labs the learner's tickets belong to (`GET /labs/info`, writer only; a lab the server does
 * not know, or no server at all, is simply left out). TODO(W3): swap for `useLabInfos(labIds)` from `src/data/labHooks.ts` when r2-w3
 * merges; the shape is the same and nothing else here changes.
 */
function useLabTitles(labIds: readonly string[]): Record<string, LabTitle> {
  const [infos, setInfos] = useState<Record<string, LabTitle>>({})
  const key = [...new Set(labIds)].sort().join(',')
  useEffect(() => {
    let live = true
    const ids = key ? key.split(',') : []
    void Promise.all(ids.map(async id => [id, await labInfoCall(id)] as const)).then(rs => {
      if (!live) return
      setInfos(Object.fromEntries(rs.flatMap(([id, r]) => (r.ok ? [[id, { title: r.title, closingTicket: r.closingTicket }]] : []))))
    })
    return () => { live = false }
  }, [key])
  return infos
}

/** The week at a glance (computed from existing data) and the three prompts. Writes only on Save. */
export function WeekView({ week, current, onWeek }: { week: string; current: string; onWeek: (w: string) => void }) {
  const d = useDb()
  const tickets = useTickets(), sessions = useSessions(), redos = useRedos(), rows = useJournalRows()
  const reviews = useWeeklyReviews(), settings = useSettings()
  const labReviews = useLiveQuery(() => d.labReviews.toArray(), [d])
  const plan = usePlanV2()
  const infos = useLabTitles((tickets ?? []).flatMap(t => (t.lab ? [t.lab.id] : [])))
  if (!tickets || !sessions || !redos || !rows || !reviews || !labReviews || !settings) return <Loading />
  const labClosing = Object.fromEntries(Object.entries(infos).map(([id, i]) => [id, i.closingTicket]))
  const sum = weekSummary({ week, tickets, sessions, redos, journal: rows, labReviews, labClosing, budgetMin: weeklyTotal(budgetsOf(settings, plan?.mix)) })
  const labTitle = (id: string): string => infos[id]?.title ?? id
  return <WeekBody key={week} week={week} current={current} onWeek={onWeek} sum={sum} labTitle={labTitle} stored={reviews.find(r => r.week === week) ?? null} />
}

function WeekBody({ week, current, onWeek, sum, stored, labTitle }: {
  week: string; current: string; onWeek: (w: string) => void; sum: WeekSummary; stored: WeeklyReviewRow | null; labTitle: (id: string) => string
}) {
  const d = useDb()
  const toast = useToast()
  const complete = useCompleteTicket()
  const readOnly = isReadOnly()
  const [form, setForm] = useState<WeeklyForm>(() => weeklyFormFromRow(stored))
  const [saving, setSaving] = useState(false)
  const saved = weeklySaved(form, stored)
  const enabled = !saved && (stored !== null || !weeklyBlank(form)) && !readOnly && !saving
  const set = (patch: Partial<WeeklyForm>) => setForm(f => ({ ...f, ...patch }))
  const n = sum.ticketsDone.length

  async function save() {
    if (!enabled) return
    setSaving(true)
    try {
      const row = await safeWrite(() => saveWeeklyReview(d, form, week, now()), m => toast(m, 'danger'))
      if (!row || week !== current) return
      // the current week's review completes the week's ritual ticket, but only one that exists (the Open card was pressed); never mints one
      const t = await d.tickets.get(ritualTicketId(WEEKLY_REVIEW_ID, week))
      if (t && !t.archived && t.status !== 'done') await complete(t)
    } catch {
      toast('That review was not saved. Try again.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="wk" data-testid="journal-week" data-week={week} aria-labelledby="journal-week-heading">
      <div className="wk-head">
        <Button variant="quiet" data-testid="journal-week-prev" onClick={() => onWeek(prevWeekKey(week))}>Earlier week</Button>
        <h2 className="jr-day" id="journal-week-heading" data-testid="journal-week-heading"><span className="wk-nb">{week}</span> · {weekRangeLabel(week).split(' to ').map((x, i) => <span key={i}>{i > 0 && ' to '}<span className="wk-nb">{x}</span></span>)}</h2>
        <Button variant="quiet" data-testid="journal-week-next" disabled={week >= current} onClick={() => onWeek(nextWeekKey(week))}>Later week</Button>
      </div>
      <div className="jr-grid">
        <div className="jr-panel sr-panel">
          <h3 className="jr-h">The week</h3>
          <div data-testid="journal-week-tickets" data-count={n}>
            {n === 0
              ? <p className="jr-empty" data-testid="journal-week-tickets-empty" data-empty="true">No tickets finished this week.</p>
              : (
                <>
                  <span className="jr-cap">{n} {n === 1 ? 'ticket' : 'tickets'} done</span>
                  <ul className="wk-list">{sum.ticketsDone.map(t => <li key={t.id} data-testid={`journal-week-ticket-${t.id}`} data-content="plan">{t.title}</li>)}</ul>
                </>
              )}
          </div>
          <div data-testid="journal-week-labs">
            {sum.labs.length === 0
              ? <p className="jr-empty" data-testid="journal-week-labs-empty" data-empty="true">No labs this week.</p>
              : (
                <ul className="wk-list">
                  {sum.labs.map(l => <li key={l.labId} data-testid={`journal-week-lab-${l.labId}`} data-state={l.state}><span data-content="plan">{labTitle(l.labId)}</span>: {l.state === 'proven' ? 'Proven' : 'Done'}</li>)}
                </ul>
              )}
          </div>
          <p className="wk-line" data-testid="journal-week-minutes" data-minutes={sum.minutes} data-budget={sum.budgetMin}>{sum.timeLine}</p>
          <div data-testid="journal-week-hard">
            <span className="jr-cap">Came up hard</span>
            {sum.hardRedos.length === 0 && sum.hardLines.length === 0
              ? <p className="jr-empty" data-testid="journal-week-hard-empty" data-empty="true">Nothing came up hard this week.</p>
              : (
                <ul className="wk-list">
                  {sum.hardRedos.map(h => <li key={h.redoId} data-testid={`journal-week-hard-redo-${h.redoId}`} data-content="plan">{h.title}</li>)}
                  {sum.hardLines.map(h => <li key={h.day} data-testid={`journal-week-hard-line-${h.day}`} data-content="learner">{h.text}</li>)}
                </ul>
              )}
          </div>
        </div>
        <div className="jr-panel sr-panel">
          <h3 className="jr-h">Review</h3>
          <label className="jr-field">
            <span>What worked</span>
            <textarea data-testid="journal-week-worked" data-content="learner" maxLength={JOURNAL_TEXT_MAX} rows={3} value={form.worked} disabled={readOnly} onChange={e => set({ worked: e.target.value.slice(0, JOURNAL_TEXT_MAX) })} />
          </label>
          <label className="jr-field">
            <span>What I would change</span>
            <textarea data-testid="journal-week-change" data-content="learner" maxLength={JOURNAL_TEXT_MAX} rows={3} value={form.change} disabled={readOnly} onChange={e => set({ change: e.target.value.slice(0, JOURNAL_TEXT_MAX) })} />
          </label>
          <label className="jr-field">
            <span>Focus for next week</span>
            <input type="text" data-testid="journal-week-focus" data-content="learner" autoComplete="off" maxLength={JOURNAL_LINE_MAX} value={form.focus} disabled={readOnly} onChange={e => set({ focus: e.target.value.slice(0, JOURNAL_LINE_MAX) })} />
          </label>
          <div className="jr-save">
            {saved && <span className="jr-saved" data-testid="journal-week-saved" role="status">Saved</span>}
            <Button variant="accent" data-accent="primary" data-testid="journal-week-save" disabled={!enabled} onClick={() => void save()}>SAVE · REVIEW</Button>
          </div>
        </div>
      </div>
    </section>
  )
}

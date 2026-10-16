import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useJournalRows, useRedos, useTickets } from '../data/hooks'
import { localDayKey } from '../lib/dates'
import { useNow } from '../lib/useNow'
import { resolveDay } from '../rules/journal'
import { isoWeekOf } from '../rules/ritual'
import { resolveWeek } from '../rules/weekly'
import { Loading } from '../ui/Loading'
import { Entry } from './journal/Entry'
import { HardList } from './journal/HardList'
import { Strip } from './journal/Strip'
import { WeekView } from './journal/WeekView'
import './journal.css'

/**
 * The daily journal (docs/contracts/journal.md): a two-minute end-of-day entry prefilled from the tickets finished that day,
 * a zero-work "No study today" path, a seven-day strip and "Came up hard this week". No XP and no streak. Nothing is written
 * until Save (or Add to Review) is pressed; loading, choosing a day and typing write nothing.
 */
export function Journal() {
  const tickets = useTickets()
  const rows = useJournalRows()
  const redos = useRedos()
  const nowMs = useNow(60_000)
  const [params, setParams] = useSearchParams()
  const today = localDayKey(nowMs)
  const day = resolveDay(params.get('day'), today)
  // the clock day is the default, so it keeps the bare /journal address; an earlier day is ?day=YYYY-MM-DD
  const pick = useCallback((next: string) => {
    setParams(next === today ? {} : { day: next }, { replace: true })
  }, [setParams, today])
  if (!tickets || !rows || !redos) return <Loading />
  // W5 (rituals.md RIT-22): the Day entry is the default; ?view=week is the Week view of an ISO week (?week=YYYY-Www, never a future one)
  const currentWeek = isoWeekOf(nowMs).key
  const weekView = params.get('view') === 'week'
  const week = resolveWeek(params.get('week'), currentWeek)
  const pickWeek = (w: string) => setParams(w === currentWeek ? { view: 'week' } : { view: 'week', week: w }, { replace: true })
  const views = (
    <div className="jr-views" role="group" aria-label="Journal view" data-testid="journal-views">
      <Link className="sr-btn sr-btn-quiet" data-testid="journal-view-day" to="/journal" aria-current={weekView ? undefined : 'page'}>Day</Link>
      <Link className="sr-btn sr-btn-quiet" data-testid="journal-view-week" to="/journal?view=week" aria-current={weekView ? 'page' : undefined}>Week</Link>
    </div>
  )
  if (weekView) return <div className="jr">{views}<WeekView week={week} current={currentWeek} onWeek={pickWeek} /></div>
  return (
    <div className="jr">
      {views}
      <Strip rows={rows} today={today} day={day} onPick={pick} />
      <div className="jr-grid">
        <Entry key={day} day={day} today={today} tickets={tickets} stored={rows.find(r => r.day === day) ?? null} onPick={pick} />
        <HardList rows={rows} tickets={tickets} redos={redos} today={today} />
      </div>
    </div>
  )
}

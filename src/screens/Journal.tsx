import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useJournalRows, useRedos, useTickets } from '../data/hooks'
import { localDayKey } from '../lib/dates'
import { useNow } from '../lib/useNow'
import { resolveDay } from '../rules/journal'
import { Loading } from '../ui/Loading'
import { Entry } from './journal/Entry'
import { HardList } from './journal/HardList'
import { Strip } from './journal/Strip'
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
  return (
    <div className="jr">
      <Strip rows={rows} today={today} day={day} onPick={pick} />
      <div className="jr-grid">
        <Entry key={day} day={day} today={today} tickets={tickets} stored={rows.find(r => r.day === day) ?? null} onPick={pick} />
        <HardList rows={rows} tickets={tickets} redos={redos} today={today} />
      </div>
    </div>
  )
}

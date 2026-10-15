import type { JournalRow } from '../../data/types'
import { shortWeekday, stripOf, type StripState } from '../../rules/journal'

const WORD: Record<StripState, string> = { written: 'written', none: 'no study', blank: '' }
const SPOKEN: Record<StripState, string> = { written: 'written', none: 'no study', blank: 'no entry' }

/**
 * JOURNAL-15: the last seven days ending on the clock day, oldest first. A cell's text is its short weekday, a line break, then
 * "written", "no study" or nothing; its accessible name is "<weekday> <day> <state word>". The strip counts nothing and keeps
 * no run, so a quiet day is only an empty cell. A cell opens that day's entry.
 */
export function Strip({ rows, today, day, onPick }: { rows: readonly JournalRow[]; today: string; day: string; onPick: (day: string) => void }) {
  return (
    <div className="jr-strip" role="group" aria-label="Last seven days" data-testid="journal-strip">
      {stripOf(rows, today).map(c => (
        <button
          key={c.day} type="button" className="jr-cell" data-testid={`journal-strip-day-${c.day}`} data-state={c.state}
          aria-current={c.day === day ? 'true' : undefined} aria-label={`${shortWeekday(c.day)} ${c.day} ${SPOKEN[c.state]}`}
          onClick={() => onPick(c.day)}
        >
          <span className="jr-cell-day">{shortWeekday(c.day)}</span>
          {c.state !== 'blank' && <>{'\n'}<span className="jr-cell-word">{WORD[c.state]}</span></>}
        </button>
      ))}
    </div>
  )
}

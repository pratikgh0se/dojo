import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { setNow } from '../../src/lib/clock'
import { Week } from '../../src/screens/Week'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// smallPlan rotation; start Mon 2026-09-07; Tue 2026-09-08 is S1 day 2.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const TUE = ist('2026-09-08T21:00:00')

async function setup(at = TUE) {
  setNow(() => at)
  const d = await seededDb()
  renderWithApp(<Week />, { db: d, plan: smallPlan, route: '/week', path: '/week' })
  await screen.findByTestId('day-Mon')
  return d
}

describe('Week screen', () => {
  it('highlights today and rests on Friday', async () => {
    await setup()
    expect(screen.getByTestId('day-Tue')).toHaveAttribute('aria-current', 'date')
    expect(screen.getByTestId('day-Mon')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('day-Fri')).toHaveClass('rest')
    expect(screen.getByTestId('day-Fri')).toHaveTextContent('Off')
  })

  it('lists each day’s picks from the rotation, linking to Do', async () => {
    await setup()
    expect(within(screen.getByTestId('day-Mon')).getByRole('link', { name: 'Rung 1, the API call' })).toHaveAttribute('href', '/do/m1w1t1')
    expect(within(screen.getByTestId('day-Tue')).getAllByRole('link').map(a => a.textContent)).toEqual(['200 · Number of Islands', '127 · Word Ladder'])
  })

  it('ruling 22 D2: a card the plan lists again later in the week carries "↻ again", titled as the second pass', async () => {
    await setup()
    const chips = document.querySelectorAll('[data-testid^="again-"]')
    expect(chips.length).toBeGreaterThan(0)
    for (const c of chips) {
      expect(c).toHaveTextContent('↻ again')
      expect(c).not.toHaveAttribute('title') // one tooltip only: the bubble (cu-final)
      expect(c).toHaveAttribute('data-tip', 'Second pass: re-solve it from memory') // shown on hover by ui/Tip (cu-3 P3-4)
      expect(c.closest('[data-testid^="day-"]')).not.toBe(screen.getByTestId('day-Mon'))
    }
    // the first listing of each card has no chip
    expect(within(screen.getByTestId('day-Tue')).queryByText('↻ again')).toBeNull()
  })

  it('counts done and logged focus minutes per day, labelled "min focus" (live; ruling 24 S3)', async () => {
    const d = await setup()
    expect(screen.getByTestId('day-meta-Tue')).toHaveTextContent('0 done · 0 min focus')
    await moveTicket(d, 'p1', 'done', TUE)
    // a session's wall-clock length is not focus: only the finished focus blocks are
    await d.sessions.add({ id: 's1', ticketId: 'p1', start: TUE - 3_600_000, end: TUE - 2_100_000, minutes: 25, outcome: 'solved', xpDelta: 5 })
    await d.events.add({ t: 'focus', id: 'p1', at: TUE - 2_100_000, minutes: 6 })
    await waitFor(() => expect(screen.getByTestId('day-meta-Tue')).toHaveTextContent('1 done · 6 min focus'))
  })

  it('shows the 14-day sprint calendar and the minutes-per-week chart', async () => {
    await setup()
    expect(document.querySelectorAll('[data-testid^="cal-"]')).toHaveLength(14)
    expect(screen.getByTestId('cal-2026-09-08')).toHaveClass('is-today')
    // UAT cu-6 P3-13: each cell carries its day of the month
    expect(screen.getByTestId('cal-2026-09-08')).toHaveTextContent('Tu8')
    expect(screen.getByTestId('cal-2026-09-14')).toHaveTextContent('Mo14')
    const chart = screen.getByRole('img', { name: 'Minutes per week, last 8 weeks' })
    expect(chart).toBeInTheDocument()
    // Full-width, responsive chart: no fixed/maxWidth inline style pinning it to a
    // fraction of the panel (Controller fix round 1).
    expect(chart).not.toHaveAttribute('style')
    const labels = chart.querySelectorAll('text.chart-label')
    expect(labels.length).toBe(8)
    for (const l of labels) expect(l.textContent).toMatch(/^\d{2}·\d{2}$/)
  })

  it('before the start date shows rotation only (Review Focus #5)', async () => {
    await setup(ist('2026-09-01T10:00:00'))
    expect(screen.getByTestId('day-Mon')).toHaveTextContent('AI · watch')
    expect(screen.queryByTestId('day-meta-Mon')).toBeNull()
    expect(document.querySelectorAll('[data-testid^="cal-"]')).toHaveLength(0)
  })
})

// The ux (Part 2) x briefs (Part 3) integration points.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Brief, DojoEvent, Ticket } from '../../src/data/types'
import { startStudy } from '../../src/rules/studySession'
import { Brief as SessionBrief } from '../../src/screens/do/study/SessionPanel'
import { WorkloadPanel } from '../../src/screens/today/WorkloadPanel'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-10-06T10:00:00') // a Tuesday: a focus day, 120 minutes

const brief = (goal: string): Brief => ({
  goal, steps: [{ text: 'Watch it' }], minutes: 60, dayType: 'focus', learn: ['x'], outcome: 'y',
  deliverable: { kind: 'answers', prompt: 'Answer' }, questions: [], status: 'draft', source: 'ai',
})

describe('session-brief carries the card brief goal (ux Addendum 1 Q5, UX-06b)', () => {
  const study = startStudy({ id: 's1', ticketId: 't1', goal: 'finish ep 1', cardIds: ['t1'], focusMin: 25, breakMin: 5, chime: false, now: NOW })
  it('shows the title, the session plan and the brief goal when a brief exists', () => {
    render(<SessionBrief study={study} cards={[mkTicket({ id: 't1', title: 'Essence of Calculus', brief: brief('See why a derivative is a ratio') })]} />)
    const box = screen.getByTestId('session-brief')
    expect(within(box).getByText('Essence of Calculus')).toBeTruthy()
    expect(box.textContent).toContain('This session I will: finish ep 1')
    expect(box.textContent).toContain('See why a derivative is a ratio')
    expect(within(box).getByTestId('session-brief-goal').tagName).toBe('P')
  })
  it('in focus mode the card description is left out when the brief has a goal, and kept when it has none (cu-2 P3-17)', () => {
    const withGoal = mkTicket({ id: 't1', title: 'Essence of Calculus', text: 'A long card description', brief: brief('See why a derivative is a ratio') })
    const r = render(<SessionBrief study={study} cards={[withGoal]} focus />)
    expect(screen.getByTestId('session-brief').textContent).toContain('See why a derivative is a ratio')
    expect(screen.getByTestId('session-brief').textContent).not.toContain('A long card description')
    r.unmount()
    render(<SessionBrief study={study} cards={[mkTicket({ id: 't1', title: 'Plain card', text: 'Old text' })]} focus />)
    expect(screen.getByTestId('session-brief').textContent).toContain('Old text')
    r.unmount()
  })
  it('outside focus mode the card description stays beside the goal', () => {
    render(<SessionBrief study={study} cards={[mkTicket({ id: 't1', title: 'Essence of Calculus', text: 'A long card description', brief: brief('See why') })]} />)
    expect(screen.getByTestId('session-brief').textContent).toContain('A long card description')
  })
  it('has no goal line without a brief', () => {
    render(<SessionBrief study={study} cards={[mkTicket({ id: 't1', title: 'Plain card', text: 'Old text' })]} />)
    expect(screen.queryByTestId('session-brief-goal')).toBeNull()
    expect(screen.getByTestId('session-brief').textContent).toContain('Old text')
  })
})

describe("Today's suggestions use real focus minutes for the time left (briefs spec §3 with Part 2)", () => {
  const cards: Ticket[] = [1, 2, 3].map(i => mkTicket({ id: `c${i}`, title: `Card ${i}`, order: i, estMin: 50 }))
  const focus = (minutes: number): DojoEvent => ({ t: 'focus', id: 'c1', at: NOW - 60_000, minutes })
  const shown = (events: DojoEvent[]) => {
    const r = render(
      <MemoryRouter>
        <WorkloadPanel tickets={cards} sprint={1} budget={1440} planned={150} nowMs={NOW} events={events} />
      </MemoryRouter>,
    )
    const ids = within(screen.getByTestId('suggested')).queryAllByRole('link').map(a => a.getAttribute('data-testid'))
    r.unmount()
    return ids
  }
  it('no focus yet: 120 minutes left fits two 50-minute cards', () => {
    expect(shown([])).toEqual(['do-c1', 'do-c2'])
  })
  it('60 minutes of focus today leaves room for one card', () => {
    expect(shown([focus(60)])).toEqual(['do-c1'])
  })
  it("a full day's focus leaves nothing to suggest", () => {
    expect(shown([focus(120)])).toEqual([])
  })
  it('yesterday\'s focus does not count', () => {
    expect(shown([{ t: 'focus', id: 'c1', at: NOW - 86_400_000, minutes: 120 }])).toEqual(['do-c1', 'do-c2'])
  })
})

describe('Workload "time used today": finished cards without focus today, plus focus minutes (G4 M2/M3)', () => {
  // cards of 30 minutes on a 120-minute focus day: the number suggested shows the time left
  const open = [1, 2, 3, 4].map(i => mkTicket({ id: `o${i}`, title: `Open ${i}`, order: i, estMin: 30 }))
  const done = (id: string, estMin: number) => mkTicket({ id, title: id, order: 0, estMin, status: 'done', doneAt: NOW - 3_600_000 })
  const focus = (id: string, minutes: number): DojoEvent => ({ t: 'focus', id, at: NOW - 60_000, minutes })
  const shown = (tickets: Ticket[], events: DojoEvent[]) => {
    const r = render(
      <MemoryRouter>
        <WorkloadPanel tickets={tickets} sprint={1} budget={1440} planned={120} nowMs={NOW} events={events} />
      </MemoryRouter>,
    )
    const n = within(screen.getByTestId('suggested')).queryAllByRole('link').length
    r.unmount()
    return n
  }
  it('a 60-minute card done without a session plus 25 focus minutes on another card: 85 used, one card fits', () => {
    expect(shown([done('d1', 60), ...open], [focus('o1', 25)])).toBe(1)
  })
  it('a 60-minute card done with 25 focus minutes on it counts once (25 used): three cards fit', () => {
    expect(shown([done('d1', 60), ...open], [focus('d1', 25)])).toBe(3)
  })
  it('mixed: a focused done card counts its focus, an unfocused one its minutes (25 + 30 = 55 used): two cards fit', () => {
    expect(shown([done('d1', 60), done('d2', 30), ...open], [focus('d1', 25)])).toBe(2)
  })
})

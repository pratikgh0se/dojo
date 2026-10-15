// The ux (Part 2) x briefs (Part 3) integration points.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Brief } from '../../src/data/types'
import { startStudy } from '../../src/rules/studySession'
import { Brief as SessionBrief } from '../../src/screens/do/study/SessionPanel'
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

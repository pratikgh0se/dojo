import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { saveStudy } from '../../src/lib/studyStore'
import { startStudy } from '../../src/rules/studySession'
import { loadCheck } from '../../src/rules/load'
import { SlideAsk } from '../../src/screens/today/SlideAsk'
import { freshDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const T = new Date('2026-10-20T21:10:00+05:30').getTime()
const tickets: Ticket[] = [
  ...[1, 2, 3, 4].map(i => mkTicket({ id: `a${i}`, title: `Old ${i}`, sprint: 1, plannedSprint: 1, order: i })),
  ...[5, 6, 7, 8].map(i => mkTicket({ id: `b${i}`, title: `Now ${i}`, sprint: 2, plannedSprint: 2, order: i })),
]
async function show(ts: Ticket[] = tickets) {
  setNow(() => T)
  const d = freshDb()
  await d.tickets.bulkPut(ts)
  const load = loadCheck(ts, 2, 2)
  renderWithApp(<SlideAsk tickets={ts} sprint={2} load={load} />, { db: d, plan: smallPlan })
  return { d, load }
}

describe('Ask what to slide', () => {
  it('H-39 is hidden when the sprint fits', async () => {
    await show(tickets.slice(4))
    expect(screen.queryByTestId('ai-slide-ask')).toBeNull()
  })

  it('H-40 lists due − cap suggestions, each a due ticket with a fake reason', async () => {
    const { load } = await show()
    expect(load.verdict).toBe('Heavy')
    fireEvent.click(screen.getByRole('button', { name: 'Ask what to slide' }))
    const panel = await screen.findByRole('region', { name: 'Suggested slides' })
    const rows = within(panel).getAllByRole('listitem')
    expect(rows).toHaveLength(load.due - load.cap)
    for (const row of rows) {
      const id = row.getAttribute('data-testid')!.replace('ai-slide-row-', '')
      expect(tickets.some(t => t.id === id)).toBe(true)
      expect(screen.getByTestId(`ai-slide-reason-${id}`).textContent).toMatch(new RegExp(`^\\[fake:suggest_slide\\].*${id}`))
    }
  })

  it('never proposes the card being studied right now (cu-2 P3-5)', async () => {
    // a session is running on the oldest due card, the one the fake advice would list first
    saveStudy(startStudy({ id: 'st1', ticketId: 'a1', goal: '', cardIds: ['a1'], focusMin: 25, breakMin: 5, chime: false, now: T }))
    const { load } = await show()
    fireEvent.click(screen.getByTestId('ai-slide-ask'))
    await screen.findByTestId('ai-slide-panel')
    const ids = screen.getAllByTestId(/^ai-slide-row-/).map(r => r.getAttribute('data-testid')!.replace('ai-slide-row-', ''))
    expect(ids).toHaveLength(load.due - load.cap)
    expect(ids).not.toContain('a1')
  })

  it('H-41 Slide these moves every listed ticket to the next sprint and closes the panel', async () => {
    const { d, load } = await show()
    fireEvent.click(screen.getByTestId('ai-slide-ask'))
    await screen.findByTestId('ai-slide-panel')
    const ids = screen.getAllByTestId(/^ai-slide-row-/).map(r => r.getAttribute('data-testid')!.replace('ai-slide-row-', ''))
    expect(ids).toHaveLength(load.due - load.cap)
    fireEvent.click(screen.getByRole('button', { name: 'Slide these' }))
    await waitFor(() => expect(screen.queryByTestId('ai-slide-panel')).toBeNull())
    for (const id of ids) expect((await d.tickets.get(id))!).toMatchObject({ sprint: 3 })
  })

  it('H-42 Cancel closes the panel and changes nothing', async () => {
    const { d } = await show()
    fireEvent.click(screen.getByTestId('ai-slide-ask'))
    await screen.findByTestId('ai-slide-panel')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('ai-slide-panel')).toBeNull()
    expect((await d.tickets.toArray()).every(t => t.sprint <= 2)).toBe(true)
  })

  it('the panel takes focus on open and gives it back to the trigger on Cancel or Confirm', async () => {
    await show()
    fireEvent.click(screen.getByTestId('ai-slide-ask'))
    expect(await screen.findByTestId('ai-slide-panel')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('ai-slide-ask')).toHaveFocus()

    fireEvent.click(screen.getByTestId('ai-slide-ask'))
    await screen.findByTestId('ai-slide-panel')
    fireEvent.click(screen.getByRole('button', { name: 'Slide these' }))
    await waitFor(() => expect(screen.queryByTestId('ai-slide-panel')).toBeNull())
    expect(screen.getByTestId('ai-slide-ask')).toHaveFocus()
  })

  it('H-43 an error shows the busy message with Retry, and Retry recovers', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'suggest_slide:busy')
    await show()
    fireEvent.click(screen.getByTestId('ai-slide-ask'))
    expect(await screen.findByTestId('ai-error')).toHaveTextContent('The AI helper is busy. Try again in a moment.')
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(screen.getByTestId('ai-retry'))
    expect(await screen.findByTestId('ai-slide-panel')).toBeInTheDocument()
  })
})

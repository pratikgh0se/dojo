import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { setNow } from '../../src/lib/clock'
import { Designs } from '../../src/screens/Designs'
import { seededDb } from '../helpers/db'
import { flatPlanProse } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// flatPlanProse: one tier "Foundations" with the design d-method first; the screen has no schedule, so the date does not matter.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const S1 = ist('2026-09-08T10:00:00')
const S2 = ist('2026-09-21T10:00:00')
const S5 = ist('2026-11-02T10:00:00')

async function setup(at: number, route = '/designs', plan = flatPlanProse) {
  setNow(() => at)
  const d = await seededDb(plan)
  renderWithApp(<Designs />, { db: d, plan, route, path: '/designs' })
  await screen.findByTestId('next-design')
  return d
}

describe('Designs screen', () => {
  it('with nothing done the callout names the first design, and no schedule wording shows', async () => {
    await setup(S1)
    expect(screen.getByTestId('next-design-title')).toHaveTextContent('The method, on a whiteboard, in 45 minutes')
    expect(screen.getByTestId('designs-done')).toHaveTextContent('0/2')
    expect(screen.getByTestId('designs-dives')).toHaveTextContent('0')
    expect(document.body.textContent ?? '').not.toMatch(/\bS\d+\b|Sunday|Sundays/)
  })

  it('shows the next design and opens its tier', async () => {
    await setup(S2)
    expect(screen.getByTestId('next-design-title')).toHaveTextContent('The method, on a whiteboard, in 45 minutes')
    fireEvent.click(screen.getByTestId('open-next-tier'))
    const detail = await screen.findByTestId('tier-detail')
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?tier=1')
    expect(within(detail).getByTestId('row-d-method')).toBeInTheDocument()
    const dives = screen.getByTestId('dives-d-method')
    expect(dives).not.toHaveAttribute('open')
    expect(within(dives).getByText('Requirements')).toBeInTheDocument()
    expect(within(dives).getByRole('link', { name: 'Hello Interview free guides' })).toHaveAttribute('href', 'https://example.com/hello')
  })

  it('a plain /designs shows the tier detail and its rows for the next design\'s tier, keeping the hint (GLOBAL-10)', async () => {
    await setup(S2)
    const detail = screen.getByTestId('tier-detail')
    expect(within(detail).getByTestId('row-d-method')).toBeInTheDocument()
    for (const h of ['do-d-method', 'design-start-d-method', 'dives-d-method']) expect(within(detail).getByTestId(h)).toBeInTheDocument()
    expect(screen.getByTestId('designs-hint')).toBeInTheDocument()
    expect(screen.getByTestId('tier-1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '')
  })

  it('selecting a ladder column opens that tier; the URL restores it', async () => {
    await setup(S2, '/designs?tier=1')
    expect(screen.getByTestId('tier-detail')).toBeInTheDocument()
    expect(screen.getByTestId('tier-1')).toHaveAttribute('aria-pressed', 'true')
  })

  it('ticking a design pays XP, counts deep dives (done × 4), moves the callout', async () => {
    const d = await setup(S2, '/designs?tier=1')
    fireEvent.click(screen.getByTestId('tick-d-method'))
    expect(await screen.findByText('+20 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('designs-done')).toHaveTextContent('1/2'))
    expect(screen.getByTestId('designs-dives')).toHaveTextContent('4')
    expect(screen.getByTestId('next-design-title')).toHaveTextContent('Back-of-envelope sheet')
    expect((await d.events.toArray()).map(e => [e.t, 'id' in e ? e.id : undefined])).toEqual([['tick', 'd-method']])
  })

  it('reflects a tick made elsewhere (Review Focus #2)', async () => {
    const d = await setup(S2, '/designs?tier=1')
    await moveTicket(d, 'd-estimate', 'done', S2)
    await waitFor(() => expect(screen.getByTestId('tick-d-estimate')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByTestId('designs-done')).toHaveTextContent('1/2')
  })

  it('after the window with everything done: "All 2 done"', async () => {
    const d = await setup(S5)
    await moveTicket(d, 'd-method', 'done', S5)
    await moveTicket(d, 'd-estimate', 'done', S5)
    await waitFor(() => expect(screen.getByTestId('next-design-text')).toHaveTextContent('All 2 done'))
  })

  it('shows the 20-point rubric and what done means', async () => {
    await setup(S2)
    const rubric = screen.getByTestId('rubric')
    expect(within(rubric).getByRole('heading', { name: 'Rubric · 20 points' })).toBeInTheDocument()
    expect(within(rubric).getAllByRole('row')).toHaveLength(5)
    expect(rubric).toHaveTextContent('self-graded against the rubric')
  })

  it('empty state when the plan has no design bank', async () => {
    const plan = { ...flatPlanProse, design_bank: [] }
    setNow(() => S2)
    const d = await seededDb(plan)
    renderWithApp(<Designs />, { db: d, plan, route: '/designs', path: '/designs' })
    expect(await screen.findByTestId('designs-empty')).toHaveTextContent('No design bank in this plan')
  })

  it('names the tier columns by the plan tier and the ladder region (C-DESIGN §10)', async () => {
    await setup(S2)
    const ladder = screen.getByRole('region', { name: 'Tier ladder' })
    expect(within(ladder).getByRole('heading', { name: 'Tier ladder · 0 of 2 designs' })).toBeInTheDocument()
    expect(within(ladder).getByRole('button', { name: 'Foundations (sprints 2 to 3)' })).toBe(screen.getByTestId('tier-1'))
  })

  it('offers one Start session button per design row (D-2)', async () => {
    await setup(S2, '/designs?tier=1')
    const detail = screen.getByTestId('tier-detail')
    const starts = within(detail).getAllByRole('button', { name: /^Start session: / })
    expect(starts.map(b => b.getAttribute('aria-label'))).toEqual([
      'Start session: The method, on a whiteboard, in 45 minutes', 'Start session: Back-of-envelope sheet',
    ])
    fireEvent.click(starts[0])
    expect(screen.getByTestId('location')).toHaveTextContent('/designs/session/d-method')
  })

  it('shows the chart row: designs per tier, designs done, difficulty', async () => {
    await setup(S2)
    expect(screen.getByRole('img', { name: /^Designs per tier: Foundations 0 of 2 done$/ })).toBeInTheDocument()
    expect(screen.getByTestId('designs-sundays')).toHaveTextContent('0 deep dives answered')
    expect(screen.getByRole('heading', { name: 'Designs done' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Difficulty: / })).toBeInTheDocument()
  })

  it('UAT J2: the difficulty chart has a one-word title and a key for its two bars', async () => {
    await setup(S2)
    expect(screen.getByRole('heading', { name: 'Difficulty' })).toBeInTheDocument()
    expect(screen.getByTestId('designs-difficulty-key')).toHaveTextContent('donetotal')
  })
})

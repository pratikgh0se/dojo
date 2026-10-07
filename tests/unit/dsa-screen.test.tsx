import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import type { PlanJson } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { Dsa } from '../../src/screens/Dsa'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00')

async function setup(route = '/dsa', plan: PlanJson = smallPlan) {
  setNow(() => NOW)
  const d = await seededDb(plan)
  renderWithApp(<Dsa />, { db: d, plan, route, path: '/dsa' })
  await screen.findByTestId('dsa-solved')
  return d
}

const pressed = (id: string) => screen.getByTestId(`cell-${id}`).getAttribute('aria-pressed')

describe('DSA screen', () => {
  it('shows totals and one heatmap row per topic, cells in file order', async () => {
    await setup()
    expect(screen.getByTestId('dsa-solved')).toHaveTextContent('0/3')
    expect(screen.getByTestId('dsa-hard')).toHaveTextContent('0')
    expect(screen.getByTestId('dsa-premium')).toHaveTextContent('0')
    const cells = [...screen.getByTestId('heat-row-1').querySelectorAll('.heat-cell')].map(c => c.getAttribute('data-testid'))
    expect(cells).toEqual(['cell-p200', 'cell-p127', 'cell-p1'])
    expect(screen.getByTestId('dsa-hint')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Solved vs total by difficulty' })).toBeInTheDocument()
  })

  it('opens topic detail from the row label and records it in the query string', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('topic-1'))
    const detail = await screen.findByTestId('topic-detail')
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?topic=1')
    expect(detail).toHaveTextContent('Graphs; Island (Matrix Traversal)')
    expect(detail).toHaveTextContent('Templates first.')
    expect(within(detail).getByRole('link', { name: 'William Fiset graph theory ↗' })).toHaveAttribute(
      'href', 'https://www.youtube.com/playlist?list=PLDV1Zeh2NRsDGO4--qE8yH72HFL1Km93P',
    )
    const row = screen.getByTestId('row-p200')
    expect(within(row).getByRole('link', { name: 'NeetCode ↗' })).toHaveAttribute('href', 'https://neetcode.io/solutions/number-of-islands')
    expect(within(row).getByRole('link', { name: 'LeetCode ↗' })).toHaveAttribute('href', 'https://leetcode.com/problems/number-of-islands/')
    expect(screen.getByTestId('do-p200')).toHaveAttribute('href', '/do/p200')
  })

  it('restores the selected topic from the URL', async () => {
    await setup('/dsa?topic=1')
    expect(screen.getByTestId('topic-detail')).toBeInTheDocument()
  })

  it('also accepts the S<n> topic form (Controller addendum 2)', async () => {
    await setup('/dsa?topic=S1')
    expect(screen.getByTestId('topic-detail')).toBeInTheDocument()
    expect(screen.getByTestId('topic-detail')).toHaveTextContent('S1 · Graphs: BFS and DFS')
  })

  it('ticks from a heatmap cell with the Board’s toast and event', async () => {
    const d = await setup()
    fireEvent.click(screen.getByTestId('cell-p200'))
    expect(await screen.findByText('+10 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(pressed('p200')).toBe('true'))
    expect(screen.getByTestId('dsa-solved')).toHaveTextContent('1/3')
    expect((await d.events.toArray()).map(e => e.t)).toEqual(['tick'])
  })

  it('reflects a tick made elsewhere in cells, rows and totals (Review Focus #2)', async () => {
    const d = await setup('/dsa?topic=1')
    await moveTicket(d, 'p127', 'done', NOW)
    await waitFor(() => expect(pressed('p127')).toBe('true'))
    expect(screen.getByTestId('tick-p127')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('dsa-hard')).toHaveTextContent('1')
  })

  it('excludes archived tickets: disabled cell, read-only row, not counted (Review Focus #5)', async () => {
    const d = await setup('/dsa?topic=1')
    await d.tickets.update('p1', { archived: true, status: 'done' })
    await waitFor(() => expect(screen.getByTestId('cell-p1')).toBeDisabled())
    expect(pressed('p1')).toBe('false')
    expect(screen.getByTestId('dsa-solved')).toHaveTextContent('0/3')
    expect(screen.getAllByTestId('row-readonly')).toHaveLength(1)
  })

  it('hides the NeetCode link for an unparseable URL', async () => {
    const plan = JSON.parse(JSON.stringify(smallPlan)) as PlanJson
    plan.dsa_bank[0].problems[0].url = 'https://example.com/x'
    await setup('/dsa?topic=1', plan)
    expect(within(screen.getByTestId('row-p200')).queryByRole('link', { name: 'NeetCode ↗' })).toBeNull()
  })

  it('shows an empty state when the plan has no DSA bank', async () => {
    const plan = { ...smallPlan, dsa_bank: [] }
    setNow(() => NOW)
    const d = await seededDb(plan)
    renderWithApp(<Dsa />, { db: d, plan, route: '/dsa', path: '/dsa' })
    expect(await screen.findByTestId('dsa-empty')).toHaveTextContent('No DSA bank in this plan')
  })

  it('a premium cell carries no text glyph: a data-premium notch, and "premium" in its name (G4 review)', async () => {
    const plan = structuredClone(smallPlan) as PlanJson
    const bank = (plan as unknown as { dsa_bank: Array<{ problems: Array<{ num: number; premium: boolean }> }> }).dsa_bank
    bank.flatMap(t => t.problems).find(p => p.num === 127)!.premium = true
    await setup('/dsa', plan)
    const cell = screen.getByTestId('cell-p127')
    expect(cell).toHaveAttribute('data-premium', 'true')
    expect(cell.textContent).toBe('')
    expect(cell).toHaveAccessibleName(/premium/)
    expect(screen.getByTestId('cell-p200')).not.toHaveAttribute('data-premium')
  })
})


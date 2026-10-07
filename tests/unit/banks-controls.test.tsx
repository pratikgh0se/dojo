import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { Banks } from '../../src/screens/Banks'
import { seededDb } from '../helpers/db'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

async function setup(route: string) {
  setNow(() => ist('2026-10-12T09:00:00'))
  const plan = realPlan()
  const d = await seededDb(plan, '2026-10-05')
  renderWithApp(<Banks />, { db: d, plan, route, path: '/banks' })
  await screen.findByTestId('banks-visible-count')
  return d
}
const rows = () => [...document.querySelectorAll('[data-testid^="bank-item-"][data-status]')].map(r => r.getAttribute('data-testid')!.slice('bank-item-'.length))
const search = () => screen.getByRole('searchbox', { name: 'Search this bank' })
const locSearch = () => screen.getByTestId('location').getAttribute('data-search')

describe('bank filters', () => {
  it('searches names case-insensitively and writes q to the URL', async () => {
    await setup('/banks?bank=neetcode150')
    fireEvent.change(search(), { target: { value: 'pair' } })
    await waitFor(() => expect(rows()).toEqual(['p9001']))
    expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 1 of 6')
    expect(locSearch()).toBe('?bank=neetcode150&q=pair')
  })

  it('matches a LeetCode number', async () => {
    await setup('/banks?bank=blind75&q=200')
    expect(rows()).toContain('p200')
  })

  it('filters by difficulty, pattern and status; options come from the bank', async () => {
    await setup('/banks?bank=blind75')
    fireEvent.change(screen.getByRole('combobox', { name: 'Difficulty' }), { target: { value: 'H' } })
    await waitFor(() => expect(rows()).toContain('p9104'))
    expect(rows()).not.toContain('p9001')
    for (const id of rows()) expect(within(screen.getByTestId(`bank-item-${id}`)).getByTestId('bank-item-difficulty')).toHaveTextContent('H')
    expect(locSearch()).toBe('?bank=blind75&diff=H')
    const patterns = within(screen.getByRole('combobox', { name: 'Pattern' })).getAllByRole('option').map(o => o.textContent)
    expect(patterns[0]).toBe('All patterns')
    expect(patterns).toContain('BFS / DFS')
    expect(patterns).not.toContain('DP · BITMASK')
    expect(within(screen.getByRole('combobox', { name: 'Status' })).getAllByRole('option').map(o => o.textContent)).toEqual(['All', 'Todo', 'Done'])
  })

  it('shows the empty state, then Clear filters resets everything', async () => {
    await setup('/banks?bank=neetcode150&diff=E&q=islands')
    const empty = screen.getByTestId('banks-empty')
    expect(empty).toHaveTextContent('No items match.')
    expect(document.querySelectorAll('[data-testid^="banks-group-"]').length).toBe(0)
    fireEvent.click(screen.getByTestId('banks-clear-filters'))
    await waitFor(() => expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 6 of 6'))
    expect(search()).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Difficulty' })).toHaveValue('')
    expect(locSearch()).toBe('?bank=neetcode150')
    expect(screen.getByTestId('banks-clear-filters')).toBeDisabled()
  })

  it('restores filters from the URL and resets them on bank switch', async () => {
    await setup('/banks?bank=blind75&diff=M&status=todo')
    expect(screen.getByRole('combobox', { name: 'Difficulty' })).toHaveValue('M')
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('todo')
    fireEvent.click(screen.getByRole('tab', { name: /^Fixture Set A/ }))
    await waitFor(() => expect(locSearch()).toBe('?bank=neetcode150'))
    expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 6 of 6')
  })

  it('ignores hand-edited values (Review Focus 3)', async () => {
    await setup('/banks?bank=zzz&diff=Z&pattern=NOPE&status=maybe')
    expect(screen.getByRole('heading', { level: 2, name: 'Plan bank' })).toBeInTheDocument()
    expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 169 of 169')
  })

  it('hides Difficulty and Pattern on Hello Interview', async () => {
    await setup('/banks?bank=hellointerview')
    expect(screen.queryByRole('combobox', { name: 'Difficulty' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Pattern' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument()
    expect(search()).toBeInTheDocument()
  })

  it('status Done shows only ticked items', async () => {
    await setup('/banks?bank=blind75')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Pair Finder' }))
    await waitFor(() => expect(screen.getByTestId('banks-tab-count-blind75')).toHaveTextContent('1/6'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'done' } })
    await waitFor(() => expect(rows()).toEqual(['p9001']))
    expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 1 of 6')
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'todo' } })
    await waitFor(() => expect(rows()).toHaveLength(5))
  })

  it('"/" focuses search; Esc clears it', async () => {
    await setup('/banks?bank=blind75&q=tree')
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(search())
    fireEvent.keyDown(search(), { key: 'Escape' })
    await waitFor(() => expect(search()).toHaveValue(''))
    expect(locSearch()).toBe('?bank=blind75')
  })

  it('Mine starts empty with its own message', async () => {
    await setup('/banks?bank=mine')
    expect(screen.getByTestId('banks-empty')).toHaveTextContent('Nothing in Mine yet. Mine is your own problem list: paste a LeetCode or Codeforces link, or type a problem name, in the box above and press Classify to add it.')
    expect(screen.getByTestId('banks-tab-count-mine')).toHaveTextContent('0/0')
  })
})

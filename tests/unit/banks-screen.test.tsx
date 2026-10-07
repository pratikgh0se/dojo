import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { Banks } from '../../src/screens/Banks'
import { seededDb } from '../helpers/db'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-10-12T09:00:00')

async function setup(route = '/banks') {
  setNow(() => NOW)
  const plan = realPlan()
  const d = await seededDb(plan, '2026-10-05')
  renderWithApp(<Banks />, { db: d, plan, route, path: '/banks' })
  await screen.findByTestId('banks-page')
  await screen.findByTestId('banks-visible-count')
  return d
}
const count = (id: string) => screen.getByTestId(`banks-tab-count-${id}`).textContent
const flashes = () => Number(document.documentElement.dataset.flashes ?? '0')

describe('Banks screen', () => {
  it('opens on the Plan bank with seven tabs in contract order', async () => {
    await setup()
    const tabs = within(screen.getByRole('tablist', { name: 'Banks' })).getAllByRole('tab')
    expect(tabs.map(t => t.textContent?.replace(/\s+\d+\/\d+$/, ''))).toEqual(['Plan bank', 'Fixture Set A', 'Fixture Set B', 'Fixture Set C', 'Fixture Ladder', 'Fixture Designs', 'Mine'])
    expect(screen.getByRole('tab', { name: /^Plan bank/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Plan bank' })).toBeInTheDocument()
    expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 169 of 169')
    expect(count('plan')).toBe('0/169')
    expect(screen.getByTestId('banks-header')).toHaveTextContent('From your plan')
    expect(screen.queryByTestId('banks-source-link')).toBeNull()
    expect(screen.queryByTestId('banks-snapshot')).toBeNull()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'banks-tab-plan')
  })

  it('shows a pack with its source, snapshot, groups, plan markers and link cubes', async () => {
    await setup('/banks?bank=blind75')
    const src = screen.getByTestId('banks-source-link')
    expect(src).toHaveAccessibleName('Source ↗')
    expect(src).toHaveAttribute('href', 'https://example.com/fixture-sets/b')
    expect(src).toHaveAttribute('target', '_blank')
    expect(src.getAttribute('rel')).toContain('noopener')
    expect(screen.getByTestId('banks-snapshot')).toHaveTextContent('Snapshot 2026-01-01')
    expect(screen.getByRole('progressbar', { name: 'Fixture Set B progress' })).toHaveAttribute('aria-valuemax', '6')
    expect(document.querySelectorAll('[data-testid^="bank-item-"][data-status]')).toHaveLength(6)
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Lists', 'Trees'])
    const p200 = screen.getByTestId('bank-item-p200')
    expect(p200).toHaveAttribute('data-in-plan', 'true')
    expect(within(p200).getByTestId('bank-item-inplan')).toHaveTextContent('Plan · S1')
    expect(within(p200).getByTestId('bank-item-pattern')).toHaveTextContent('BFS / DFS')
    const cube = screen.getByTestId('bank-cell-p200')
    expect(cube.tagName).toBe('A')
    expect(cube).toHaveAttribute('href', '/dsa?topic=1')
    expect(cube).toHaveAccessibleName('Region Counter · in plan S1')
    expect(screen.getByTestId('bank-cell-p9001')).toHaveAccessibleName('Pair Finder · E · todo')
    const link = within(screen.getByTestId('bank-item-p9001')).getByTestId('bank-item-link')
    expect(link).toHaveAttribute('href', 'https://leetcode.com/problems/fixture-pair-finder/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(within(screen.getByTestId('banks-group-trees')).getByTestId('bank-item-p200')).toBeInTheDocument()
    expect(within(screen.getByTestId('banks-group-lists')).queryByTestId('bank-item-p200')).toBeNull()
  })

  it('switches banks with the keyboard; selection follows focus and lives in the URL', async () => {
    await setup()
    const plan = screen.getByRole('tab', { name: /^Plan bank/ })
    plan.focus()
    fireEvent.keyDown(plan, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Fixture Set B/ })).toHaveAttribute('aria-selected', 'true'))
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Fixture Set B/ }))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?bank=blind75')
    expect(screen.getByRole('tab', { name: /^Plan bank/ })).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Mine/ })).toHaveAttribute('aria-selected', 'true'))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Plan bank/ })).toHaveAttribute('aria-selected', 'true'))
  })

  it('a bank-only tick rewards once, is shared across banks, and unticks cleanly', async () => {
    const d = await setup('/banks?bank=blind75')
    const before = flashes()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Pair Finder' }))
    expect(await screen.findByText('+5 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(count('blind75')).toBe('1/6'))
    expect(flashes()).toBe(before + 1)
    expect(screen.getByTestId('bank-item-p9001')).toHaveAttribute('data-status', 'done')
    expect(screen.getByTestId('bank-cell-p9001')).toHaveAttribute('data-status', 'done')
    expect(screen.getByRole('progressbar', { name: 'Fixture Set B progress' })).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByTestId('banks-group-count-lists')).toHaveTextContent('1/3')
    expect(count('neetcode150')).toBe('1/6')
    expect(count('plan')).toBe('0/169')
    expect(await d.tickets.get('p9001')).toMatchObject({ origin: 'bank:blind75', status: 'done', sprint: 1 })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Pair Finder' }))
    await waitFor(() => expect(count('blind75')).toBe('0/6'))
    expect(flashes()).toBe(before + 1)
    expect(await d.tickets.get('p9001')).toBeUndefined()
  })

  it('ticking an in-plan item from a bank ticks the plan ticket', async () => {
    const d = await setup('/banks?bank=blind75')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Region Counter' }))
    expect(await screen.findByText('+10 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(count('plan')).toBe('1/169'))
    expect(await d.tickets.get('p200')).toMatchObject({ origin: 'plan', status: 'done' })
  })

  it('a normal heatmap cell ticks', async () => {
    await setup('/banks?bank=blind75')
    fireEvent.click(screen.getByTestId('bank-cell-p9001'))
    await waitFor(() => expect(count('blind75')).toBe('1/6'))
  })

  it('design pack rows share the plan design ticket and show — chips', async () => {
    await setup('/banks?bank=hellointerview')
    const wa = screen.getByTestId('bank-item-hi-fx-chat')
    expect(wa).toHaveAttribute('data-ticket-id', 'd-chat')
    expect(wa).toHaveAttribute('data-in-plan', 'true')
    expect(within(wa).getByTestId('bank-item-inplan')).toHaveTextContent('Plan · d-chat')
    expect(within(wa).getByTestId('bank-item-difficulty')).toHaveTextContent('—')
    expect(within(wa).getByTestId('bank-item-pattern')).toHaveTextContent('—')
    expect(screen.getByTestId('bank-item-hi-fx-solo')).toHaveAttribute('data-in-plan', 'false')
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Design drills'])
  })
})

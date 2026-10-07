import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { Banks } from '../../src/screens/Banks'
import { seededDb } from '../helpers/db'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const ROBOTS = 'https://leetcode.com/problems/maximum-number-of-robots-within-budget/'

async function setup(route = '/banks?bank=mine') {
  setNow(() => ist('2026-10-12T09:00:00'))
  const plan = realPlan()
  const d = await seededDb(plan, '2026-10-05')
  renderWithApp(<Banks />, { db: d, plan, route, path: '/banks' })
  await screen.findByTestId('mine-add')
  return d
}
const input = () => screen.getByRole('textbox', { name: 'URL or name' })
const classify = async (text: string) => {
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Classify' }))
}
const sug = () => screen.getByTestId('mine-suggestion')

describe('Mine', () => {
  it('Classify is disabled for empty or whitespace input', async () => {
    await setup()
    expect(screen.getByRole('button', { name: 'Classify' })).toBeDisabled()
    fireEvent.change(input(), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Classify' })).toBeDisabled()
  })

  it('classifies a LeetCode URL with the fake AI and adds it on Accept, without a reward', async () => {
    const d = await setup()
    await classify(ROBOTS)
    await screen.findByTestId('mine-suggestion')
    expect(within(sug()).getByTestId('mine-suggestion-note').textContent?.startsWith('[fake:classify]')).toBe(true)
    expect(within(sug()).getByTestId('mine-source')).toHaveTextContent('LeetCode')
    expect(within(sug()).getByRole('textbox', { name: 'Title' })).toHaveValue('Maximum Number Of Robots Within Budget')
    expect(within(sug()).getByRole('combobox', { name: 'Pattern' })).toHaveValue('SLIDING WINDOW')
    expect(within(sug()).getByRole('combobox', { name: 'Difficulty' })).toHaveValue('M')
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['classify'])
    fireEvent.click(within(sug()).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.getByTestId('banks-tab-count-mine')).toHaveTextContent('0/1'))
    expect(screen.queryByTestId('mine-suggestion')).toBeNull()
    expect(input()).toHaveValue('')
    const row = within(screen.getByTestId('banks-group-sliding-window')).getAllByRole('listitem')[0]
    expect(row.getAttribute('data-testid')?.startsWith('bank-item-mine-')).toBe(true)
    const link = within(row).getByRole('link', { name: 'Maximum Number Of Robots Within Budget' })
    expect(link).toHaveAttribute('href', ROBOTS)
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.queryByText(/xp · Saved/)).toBeNull()
    expect((await d.bankItems.toArray())[0]).toMatchObject({ bank: 'mine', source: 'LeetCode', inputKind: 'url' })
  })

  it('text input: edit the suggestion, accept, then edit the row and cancel', async () => {
    await setup()
    await classify('Kadane on a circular array')
    await screen.findByTestId('mine-suggestion')
    expect(within(sug()).getByTestId('mine-source')).toHaveTextContent('Text')
    fireEvent.change(within(sug()).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'DP · TABULATION' } })
    fireEvent.change(within(sug()).getByRole('combobox', { name: 'Difficulty' }), { target: { value: 'H' } })
    fireEvent.change(within(sug()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Circular Kadane' } })
    fireEvent.click(within(sug()).getByRole('button', { name: 'Accept' }))
    const group = await screen.findByTestId('banks-group-dp-tabulation')
    const row = within(group).getByText('Circular Kadane').closest('li')!
    expect(within(row).queryByRole('link', { name: 'Circular Kadane' })).toBeNull()
    expect(within(row).getByTestId('bank-item-difficulty')).toHaveTextContent('H')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Circular Kadane' }))
    fireEvent.change(within(sug()).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'GREEDY' } })
    fireEvent.click(within(sug()).getByRole('button', { name: 'Save' }))
    await screen.findByTestId('banks-group-greedy')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Circular Kadane' }))
    fireEvent.change(within(sug()).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'TRIE' } })
    fireEvent.click(within(sug()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('mine-suggestion')).toBeNull())
    expect(screen.getByTestId('banks-group-greedy')).toBeInTheDocument()
  })

  it('a known URL skips classify and reuses the shared id', async () => {
    const d = await setup()
    await classify('https://leetcode.com/problems/fixture-pair-finder/')
    await screen.findByTestId('mine-suggestion')
    expect(within(sug()).getByTestId('mine-suggestion-note')).toHaveTextContent('Known item · Fixture Set B')
    expect(within(sug()).getByRole('textbox', { name: 'Title' })).toHaveValue('Pair Finder')
    expect(within(sug()).getByRole('combobox', { name: 'Difficulty' })).toHaveValue('E')
    fireEvent.click(within(sug()).getByRole('button', { name: 'Accept' }))
    const row = await screen.findByTestId('bank-item-p9001')
    fireEvent.click(within(row).getByRole('checkbox', { name: 'Done: Pair Finder' }))
    expect(await screen.findByText('+5 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('banks-tab-count-blind75')).toHaveTextContent('1/6'))
    expect(screen.getByTestId('banks-tab-count-neetcode150')).toHaveTextContent('1/6')
    expect(await d.tickets.get('p9001')).toMatchObject({ origin: 'mine', xp: 5 })
    expect(screen.getByRole('button', { name: 'Remove Pair Finder' })).toBeDisabled()
  })

  it('a known Codeforces item added via Mine earns the same XP as ticking it in Codeforces (rating carried, not the E/M/H bucket)', async () => {
    const d = await setup()
    await classify('https://codeforces.com/problemset/problem/9003/C')
    await screen.findByTestId('mine-suggestion')
    expect(within(sug()).getByTestId('mine-suggestion-note')).toHaveTextContent('Known item · Fixture Ladder')
    fireEvent.click(within(sug()).getByRole('button', { name: 'Accept' }))
    const row = await screen.findByTestId('bank-item-cf-9003C')
    fireEvent.click(within(row).getByRole('checkbox', { name: 'Done: Fixture Greedy' }))
    // cfXp(1300) = round(1300/100) - 7 = 6; the E/M/H bucket route would instead pay baseXp('problem', 'E') = 5.
    expect(await screen.findByText('+6 xp · Saved')).toBeInTheDocument()
    expect(await d.tickets.get('cf-9003C')).toMatchObject({ origin: 'mine', xp: 6, rating: 1300 })
  })

  it('rejects duplicates, handles Codeforces URLs and removes undone rows', async () => {
    await setup()
    await classify(ROBOTS)
    fireEvent.click(within(await screen.findByTestId('mine-suggestion')).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.getByTestId('banks-tab-count-mine')).toHaveTextContent('0/1'))
    await classify(ROBOTS.slice(0, -1))
    expect(await screen.findByTestId('mine-notice')).toHaveTextContent('Already in Mine')
    expect(screen.queryByTestId('mine-suggestion')).toBeNull()
    await classify('https://codeforces.com/contest/9998/problem/A')
    await screen.findByTestId('mine-suggestion')
    expect(within(sug()).getByTestId('mine-source')).toHaveTextContent('Codeforces')
    expect(within(sug()).getByRole('textbox', { name: 'Title' })).toHaveValue('CF 9998A')
    fireEvent.click(within(sug()).getByRole('button', { name: 'Accept' }))
    await screen.findByTestId('bank-item-cf-9998A')
    fireEvent.click(screen.getByRole('button', { name: 'Remove CF 9998A' }))
    await waitFor(() => expect(screen.queryByTestId('bank-item-cf-9998A')).toBeNull())
  })

  it('shows a classify failure raw with Retry and adds nothing', async () => {
    const d = await setup()
    await classify('__fail_classify__')
    const err = await screen.findByTestId('mine-error')
    expect(err).toHaveTextContent('fake classify failure')
    expect(within(err).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(await d.bankItems.count()).toBe(0)
    expect(screen.getByRole('tab', { name: /^Fixture Set B/ })).toBeInTheDocument()
  })
})

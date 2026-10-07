import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { Banks } from '../../src/screens/Banks'
import { seededDb } from '../helpers/db'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const PROBE = '[{"contestId":9999,"index":"Z","name":"Contract Import Probe","rating":1700,"tags":["greedy"]}]'

async function setup() {
  setNow(() => ist('2026-10-12T09:00:00'))
  const plan = realPlan()
  const d = await seededDb(plan, '2026-10-05')
  renderWithApp(<Banks />, { db: d, plan, route: '/banks?bank=codeforces', path: '/banks' })
  await screen.findByTestId('banks-import')
  return d
}
const importText = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ladder JSON' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
}

describe('Codeforces import', () => {
  it('is a disclosure', async () => {
    await setup()
    const btn = screen.getByRole('button', { name: 'Import ladder' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Ladder JSON' })).toBeNull()
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('imports the probe once, merges by id and adds the rating group', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Import ladder' }))
    await importText(PROBE)
    await waitFor(() => expect(screen.getByTestId('banks-import-result')).toHaveTextContent('1 new, 0 already present'))
    await waitFor(() => expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 6 of 6'))
    const row = within(screen.getByTestId('banks-group-1700')).getByTestId('bank-item-cf-9999Z')
    expect(within(row).getByTestId('bank-item-difficulty')).toHaveTextContent('1700')
    expect(within(row).getByTestId('bank-item-pattern')).toHaveTextContent('GREEDY')
    expect(within(row).getByTestId('bank-item-link')).toHaveAttribute('href', 'https://codeforces.com/problemset/problem/9999/Z')
    expect(within(screen.getByRole('combobox', { name: 'Difficulty' })).getAllByRole('option').map(o => o.textContent)).toContain('1700')
    await importText(PROBE)
    await waitFor(() => expect(screen.getByTestId('banks-import-result')).toHaveTextContent('0 new, 1 already present'))
    expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 6 of 6')
  })

  it('rejects invalid JSON without changing the count', async () => {
    const d = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Import ladder' }))
    for (const bad of ['not json', '[{"name":"x"}]']) {
      await importText(bad)
      await waitFor(() => expect(screen.getByTestId('banks-import-result').textContent?.startsWith('Invalid ladder JSON')).toBe(true))
    }
    expect(screen.getByTestId('banks-visible-count')).toHaveTextContent('Showing 5 of 5')
    expect(await d.bankItems.count()).toBe(0)
  })

  it('ticks an imported rating with its XP', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Import ladder' }))
    await importText(PROBE)
    await screen.findByTestId('bank-item-cf-9999Z')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Contract Import Probe' }))
    expect(await screen.findByText('+10 xp · Saved')).toBeInTheDocument()
  })
})

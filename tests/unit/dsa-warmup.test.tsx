import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { safeWrite } from '../../src/data/safeWrite'
import { Dsa } from '../../src/screens/Dsa'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const plan = realPlan()
async function setup(route: string) {
  const d = await seededDb(plan, '2026-10-05')
  renderWithApp(<Dsa />, { db: d, plan, route, path: '/dsa' })
  await screen.findByTestId('topic-detail')
  return d
}
const warm = () => within(screen.getByRole('region', { name: 'Warm-up' }))
const pressed = () => warm().getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)

describe('DSA warm-up (labs contract §6)', () => {
  beforeAll(installAlgoEngines)

  it('opens the topic with its free warm-up first, at step 0, not playing (S36)', async () => {
    const d = await setup('/dsa?topic=2')
    const detail = screen.getByTestId('topic-detail')
    expect(within(detail).getAllByRole('region')[0]).toHaveAttribute('aria-label', 'Warm-up')
    expect(warm().getByText('Warm-up · free')).toBeInTheDocument()
    expect(within(warm().getByRole('group', { name: 'Warm-up walkthroughs' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Topological sort · Kahn'])
    expect(pressed()).toEqual(['Topological sort · Kahn'])
    expect(await warm().findByTestId('lab-step-counter')).toHaveTextContent('STEP 0 / 56')
    expect(warm().getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(warm().getByRole('link', { name: 'Open in Atlas' })).toHaveAttribute('href', '/atlas?pattern=topo-sort')
    expect(await d.atlasRuns.count()).toBe(0)
  })

  it('switches warm-ups and resets to the default when the topic changes (S38)', async () => {
    await setup('/dsa?topic=7')
    expect(within(warm().getByRole('group', { name: 'Warm-up walkthroughs' })).getAllByRole('button').map(b => b.textContent)).toEqual([
      'Memoization · fib(5)', 'Tabulation · fib(5)', 'Coin change · 1-D DP', 'Longest increasing subsequence',
    ])
    fireEvent.click(warm().getByRole('button', { name: 'Coin change · 1-D DP' }))
    expect(await screen.findByRole('region', { name: 'Player: Coin change · 1-D DP' })).toBeInTheDocument()
    expect(screen.getByTestId('lab-step-counter')).toHaveTextContent('STEP 0 / 35')
  })

  it('"Open in Atlas" awaits a write still in flight before navigating (S39: no lost predict/seen row)', async () => {
    await setup('/dsa?topic=2')
    let resolveWrite!: () => void
    const gate = new Promise<void>(res => { resolveWrite = res })
    // Simulate the player's own recordSeen/recordPredict write still being in flight when he clicks away.
    void safeWrite(() => gate, () => {})
    fireEvent.click(warm().getByRole('link', { name: 'Open in Atlas' }))
    // Not yet: the write hasn't settled, so navigation must not have happened.
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByTestId('location')).toHaveTextContent('/dsa')
    resolveWrite()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?pattern=topo-sort'))
  })

  it.each(plan.dsa_bank.map(w => w.sprint))('topic S%i has a warm-up that links to the Atlas (S37)', async sprint => {
    await setup(`/dsa?topic=${sprint}`)
    expect(pressed()).toHaveLength(1)
    expect(warm().getByRole('link', { name: 'Open in Atlas' }).getAttribute('href')).toMatch(/^\/atlas\?pattern=[a-z-]+$/)
    expect((await warm().findByTestId('lab-step-counter')).textContent).toMatch(/^STEP 0 \/ [1-9]\d*$/)
  })
})

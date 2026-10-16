import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useTodayModel } from '../../src/data/flatHooks'
import { resetNow, setNow } from '../../src/lib/clock'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
afterEach(() => resetNow())

function Probe() {
  const m = useTodayModel()
  return m ? <div data-testid="probe" data-lead={String(m.lead)} data-budgets={m.budgets.join(',')} data-mix-budget={m.mix.budget}>ok</div> : null
}
async function run(now: number, activeDays: [number, number][], o: { budgets?: number[]; status?: 'todo' | 'doing' } = {}) {
  setNow(() => now)
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-10-01', planVersion: 't', aiProviders: {}, possibleXp: 0, laneBudgets: o.budgets ?? [90, 60, 60, 60, 30, 30, 150] })
  await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', estMin: 20, status: o.status ?? 'todo' }))
  await d.sessions.bulkPut(activeDays.map(([mo, da]) => ({ id: `s-${mo}-${da}`, ticketId: 'w1', start: at(2026, mo, da, 9), end: at(2026, mo, da, 10), minutes: 60, outcome: 'solved' as const, xpDelta: 0 })))
  renderWithApp(<Probe />, { db: d, ...appPlans() })
  return screen.findByTestId('probe')
}

describe('useTodayModel: restart, lead and half load', () => {
  it('3 inactive days: no lead', async () => {
    expect(await run(at(2026, 11, 5), [[11, 1]])).toHaveAttribute('data-lead', 'null')
  })
  it('4 inactive days: the restart lead, full budgets', async () => {
    const p = await run(at(2026, 11, 6), [[11, 1]])
    expect(p).toHaveAttribute('data-lead', 'restart')
    expect(p).toHaveAttribute('data-budgets', '90,60,60,60,30,30,150')
  })
  it('the day after a return from a long gap: half the day budget (Tuesday 60 -> 30), no lead', async () => {
    const p = await run(at(2026, 11, 3), [[10, 20], [11, 2]])
    expect(p).toHaveAttribute('data-lead', 'null')
    expect(p).toHaveAttribute('data-budgets', '45,30,30,30,15,15,75')
    expect(p).toHaveAttribute('data-mix-budget', '30')
  })
  it('a half-load Thursday (30 -> 15) is a short day: the Floor leads without a welcome', async () => {
    expect(await run(at(2026, 11, 5), [[10, 20], [11, 2]])).toHaveAttribute('data-lead', 'short')
  })
  it('the fifth day after the return is normal again', async () => {
    const p = await run(at(2026, 11, 7), [[10, 20], [11, 2]])
    expect(p).toHaveAttribute('data-budgets', '90,60,60,60,30,30,150')
  })
  it('a restart day wins over a short day (budget 15)', async () => {
    expect(await run(at(2026, 11, 6), [[11, 1]], { budgets: [15, 15, 15, 15, 15, 15, 15] })).toHaveAttribute('data-lead', 'restart')
  })
  it('a short day alone (budget 15, no gap) is the short lead', async () => {
    expect(await run(at(2026, 11, 3), [[11, 2]], { budgets: [15, 15, 15, 15, 15, 15, 15] })).toHaveAttribute('data-lead', 'short')
  })
  it('a started ticket on a restart day keeps the restart lead (RIT-54)', async () => {
    expect(await run(at(2026, 11, 6), [[11, 1]], { status: 'doing' })).toHaveAttribute('data-lead', 'restart')
  })
  it('a started ticket on a short day ends the lead: it is never put behind the Floor', async () => {
    expect(await run(at(2026, 11, 3), [[11, 2]], { status: 'doing', budgets: [15, 15, 15, 15, 15, 15, 15] })).toHaveAttribute('data-lead', 'null')
  })
  it('a learner with no activity at all is not on a restart', async () => {
    expect(await run(at(2026, 11, 6), [])).toHaveAttribute('data-lead', 'null')
  })
})

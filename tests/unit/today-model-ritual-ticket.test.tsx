import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useTodayModel } from '../../src/data/flatHooks'
import { resetNow, setNow } from '../../src/lib/clock'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

// RIT-18: a started weekly review or swap drill ticket is never the quest and never in the pick list
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
afterEach(() => resetNow())

function Probe() {
  const m = useTodayModel()
  return m ? <div data-testid="probe" data-action={m.next.kind} data-quest={'ticket' in m.next ? (m.next.ticket?.id ?? '') : ''} data-pick-doing={m.pick.doing.map(t => t.id).join(',')}>ok</div> : null
}
async function run(origin: string, id: string) {
  setNow(() => at(2026, 11, 9, 0))
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-10-01', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', estMin: 20, status: 'todo' }))
  await d.tickets.put(mkTicket({ id, kind: 'ritual', lane: 'ritual', origin, estMin: 60, status: 'doing' }))
  renderWithApp(<Probe />, { db: d, ...appPlans() })
  return screen.findByTestId('probe')
}

describe('useTodayModel: windowed ritual tickets', () => {
  it('a started weekly review ticket is not the resume quest or in the pick list', async () => {
    const p = await run('ritual:weekly-review:2026-W45', 'ritual-weekly-review-2026-W45')
    expect(p).not.toHaveAttribute('data-quest', 'ritual-weekly-review-2026-W45')
    expect(p).toHaveAttribute('data-pick-doing', '')
  })
  it('a started swap drill ticket is not the resume quest or in the pick list', async () => {
    const p = await run('ritual:model-swap-drill:2026-11', 'ritual-model-swap-drill-2026-11')
    expect(p).not.toHaveAttribute('data-action', 'resume')
    expect(p).toHaveAttribute('data-pick-doing', '')
  })
})

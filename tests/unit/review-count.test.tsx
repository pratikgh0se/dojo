import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resetNow, setNow } from '../../src/lib/clock'
import { useDueReviews } from '../../src/app/useDueReviews'
import { useTodayModel } from '../../src/data/flatHooks'
import type { Redo } from '../../src/data/types'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const DAY = 86_400_000
function Probe() {
  const cards = useDueReviews()
  const model = useTodayModel()
  return <p data-testid="probe">{cards && model ? `${cards.length}:${model.dueReviews}` : 'loading'}</p>
}

describe('the due count', () => {
  it('is the same on Review, the badge and Today, and skips an archived ticket', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    const ts = [mkTicket({ id: 'a', kind: 'watch' }), mkTicket({ id: 'b', kind: 'problem', lane: 'dsa' }), mkTicket({ id: 'gone', kind: 'problem', lane: 'dsa', archived: true })]
    await d.tickets.bulkPut(ts)
    const redo = (id: string, ticketId: string): Redo => ({ id, ticketId, source: 'check_failed', createdAt: Date.now() - 9 * DAY, stage: 0, due: Date.now() - DAY, passed: [], helpCost: 0, refunded: 0 })
    await d.redos.bulkPut([redo('r1', 'a'), redo('r2', 'b'), redo('r3', 'gone')])
    renderWithApp(<Probe />, { db: d, ...appPlans() })
    expect(await screen.findByText('2:2')).toBeInTheDocument()
  })

  afterEach(() => resetNow())

  it('follows a browser clock fixed after the page loaded, within two seconds (BANK-15)', async () => {
    let clock = new Date(2026, 9, 14, 12, 0).getTime()
    setNow(() => clock)
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-10-14', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    // a bank question's redo has no ticket (its ticketId is the question id) and is due on 2026-11-04
    await d.redos.put({ id: 'r-bank', ticketId: 'x-SD01-1', source: 'bank_q', createdAt: clock, stage: 0, due: '2026-11-04', passed: [], helpCost: 0, refunded: 0, piece: { topic: 'Estimation', question: 'How big?', answer: 'About 2 GB.', qid: 'x-SD01-1' } })
    renderWithApp(<Probe />, { db: d, ...appPlans() })
    expect(await screen.findByText('0:0')).toBeInTheDocument()
    clock = new Date(2026, 10, 4, 10, 0).getTime()
    expect(await screen.findByText('1:1', undefined, { timeout: 2500 })).toBeInTheDocument()
  })
})

// F1: a week's ritual ticket is not plan content. A plan refresh keeps it; it is never archived as a vanished plan ticket.
import { describe, expect, it } from 'vitest'
import { reconcilePlan } from '../../src/rules/reconcile'
import { weekTicket } from '../../src/rules/ritual'
import { mkTicket } from '../helpers/tickets'

describe('reconcilePlan with a ritual ticket', () => {
  it('keeps it exactly as it is and archives nothing', () => {
    const ritual = weekTicket(new Date(2026, 9, 14).getTime(), { minutes: 30, dueWeekday: 6 })
    const planned = mkTicket({ id: 'p1' })
    const res = reconcilePlan([planned, ritual], [{ ...planned }], {})
    expect(res.archived).toEqual([])
    expect(res.deletes).toEqual([])
    expect(res.puts.find(t => t.id === ritual.id)?.archived).not.toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import type { DojoEvent, ReplanReport, Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

describe('R1 data types (compile-time contract, MIG-03 and D10/D11)', () => {
  it('accepts a replan event carrying the contract report', () => {
    const report: ReplanReport = {
      backupFile: null, archived: 3, doneAndDropped: ['a'], xpBefore: 10, xpAfter: 10,
      designSessionsRewritten: 1, coreMinutesBefore: 480, coreMinutesAfter: 960, codeMerged: 0,
    }
    const e: DojoEvent = { t: 'replan', at: 1, report }
    expect(e.t === 'replan' && e.report.xpBefore === e.report.xpAfter).toBe(true)
  })
  it('accepts mergedInto and learnerUpdatedAt on a ticket', () => {
    const t: Ticket = { ...mkTicket({ id: 'x' }), mergedInto: 'y', learnerUpdatedAt: 5, explainAnswers: ['a'] }
    expect(t.mergedInto).toBe('y')
    expect(t.learnerUpdatedAt).toBe(5)
  })
})

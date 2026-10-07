import { describe, expect, it } from 'vitest'
import type { DojoEvent, Session } from '../../src/data/types'
import { deepestRung, dsaEvidence, dsaTickedWithoutAttempt, helpLadderUsage, passRate, redoHitRate } from '../../src/rules/evidence'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const START = '2026-10-05'
let n = 0
function ses(ticketId: string, at: string, outcome: Session['outcome'], rungs?: Session['rungs']): Session {
  const start = ist(at)
  return { id: `s${n++}`, ticketId, start, end: start + 60_000, minutes: 1, outcome, xpDelta: 0, ...(rungs ? { rungs } : {}) }
}
const problems = ['p1', 'p2', 'p3', 'p4'].map(id => mkTicket({ id, kind: 'problem', track: 'interview' }))
const task = mkTicket({ id: 't1', kind: 'task' })

describe('dsaEvidence', () => {
  it('Review Focus 5: each problem counts once, by its latest Do session; tasks and ticks without sessions count nowhere', () => {
    const sessions = [
      ses('p1', '2026-10-06T10:00', 'gave_up'), ses('p1', '2026-10-09T10:00', 'solved'),
      ses('p2', '2026-10-06T11:00', 'solved_help'),
      ses('p3', '2026-10-06T12:00', 'gave_up'),
      ses('t1', '2026-10-06T13:00', 'gave_up'),
    ]
    const ticked = { ...problems[3], status: 'done' as const }
    const done = (t: (typeof problems)[number]) => ({ ...t, status: 'done' as const }) // the live ticket state decides (cu-final row 6)
    expect(dsaEvidence([done(problems[0]!), done(problems[1]!), problems[2]!, ticked, task], sessions, [])).toEqual({ solved: 1, help: 1, gaveUp: 1, redoPassed: 0, redoTotal: 0 })
    // the same sessions with the solved card unticked: it is no longer solved
    expect(dsaEvidence([problems[0]!, done(problems[1]!), problems[2]!, ticked, task], sessions, [])).toMatchObject({ solved: 0, help: 1, gaveUp: 1 })
  })
  // UAT cu-3 P3-6: the DSA tile read 2/169 and Evidence 0, 0, 0 for the same two cards (ticked on the Board). The stats still
  // leave a tick out (integration I-12); the number that makes them add up is dsaTickedWithoutAttempt.
  it('dsaTickedWithoutAttempt: plan problems done with no counted Do session; the tile = the stats + these', () => {
    const done = (id: string, extra: Partial<ReturnType<typeof mkTicket>> = {}) => mkTicket({ id, kind: 'problem', track: 'interview', status: 'done', ...extra })
    const tickets = [done('p1'), done('p2'), done('p3'), done('p4'), done('p5', { origin: 'neetcode' as never }), mkTicket({ id: 'p6', kind: 'problem' }), done('t1', { kind: 'task' })]
    const sessions = [ses('p1', '2026-10-06T10:00', 'solved'), ses('p2', '2026-10-06T10:00', 'studied'), ses('p6', '2026-10-06T10:00', 'gave_up')]
    const e = dsaEvidence(tickets, sessions, [])
    const ticked = dsaTickedWithoutAttempt(tickets, sessions)
    expect(e).toMatchObject({ solved: 1, help: 0, gaveUp: 1 }) // the ticks are in neither
    expect(ticked).toBe(3) // p2 (a study session is no attempt), p3, p4; not p5 (a bank problem), not p6 (not done), not t1
    expect(dsaTickedWithoutAttempt([], [])).toBe(0)
    const planDone = tickets.filter(t => t.kind === 'problem' && t.origin === 'plan' && t.status === 'done').length
    expect(planDone).toBe(e.solved + e.help + ticked) // 4 = 1 + 0 + 3
  })
  it('redo pass rate from redo events', () => {
    const ev: DojoEvent[] = [
      { t: 'redo_pass', id: 'p1', at: 1, stage: 0, refund: 5 },
      { t: 'redo_fail', id: 'p2', at: 2, stage: 0, refund: 0 },
      { t: 'redo_pass', id: 'p1', at: 3, stage: 1, refund: 5 },
    ]
    const e = dsaEvidence(problems, [], ev)
    expect([e.redoPassed, e.redoTotal]).toEqual([2, 3])
    expect(passRate(e.redoPassed, e.redoTotal)).toBe('2 / 3')
  })
  it('M4: a design ticket\'s redo events (the Do ladder can close a kind:"design" redo too) never inflate the DSA redo rate', () => {
    const designTicket = mkTicket({ id: 'd-method', kind: 'design', track: 'ai' })
    const ev: DojoEvent[] = [
      { t: 'redo_pass', id: 'p1', at: 1, stage: 0, refund: 5 }, // DSA - counts
      { t: 'redo_pass', id: 'd-method', at: 2, stage: 0, refund: 5 }, // design - must not count
      { t: 'redo_fail', id: 'd-method', at: 3, stage: 0, refund: 0 }, // design - must not count
    ]
    const e = dsaEvidence([...problems, designTicket], [], ev)
    expect([e.redoPassed, e.redoTotal]).toEqual([1, 1])
  })
})

describe('helpLadderUsage', () => {
  it('deepest rung per session; no rungs means attempt only', () => {
    expect(deepestRung(ses('p1', '2026-10-06T10:00', 'solved'))).toBe(1)
    expect(deepestRung(ses('p1', '2026-10-06T10:00', 'gave_up', [1, 2, 3, 5]))).toBe(5)
  })
  it('one row per sprint from S1 to the latest session sprint, counts by deepest rung', () => {
    const rows = helpLadderUsage([
      ses('p1', '2026-10-06T10:00', 'solved'),
      ses('p2', '2026-10-06T11:00', 'solved_help', [1, 2]),
      ses('p3', '2026-10-06T12:00', 'gave_up', [1, 5]),
      ses('p1', '2026-10-20T10:00', 'solved', [1]),
    ], START)
    expect(rows).toEqual([
      { sprint: 1, counts: [1, 1, 0, 0, 1] },
      { sprint: 2, counts: [1, 0, 0, 0, 0] },
    ])
  })
  it('sessions before the plan start are ignored; none gives no rows', () => {
    expect(helpLadderUsage([ses('p1', '2026-10-01T10:00', 'solved')], START)).toEqual([])
    expect(helpLadderUsage([], START)).toEqual([])
  })
})

describe('redoHitRate', () => {
  it('counts passes and fails and sums refunds including the stage-2 bonus (C-LADDER H-30: 5 + 5 + 3)', () => {
    const ev: DojoEvent[] = [
      { t: 'redo_pass', id: 'p1', at: 1, stage: 0, refund: 5 },
      { t: 'redo_pass', id: 'p1', at: 2, stage: 1, refund: 5 },
      { t: 'redo_pass', id: 'p1', at: 3, stage: 2, refund: 3 },
      { t: 'tick', id: 'p9', at: 4, xp: 10 },
    ]
    expect(redoHitRate(ev)).toEqual({ passed: 3, failed: 0, refunded: 13 })
    expect(redoHitRate([{ t: 'redo_fail', id: 'p1', at: 1, stage: 0, refund: 0 }])).toEqual({ passed: 0, failed: 1, refunded: 0 })
  })
})

describe('studied sessions (a study session solves nothing)', () => {
  it('never become a problem\'s latest session, a gave-up count, or a ladder-usage attempt', () => {
    const sessions = [ses('p1', '2026-10-06T10:00', 'solved'), ses('p1', '2026-10-09T10:00', 'studied')]
    expect(dsaEvidence([{ ...problems[0]!, status: 'done' }, ...problems.slice(1)], sessions, [])).toMatchObject({ solved: 1, help: 0, gaveUp: 0 })
    expect(helpLadderUsage([...sessions], START).reduce((a, r) => a + r.counts.reduce((x, y) => x + y, 0), 0)).toBe(1)
  })
})

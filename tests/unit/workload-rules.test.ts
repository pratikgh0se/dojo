import { describe, expect, it } from 'vitest'
import type { BriefOutput } from '../../src/ai/types'
import { toBrief } from '../../src/rules/brief'
import { effSprint } from '../../src/rules/sprint'
import {
  applyRollover, cardDayType, coreMinutesOf, DAY_MINUTES, dayTypeOf, hoursText, isOverBudget, loadMinutesText, minutesDoneOn, minutesUsedToday,
  overBudgetText, plannedMinutes, rebalanceProposal, rolledNotes, rolledText, rolloverPlan, suggestCards,
} from '../../src/rules/workload'
import { mkTicket } from '../helpers/tickets'

const brief = (minutes: number, dayType: BriefOutput['dayType'] = 'focus') =>
  toBrief({ goal: 'g', steps: [{ text: 's' }], minutes, dayType, learn: [], outcome: 'o', deliverable: { kind: 'note', prompt: 'p' }, questions: [] })
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
// 2026-10-05 is a Monday; sprint 1 = Oct 5-18, sprint 2 = Oct 19-Nov 1
const START = '2026-10-05'

describe('budget and minutes', () => {
  it('the budget defaults to 24 h and ignores junk', () => {
    expect(coreMinutesOf(undefined)).toBe(1440)
    expect(coreMinutesOf({})).toBe(1440)
    expect(coreMinutesOf({ coreMinutes: 120 })).toBe(120)
    expect(coreMinutesOf({ coreMinutes: 3 })).toBe(1440)
    expect(coreMinutesOf({ coreMinutes: NaN })).toBe(1440)
  })
  it('planned minutes: unfinished, live, non-container cards of the sprint; brief minutes beat the default', () => {
    const ts = [
      mkTicket({ id: 'a', estMin: 50 }), mkTicket({ id: 'b', estMin: 50, brief: brief(90) }), mkTicket({ id: 'done', status: 'done', estMin: 500 }),
      mkTicket({ id: 'box', children: ['x'], estMin: 500 }), mkTicket({ id: 'arch', archived: true, estMin: 500 }), mkTicket({ id: 'later', sprint: 2, estMin: 500 }),
    ]
    expect(plannedMinutes(ts, 1)).toBe(140)
  })
  it('hours read "18", "1.5" and the load line "18 h / 24 h"', () => {
    expect(hoursText(1080)).toBe('18')
    expect(hoursText(90)).toBe('1.5')
    expect(hoursText(100)).toBe('1.7')
    expect(hoursText(0)).toBe('0')
    expect(loadMinutesText(1080, 1440)).toBe('18 h / 24 h')
    expect(loadMinutesText(90, 120)).toBe('1.5 h / 2 h')
    expect(overBudgetText(2, 1800, 1440)).toBe('Sprint 2: 30 h planned, budget 24 h.')
    expect(isOverBudget(1441, 1440)).toBe(true)
    expect(isOverBudget(1440, 1440)).toBe(false)
  })
})

describe('day types and suggestions', () => {
  it('Mon-Wed focus, Thu-Fri light, Sat-Sun long', () => {
    expect((['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map(dayTypeOf)).toEqual(['focus', 'focus', 'focus', 'light', 'light', 'long', 'long'])
    expect(cardDayType(mkTicket({ id: 'a' }))).toBe('focus')
    expect(cardDayType(mkTicket({ id: 'a', brief: brief(30, 'long') }))).toBe('long')
  })
  const pool = [
    mkTicket({ id: 'f1', order: 1, brief: brief(60, 'focus') }), mkTicket({ id: 'l1', order: 2, brief: brief(30, 'light') }),
    mkTicket({ id: 'l2', order: 3, brief: brief(30, 'light') }), mkTicket({ id: 'l3', order: 4, brief: brief(30, 'light') }),
    mkTicket({ id: 'g1', order: 5, brief: brief(200, 'long') }),
  ]
  it('BR-09: on a Thursday only light cards are suggested when any exist, within the day\'s 60 minutes', () => {
    const s = suggestCards(pool, 1, at(2026, 10, 8))
    expect(s.map(x => x.ticket.id)).toEqual(['l1', 'l2'])
  })
  it('falls back to every card when none has today\'s type, and always offers at least one while time is left', () => {
    const noLight = pool.filter(t => cardDayType(t) !== 'light')
    expect(suggestCards(noLight, 1, at(2026, 10, 8)).map(x => x.ticket.id)).toEqual(['f1'])
    expect(suggestCards([mkTicket({ id: 'huge', brief: brief(400, 'focus') })], 1, at(2026, 10, 6)).map(x => x.ticket.id)).toEqual(['huge'])
  })
  it('the weekend is long, the time left shrinks with what was done today, and none is offered when it is used up', () => {
    expect(DAY_MINUTES).toEqual({ focus: 120, light: 60, long: 240 })
    expect(suggestCards(pool, 1, at(2026, 10, 10)).map(x => x.ticket.id)).toEqual(['g1'])
    expect(suggestCards(pool, 1, at(2026, 10, 8), 45).map(x => x.ticket.id)).toEqual(['l1'])
    expect(suggestCards(pool, 1, at(2026, 10, 8), 60)).toEqual([])
  })
  it('skips finished and other-sprint cards, and stops at five', () => {
    const many = Array.from({ length: 9 }, (_, i) => mkTicket({ id: `m${i}`, order: i, brief: brief(5, 'focus') }))
    expect(suggestCards(many, 1, at(2026, 10, 6))).toHaveLength(5)
    expect(suggestCards([mkTicket({ id: 'd', status: 'done' }), mkTicket({ id: 'o', sprint: 2 })], 1, at(2026, 10, 6))).toEqual([])
  })
  it('minutes done today count cards finished on the local day', () => {
    const ts = [mkTicket({ id: 'a', status: 'done', doneAt: at(2026, 10, 6, 9), brief: brief(40) }), mkTicket({ id: 'b', status: 'done', doneAt: at(2026, 10, 5, 9), estMin: 30 })]
    expect(minutesDoneOn(ts, at(2026, 10, 6, 20))).toBe(40)
  })
})

describe('roll-over', () => {
  const ts = [
    mkTicket({ id: 'a', sprint: 1 }), mkTicket({ id: 'done', sprint: 1, status: 'done' }), mkTicket({ id: 'b', sprint: 2 }),
    mkTicket({ id: 'c', sprint: 1, rolledFrom: [] }), mkTicket({ id: 'box', sprint: 1, children: ['k'] }), mkTicket({ id: 'arch', sprint: 1, archived: true }),
  ]
  it('BR-10: once sprint 1 has ended every unfinished card in it moves to sprint 2 and remembers sprint 1', () => {
    const plan = rolloverPlan(ts, at(2026, 10, 19, 8), START)
    expect(plan.map(p => p.id).sort()).toEqual(['a', 'box', 'c']) // a split container rolls with its sessions
    expect(plan[0]).toEqual({ id: 'a', from: 1, to: 2, rolledFrom: [1], home: 1 })
    expect(applyRollover(ts[0], plan[0])).toMatchObject({ id: 'a', sprint: 2, rolledFrom: [1], xp: 0, status: 'todo' })
  })
  it('sprints that ended before tracking began are not rolled', () => {
    const p = rolloverPlan([mkTicket({ id: 'a', sprint: 1 }), mkTicket({ id: 'b', sprint: 2 })], at(2026, 11, 3), START, 2)
    expect(p.map(x => x.id)).toEqual(['b'])
  })
  it('the roll leaves a carry so the sprint-by-sprint views still see the card at home', () => {
    const t = mkTicket({ id: 'a', sprint: 1 })
    const p = rolloverPlan([t], at(2026, 10, 19, 8), START)[0]
    expect(p.home).toBe(1)
    const rolled = applyRollover(t, p)
    expect(rolled.carry).toEqual({ home: 1, into: 2 })
    expect(effSprint(rolled)).toBe(1)
    expect(effSprint({ sprint: 5, carry: { home: 1, into: 2 } })).toBe(5) // moved on by hand: it counts where it now is
    expect(effSprint(mkTicket({ id: 'z', sprint: 4 }))).toBe(4)
    const again = applyRollover(rolled, rolloverPlan([rolled], at(2026, 11, 3), START)[0])
    expect(again).toMatchObject({ sprint: 3, rolledFrom: [1, 2], carry: { home: 1, into: 3 } })
  })
  it('does nothing during the sprint, before the plan starts, without a start date, or after the plan ends', () => {
    expect(rolloverPlan(ts, at(2026, 10, 18, 23), START)).toEqual([])
    expect(rolloverPlan(ts, at(2026, 10, 1), START)).toEqual([])
    expect(rolloverPlan(ts, at(2026, 10, 19), '')).toEqual([])
    expect(rolloverPlan(ts, at(2036, 1, 1), START)).toEqual([])
  })
  it('after several missed sprints a card lands in the current one; rolledFrom records only the sprint it actually left', () => {
    const p = rolloverPlan([mkTicket({ id: 'a', sprint: 1, rolledFrom: [] })], at(2026, 11, 3), START)
    expect(p).toEqual([{ id: 'a', from: 1, to: 3, rolledFrom: [1], home: 1 }])
    expect(rolloverPlan([mkTicket({ id: 'z', sprint: 2, rolledFrom: [1] })], at(2026, 11, 3), START)[0].rolledFrom).toEqual([1, 2]) // rolled 1 to 2 earlier, now 2 to 3
  })
  it('is idempotent: rolled cards are already in the current sprint', () => {
    const p = rolloverPlan(ts, at(2026, 10, 19, 8), START)
    const after = ts.map(t => { const r = p.find(x => x.id === t.id); return r ? applyRollover(t, r) : t })
    expect(rolloverPlan(after, at(2026, 10, 19, 9), START)).toEqual([])
  })
  it('Today\'s note counts unfinished cards by the sprint they last rolled from', () => {
    const rolled = [
      mkTicket({ id: 'a', sprint: 2, rolledFrom: [1] }), mkTicket({ id: 'b', sprint: 2, rolledFrom: [1] }), mkTicket({ id: 'c', sprint: 2, rolledFrom: [1], status: 'done' }),
      mkTicket({ id: 'd', sprint: 3, rolledFrom: [2] }), mkTicket({ id: 'e', sprint: 2 }),
    ]
    expect(rolledNotes(rolled, 2)).toEqual([{ from: 1, count: 2 }])
    expect(rolledText({ from: 1, count: 2 })).toBe('2 cards rolled from Sprint 1')
    expect(rolledText({ from: 1, count: 1 })).toBe('1 card rolled from Sprint 1')
  })
})

describe('rebalancing', () => {
  const s = [
    mkTicket({ id: 'a', order: 1, brief: brief(60) }), mkTicket({ id: 'b', order: 2, brief: brief(60) }), mkTicket({ id: 'c', order: 3, brief: brief(60) }),
    mkTicket({ id: 'd', order: 4, brief: brief(60) }), mkTicket({ id: 'x', order: 5, sprint: 2, brief: brief(60) }),
  ]
  it('BR-11: moves the latest-ordered cards to the next sprint until it fits, listing every move', () => {
    const p = rebalanceProposal(s, 1, 120)
    expect(p).toMatchObject({ sprint: 1, to: 2, planned: 240, budget: 120, after: 120 })
    expect(p.moves.map(m => m.id)).toEqual(['d', 'c'])
    expect(p.moves[0]).toEqual({ id: 'd', title: 'd', minutes: 60 })
  })
  it('never proposes a move past the last sprint of the plan', () => {
    const last = [mkTicket({ id: 'z', sprint: 72, brief: brief(600) })]
    expect(rebalanceProposal(last, 72, 60).moves).toEqual([])
  })
  it('never proposes a pinned or Doing card, or a finished one', () => {
    const t = s.map(x => (x.id === 'd' ? { ...x, pinned: true } : x.id === 'c' ? { ...x, status: 'doing' as const } : x))
    expect(rebalanceProposal(t, 1, 120).moves.map(m => m.id)).toEqual(['b', 'a'])
    expect(rebalanceProposal(t, 1, 120).after).toBe(120)
  })
  it('proposes nothing when the sprint fits, and everything movable when nothing can make it fit', () => {
    expect(rebalanceProposal(s, 1, 240).moves).toEqual([])
    const p = rebalanceProposal(s.map(x => ({ ...x, pinned: x.id === 'a' })), 1, 30)
    expect(p.moves.map(m => m.id)).toEqual(['d', 'c', 'b'])
    expect(p.after).toBe(60)
  })
})

describe('minutesUsedToday (G4 M3)', () => {
  const now = at(2026, 10, 6, 18)
  const done = (id: string, estMin: number) => mkTicket({ id, estMin, status: 'done', doneAt: at(2026, 10, 6, 10) })
  const focus = (id: string, minutes: number, when = at(2026, 10, 6, 9)) => ({ t: 'focus' as const, id, at: when, minutes })
  it('adds finished cards with no focus today to the focus minutes', () => {
    expect(minutesUsedToday([done('a', 60)], [focus('b', 25)], now)).toBe(85)
  })
  it('a card finished with focus today counts only its focus minutes', () => {
    expect(minutesUsedToday([done('a', 60)], [focus('a', 25)], now)).toBe(25)
  })
  it('an invalid focus event (0, negative or NaN minutes) does not take its card out of the count', () => {
    for (const bad of [0, -5, NaN]) expect(minutesUsedToday([done('a', 60)], [focus('a', bad)], now)).toBe(60)
  })
  it("yesterday's focus on a card does not stop today's finish from counting", () => {
    expect(minutesUsedToday([done('a', 60)], [focus('a', 25, at(2026, 10, 5, 9))], now)).toBe(60)
  })
})

describe('rolledNote (shell-today-board A9)', () => {
  it('aggregates every card rolled into the sprint into one line from the previous sprint', async () => {
    const { rolledNote } = await import('../../src/rules/workload')
    const t = (id: string, rolledFrom: number[]) => ({ id, sprint: 21, status: 'todo', archived: false, rolledFrom }) as unknown as Parameters<typeof rolledNote>[0][number]
    expect(rolledNote([t('a', [1]), t('b', [1]), t('c', [20]), t('d', [7, 12])], 21)).toEqual({ from: 20, count: 4 })
    expect(rolledNote([], 21)).toBeNull()
  })
})

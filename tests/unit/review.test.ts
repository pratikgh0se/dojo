import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FAKE_FAIL_KEY } from '../../src/ai/fake'
import { patchSettings } from '../../src/data/db'
import { shiftPlanAction, slideNext, slideSprintAction, slideTicketTo, undoLast } from '../../src/data/boardActions'
import { applyRebalance, moveToSprint, runRollover } from '../../src/data/workloadActions'
import { buildReview } from '../../src/data/reviewActions'
import type { Session, StoredEvent } from '../../src/data/types'
import { buildReviewStats, daysText, gapRuns, isPlanItemOf, longestStreak, pctText, sprintDays } from '../../src/rules/review'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const START = '2026-10-05'
const sess = (day: number, minutes = 30, month = 10): Session => ({ id: `s${day}`, ticketId: 'a', start: at(2026, month, day, 10), end: at(2026, month, day, 11), minutes, outcome: 'solved', xpDelta: 0 })
const tick = (day: number, id = 'a'): StoredEvent => ({ t: 'tick', id, at: at(2026, 10, day), xp: 10 })

describe('helpers', () => {
  it('a sprint is 14 local days', () => {
    const d = sprintDays(1, START)
    expect(d).toHaveLength(14)
    expect([d[0], d[13]]).toEqual(['2026-10-05', '2026-10-18'])
    expect(sprintDays(2, START)[0]).toBe('2026-10-19')
  })
  it('streaks and gaps', () => {
    expect(longestStreak([])).toBe(0)
    expect(longestStreak(['2026-10-05', '2026-10-06', '2026-10-06', '2026-10-08', '2026-10-09', '2026-10-10'])).toBe(3)
    const all = sprintDays(1, START)
    expect(gapRuns(all, new Set(['2026-10-05', '2026-10-08']), '2026-10-10')).toEqual(['2026-10-06..2026-10-07', '2026-10-09..2026-10-10'])
    expect(gapRuns(all, new Set(['2026-10-05']), '2026-10-06')).toEqual(['2026-10-06'])
    expect(gapRuns(all, new Set(), '2026-10-04')).toEqual([])
  })
  it('text helpers: "1 day", "<n> days", percentages', () => {
    expect([daysText(0), daysText(1), daysText(2)]).toEqual(['0 days', '1 day', '2 days'])
    expect([pctText(null), pctText(0.5), pctText(2 / 3)]).toEqual(['no data', '50%', '67%'])
  })
})

describe('buildReviewStats', () => {
  const base = { sprint: 1, startDate: START, nowMs: at(2026, 10, 19, 8) }
  it('counts done, planned (including cards that rolled out), slipped and focus days from events and sessions', () => {
    const tickets = [
      mkTicket({ id: 'a', sprint: 1, status: 'done' }), mkTicket({ id: 'b', sprint: 1, status: 'done' }), mkTicket({ id: 'c', sprint: 1 }),
      mkTicket({ id: 'r1', title: 'Rolled once', sprint: 2, rolledFrom: [1], order: 5 }), mkTicket({ id: 'r2', title: 'Rolled twice', sprint: 3, rolledFrom: [1, 2], order: 6 }),
      mkTicket({ id: 'other', sprint: 2, plannedSprint: 2 }), mkTicket({ id: 'gone', sprint: 1, archived: true }),
      // ruling 20 S4: a split card counts once, as itself; its part is never counted
      mkTicket({ id: 'box', sprint: 1, children: ['x'] }), mkTicket({ id: 'x', sprint: 1, origin: 'box', childOf: 'box', status: 'done' }),
    ]
    const s = buildReviewStats({ ...base, tickets, sessions: [sess(6), sess(7), sess(7), sess(13, 0), sess(2, 30, 11)], events: [tick(7), tick(9), { t: 'tick', id: 'z', at: at(2026, 10, 20), xp: 1 }] })
    expect(s).toMatchObject({ sprint: 1, planned: 6, done: 2, focusDays: ['2026-10-06', '2026-10-07', '2026-10-09'], longestStreak: 2 })
    expect(s.slipped).toEqual([{ id: 'r1', title: 'Rolled once', rolled: 1 }, { id: 'r2', title: 'Rolled twice', rolled: 2 }])
    expect(s.gaps).toEqual(['2026-10-05', '2026-10-08', '2026-10-10..2026-10-18'])
  })
  // UAT cu-3 P2-2: after "Slide sprint" moved 14 of 16 cards to S2 the review read Planned 1, Done 1, Slipped 0 ("Nothing slipped").
  it('cards slid out of the sprint are slipped and still its plan items; cards slid in are an earlier sprint\'s', () => {
    const own = Array.from({ length: 16 }, (_, k) => mkTicket({ id: `c${k}`, title: `Card ${k}`, order: k, sprint: k < 2 ? 1 : 2, status: k === 0 ? 'done' : 'todo', slidFrom: k < 2 ? [] : [1] }))
    const s1 = buildReviewStats({ ...base, nowMs: at(2026, 10, 6, 9), tickets: own, sessions: [], events: [] })
    expect(s1).toMatchObject({ planned: 16, done: 1 })
    expect(s1.slipped).toHaveLength(14)
    expect(s1.slipped[0]).toEqual({ id: 'c2', title: 'Card 2', rolled: 1 })
    // Sprint 2: its own plan items are the ones it had (none here); the 14 slid in are Sprint 1's, never Sprint 2's slips
    const s2 = buildReviewStats({ ...base, sprint: 2, nowMs: at(2026, 10, 6, 9), tickets: own, sessions: [], events: [] })
    expect(s2).toMatchObject({ planned: 0, done: 0, slipped: [] })
  })
  it('a card slid on from a sprint it had itself slid into is only its plan sprint\'s item, and slipped from that one', () => {
    const t = mkTicket({ id: 'x', sprint: 3, slidFrom: [1, 2] })
    expect(isPlanItemOf(t, 1)).toBe(true)
    expect(isPlanItemOf(t, 2)).toBe(false)
    expect(isPlanItemOf(t, 3)).toBe(false)
    const s1 = buildReviewStats({ ...base, tickets: [t], sessions: [], events: [] })
    expect(s1).toMatchObject({ planned: 1, done: 0 })
    expect(s1.slipped).toEqual([{ id: 'x', title: 'x', rolled: 2 }])
    // Sprint 2 only carried it: it is not that sprint's plan item, so not that sprint's slip (ruling 25 R1: slipped is within planned)
    expect(buildReviewStats({ ...base, sprint: 2, tickets: [t], sessions: [], events: [] })).toMatchObject({ planned: 0, slipped: [] })
  })
  it('a split card is one plan item, and slips once, whichever sprint its parts sit in', () => {
    const tickets = [
      mkTicket({ id: 'box', sprint: 2, slidFrom: [1], children: ['p1', 'p2'] }),
      mkTicket({ id: 'p1', sprint: 2, slidFrom: [1], childOf: 'box', origin: 'box' }), mkTicket({ id: 'p2', sprint: 2, slidFrom: [1], childOf: 'box', origin: 'box' }),
      mkTicket({ id: 'stay', sprint: 1, status: 'done' }),
    ]
    const s = buildReviewStats({ ...base, tickets, sessions: [], events: [] })
    expect(s).toMatchObject({ planned: 2, done: 1 })
    expect(s.slipped.map(x => x.id)).toEqual(['box'])
  })
  // UAT cu-3p P2-3, ruling 25 R1: a plan item of N that is not done and now sits in a later sprint slipped from N, however it got there
  it('R1: a card moved by hand, or by Shift plan, with no mark on it, slipped; one pulled into an earlier sprint did not; a done one did not', () => {
    const tickets = [
      mkTicket({ id: 'moved', sprint: 3, order: 1 }), // Move to sprint… / a rebalance / Shift plan write no slidFrom
      mkTicket({ id: 'shifted', sprint: 2, order: 2 }),
      mkTicket({ id: 'stay', sprint: 1, order: 3 }),
      mkTicket({ id: 'finished', sprint: 1, status: 'done', order: 4 }),
      mkTicket({ id: 'pulled', sprint: 1, plannedSprint: 3, order: 5 }), // Sprint 3's item, pulled into Sprint 1: not Sprint 1's, not a slip
    ]
    const s1 = buildReviewStats({ ...base, tickets, sessions: [], events: [] })
    expect(s1).toMatchObject({ planned: 4, done: 1 })
    expect(s1.slipped).toEqual([{ id: 'moved', title: 'moved', rolled: 1 }, { id: 'shifted', title: 'shifted', rolled: 1 }])
    // Sprint 3's review: its own card sits earlier, so it is open, not slipped
    expect(buildReviewStats({ ...base, sprint: 3, tickets, sessions: [], events: [] })).toMatchObject({ planned: 1, done: 0, slipped: [] })
    // pulled forward and done: the plan sprint's work, not a slip
    expect(buildReviewStats({ ...base, sprint: 3, tickets: tickets.map(t => (t.id === 'pulled' ? { ...t, status: 'done' as const } : t)), sessions: [], events: [] })).toMatchObject({ planned: 1, done: 1, slipped: [] })
  })
  it('a card done after it slid on is neither slipped nor done in the sprint it left', () => {
    const t = mkTicket({ id: 'late', sprint: 2, slidFrom: [1], status: 'done' })
    expect(buildReviewStats({ ...base, tickets: [t], sessions: [], events: [] })).toMatchObject({ planned: 1, done: 0, slipped: [] })
  })
  it('redo and check pass rates come from the events inside the sprint; null without data', () => {
    const ev: StoredEvent[] = [
      { t: 'redo_pass', id: 'a', at: at(2026, 10, 8), stage: 0, refund: 1 }, { t: 'redo_fail', id: 'b', at: at(2026, 10, 9), stage: 0, refund: 0 },
      { t: 'redo_pass', id: 'c', at: at(2026, 10, 25), stage: 0, refund: 1 },
      { t: 'check', id: 'a', at: at(2026, 10, 8), passed: true }, { t: 'check', id: 'a', at: at(2026, 10, 9), passed: true }, { t: 'check', id: 'b', at: at(2026, 10, 9), passed: false },
    ]
    const s = buildReviewStats({ ...base, tickets: [], sessions: [], events: ev })
    expect(s.redoPassRate).toBe(0.5)
    expect(s.checkPassRate).toBeCloseTo(2 / 3)
    const none = buildReviewStats({ ...base, tickets: [], sessions: [], events: [] })
    expect([none.redoPassRate, none.checkPassRate, none.planned, none.done]).toEqual([null, null, 0, 0])
  })
  it('gaps only cover days that have begun in the current sprint', () => {
    const s = buildReviewStats({ ...base, nowMs: at(2026, 10, 8, 9), tickets: [], sessions: [sess(5)], events: [] })
    expect(s.gaps).toEqual(['2026-10-06..2026-10-08'])
  })
})

const failHook = (v: string | null) => { if (v === null) localStorage.removeItem(FAKE_FAIL_KEY); else localStorage.setItem(FAKE_FAIL_KEY, v) }
describe('buildReview', () => {
  beforeEach(() => failHook(null))
  afterEach(() => failHook(null))
  async function db() {
    const d = freshDb()
    await patchSettings(d, { startDate: START })
    await d.tickets.bulkPut([mkTicket({ id: 'a', sprint: 1, status: 'done' }), mkTicket({ id: 'b', sprint: 1 })])
    return d
  }
  it('BR-13: stores the numbers and the fake prose "Review for Sprint N: <done>/<planned> cards done."', async () => {
    const d = await db()
    const r = await buildReview(d, 1, at(2026, 10, 10))
    expect(r.ok && r.review).toMatchObject({ sprint: 1, prose: 'Review for Sprint 1: 1/2 cards done.', provider: 'fake', stats: { planned: 2, done: 1 } })
    expect(await d.reviews.count()).toBe(1)
    expect(await d.aiLog.where('job').equals('review_sprint').count()).toBe(1)
  })
  it('UAT cu-3 P2-2: after Slide sprint the stored review counts the slid cards as slipped', async () => {
    const d = freshDb()
    await patchSettings(d, { startDate: START })
    await d.tickets.bulkPut([
      mkTicket({ id: 'a', title: 'Done card', sprint: 1, status: 'done', order: 1 }),
      ...Array.from({ length: 14 }, (_, k) => mkTicket({ id: `u${k}`, title: `Open ${k}`, sprint: 1, order: 10 + k })),
    ])
    const slid = await slideSprintAction(d, 1, at(2026, 10, 6), 1)
    expect(slid).toMatchObject({ ok: true, count: 14 })
    const r = await buildReview(d, 1, at(2026, 10, 6, 15))
    expect(r.ok && r.review.stats).toMatchObject({ planned: 15, done: 1 })
    expect(r.ok && r.review.stats.slipped).toHaveLength(14)
    expect(r.ok && r.review.prose).toBe('Review for Sprint 1: 1/15 cards done.')
  })
  it('an AI failure stores nothing; no start date is refused first', async () => {
    const d = await db()
    failHook('review_sprint')
    expect(await buildReview(d, 1, at(2026, 10, 10))).toEqual({ ok: false, code: 'claude_failed', error: 'fake review_sprint unavailable' })
    expect(await d.reviews.count()).toBe(0)
    expect(await buildReview(freshDb(), 1, 0)).toEqual({ ok: false, code: 'no_start', error: 'Set a start date first' })
  })
})

// UAT cu-3p P2-3 / ruling 25 R1: every route a card can leave a sprint by, through the real actions, then the review's numbers.
describe('R1 · slipped by every route, undone moves not at all', () => {
  const NOW = at(2026, 10, 6)
  const CUR = 1
  const ID = (n: number) => `c${n}`
  async function sprint1() {
    const d = freshDb()
    await patchSettings(d, { startDate: START, trackedFrom: 1 })
    await d.tickets.bulkPut([
      ...Array.from({ length: 8 }, (_, k) => mkTicket({ id: ID(k), title: `Card ${k}`, order: k, sprint: 1 })),
      mkTicket({ id: 'done', title: 'Done card', order: 20, sprint: 1, status: 'done' }),
      mkTicket({ id: 'next', title: 'Sprint 2 own', order: 30, sprint: 2, plannedSprint: 2 }),
    ])
    return d
  }
  const stats = async (d: Awaited<ReturnType<typeof sprint1>>, sprint = 1) =>
    buildReviewStats({ sprint, startDate: START, nowMs: NOW + 1000, tickets: await d.tickets.toArray(), sessions: [], events: await d.events.toArray() })
  const slippedIds = async (d: Awaited<ReturnType<typeof sprint1>>) => (await stats(d)).slipped.map(x => x.id)

  it('nothing moved: planned 9 (the sprint\'s own), done 1, slipped 0', async () => {
    const d = await sprint1()
    expect(await stats(d)).toMatchObject({ planned: 9, done: 1, slipped: [] })
  })

  it('Move to sprint…', async () => {
    const d = await sprint1()
    expect(await moveToSprint(d, ID(0), 4, NOW)).toMatchObject({ ok: true })
    expect(await moveToSprint(d, ID(1), 2, NOW + 1)).toMatchObject({ ok: true })
    expect(await stats(d)).toMatchObject({ planned: 9, done: 1 })
    expect(await slippedIds(d)).toEqual([ID(0), ID(1)])
  })

  it('a rebalance', async () => {
    const d = await sprint1()
    expect(await applyRebalance(d, [ID(6), ID(7)], 1, 2, NOW)).toMatchObject({ ok: true, count: 2 })
    expect(await slippedIds(d)).toEqual([ID(6), ID(7)])
  })

  it('Shift plan', async () => {
    const d = await sprint1()
    expect(await shiftPlanAction(d, 1, NOW, CUR)).toMatchObject({ ok: true })
    const s = await stats(d)
    expect(s).toMatchObject({ planned: 9, done: 1 })
    expect(s.slipped).toHaveLength(8) // the finished card stays, every open one moved on
    // the card that was Sprint 2's own is Sprint 2's slip now (it moved to 3), never Sprint 1's
    expect(await slippedIds(d)).not.toContain('next')
    expect((await stats(d, 2)).slipped.map(x => x.id)).toEqual(['next'])
  })

  it('Slide ›', async () => {
    const d = await sprint1()
    expect(await slideNext(d, ID(2), NOW, CUR)).toMatchObject({ ok: true })
    expect(await slideTicketTo(d, ID(3), 5, NOW + 1, CUR)).toMatchObject({ ok: true })
    expect(await slippedIds(d)).toEqual([ID(2), ID(3)])
  })

  it('Slide sprint', async () => {
    const d = await sprint1()
    expect(await slideSprintAction(d, 1, NOW, CUR)).toMatchObject({ ok: true, count: 8 })
    const s = await stats(d)
    expect(s).toMatchObject({ planned: 9, done: 1 })
    expect(s.slipped).toHaveLength(8)
    // Sprint 2 holds the eight and its own: it plans one, and slips none of the slid-in ones
    expect(await stats(d, 2)).toMatchObject({ planned: 1, slipped: [] })
  })

  it('the roll-over of an ended sprint', async () => {
    const d = await sprint1()
    expect(await runRollover(d, at(2026, 10, 20))).toBe(8) // Sprint 2 has begun: Sprint 1's open cards roll into it
    expect(await slippedIds(d)).toHaveLength(8)
    expect(await stats(d)).toMatchObject({ planned: 9, done: 1 })
  })

  it('every route together, and each one undone leaves it as it was', async () => {
    const d = await sprint1()
    await moveToSprint(d, ID(0), 4, NOW)
    await slideNext(d, ID(2), NOW + 1, CUR)
    await shiftPlanAction(d, 1, NOW + 2, CUR)
    await slideSprintAction(d, 1, NOW + 3, CUR) // nothing open is left in Sprint 1: refused, no step
    expect((await slippedIds(d)).length).toBe(8)
    // Undo, newest first: the Shift plan, then the slide, then the move
    expect(await undoLast(d, NOW + 10)).toMatchObject({ ok: true })
    expect((await slippedIds(d)).sort()).toEqual([ID(0), ID(2)].sort())
    expect(await undoLast(d, NOW + 11)).toMatchObject({ ok: true })
    expect(await slippedIds(d)).toEqual([ID(0)])
    expect(await undoLast(d, NOW + 12)).toMatchObject({ ok: true })
    expect(await stats(d)).toMatchObject({ planned: 9, done: 1, slipped: [] })
  })

  it('a slide sprint, undone: nothing slipped, as before it', async () => {
    const d = await sprint1()
    await slideSprintAction(d, 1, NOW, CUR)
    expect((await stats(d)).slipped).toHaveLength(8)
    await undoLast(d, NOW + 1)
    expect(await stats(d)).toMatchObject({ planned: 9, done: 1, slipped: [] })
  })
})

// Ruling 20 S4 (UAT r4 P1): once a card is split, time counts the open parts and every problem and progress count
// counts the parent once, when all its parts are done.
import { describe, expect, it } from 'vitest'
import { splitTicket } from '../../src/rules/split'
import { dsaEvidence, helpLadderUsage } from '../../src/rules/evidence'
import { outcomesBySprint, rings } from '../../src/rules/progress'
import { itemSessions } from '../../src/rules/units'
import { buildReviewStats } from '../../src/rules/review'
import { carrotHp, milestoneBadges, sprintTasks } from '../../src/rules/vitals'
import { healthStats, loadCheck } from '../../src/rules/load'
import { skillProgress } from '../../src/rules/map'
import { totalXp } from '../../src/rules/xp'
import { plannedMinutes } from '../../src/rules/workload'
import { parseLocalDate } from '../../src/lib/dates'
import type { Session, Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const START = '2026-10-05'
const T0 = parseLocalDate(START) + 20 * 3600_000

const sess = (id: string, ticketId: string, at: number, outcome: Session['outcome'], rungs?: Session['rungs']): Session => ({
  id, ticketId, start: at, end: at + 600_000, minutes: 10, outcome, xpDelta: 0, ...(rungs ? { rungs } : {}),
})

function splitProblem(done: boolean[]): Ticket[] {
  const p200 = mkTicket({ id: 'p200', kind: 'problem', track: 'interview', difficulty: 'M', estMin: 35, title: '200 · Number of Islands', skill: 'graphs' })
  const r = splitTicket(p200, done.length)
  const kids = r.children.map((c, i) => (done[i] ? { ...c, status: 'done' as const, doneAt: T0 + i, xp: c.xpBase ?? 0 } : c))
  const parent = done.every(Boolean) ? { ...r.parent, status: 'done' as const, doneAt: T0 + 9 } : r.parent
  return [parent, ...kids]
}

describe('ruling 20 S4: item counts after a split', () => {
  it('Evidence counts a split problem once, as solved without help, only when every part is done', () => {
    const all = splitProblem([true, true, true])
    const sessions = all.filter(t => t.childOf).map((t, i) => sess(`s${i}`, t.id, T0 + i * 1000, 'solved'))
    expect(dsaEvidence(all, sessions, [])).toMatchObject({ solved: 1, help: 0, gaveUp: 0 })
    // two parts done, one open: nothing counted yet
    const open = splitProblem([true, true, false])
    expect(dsaEvidence(open, sessions.slice(0, 2), [])).toMatchObject({ solved: 0, help: 0, gaveUp: 0 })
  })

  it('help on any part makes the problem solved with help (once); its rungs are the union', () => {
    const all = splitProblem([true, true, true])
    const kids = all.filter(t => t.childOf)
    const sessions = [sess('a', kids[0].id, T0, 'solved'), sess('b', kids[1].id, T0 + 1000, 'solved_help', [2]), sess('c', kids[2].id, T0 + 2000, 'solved')]
    expect(dsaEvidence(all, sessions, [])).toMatchObject({ solved: 0, help: 1 })
    const items = itemSessions(sessions, all)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ ticketId: 'p200', outcome: 'solved_help', rungs: [2], minutes: 30 })
    expect(helpLadderUsage(items, START)[0].counts).toEqual([0, 1, 0, 0, 0])
  })

  it('the sprint-by-sprint outcomes count the parent once', () => {
    const all = splitProblem([true, true, true])
    const sessions = all.filter(t => t.childOf).map((t, i) => sess(`s${i}`, t.id, T0 + i * 1000, 'solved'))
    expect(outcomesBySprint(sessions, START)[0]).toMatchObject({ solved: 3 }) // raw sessions: the old bug
    expect(outcomesBySprint(itemSessions(sessions, all), START)).toEqual([{ sprint: 1, solved: 1, solved_help: 0, gave_up: 0 }])
  })

  it('ALL, DSA and Interview n/total count the parent once; XP sums to the parent base (BR-19)', () => {
    const all = splitProblem([true, true, true])
    const r = rings(all)
    expect(r.all).toEqual({ done: 1, total: 1 })
    expect(r.dsa).toEqual({ done: 1, total: 1 })
    expect(totalXp(all)).toBe(10)
    expect(rings(splitProblem([true, false, false])).dsa).toEqual({ done: 0, total: 1 })
  })

  it('the sprint review counts plan items: the split card once', () => {
    const all = splitProblem([true, true, true])
    const stats = buildReviewStats({ sprint: 1, startDate: START, nowMs: T0 + 5000, tickets: all, sessions: [], events: [] })
    expect(stats).toMatchObject({ planned: 1, done: 1 })
    const open = buildReviewStats({ sprint: 1, startDate: START, nowMs: T0 + 5000, tickets: splitProblem([true, false]), sessions: [], events: [] })
    expect(open).toMatchObject({ planned: 1, done: 0 })
  })

  it('skill progress counts the split card once', () => {
    const all = splitProblem([true, false, false])
    expect(skillProgress([{ id: 'graphs' } as never], all).graphs).toMatchObject({ done: 0, total: 1 })
  })

  it('Carrot HP, This sprint n/m and the badges count a split task once; minutes count its open parts', () => {
    const big = mkTicket({ id: 'big', kind: 'stage', session: 'rebuild', stage: 0, estMin: 90, order: 1 })
    const other = mkTicket({ id: 'small', kind: 'task', estMin: 30, order: 2 })
    const r = splitTicket(big, 3)
    const kids = [{ ...r.children[0], status: 'done' as const }, r.children[1], r.children[2]]
    const all = [r.parent, ...kids, other]
    expect(sprintTasks(all, 1).map(t => t.id)).toEqual(['big', 'small'])
    expect(carrotHp(all, 1)).toEqual({ max: 2, left: 2 })
    expect(healthStats(all, 1)[1]).toMatchObject({ label: 'This sprint', value: '0/2' })
    expect(loadCheck(all, 1, 1).due).toBe(2)
    expect(milestoneBadges(all).find(b => b.glyph === '½')?.hint).toBe('Halfway · 1 task')
    expect(plannedMinutes(all, 1)).toBe(30 + 30 + 30) // the two open parts and the other card
  })
})

describe('ruling 20 S4: the Board lists a split card as an uncounted group line by its parts', () => {
  it('the group line sits in the column of the first open part, then Done; columns count only cards', async () => {
    const { boardColumns, countedCards, groupLineText } = await import('../../src/rules/board')
    const p200 = mkTicket({ id: 'p200', kind: 'problem', estMin: 35, title: '200 · Number of Islands', status: 'doing', order: 1 })
    const r = splitTicket(p200, 3)
    const other = mkTicket({ id: 'x', order: 5 })
    let all = [r.parent, ...r.children, other]
    let cols = boardColumns(all, 1)
    expect(cols.todo.map(t => t.id)).toEqual(['p200', 'p200~1', 'p200~2', 'p200~3', 'x'])
    expect(cols.doing).toEqual([])
    expect(countedCards(cols.todo)).toHaveLength(4)
    expect(groupLineText(r.parent, all)).toBe('200 · Number of Islands · split · 0 of 3 done')
    all = all.map(t => (t.childOf ? { ...t, status: 'done' as const } : t.id === 'p200' ? { ...t, status: 'done' as const } : t))
    cols = boardColumns(all, 1)
    expect(cols.done.map(t => t.id)).toEqual(['p200', 'p200~1', 'p200~2', 'p200~3'])
    expect(countedCards(cols.done)).toHaveLength(3)
    expect(groupLineText(r.parent, all)).toBe('200 · Number of Islands · split · 3 of 3 done')
  })
})

// UAT cu-r1b F-B2 (reverses cu-3 P3-5): every Board header counts the cards listed under it, a done part included.
describe('ruling 20 S4: a Board header counts the cards listed in its column', () => {
  it('Done counts a part moved into it, and Todo the parts left; the group line never counts', async () => {
    const { boardColumns, columnCount } = await import('../../src/rules/board')
    const other = mkTicket({ id: 'x', order: 5, status: 'done', doneAt: T0 })
    const counts = (all: Ticket[]) => {
      const cols = boardColumns(all, 1)
      return { todo: columnCount('todo', cols.todo), doing: columnCount('doing', cols.doing), done: columnCount('done', cols.done) }
    }
    expect(counts([...splitProblem([true, false, false]), other])).toEqual({ todo: 2, doing: 0, done: 2 })
    expect(counts([...splitProblem([true, true, false]), other])).toEqual({ todo: 1, doing: 0, done: 3 })
    expect(counts([...splitProblem([true, true, true]), other])).toEqual({ todo: 0, doing: 0, done: 4 })
  })

  it('the Doing limit counts the cards shown in Doing: a split parent is no extra card (cu-r1b F-B4)', async () => {
    const { canMove, doingCount } = await import('../../src/rules/board')
    const all = splitProblem([false, false, false]).map(t => (t.id === 'p200' || t.id === 'p200~2' ? { ...t, status: 'doing' as const } : t))
    const rebuild = mkTicket({ id: 'rb', order: 6, status: 'doing' })
    const t1 = mkTicket({ id: 't1', order: 7 })
    const t2 = mkTicket({ id: 't2', order: 8 })
    const board = [...all, rebuild, t1, t2]
    expect(doingCount(board, 1)).toBe(2)
    expect(canMove(board, 't1', 'doing')).toEqual({ ok: true })
    const three = board.map(t => (t.id === 't1' ? { ...t, status: 'doing' as const } : t))
    expect(canMove(three, 't2', 'doing')).toEqual({ ok: false, reason: 'doing_full' })
  })

  it('Week "n done" and Progress ALL n/total still count the problem once', async () => {
    const { weekTiles } = await import('../../src/rules/week')
    const other = mkTicket({ id: 'x', order: 5, status: 'done', doneAt: T0, kind: 'problem', track: 'interview' })
    const all = [...splitProblem([true, true, true]), other]
    const { smallPlan } = await import('../helpers/plan')
    const week = weekTiles(T0, START, smallPlan.rotation, all, [], 72).reduce((a, t) => a + t.done, 0)
    expect([week, rings(all).all.done]).toEqual([2, 2])
  })
})

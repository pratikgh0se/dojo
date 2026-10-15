import { describe, expect, it } from 'vitest'
import { dailyMix, isQueued, nextAction } from '../../src/rules/dayMix'
import { laneChips, moveInLane, queueView, todayPickList } from '../../src/rules/queue'
import { STATUS_RANK } from '../../src/rules/reconcile'
import { nodeState } from '../../src/rules/skillTree'
import { nextTicketOf } from '../../src/rules/skillView'
import type { PlanPhase } from '../../src/data/planV2'
import type { Lane, Ticket } from '../../src/data/types'
import { reconcilePlan } from '../../src/rules/reconcile'
import { newTicket, planToTickets } from '../../src/rules/planTickets'
import { flatPlanV2 } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const BUDGETS = [90, 60, 60, 60, 30, 30, 150]
const WED = new Date(2026, 10, 4, 10, 0)
const phases: PlanPhase[] = [{ p: 1, name: 'A', months: '', idea: '', authored: true }]
const tk = (id: string, lane: Lane, order: number, extra: Partial<Ticket> = {}): Ticket =>
  mkTicket({ id, lane, order, title: id, estMin: 30, track: lane === 'path' ? 'ai' : 'interview', kind: lane === 'dsa' ? 'problem' : 'build', ...extra })
const ids = (ts: Ticket[]) => ts.map(t => t.id)

describe('status order and the queued ticket (README Data fields, BOARD)', () => {
  it('ranks todo < doing < blocked = help < done', () => {
    expect(STATUS_RANK.todo).toBeLessThan(STATUS_RANK.doing)
    expect(STATUS_RANK.doing).toBeLessThan(STATUS_RANK.blocked)
    expect(STATUS_RANK.blocked).toBe(STATUS_RANK.help)
    expect(STATUS_RANK.help).toBeLessThan(STATUS_RANK.done)
  })
  it('only a non-archived todo ticket is queued; doing, blocked, help, done and archived are not', () => {
    expect(isQueued(tk('a', 'path', 1))).toBe(true)
    for (const status of ['doing', 'blocked', 'help', 'done'] as const) expect(isQueued(tk('a', 'path', 1, { status }))).toBe(false)
    expect(isQueued(tk('a', 'path', 1, { archived: true }))).toBe(false)
  })
})

describe('Today skips blocked and need-help tickets (TODAY-09, TODAY-16, TODAY-21, BOARD-38 to BOARD-40)', () => {
  const base = [tk('b1', 'path', 1, { status: 'blocked', blockedNote: 'Waiting' }), tk('h1', 'path', 2, { status: 'help' }), tk('p3', 'path', 3), tk('d1', 'dsa', 4)]
  const act = (t: Ticket[]) => nextAction({ tickets: t, date: WED, budgets: BUDGETS, careerLane: false, dueReviews: 0, phases })

  it('the quest is the first todo ticket of its lane, never a blocked or help one', () => {
    const r = act(base)
    expect(r.kind).toBe('start')
    expect(r.kind === 'start' && r.ticket.id).toBe('p3')
  })
  it('a blocked ticket never blocks the lane behind it in the day mix', () => {
    const m = dailyMix({ tickets: base, date: WED, budgets: BUDGETS, careerLane: false })
    expect(ids(m.items)).toEqual(['p3', 'd1'])
    expect(m.lanesDone).toEqual(['design']) // the lane with no ticket at all; path keeps a blocked one
  })
  it('a doing ticket still resumes; a blocked one does not', () => {
    const r = act([...base, tk('x', 'dsa', 5, { status: 'doing' })])
    expect(r.kind === 'resume' && r.ticket.id).toBe('x')
    expect(act([tk('b1', 'path', 1, { status: 'blocked' }), tk('p3', 'path', 3)]).kind).toBe('start')
  })
  it('only blocked and help tickets left: wait, and the reason names them (TODAY-21)', () => {
    const r = act([tk('b1', 'path', 1, { status: 'blocked' }), tk('h1', 'dsa', 2, { status: 'help' }), tk('done', 'dsa', 3, { status: 'done' })])
    expect(r).toMatchObject({ kind: 'wait', ticket: null })
    expect(r.reason).toMatch(/blocked/)
    expect(r.reason.length).toBeLessThanOrEqual(120)
  })
  it('nothing open at all keeps its old reason', () => {
    expect(act([tk('done', 'dsa', 3, { status: 'done' })]).reason).toBe('every ticket in your queue is done')
  })
  it('the pick list holds todo tickets only; started tickets come first in their own group', () => {
    const p = todayPickList({ tickets: [...base, tk('x', 'dsa', 5, { status: 'doing' })], careerLane: false })
    expect(ids(p.doing)).toEqual(['x'])
    expect(p.lanes.flatMap(l => ids(l.items))).toEqual(['p3', 'd1'])
  })
})

describe('Path (PATH-03, PATH-32)', () => {
  const all = [
    tk('p1', 'path', 1), tk('p2', 'path', 2, { status: 'blocked', blockedNote: 'x' }), tk('p3', 'path', 3),
    tk('d1', 'dsa', 4, { status: 'help' }), tk('d2', 'dsa', 5), tk('g1', 'design', 6, { status: 'blocked' }), tk('g0', 'design', 0.5, { status: 'doing' }),
  ]
  it('Up next lists todo tickets only and counts the rest from them', () => {
    const v = queueView({ tickets: all, careerLane: false, perLane: 1 })
    expect(v.upNext.map(l => ids(l.items))).toEqual([['p1'], ['d2'], []])
    expect(v.upNext.map(l => l.more)).toEqual([1, 0, 0])
    expect(v.moreTotal).toBe(1)
  })
  it('the Blocked and need help group holds blocked and help tickets in lane blocks, effective order inside', () => {
    expect(ids(queueView({ tickets: all, careerLane: false }).blocked)).toEqual(['p2', 'd1', 'g1'])
    expect(ids(queueView({ tickets: all, careerLane: false, lane: 'dsa' }).blocked)).toEqual(['d1'])
    expect(ids(queueView({ tickets: all, careerLane: false, search: 'g1' }).blocked)).toEqual(['g1'])
  })
  it('the group is empty when nothing is blocked; the doing group is unchanged', () => {
    const v = queueView({ tickets: [tk('a', 'path', 1, { status: 'doing' })], careerLane: false })
    expect(v.blocked).toEqual([])
    expect(ids(v.doing)).toEqual(['a'])
  })
  it('chip counts include blocked and help tickets (they are open)', () => {
    const chips = laneChips({ tickets: all, careerLane: false, phases })
    expect(chips.map(c => [c.lane, c.open])).toEqual([['all', 7], ['path', 3], ['dsa', 2], ['design', 2]])
  })
  it('a blocked or help ticket cannot be reordered, and does not count as a neighbour', () => {
    expect(moveInLane(all, 'p2', 0)).toEqual([])
    expect(moveInLane(all, 'd1', 0)).toEqual([])
    const patches = moveInLane([tk('a', 'path', 1), tk('b', 'path', 2, { status: 'blocked' }), tk('c', 'path', 3)], 'c', 0)
    expect(patches).toHaveLength(1)
    expect(patches[0].orderOverride).toBeLessThan(1)
  })
})

describe('Skills treat blocked and help as not started (BOARD-42)', () => {
  const node = { id: 'n', area: 'a', pre: [] as string[] } as never
  const plan = { nodes: [node] } as never
  it('a node whose only open tickets are blocked or help is available, not inprog', () => {
    const ts = [tk('a', 'path', 1, { node: 'n', status: 'blocked' }), tk('b', 'path', 2, { node: 'n', status: 'help' })]
    expect(nodeState(node, plan, ts, null)).toBe('available')
  })
  it('one done ticket and a blocked one is inprog; a doing one alone is inprog', () => {
    expect(nodeState(node, plan, [tk('a', 'path', 1, { node: 'n', status: 'done' }), tk('b', 'path', 2, { node: 'n', status: 'blocked' })], null)).toBe('inprog')
    expect(nodeState(node, plan, [tk('a', 'path', 1, { node: 'n', status: 'doing' })], null)).toBe('inprog')
  })
  it('the node start ticket is the first todo or doing ticket, never a blocked or help one', () => {
    const ts = [tk('a', 'path', 1, { node: 'n', status: 'blocked' }), tk('b', 'path', 2, { node: 'n', status: 'help' }), tk('c', 'path', 3, { node: 'n' })]
    expect(nextTicketOf('n', ts)?.id).toBe('c')
    expect(nextTicketOf('n', ts.slice(0, 2))).toBeNull()
  })
})

describe('a plan refresh keeps the statuses (BOARD-51, BOARD-52)', () => {
  const content = planToTickets(flatPlanV2)
  it('a blocked ticket keeps its status and reason, a need-help ticket its status, when the plan content changes', () => {
    const existing = content.map(newTicket)
    existing[0] = { ...existing[0], status: 'blocked', blockedNote: 'Waiting for GPU quota', orderOverride: 3 }
    existing[1] = { ...existing[1], status: 'help' }
    const changed = content.map((c, i) => (i < 3 ? { ...c, order: c.order + 100 } : c))
    const r = reconcilePlan(existing, changed, {})
    const byId = new Map(r.puts.map(t => [t.id, t]))
    expect(byId.get(content[0].id)).toMatchObject({ status: 'blocked', blockedNote: 'Waiting for GPU quota', orderOverride: 3, order: content[0].order + 100 })
    expect(byId.get(content[1].id)!.status).toBe('help')
    expect(byId.get(content[1].id)!.blockedNote).toBeUndefined()
  })
  it('a rename merge lifts a todo target to the blocked status and brings the reason along; a done row still wins', () => {
    const target = newTicket(content[0])
    const old = { ...newTicket(content[1]), id: 'old-id', status: 'blocked' as const, blockedNote: 'Waiting' }
    const r = reconcilePlan([target, old], [content[0]], { 'old-id': content[0].id })
    expect(r.puts.find(t => t.id === content[0].id)).toMatchObject({ status: 'blocked', blockedNote: 'Waiting' })
    const done = { ...old, status: 'done' as const, doneAt: 5, xp: 10 }
    const r2 = reconcilePlan([{ ...target, status: 'help' as const, blockedNote: 'x' }, done], [content[0]], { 'old-id': content[0].id })
    const merged = r2.puts.find(t => t.id === content[0].id)!
    expect(merged.status).toBe('done')
    expect('blockedNote' in merged).toBe(false)
  })
})

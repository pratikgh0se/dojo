import { describe, expect, it } from 'vitest'
import { laneChips, moveInLane, queueView, tagLane, todayPickList, DOING_SOFT_CAP } from '../../src/rules/queue'
import { effectiveOrder } from '../../src/rules/dayMix'
import type { PlanPhase } from '../../src/data/planV2'
import type { Lane, Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const tk = (id: string, lane: Lane, order: number, extra: Partial<Ticket> = {}): Ticket =>
  mkTicket({ id, lane, order, title: id, estMin: 30, track: lane === 'path' ? 'ai' : 'interview', kind: lane === 'dsa' ? 'problem' : 'build', ...extra })
const ids = (ts: Ticket[]) => ts.map(t => t.id)
const lane = (n: number, l: Lane, p: string) => Array.from({ length: n }, (_, i) => tk(`${p}${i + 1}`, l, i + 1))
const phases = (authored2: boolean): PlanPhase[] => [
  { p: 1, name: 'A', months: '', idea: '', authored: true }, { p: 2, name: 'B', months: '', idea: '', authored: authored2 },
]

describe('tagLane', () => {
  it('a bank ticket is tagged dsa; every other lane is unchanged (PATH-06)', () => {
    expect(tagLane(tk('b', 'dsa', 1, { origin: 'bank:blind75' }))).toBe('dsa')
    expect(['path', 'dsa', 'design', 'career'].map(l => tagLane(tk('x', l as Lane, 1)))).toEqual(['path', 'dsa', 'design', 'career'])
  })
})

describe('queueView', () => {
  const all = [...lane(25, 'path', 'p'), ...lane(25, 'dsa', 'd'), ...lane(25, 'design', 'g')]

  it('Up next is each lane in effective order, 10 rows and a count of the rest (PATH-03, PATH-14)', () => {
    const v = queueView({ tickets: all, careerLane: false })
    expect(v.upNext.map(l => l.lane)).toEqual(['path', 'dsa', 'design'])
    expect(v.upNext.every(l => l.items.length === 10 && l.more === 15 && l.total === 25)).toBe(true)
    expect(v.moreTotal).toBe(45)
    expect(ids(v.upNext[0].items)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'])
  })

  it('perLane 20 shows ten more per lane (PATH-15)', () => {
    const v = queueView({ tickets: all, careerLane: false, perLane: 20 })
    expect(v.upNext[1].items).toHaveLength(20)
    expect(v.upNext[1].more).toBe(5)
  })

  it('overrides decide the position (PATH-04); Doing, Done and archived never appear in Up next', () => {
    const t = [
      tk('a', 'dsa', 1), tk('b', 'dsa', 2), tk('c', 'dsa', 3, { orderOverride: 0.5 }),
      tk('doing', 'dsa', 0, { status: 'doing' }), tk('done', 'dsa', 0, { status: 'done', doneAt: 5 }), tk('gone', 'dsa', 0, { archived: true }),
    ]
    const v = queueView({ tickets: t, careerLane: false })
    expect(ids(v.upNext.find(l => l.lane === 'dsa')!.items)).toEqual(['c', 'a', 'b'])
    expect(ids(v.doing)).toEqual(['doing'])
    expect(ids(v.done)).toEqual(['done'])
  })

  it('an archived ticket that is still marked doing is hidden everywhere (Review Focus 1)', () => {
    const t = [tk('x', 'path', 1, { status: 'doing', archived: true })]
    const v = queueView({ tickets: t, careerLane: false })
    expect(v.doing).toEqual([])
    expect(v.doingCount).toBe(0)
    expect(v.doingOverCap).toBe(false)
    expect(v.upNext.flatMap(l => ids(l.items))).toEqual([])
    expect(v.moreTotal).toBe(0)
    expect(v.done).toEqual([])
    const pick = todayPickList({ tickets: t, careerLane: false })
    expect(pick.doing).toEqual([])
    expect(pick.lanes.flatMap(l => ids(l.items))).toEqual([])
  })

  it('Doing is in effective order and the soft cap warns above three but never blocks (PATH-18)', () => {
    const d = ['a', 'b', 'c', 'e'].map((id, i) => tk(id, 'path', 4 - i, { status: 'doing' }))
    const v = queueView({ tickets: d, careerLane: false })
    expect(ids(v.doing)).toEqual(['e', 'c', 'b', 'a'])
    expect(DOING_SOFT_CAP).toBe(3)
    expect(v.doingOverCap).toBe(true)
    expect(queueView({ tickets: d.slice(0, 3), careerLane: false }).doingOverCap).toBe(false)
  })

  it('equal effective order falls back to the id, whatever the input order', () => {
    const t = [tk('b', 'dsa', 1), tk('c', 'dsa', 1), tk('a', 'dsa', 1)]
    expect(ids(queueView({ tickets: t, careerLane: false }).upNext[1].items)).toEqual(['a', 'b', 'c'])
    const mixed = [tk('y', 'dsa', 5), tk('x', 'dsa', 9, { orderOverride: 5 })]
    expect(ids(queueView({ tickets: mixed, careerLane: false }).upNext[1].items)).toEqual(['x', 'y'])
  })

  it('Done lists the most recently finished first (PATH-23)', () => {
    const t = [tk('old', 'dsa', 1, { status: 'done', doneAt: 10 }), tk('new', 'path', 2, { status: 'done', doneAt: 99 }), tk('mine', 'dsa', 3, { status: 'done', doneAt: 50, origin: 'mine' })]
    expect(ids(queueView({ tickets: t, careerLane: false }).done)).toEqual(['new', 'mine', 'old'])
  })

  it('a lane filter narrows Doing, Up next and Done; a done bank ticket counts as DSA (PATH-06, README Lane tag)', () => {
    const t = [tk('p1', 'path', 1), tk('d1', 'dsa', 2), tk('dd', 'dsa', 3, { status: 'done', doneAt: 1 }), tk('pd', 'path', 4, { status: 'done', doneAt: 2 }), tk('bank', 'dsa', 5, { status: 'done', doneAt: 3, origin: 'bank:blind75' })]
    const v = queueView({ tickets: t, careerLane: false, lane: 'dsa' })
    expect(v.upNext.map(l => l.lane)).toEqual(['dsa'])
    expect(ids(v.done)).toEqual(['bank', 'dd'])
    expect(ids(queueView({ tickets: t, careerLane: false, lane: 'path' }).done)).toEqual(['pd'])
    expect(ids(queueView({ tickets: t, careerLane: false, lane: 'design' }).done)).toEqual([])
    expect(ids(queueView({ tickets: t, careerLane: false }).done)).toEqual(['bank', 'pd', 'dd'])
  })

  it('a bank ticket (bank origin, Mine) is DSA for the DSA filter whatever its stored lane, and a started one too', () => {
    const t = [
      tk('b1', 'path', 1, { status: 'done', doneAt: 5, origin: 'bank:neetcode' }),
      tk('m1', 'dsa', 2, { status: 'done', doneAt: 4, origin: 'mine' }),
      tk('bd', 'dsa', 3, { status: 'doing', origin: 'bank:blind75' }),
    ]
    const v = queueView({ tickets: t, careerLane: false, lane: 'dsa' })
    expect(ids(v.done)).toEqual(['b1', 'm1'])
    expect(ids(v.doing)).toEqual(['bd'])
  })

  it('open bank tickets are in no lane chip and no Up next, so chip counts still equal the rows (PATH-02, PATH-10)', () => {
    const t = [tk('d1', 'dsa', 1), tk('ob', 'dsa', 2, { origin: 'bank:blind75' })]
    const chips = laneChips({ tickets: t, careerLane: false, phases: phases(true) })
    expect(chips.find(c => c.lane === 'dsa')!.open).toBe(1)
    expect(chips.find(c => c.lane === 'all')!.open).toBe(1)
    expect(ids(queueView({ tickets: t, careerLane: false, lane: 'dsa' }).upNext[0].items)).toEqual(['d1'])
  })

  it('career off hides career tickets in Doing and Done too, and from the Today pick list (PATH-07, TODAY career off)', () => {
    const t = [
      tk('c-doing', 'career', 1, { status: 'doing' }), tk('c-done', 'career', 2, { status: 'done', doneAt: 9 }), tk('c-open', 'career', 3),
      tk('d-doing', 'dsa', 4, { status: 'doing' }), tk('d-done', 'dsa', 5, { status: 'done', doneAt: 8 }),
    ]
    const off = queueView({ tickets: t, careerLane: false })
    expect(ids(off.doing)).toEqual(['d-doing'])
    expect(off.doingCount).toBe(1)
    expect(ids(off.done)).toEqual(['d-done'])
    expect(off.upNext.map(l => l.lane)).toEqual(['path', 'dsa', 'design'])
    expect(ids(todayPickList({ tickets: t, careerLane: false }).doing)).toEqual(['d-doing'])
    const on = queueView({ tickets: t, careerLane: true })
    expect(ids(on.doing)).toEqual(['c-doing', 'd-doing'])
    expect(ids(on.done)).toEqual(['c-done', 'd-done'])
    expect(ids(queueView({ tickets: t, careerLane: true, lane: 'career' }).done)).toEqual(['c-done'])
  })

  it('search matches titles only, case-insensitively, and keeps the chip counts (PATH-09)', () => {
    const t = [
      tk('a1', 'dsa', 1, { title: 'Number of Islands' }),
      tk('a2', 'dsa', 2, { title: 'Word Ladder', node: 'graphs' }),
      tk('zz-9', 'dsa', 3, { title: 'Plain' }),
      tk('a4', 'dsa', 4, { title: 'Other', area: 'Backtracking' }),
      tk('a5', 'dsa', 5, { title: 'Walk the graphs of Backtracking' }),
    ]
    const dsaItems = (search: string) => ids(queueView({ tickets: t, careerLane: false, search }).upNext[1].items)
    expect(dsaItems('islands')).toEqual(['a1'])
    expect(dsaItems('ISLANDS')).toEqual(['a1'])
    expect(dsaItems('  ')).toEqual(['a1', 'a2', 'zz-9', 'a4', 'a5'])
    expect(queueView({ tickets: t, careerLane: false, search: 'zzz' }).upNext[1].items).toEqual([])
    expect(laneChips({ tickets: t, careerLane: false, phases: phases(true) }).find(c => c.lane === 'dsa')!.open).toBe(5)
  })

  it('a word in the id, node or area but not in the title does not match (PATH-09)', () => {
    const t = [
      tk('zz-9', 'dsa', 3, { title: 'Plain' }),
      tk('a2', 'dsa', 2, { title: 'Word Ladder', node: 'graphs' }),
      tk('a4', 'dsa', 4, { title: 'Other', area: 'Backtracking' }),
    ]
    const dsaItems = (search: string) => ids(queueView({ tickets: t, careerLane: false, search }).upNext[1].items)
    expect(dsaItems('ZZ-9')).toEqual([])
    expect(dsaItems('graph')).toEqual([])
    expect(dsaItems('backtrack')).toEqual([])
    expect(dsaItems('ladder')).toEqual(['a2'])
    const done = [tk('dn-1', 'dsa', 1, { title: 'Finished', status: 'done', doneAt: 1 })]
    expect(queueView({ tickets: done, careerLane: false, search: 'dn-1' }).done).toEqual([])
    expect(ids(queueView({ tickets: done, careerLane: false, search: 'finish' }).done)).toEqual(['dn-1'])
  })

  it('search is applied before the per-lane limit (PATH-09, PATH-14)', () => {
    const t = [...lane(12, 'dsa', 'x'), tk('late', 'dsa', 99, { title: 'needle' })]
    const q = queueView({ tickets: t, careerLane: false, search: 'needle' }).upNext[1]
    expect(ids(q.items)).toEqual(['late'])
    expect(q.more).toBe(0)
  })

  it('career is a lane only when enabled (PATH-07)', () => {
    const t = [tk('c1', 'career', 1)]
    expect(queueView({ tickets: t, careerLane: false }).upNext.map(l => l.lane)).toEqual(['path', 'dsa', 'design'])
    expect(queueView({ tickets: t, careerLane: true }).upNext.map(l => l.lane)).toEqual(['path', 'dsa', 'design', 'career'])
  })
})

describe('laneChips', () => {
  it('counts open tickets including started ones, and All is the sum (PATH-05)', () => {
    const t = [...lane(3, 'path', 'p'), tk('d1', 'dsa', 1, { status: 'doing' }), tk('d2', 'dsa', 2), tk('g1', 'design', 1, { status: 'done', doneAt: 1 })]
    expect(laneChips({ tickets: t, careerLane: false, phases: phases(true) }).map(c => [c.lane, c.open, c.done])).toEqual([
      ['all', 5, false], ['path', 3, false], ['dsa', 2, false], ['design', 0, true],
    ])
  })
  it('a path lane waiting for an unauthored phase does not read done (PATH-25)', () => {
    const t = [tk('d1', 'dsa', 1)]
    expect(laneChips({ tickets: t, careerLane: false, phases: phases(false) }).find(c => c.lane === 'path')).toMatchObject({ open: 0, done: false })
    expect(laneChips({ tickets: t, careerLane: false, phases: phases(true) }).find(c => c.lane === 'path')).toMatchObject({ open: 0, done: true })
  })
})

describe('todayPickList', () => {
  it('lists the other started tickets and the next ten per lane (TODAY-04, TODAY-16)', () => {
    const t = [...lane(12, 'path', 'p'), ...lane(12, 'dsa', 'd'), tk('s1', 'design', 1, { status: 'doing' }), tk('s2', 'design', 2, { status: 'doing' })]
    const r = todayPickList({ tickets: t, careerLane: false, excludeId: 's1' })
    expect(ids(r.doing)).toEqual(['s2'])
    expect(r.lanes.map(l => [l.lane, l.items.length])).toEqual([['path', 10], ['dsa', 10], ['design', 0]])
  })
})

describe('todayPickList without the quest ticket (TODAY-16)', () => {
  it('a quest that is a start ticket appears in no lane and the lane still lists ten', () => {
    const t = [...lane(12, 'path', 'p'), ...lane(12, 'dsa', 'd')]
    const r = todayPickList({ tickets: t, careerLane: false, excludeId: 'p1' })
    const path = r.lanes.find(l => l.lane === 'path')!
    expect(path.items).toHaveLength(10)
    expect(ids(path.items)).not.toContain('p1')
    expect(ids(path.items)[0]).toBe('p2')
    expect(r.lanes.flatMap(l => ids(l.items))).not.toContain('p1')
    expect(ids(r.doing)).not.toContain('p1')
  })
  it('a quest that is doing is absent from the doing group and from the lanes', () => {
    const t = [...lane(3, 'dsa', 'd'), tk('s1', 'design', 1, { status: 'doing' }), tk('s2', 'design', 2, { status: 'doing' })]
    const r = todayPickList({ tickets: t, careerLane: false, excludeId: 's1' })
    expect(ids(r.doing)).toEqual(['s2'])
    expect(r.lanes.flatMap(l => ids(l.items))).not.toContain('s1')
  })
})

describe('todayPickList with the career lane', () => {
  const t = [tk('p1', 'path', 1), tk('c1', 'career', 1), tk('c2', 'career', 2), tk('cs', 'career', 3, { status: 'doing' })]
  it('adds the career lane when it is on, and leaves it out when it is off', () => {
    const on = todayPickList({ tickets: t, careerLane: true })
    expect(on.lanes.map(l => l.lane)).toEqual(['path', 'dsa', 'design', 'career'])
    expect(ids(on.lanes[3].items)).toEqual(['c1', 'c2'])
    expect(ids(on.doing)).toEqual(['cs'])
    expect(todayPickList({ tickets: t, careerLane: false }).lanes.map(l => l.lane)).toEqual(['path', 'dsa', 'design'])
  })
})

describe('moveInLane', () => {
  const dsa = ['a', 'b', 'c', 'd', 'e'].map((id, i) => tk(id, 'dsa', i + 1))
  const apply = (ts: Ticket[], ps: { id: string; orderOverride: number }[]) => ts.map(t => { const p = ps.find(x => x.id === t.id); return p ? { ...t, orderOverride: p.orderOverride } : t })
  const order = (ts: Ticket[]) => ids([...ts].sort((x, y) => effectiveOrder(x) - effectiveOrder(y)))

  it('drops the fifth above the second: one override between the first and the second (PATH-20)', () => {
    const p = moveInLane(dsa, 'e', 1)
    expect(p).toHaveLength(1)
    expect(p[0].orderOverride).toBeGreaterThan(1)
    expect(p[0].orderOverride).toBeLessThan(2)
    expect(order(apply(dsa, p))).toEqual(['a', 'e', 'b', 'c', 'd'])
  })
  it('moves to the top and to the end', () => {
    expect(order(apply(dsa, moveInLane(dsa, 'c', 0)))).toEqual(['c', 'a', 'b', 'd', 'e'])
    expect(order(apply(dsa, moveInLane(dsa, 'a', 99)))).toEqual(['b', 'c', 'd', 'e', 'a'])
  })
  it('does nothing when the position does not change, for an empty lane, a done ticket or an unknown id', () => {
    expect(moveInLane(dsa, 'b', 1)).toEqual([])
    expect(moveInLane([tk('only', 'dsa', 1)], 'only', 0)).toEqual([])
    expect(moveInLane([...dsa, tk('x', 'dsa', 9, { status: 'done' })], 'x', 0)).toEqual([])
    expect(moveInLane(dsa, 'nope', 0)).toEqual([])
  })
  it('only this lane counts: other lanes, started and finished tickets are ignored', () => {
    const t = [...dsa, tk('p1', 'path', 0.1), tk('s', 'dsa', 0.2, { status: 'doing' }), tk('f', 'dsa', 0.3, { status: 'done' })]
    const patches = moveInLane(t, 'e', 1)
    expect(patches).toHaveLength(1)
    // between a (1) and b (2); counting the started or done ticket as a lane member would put it before a
    expect(patches[0].orderOverride).toBeGreaterThan(1)
    expect(patches[0].orderOverride).toBeLessThan(2)
    expect(order(apply(t, patches)).filter(i => ['a', 'b', 'c', 'd', 'e'].includes(i))).toEqual(['a', 'e', 'b', 'c', 'd'])
  })
  it('a started or archived ticket cannot be moved', () => {
    expect(moveInLane([...dsa, tk('s', 'dsa', 9, { status: 'doing' })], 's', 0)).toEqual([])
    expect(moveInLane([...dsa, tk('z', 'dsa', 9, { archived: true })], 'z', 0)).toEqual([])
  })
  it('renumbers the lane when two neighbours have no float between them', () => {
    const t = [tk('a', 'dsa', 1), tk('b', 'dsa', 1 + Number.EPSILON), tk('c', 'dsa', 5)]
    const p = moveInLane(t, 'c', 1)
    expect(order(apply(t, p))).toEqual(['a', 'c', 'b'])
  })
})

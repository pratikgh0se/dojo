import { describe, expect, it } from 'vitest'
import { areaProgress, isNodeDone, nodeState, nodeTickets } from '../../src/rules/skillTree'
import {
  areaEdgeMet, AREA_GRID, areaSummaries, depthsOf, edgePath, edgeStyle, layoutAreas, lockedReason, nextTicketOf,
  nodeLayers, nodeStates, preEdges, questTicketId, rowPadding, STATE_ATTR, STATE_GLYPH, STATE_WORD, summaryLine, unlocksOf,
} from '../../src/rules/skillView'
import { AREAS, mkAiTickets, mkPlanV2, mkTicket, NODES } from '../helpers/planV2'

const plan = mkPlanV2()

describe('skillTree rules', () => {
  const tickets = mkAiTickets()
  const node = (id: string) => NODES.find(n => n.id === id)!
  it('lists a node tickets in queue order and ignores archived ones', () => {
    expect(nodeTickets('L3', tickets).map(t => t.id)).toEqual(['ai.l3.learn', 'ai.l3.build'])
    expect(nodeTickets('L3', tickets.map(t => ({ ...t, archived: true })))).toEqual([])
  })
  it('gives each node one of five states, first match wins', () => {
    const st = (id: string, next: string | null = 'ai.l3.learn') => nodeState(node(id), plan, tickets, next)
    expect(st('L1')).toBe('done')
    expect(st('L3')).toBe('next')
    expect(st('L4')).toBe('locked') // L3 is not done
    expect(st('R1')).toBe('available') // L1 is done, nothing started
    expect(st('S1')).toBe('locked') // no tickets: its phase is not written
    const started = tickets.map(t => (t.id === 'ai.l4.learn' ? { ...t, status: 'doing' as const } : t))
    expect(nodeState(node('L4'), plan, started, null)).toBe('inprog')
  })
  it('puts done before next, next before inprog, inprog before locked', () => {
    const allL3 = tickets.map(t => (t.node === 'L3' ? { ...t, status: 'done' as const } : t))
    expect(nodeState(node('L3'), plan, allL3, 'ai.l3.learn')).toBe('done')
    const some = tickets.map(t => (t.id === 'ai.l3.learn' ? { ...t, status: 'done' as const } : t))
    expect(nodeState(node('L3'), plan, some, 'ai.l3.build')).toBe('next')
    expect(nodeState(node('L3'), plan, some, null)).toBe('inprog')
    // doing a ticket of a node whose prerequisite is not done is in progress, not locked
    const doing = tickets.map(t => (t.id === 'ai.l4.learn' ? { ...t, status: 'doing' as const } : t))
    expect(nodeState(node('L4'), plan, doing, 'ai.zzz')).toBe('inprog')
    // a next ticket id that belongs to no node of this tree marks nothing
    expect(NODES.some(n => nodeState(n, plan, tickets, 'not-a-ticket') === 'next')).toBe(false)
  })
  it('does not count archived tickets in any state', () => {
    const arch = tickets.map(t => (t.node === 'L1' ? { ...t, archived: true } : t))
    expect(nodeState(node('L1'), plan, arch, null)).toBe('locked') // no live tickets
    expect(isNodeDone('L1', arch)).toBe(false)
    expect(nodeState(node('R1'), plan, arch, null)).toBe('locked') // L1 is no longer done
  })
  it('weights area progress by minutes over tickets that carry the area, archived excluded', () => {
    expect(areaProgress('llm', plan, tickets)).toEqual({ done: 60, total: 225 })
    expect(areaProgress('measure', plan, tickets)).toEqual({ done: 0, total: 30 })
    expect(areaProgress('lead', plan, tickets)).toEqual({ done: 0, total: 0 })
    const extra = [...tickets, mkTicket({ id: 'x', area: 'llm', estMin: 99, archived: true }), mkTicket({ id: 'y', node: 'L1', estMin: 77 })]
    expect(areaProgress('llm', plan, extra)).toEqual({ done: 60, total: 225 }) // y has no `area`: not counted (SKILLS-03)
  })
})

describe('skillView layout', () => {
  it('draws one arrow per prerequisite link, prerequisite first, and nothing else', () => {
    const edges = preEdges(AREAS.map(a => a.id), id => AREAS.find(a => a.id === id)!.pre).map(e => e.join('>')).sort()
    expect(edges).toHaveLength(AREAS.reduce((n, a) => n + a.pre.length, 0))
    expect(edges).toContain('sched>fleet')
    expect(edges).toContain('measure>safe')
    expect(edges).not.toContain('fleet>sched')
  })
  it('places the ten areas on the mockup grid and sizes the map to five columns by three rows', () => {
    const m = layoutAreas(AREAS)
    expect(m.tiles).toHaveLength(10)
    expect(m.tiles.map(t => t.area.id)).toEqual(AREAS.map(a => a.id)) // plan order
    expect(m.tiles.find(t => t.area.id === 'ai')).toMatchObject({ c: 3, r: 3, x: 480, y: 24 + 2 * 160 })
    expect(m.width).toBe(1160)
    expect(m.height).toBe(24 + 2 * 160 + 128)
    expect(Object.keys(AREA_GRID)).toHaveLength(10)
    expect(m.edges).toHaveLength(AREAS.reduce((n, a) => n + a.pre.length, 0))
  })
  it('falls back to layers for areas it does not know', () => {
    const m = layoutAreas([{ id: 'a', name: 'A', tag: 'AA', why: '', pre: [] }, { id: 'b', name: 'B', tag: 'BB', why: '', pre: ['a'] }])
    expect(m.tiles.map(t => [t.area.id, t.c, t.r])).toEqual([['a', 1, 1], ['b', 2, 1]])
  })
  it('layers the nodes of an area by depth', () => {
    const llm = NODES.filter(n => n.area === 'llm')
    const d = depthsOf(llm.map(n => n.id), id => llm.find(n => n.id === id)!.pre)
    expect([...d.entries()]).toEqual([['L1', 0], ['L2', 1], ['L3', 2], ['L4', 3], ['R1', 1]])
  })
  it('draws one node arrow per in-area prerequisite, prerequisite first (SKILLS-09)', () => {
    const llm = NODES.filter(n => n.area === 'llm')
    expect(preEdges(llm.map(n => n.id), id => llm.find(n => n.id === id)!.pre).map(e => e.join('>')).sort()).toEqual(['L1>L2', 'L1>R1', 'L2>L3', 'L3>L4'])
    // a prerequisite in another area draws no arrow inside this one
    const sched = NODES.filter(n => n.area === 'sched')
    expect(preEdges(sched.map(n => n.id), id => sched.find(n => n.id === id)!.pre)).toEqual([])
  })
  it('gives each node a layer: 0 with no in-area prerequisite, else 1 + the highest in-area layer (SKILLS-19)', () => {
    const llm = NODES.filter(n => n.area === 'llm')
    expect(Object.fromEntries(nodeLayers(llm))).toEqual({ L1: 0, L2: 1, L3: 2, L4: 3, R1: 1 })
    expect(Object.fromEntries(nodeLayers(NODES.filter(n => n.area === 'sched')))).toEqual({ S1: 0 }) // L4, M1 lie outside the area
  })
  it('indents rows by 18 px per layer, inside the contract 16 to 20 px', () => {
    for (let l = 0; l < 4; l += 1) {
      const step = rowPadding(l + 1) - rowPadding(l)
      expect(step).toBeGreaterThanOrEqual(16)
      expect(step).toBeLessThanOrEqual(20)
    }
  })
  it('styles edges', () => {
    expect(edgeStyle('done', 'next')).toBe('acc')
    expect(edgeStyle('done', 'locked')).toBe('dash')
    expect(edgeStyle('done', 'done')).toBe('mid')
    expect(edgeStyle('available', 'inprog')).toBe('mid')
  })
})

describe('state marks as data', () => {
  it('maps every state to its contract data-glyph value (SKILLS-09), distinct from the drawing glyph', () => {
    expect(STATE_ATTR).toEqual({ done: 'check', locked: 'lock', next: 'next', inprog: 'progress', available: 'open' })
    expect(STATE_GLYPH).toEqual({ locked: 'lock', available: 'chevronR', next: 'play', inprog: 'loading', done: 'check' })
  })
  it('names every state in words (SKILLS-22)', () => {
    expect(STATE_WORD).toEqual({ locked: 'Locked', available: 'Available', next: 'Next', inprog: 'In progress', done: 'Done' })
  })
})

describe('skillView models', () => {
  const tickets = mkAiTickets()
  const states = nodeStates(plan, tickets, 'ai.l3.learn')
  it('reads the states of every plan node (SKILLS-10)', () => {
    expect(Object.fromEntries(states)).toEqual({ L1: 'done', L2: 'done', L3: 'next', L4: 'locked', R1: 'available', M1: 'available', S1: 'locked', U7: 'locked' })
  })
  it('summarises areas with the contract states', () => {
    const s = areaSummaries(plan, tickets, states)
    const by = (id: string) => s.find(a => a.area.id === id)!
    expect(s.map(a => a.area.id)).toEqual(AREAS.map(a => a.id))
    expect(by('llm')).toMatchObject({ state: 'in-progress', topicsDone: 2, topicsTotal: 5, recommended: true, needs: [], progress: { done: 60, total: 225 } })
    expect(by('measure')).toMatchObject({ state: 'open' })
    expect(by('sched')).toMatchObject({ state: 'needs-area', recommended: false })
    expect(by('sched').needs).toEqual(['Measuring things'])
    expect(by('ai')).toMatchObject({ state: 'open', topicsTotal: 1 })
    const allDone = mkAiTickets().map(t => ({ ...t, status: 'done' as const }))
    expect(areaSummaries(plan, allDone, nodeStates(plan, allDone, null)).find(a => a.area.id === 'llm')!.state).toBe('done')
  })
  it('never calls an area without tickets done, even though "all tickets done" is vacuous', () => {
    const allDone = mkAiTickets().map(t => ({ ...t, status: 'done' as const }))
    const s = areaSummaries(plan, allDone, nodeStates(plan, allDone, null))
    const lead = s.find(a => a.area.id === 'lead')!
    expect(lead.progress).toEqual({ done: 0, total: 0 })
    expect(lead.state).not.toBe('done')
    expect(s.find(a => a.area.id === 'state')!.state).not.toBe('done')
    const none = areaSummaries(plan, [], nodeStates(plan, [], null))
    expect(none.filter(a => a.state === 'done')).toEqual([])
  })
  it('treats a doing ticket as started for the area state and for needs-area', () => {
    const doing = mkAiTickets().map(t => (t.id === 'ai.m1.learn' ? { ...t, status: 'doing' as const } : t))
    const s = areaSummaries(plan, doing, nodeStates(plan, doing, null))
    expect(s.find(a => a.area.id === 'measure')!.state).toBe('in-progress')
    expect(s.find(a => a.area.id === 'sched')!.state).toBe('open') // llm done + measure doing: both prerequisites started, sched itself not
  })
  it('counts only non-archived tickets in area states', () => {
    const arch = mkAiTickets().map(t => (t.area === 'measure' ? { ...t, archived: true } : t))
    const s = areaSummaries(plan, arch, nodeStates(plan, arch, null))
    expect(s.find(a => a.area.id === 'measure')!.progress.total).toBe(0)
  })
  it('marks an arrow met when its prerequisite area has a done ticket', () => {
    expect(areaEdgeMet(plan, 'llm', tickets)).toBe(true)
    expect(areaEdgeMet(plan, 'measure', tickets)).toBe(false)
    const doing = tickets.map(t => (t.id === 'ai.m1.learn' ? { ...t, status: 'doing' as const } : t))
    expect(areaEdgeMet(plan, 'measure', doing)).toBe(false) // doing is not done
    const arch = tickets.map(t => (t.area === 'llm' ? { ...t, archived: true } : t))
    expect(areaEdgeMet(plan, 'llm', arch)).toBe(false)
  })
  it('writes the summary line from the plan node count (SKILLS-04, SKILLS-23)', () => {
    expect(summaryLine(plan, states)).toBe('2 of 8 topics done · pick an area to open it')
    expect(summaryLine(plan, nodeStates(plan, [], null))).toBe('0 of 8 topics done · pick an area to open it')
  })
  it('explains a soft lock in words', () => {
    expect(lockedReason(NODES.find(n => n.id === 'L4')!, plan, states)).toBe('Recommended first: How an LLM is made.')
    expect(lockedReason(NODES.find(n => n.id === 'S1')!, plan, states)).toBe('Not open yet: tickets written before phase 2.')
    expect(lockedReason(NODES.find(n => n.id === 'S1')!, plan, states)).toContain('tickets written before phase 2') // SKILLS-13, case-sensitive
    expect(lockedReason(NODES.find(n => n.id === 'L3')!, plan, states)).toBe('')
    expect(lockedReason(NODES.find(n => n.id === 'L1')!, plan, states)).toBe('')
  })
  it('lists what a node unlocks, from the nodes that name it as a prerequisite', () => {
    expect(unlocksOf('L1', plan).map(n => n.id)).toEqual(['L2', 'R1'])
    expect(unlocksOf('L4', plan).map(n => n.id)).toEqual(['S1'])
    expect(unlocksOf('S1', plan)).toEqual([])
  })
  it('finds the first open ticket of a node, by effective order, never an archived one', () => {
    expect(nextTicketOf('L3', tickets)?.id).toBe('ai.l3.learn')
    expect(nextTicketOf('L1', tickets)).toBeNull()
    expect(nextTicketOf('S1', tickets)).toBeNull()
    const reordered = tickets.map(t => (t.id === 'ai.l3.build' ? { ...t, orderOverride: 0 } : t))
    expect(nextTicketOf('L3', reordered)?.id).toBe('ai.l3.build')
    const arch = tickets.map(t => (t.id === 'ai.l3.learn' ? { ...t, archived: true } : t))
    expect(nextTicketOf('L3', arch)?.id).toBe('ai.l3.build')
    const started = tickets.map(t => (t.id === 'ai.l3.learn' ? { ...t, status: 'doing' as const } : t))
    expect(nextTicketOf('L3', started)?.id).toBe('ai.l3.learn') // a doing ticket is still open
  })
  it('takes the quest ticket from Today next action only for start and resume (SKILLS-11)', () => {
    const t = mkTicket({ id: 'q' })
    expect(questTicketId({ kind: 'start', ticket: t, reason: '' })).toBe('q')
    expect(questTicketId({ kind: 'resume', ticket: t, reason: '' })).toBe('q')
    expect(questTicketId({ kind: 'review', count: 3, reason: '' })).toBeNull()
    expect(questTicketId({ kind: 'wait', ticket: t, reason: '' })).toBeNull()
    expect(questTicketId({ kind: 'wait', ticket: null, reason: '' })).toBeNull()
    expect(questTicketId(undefined)).toBeNull()
  })
})

/** Every y the path touches (M x y, V y; H keeps y). */
const pathYs = (d: string): number[] => {
  const ys: number[] = []
  let y = 0
  for (const [, cmd, a, b] of d.matchAll(/([MVH])\s*(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?/g)) {
    if (cmd === 'M') y = Number(b)
    else if (cmd === 'V') y = Number(a)
    ys.push(y)
  }
  return ys
}

describe('arches stay inside the drawing (the scroll wrappers clip at 0)', () => {
  it('keeps every area arrow, including the same-row arch, at y >= 1 on the map', () => {
    const m = layoutAreas(AREAS)
    const at = new Map(m.tiles.map(t => [t.area.id, t]))
    let arches = 0
    for (const [from, to] of m.edges) {
      const a = at.get(from)!
      const b = at.get(to)!
      const p = edgePath({ x: a.x, y: a.y, w: 200, h: 128 }, { x: b.x, y: b.y, w: 200, h: 128 })
      const ys = pathYs(p.d)
      if (Math.min(...ys) < Math.min(a.y, b.y)) arches += 1
      expect(Math.min(...ys), `${from}>${to}`).toBeGreaterThanOrEqual(1)
      expect(p.hy).toBeGreaterThanOrEqual(0)
    }
    expect(arches).toBeGreaterThan(0)
  })
  it('keeps a node arch above row 0 inside the drawing', () => {
    const W = 196
    const H = 126
    const a = { x: 0, y: 20 }
    const b = { x: 3 * 220, y: 20 }
    const p = edgePath({ ...a, w: W, h: H }, { ...b, w: W, h: H })
    expect(a.y).toBe(b.y)
    expect(Math.min(...pathYs(p.d))).toBeLessThan(a.y) // it is an arch
    expect(Math.min(...pathYs(p.d))).toBeGreaterThanOrEqual(1)
  })
})

describe('edgePath', () => {
  const box = (c: number, r: number) => ({ x: (c - 1) * 240, y: 24 + (r - 1) * 160, w: 200, h: 128 })
  it('goes straight down a column and across to the next tile', () => {
    expect(edgePath(box(2, 1), box(2, 2))).toMatchObject({ d: 'M340 152 V178' })
    expect(edgePath(box(1, 1), box(2, 1))).toMatchObject({ d: 'M200 88 H234' })
  })
  it('arches over the tiles between two tiles of a row', () => {
    expect(edgePath(box(3, 2), box(5, 2)).d).toBe('M580 184 V170 H1060 V178')
  })
  it('turns in the gutter when the rows differ', () => {
    expect(edgePath(box(1, 2), box(2, 1)).d).toBe('M200 248 H220 V88 H234')
    expect(edgePath(box(4, 2), box(5, 1)).d).toBe('M920 248 H940 V88 H954')
  })
})

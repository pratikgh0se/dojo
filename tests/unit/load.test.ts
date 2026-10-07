import { describe, expect, it } from 'vitest'
import type { Brief, Ticket } from '../../src/data/types'
import { healthColumns, healthStats, leftBehind, loadCheck } from '../../src/rules/load'
import { mkTicket } from '../helpers/tickets'

let seq = 0
const brief100: Brief = {
  goal: 'g', steps: [{ text: 's' }], minutes: 100, dayType: 'focus', learn: [], outcome: 'o',
  deliverable: { kind: 'note', prompt: 'p' }, questions: [], status: 'draft', source: 'ai',
}
const tasks = (sprint: number, n: number, doneN = 0): Ticket[] =>
  Array.from({ length: n }, (_, i) => mkTicket({ id: `t${sprint}-${i}-${seq++}`, sprint, plannedSprint: sprint, order: i, status: i < doneN ? 'done' : 'todo' }))

describe('leftBehind', () => {
  it('undone tasks from earlier sprints only, oldest first', () => {
    const ts = [...tasks(2, 1), ...tasks(1, 2, 1), ...tasks(3, 1)]
    expect(leftBehind(ts, 3).map(t => t.sprint)).toEqual([1, 2])
  })
})

describe('healthColumns (Proto health)', () => {
  it('window cw−5..cw+2 clamped to S1, NOW label, done / behind / todo series', () => {
    const ts = [...tasks(1, 4, 1), ...tasks(2, 5, 2), ...tasks(3, 6)]
    const cols = healthColumns(ts, 2)
    expect(cols.map(c => c.label)).toEqual(['S1', 'NOW', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'])
    expect(cols[0]).toMatchObject({ done: 1, behind: 3, todo: 0 })
    expect(cols[1]).toMatchObject({ done: 2, behind: 0, todo: 3 })
    expect(cols[2]).toMatchObject({ done: 0, behind: 0, todo: 6 })
  })
  it('uses the given label before the start date and stays inside S65..S72 at the end (Review Focus #5)', () => {
    expect(healthColumns([], 1, 'S1')[0].label).toBe('S1')
    const end = healthColumns([], 72)
    expect(end.map(c => c.sprint)).toEqual([65, 66, 67, 68, 69, 70, 71, 72])
    expect(end[7].label).toBe('NOW')
  })
})

describe('healthStats', () => {
  it('Sprint 1 has no last sprint', () => {
    expect(healthStats(tasks(1, 3, 1), 1).map(({ tip: _t, ...x }) => x)).toEqual([
      { label: 'Last sprint', value: '—', tone: 'plain' },
      { label: 'This sprint', value: '1/3', tone: 'plain' },
      { label: 'Left behind', value: '0', tone: 'ok' },
    ])
  })
  it('later sprints show the previous sprint (ok when clear) and left behind in danger', () => {
    const ts = [...tasks(1, 2, 2), ...tasks(2, 3, 1), ...tasks(3, 4)]
    expect(healthStats(ts, 3).map(({ tip: _t, ...x }) => x)).toEqual([
      { label: 'Sprint 2', value: '1/3', tone: 'plain' },
      { label: 'This sprint', value: '0/4', tone: 'plain' },
      { label: 'Left behind', value: '2', tone: 'danger' },
    ])
    expect(healthStats(ts, 2)[0]).toEqual({ label: 'Sprint 1', value: '2/2', tone: 'ok' })
    // cu-final row 3: the "This sprint" tile says its scope
    expect(healthStats(ts, 3)[1]!.tip).toBe('0 of 4 plan tasks done this sprint (AI and interview tasks; the Board also counts DSA cards)')
  })
})

describe('loadCheck (DATA.md Load check · Proto load)', () => {
  it('Sprint 1 with no history: planned pace = sprint size, Fits', () => {
    const r = loadCheck(tasks(1, 6), 1, 1)
    expect(r).toMatchObject({ due: 6, cap: 6, pace: null, heavy: false, verdict: 'Fits' })
    expect(r.text).toBe('6 tasks due this sprint. Your pace appears here after the first sprint ends.')
    expect(r.rows.map(x => [x.label, x.n])).toEqual([['Now · 14d left', 6], ['Sprint 2', 0], ['Planned pace', 6]])
  })
  it('Sprint 2 with Sprint 1 untouched: due 12 against 6, Heavy', () => {
    const r = loadCheck([...tasks(1, 6), ...tasks(2, 6), ...tasks(3, 6)], 2, 1)
    expect(r).toMatchObject({ due: 12, cap: 6, pace: null, heavy: true, verdict: 'Heavy' })
    expect(r.text).toBe(
      "12 tasks due before sprint 3 against a pace of about 6 per sprint. Pick the 6 least important and let them slide one sprint; the plan's rule is slide, never restart.",
    )
    expect(r.rows[0].cells).toEqual([...Array(6).fill('behind'), ...Array(6).fill('todo')])
    expect(r.rows[1]).toEqual({ label: 'Sprint 3', n: 6, cells: Array(6).fill('todo') })
    expect(r.rows[2]).toEqual({ label: 'Planned pace', n: 6, cells: Array(6).fill('done') })
  })
  it('pace from history: 5 of 6 done in S1 → due 7 vs 5 is Heavy by exactly the min gap', () => {
    const r = loadCheck([...tasks(1, 6, 5), ...tasks(2, 6), ...tasks(3, 6)], 2, 8)
    expect(r).toMatchObject({ due: 7, cap: 5, pace: 5, heavy: true })
    expect(r.rows[0].label).toBe('Now · 7d left')
    expect(r.rows[2].label).toBe('Your pace')
    expect(r.text).toContain('Pick the 2 least important')
  })
  it('pace from history, all clear: Fits with the keep-the-rhythm copy', () => {
    const r = loadCheck([...tasks(1, 6, 6), ...tasks(2, 6), ...tasks(3, 6)], 2, 1)
    expect(r).toMatchObject({ due: 6, cap: 6, heavy: false, verdict: 'Fits' })
    expect(r.text).toBe('6 tasks due before sprint 3; you have been clearing about 6 a sprint. Keep the rhythm.')
  })
  it('over the ratio but under the min gap is Fits (due 3, cap 1 → 3 > 1.3 but gap 2 → Heavy; due 2, cap 1 → gap 1 → Fits)', () => {
    expect(loadCheck([...tasks(1, 2, 1), ...tasks(2, 2)], 2, 1)).toMatchObject({ due: 3, cap: 1, heavy: true })
    expect(loadCheck([...tasks(1, 2, 1), ...tasks(2, 1)], 2, 1)).toMatchObject({ due: 2, cap: 1, heavy: false })
  })
  it('within the ratio is Fits even with a gap of 2 (due 12 vs cap 10)', () => {
    expect(loadCheck([...tasks(1, 10, 10), ...tasks(2, 12)], 2, 1)).toMatchObject({ due: 12, cap: 10, heavy: false })
  })
  it('Sprint 72 has no next sprint (Review Focus #5)', () => {
    const r = loadCheck(tasks(72, 3), 72, 1)
    expect(r.rows[1]).toEqual({ label: 'Sprint 72', n: 0, cells: [] })
  })
})

describe('roll-over does not change the Today and Load views (briefs: cards stay left behind from their home sprint)', () => {
  it('the Load check, Left behind and This sprint read the same before and after the cards roll to sprint 2', async () => {
    const { applyRollover, rolloverPlan } = await import('../../src/rules/workload')
    const { sprintTasks } = await import('../../src/rules/vitals')
    const mk = (id: string, sprint: number, order: number) => mkTicket({ id, sprint, plannedSprint: sprint, order })
    const before = [mk('a', 1, 1), mk('b', 1, 2), mk('c', 2, 3), mk('d', 2, 4)]
    const now = new Date(2026, 9, 20, 10).getTime() // sprint 2 of a plan that started 2026-10-05
    const plan = rolloverPlan(before, now, '2026-10-05')
    const after = before.map(t => { const r = plan.find(x => x.id === t.id); return r ? applyRollover(t, r) : t })
    expect(after.filter(t => t.sprint === 2).map(t => t.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(loadCheck(after, 2, 2)).toEqual(loadCheck(before, 2, 2))
    expect(leftBehind(after, 2).map(t => t.id)).toEqual(['a', 'b'])
    expect(sprintTasks(after, 2).map(t => t.id)).toEqual(['c', 'd'])
    expect(sprintTasks(after, 1).map(t => t.id)).toEqual(['a', 'b'])
  })
})

describe('loadCheck pace from real focus minutes (ux spec, Today: the load check uses real focus minutes)', () => {
  // current sprint 1: 6 tasks of est 50 min; nothing done in earlier sprints (no history)
  const s1 = () => tasks(1, 6).map(t => ({ ...t, estMin: 50 }))
  it('without focus minutes nothing changes', () => {
    const a = loadCheck(s1(), 1, 1)
    const b = loadCheck(s1(), 1, 1, { perSprint: 0 })
    expect(b).toEqual(a)
    expect(a.pace).toBeNull()
  })
  it('with no completed-sprint history but a week of logged focus, focus minutes become the pace: minutes / average task estimate', () => {
    const r = loadCheck(s1(), 1, 1, { perSprint: 250, historyDays: 7 }) // 250 min / 50 = 5 tasks a sprint
    expect(r.pace).toBe(5)
    expect(r.cap).toBe(5)
    expect(r.due).toBe(6)
    expect(r.heavy).toBe(false) // 6 is not above 5 x 1.3
  })
  it('a low real focus pace makes a full sprint Heavy', () => {
    const r = loadCheck(s1(), 1, 1, { perSprint: 100, historyDays: 9 }) // 2 tasks a sprint against 6 due
    expect(r.cap).toBe(2)
    expect(r.heavy).toBe(true)
    expect(r.verdict).toBe('Heavy')
    expect(r.rows[2].label).toBe('Your pace')
  })
  it('with history, pace is the average of the done pace and the focus pace', () => {
    const ts = [...tasks(1, 4, 4), ...tasks(2, 6).map(t => ({ ...t, estMin: 50 }))] // done pace 4 in sprint 1; now sprint 2
    expect(loadCheck(ts, 2, 1).pace).toBe(4)
    const r = loadCheck(ts, 2, 1, { perSprint: 100 }) // focus pace 2 -> (4 + 2) / 2 = 3
    expect(r.pace).toBe(3)
    expect(r.cap).toBe(3)
  })
  it('a briefed card counts at its brief minutes (briefs spec §3), not its old estimate', () => {
    const briefed = s1().map(t => ({ ...t, brief: brief100 }))
    const r = loadCheck(briefed, 1, 1, { perSprint: 250, historyDays: 7 }) // 250 min / 100 = 2.5 tasks a sprint
    expect(r.pace).toBe(2.5)
    expect(r.cap).toBe(3)
  })
})

describe('loadCheck in the first sprint (ruling 24 S2, cu-2 P2-2): a pace needs data', () => {
  const s1 = () => tasks(1, 6).map(t => ({ ...t, estMin: 50 }))
  const PLAN = { planned: 6 * 50, budget: 1440 }

  it('one finished 1-minute block is no pace: still Fits, no slide advice, the first-sprint sentence', () => {
    const r = loadCheck(s1(), 1, 2, { perSprint: 2, historyDays: 0 }, PLAN) // 1 min in 7 days, doubled
    expect(r).toMatchObject({ heavy: false, verdict: 'Fits', pace: null, due: 6, cap: 6 })
    expect(r.text).toBe('6 tasks due this sprint. Your pace appears here after the first sprint ends.')
    expect(r.rows[2].label).toBe('Planned pace')
  })

  it('a few days of focus (under a week) are not enough either, however low the minutes', () => {
    const r = loadCheck(s1(), 1, 6, { perSprint: 20, historyDays: 6 }, PLAN)
    expect(r).toMatchObject({ heavy: false, pace: null })
  })

  it('seven days of logged focus earn a pace inside the first sprint', () => {
    const r = loadCheck(s1(), 1, 8, { perSprint: 100, historyDays: 7 }, PLAN)
    expect(r.pace).toBe(2)
    expect(r.heavy).toBe(true)
    expect(r.text).toContain('against a pace of about 2 per sprint')
  })

  it('the first sprint is judged by the plan against the core-minutes budget: Fits at or under it', () => {
    expect(loadCheck(s1(), 1, 1, undefined, { planned: 1440, budget: 1440 })).toMatchObject({ heavy: false, verdict: 'Fits' })
  })

  it('Heavy by plan: over the budget, with the excess in cards to slide and the first-sprint sentence kept', () => {
    // 6 cards of 300 min = 1800 min against 1440: 360 over = 2 average cards
    const r = loadCheck(s1(), 1, 1, undefined, { planned: 1800, budget: 1440 })
    expect(r).toMatchObject({ heavy: true, verdict: 'Heavy', pace: null, due: 6, cap: 4 })
    expect(r.text).toBe(
      "6 tasks due this sprint, 30 h planned against the 24 h core-minutes budget. Pick the 2 least important and let them slide one sprint; the plan's rule is slide, never restart. Your pace appears here after the first sprint ends.",
    )
    expect(r.text).not.toMatch(/pace of about/)
    expect(r.rows[2]).toMatchObject({ label: 'Planned pace', n: 4 })
  })

  it('Heavy by plan never asks to slide more than is due, and at least one', () => {
    expect(loadCheck(tasks(1, 2), 1, 1, undefined, { planned: 100_000, budget: 1440 }).cap).toBe(0)
    expect(loadCheck(tasks(1, 6), 1, 1, undefined, { planned: 1441, budget: 1440 }).cap).toBe(5)
  })

  it('from the second sprint the pace logic is what it was: a sprint 1 left untouched is Heavy', () => {
    const r = loadCheck([...tasks(1, 6), ...tasks(2, 6), ...tasks(3, 6)], 2, 1, { perSprint: 0 }, { planned: 100, budget: 1440 })
    expect(r).toMatchObject({ due: 12, cap: 6, heavy: true })
  })

  it('says "1 task", never "1 tasks"', () => {
    expect(loadCheck(tasks(1, 1), 1, 1).text).toBe('1 task due this sprint. Your pace appears here after the first sprint ends.')
    const r = loadCheck([...tasks(1, 2, 1), ...tasks(2, 0)], 2, 1)
    expect(r.text).toMatch(/^1 task due before sprint 3/)
  })
})

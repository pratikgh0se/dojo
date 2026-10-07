import { describe, expect, it } from 'vitest'
import { todayDrawers } from '../../src/rules/todayDrawers'
import { smallPlan } from '../helpers/plan'
import { smallTickets } from '../helpers/tickets'

describe('todayDrawers (Proto drw)', () => {
  it('This sprint: title, focus sub, AI then interview, cubes', () => {
    const ts = smallTickets().map(t => (t.id === 'm1w1i1' ? { ...t, status: 'done' as const } : t))
    const m = todayDrawers(smallPlan, ts, 1)
    expect(m.tasks).toMatchObject({ title: 'This sprint · 2 tasks', sub: 'fa1 · fi1', done: 1, total: 2, focusAi: 'fa1', focusInterview: 'fi1' })
    expect(m.tasks.ai.map(t => t.id)).toEqual(['m1w1t1'])
    expect(m.tasks.interview.map(t => t.id)).toEqual(['m1w1i1'])
    expect(m.tasks.cubes).toEqual([false, true])
  })

  it('This sprint says "1 task", never "1 tasks" (cu-2 P3-4)', () => {
    const one = smallTickets().filter(t => t.id !== 'm1w1i1')
    expect(todayDrawers(smallPlan, one, 1).tasks.title).toBe('This sprint · 1 task')
  })

  it("This sprint: sub is '' (not ' · ') when the plan has no entry for the sprint", () => {
    const m = todayDrawers(smallPlan, smallTickets(), 4)
    expect(m.tasks.sub).toBe('')
  })

  it('Left behind appears only with overdue tasks, tagged by sprint and track', () => {
    expect(todayDrawers(smallPlan, smallTickets(), 1).carry).toBeNull()
    const carry = todayDrawers(smallPlan, smallTickets(), 2).carry!
    expect(carry).toMatchObject({ title: 'Left behind · 2', sub: 'Unticked tasks from earlier sprints', done: 0, total: 2 })
    expect(carry.rows.map(r => r.tag)).toEqual(['from sprint 1 · AI', 'from sprint 1 · interview'])
    expect(carry.cubes).toEqual([false, false])
  })

  it('DSA: latest topic at or before the sprint (else the first), title before ":", pattern as sub', () => {
    const m = todayDrawers(smallPlan, smallTickets(), 3)
    expect(m.dsa).toMatchObject({ title: 'DSA · Graphs', sub: 'Graphs; Island (Matrix Traversal)', done: 0, total: 3 })
    expect(m.dsa!.topic.problems.map(p => p.num)).toEqual([200, 127, 1])
  })

  it('Design: only while a tier is active; titled by the rotation design day; next undone item', () => {
    expect(todayDrawers(smallPlan, smallTickets(), 1).design).toBeNull()
    const d = todayDrawers(smallPlan, smallTickets(), 2).design!
    expect(d).toMatchObject({ title: 'Thursday design', sub: 'The method, on a whiteboard, in 45 minutes', done: 0, total: 2 })
    expect(d.item?.id).toBe('d-method')
    const allDone = smallTickets().map(t => (t.kind === 'design' ? { ...t, status: 'done' as const } : t))
    const d2 = todayDrawers(smallPlan, allDone, 3).design!
    expect(d2.item).toBeNull()
    expect(d2.sub).toBe('Tier complete')
    expect(d2.cubes).toEqual([true, true])
  })
})

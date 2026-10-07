import { describe, expect, it } from 'vitest'
import { pickToday, todayView, upcomingForSprint } from '../../src/rules/today'
import { effectiveLastSprint, planPosition, sprintStart } from '../../src/rules/sprint'
import type { Ticket } from '../../src/data/types'
import { smallPlan } from '../helpers/plan'
import { smallTickets, mkTicket } from '../helpers/tickets'

const START = '2026-09-07'
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const view = (when: string, tickets: Ticket[] = smallTickets()) =>
  todayView(planPosition(ist(when), START), smallPlan.rotation, tickets, START)
const ids = (ts: Ticket[]) => ts.map(t => t.id)

describe('todayView edge dates (Review Focus #4)', () => {
  it('before the start date → not started', () => {
    expect(view('2026-09-01T09:00:00')).toEqual({ kind: 'before', eyebrow: 'PLAN STARTS 2026-09-07', daysUntil: 6 })
  })
  it('Friday → rest, using the rotation text verbatim', () => {
    expect(view('2026-09-11T21:00:00')).toEqual({ kind: 'rest', eyebrow: 'SPRINT 1 · DAY 5 OF 14 · Off', role: 'Off' })
  })
  it('after sprint 72 → finished, and reports how many tickets are still unfinished', () => {
    expect(view('2029-06-11T09:00:00')).toEqual({ kind: 'after', eyebrow: 'PLAN COMPLETE · 72 OF 72', unfinished: 10 })
  })
  it('after sprint 72 with everything done → 0 unfinished', () => {
    const ts = smallTickets().map(t => ({ ...t, status: 'done' as const }))
    expect(view('2029-06-11T09:00:00', ts)).toEqual({ kind: 'after', eyebrow: 'PLAN COMPLETE · 72 OF 72', unfinished: 0 })
  })
  it('last day of sprint 72 with nothing assigned → clear, no throw', () => {
    expect(view('2029-06-10T09:00:00')).toMatchObject({ kind: 'clear', eyebrow: 'SPRINT 72 · DAY 14 OF 14 · Interview + review' })
  })
  it('drops the role suffix when the rotation has no entry', () => {
    const v = todayView(planPosition(ist('2026-09-07T09:00:00'), START), {}, smallTickets(), START)
    expect(v.eyebrow).toBe('SPRINT 1 · DAY 1 OF 14')
  })
})

describe('todayView picks work from rotation text', () => {
  it('Monday "AI · watch" → first undone AI ticket', () => {
    const v = view('2026-09-07T21:10:00')
    expect(v).toMatchObject({ kind: 'work', eyebrow: 'SPRINT 1 · DAY 1 OF 14 · AI · watch', role: 'AI · watch' })
    if (v.kind !== 'work') throw new Error('expected work')
    expect(ids(v.tickets)).toEqual(['m1w1t1'])
    expect(v.primary.id).toBe('m1w1t1')
  })
  it('Tuesday "Interview · code" → first two undone problems', () => {
    const v = view('2026-09-08T21:10:00')
    if (v.kind !== 'work') throw new Error('expected work')
    expect(ids(v.tickets)).toEqual(['p200', 'p127'])
  })
  it('Thursday "Interview · design" → a design, else the first interview ticket', () => {
    const v1 = view('2026-09-10T21:10:00')
    if (v1.kind !== 'work') throw new Error('expected work')
    expect(ids(v1.tickets)).toEqual(['m1w1i1'])
    const v2 = view('2026-09-24T21:10:00')
    if (v2.kind !== 'work') throw new Error('expected work')
    expect(ids(v2.tickets)).toEqual(['d-method'])
  })
  it('Sunday "Interview + review" → first three undone interview tickets', () => {
    const v = view('2026-09-13T10:00:00')
    if (v.kind !== 'work') throw new Error('expected work')
    expect(ids(v.tickets)).toEqual(['m1w1i1', 'p200', 'p127'])
  })
  it('skips done/archived tickets and falls back to any undone ticket', () => {
    const ts = smallTickets().map(t =>
      t.id === 'm1w1t1' ? { ...t, status: 'done' as const } : t.id === 'm1w1i1' ? { ...t, archived: true } : t,
    )
    const v = view('2026-09-07T21:10:00', ts)
    if (v.kind !== 'work') throw new Error('expected work')
    expect(ids(v.tickets)).toEqual(['p200'])
  })
  it('includes tickets slid into the current sprint', () => {
    const ts = smallTickets().map(t => (t.id === 'm1w1t1' ? { ...t, sprint: 2, slidFrom: [1] } : t))
    const v = view('2026-09-21T21:10:00', ts)
    if (v.kind !== 'work') throw new Error('expected work')
    expect(ids(v.tickets)).toEqual(['m1w1t1'])
  })
  it('is clear when everything in the sprint is done', () => {
    const ts = smallTickets().map(t => (t.sprint === 1 ? { ...t, status: 'done' as const } : t))
    expect(view('2026-09-07T21:10:00', ts).kind).toBe('clear')
  })
})

describe('post-72 tickets extend the active window (controller ruling #4)', () => {
  it('a live ticket at S73 shows Today as work on a date in S73, not "Plan complete"', () => {
    const ts = [...smallTickets(), mkTicket({ id: 'late', sprint: 73, order: 99 })]
    const lastSprint = effectiveLastSprint(ts)
    expect(lastSprint).toBe(73)
    const whenInS73 = sprintStart(73, START) + 21_600_000 // a few hours into day 1 of S73
    const pos = planPosition(whenInS73, START, lastSprint)
    expect(pos).toMatchObject({ phase: 'active', sprint: 73, dayInSprint: 1 })
    const v = todayView(pos, smallPlan.rotation, ts, START)
    expect(v.kind).toBe('work')
    if (v.kind === 'work') expect(v.primary.id).toBe('late')
  })
})

describe('pickToday', () => {
  it('returns [] for an empty pool', () => {
    expect(pickToday('AI · watch', [])).toEqual([])
  })
})

describe('pickToday with stage tickets (Controller rulings applied)', () => {
  it('includes undone stage tickets on "AI · watch" day', () => {
    const stage = mkTicket({ id: 'stage-1', kind: 'stage', track: 'ai', sprint: 1, order: 1 })
    const pool = [stage]
    const picked = pickToday('AI · watch', pool)
    expect(ids(picked)).toEqual(['stage-1'])
  })
})

describe('pickToday: session-aware rotation (Task 4, one case per weekday)', () => {
  const watch = mkTicket({ id: 'w', kind: 'stage', track: 'ai', session: 'watch', order: 1 })
  const rebuild = mkTicket({ id: 'r', kind: 'stage', track: 'ai', session: 'rebuild', order: 2 })
  const build = mkTicket({ id: 'b', kind: 'stage', track: 'ai', session: 'build', order: 3 })
  const teachback = mkTicket({ id: 'tb', kind: 'stage', track: 'ai', session: 'teachback', order: 4 })
  const stagePool = [watch, rebuild, build, teachback]
  const iv1 = mkTicket({ id: 'i1', kind: 'task', track: 'interview', order: 10 })
  const iv2 = mkTicket({ id: 'i2', kind: 'problem', track: 'interview', order: 11 })
  const design = mkTicket({ id: 'd1', kind: 'design', track: 'interview', order: 12 })
  const problem = mkTicket({ id: 'p1', kind: 'problem', track: 'interview', order: 13 })

  it('Monday "AI · watch" picks the watch stage ticket, not rebuild/build/teachback', () => {
    expect(ids(pickToday('AI · watch', stagePool))).toEqual(['w'])
  })
  it('Tuesday "Interview · code" is untouched by stage sessions — first two problems', () => {
    expect(ids(pickToday('Interview · code', [...stagePool, iv2, problem]))).toEqual(['i2', 'p1'])
  })
  it('Wednesday "AI · rebuild" picks the rebuild stage ticket — "rebuild" must not fall through to "build"', () => {
    expect(ids(pickToday('AI · rebuild', stagePool))).toEqual(['r'])
  })
  it('Thursday "Interview · design" is untouched by stage sessions — a design ticket', () => {
    expect(ids(pickToday('Interview · design', [...stagePool, design]))).toEqual(['d1'])
  })
  it('Friday "Off" is a rest day at the todayView level, not exercised by pickToday', () => {
    expect(pickToday('Off', stagePool)).toEqual(stagePool.slice(0, 1))
  })
  it('Saturday "AI · build + break" picks the build stage ticket', () => {
    expect(ids(pickToday('AI · build + break', stagePool))).toEqual(['b'])
  })
  it('Sunday "Interview + teach-back" leads with the teachback stage ticket, interview tickets listed after', () => {
    expect(ids(pickToday('Interview + teach-back', [...stagePool, iv1, iv2]))).toEqual(['tb', 'i1', 'i2'])
  })
  it('Sunday falls back to interview-only behavior when no teachback ticket is undone', () => {
    const noTeachback = [watch, rebuild, build]
    expect(ids(pickToday('Interview + teach-back', [...noTeachback, iv1, iv2]))).toEqual(['i1', 'i2'])
  })
})

describe('upcomingForSprint (before-start "Coming up" list)', () => {
  const forgeRotation = {
    Mon: 'AI · watch',
    Tue: 'Interview · code',
    Wed: 'AI · rebuild',
    Thu: 'Interview · design',
    Fri: 'Off',
    Sat: 'AI · build + break',
    Sun: 'Interview + teach-back',
  }
  const watch = mkTicket({ id: 'w', kind: 'stage', track: 'ai', session: 'watch', order: 1, title: 'Watch' })
  const rebuild = mkTicket({ id: 'r', kind: 'stage', track: 'ai', session: 'rebuild', order: 2, title: 'Rebuild' })
  const build = mkTicket({ id: 'b', kind: 'stage', track: 'ai', session: 'build', order: 3, title: 'Build' })
  const teachback = mkTicket({ id: 'tb', kind: 'stage', track: 'ai', session: 'teachback', order: 4, title: 'Teach-back' })
  const design = mkTicket({ id: 'd1', kind: 'design', track: 'interview', order: 5, title: 'Design 1', links: [{ label: 'Karpathy: intro', url: 'https://x' }] })
  const problem = mkTicket({ id: 'p1', kind: 'problem', track: 'interview', order: 6, title: 'Problem 1' })

  it('orders the four stage tickets watch, rebuild, build, teach-back, then interview tickets by plan order', () => {
    // Pool is deliberately shuffled to prove the output order comes from the
    // stage-session sequence and ticket.order, not from pool order.
    const pool = [problem, teachback, design, build, watch, rebuild]
    const upcoming = upcomingForSprint(pool, forgeRotation)
    expect(upcoming.map(u => u.ticket.id)).toEqual(['w', 'r', 'b', 'tb', 'd1', 'p1'])
  })

  it('labels each ticket with its weekday from the rotation', () => {
    const pool = [watch, rebuild, build, teachback, design, problem]
    const upcoming = upcomingForSprint(pool, forgeRotation)
    const labelFor = (id: string) => upcoming.find(u => u.ticket.id === id)?.label
    expect(labelFor('w')).toBe('Mon · AI · watch')
    expect(labelFor('r')).toBe('Wed · AI · rebuild')
    expect(labelFor('b')).toBe('Sat · AI · build + break')
    expect(labelFor('tb')).toBe('Sun · Interview + teach-back')
    expect(labelFor('d1')).toBe('Thu · Interview · design')
    expect(labelFor('p1')).toBe('Tue · Interview · code')
  })

  it('carries the ticket\'s first link through for display', () => {
    const upcoming = upcomingForSprint([design], forgeRotation)
    expect(upcoming[0].firstLink).toEqual({ label: 'Karpathy: intro', url: 'https://x' })
  })

  it('skips stage sessions that are missing from the pool', () => {
    const upcoming = upcomingForSprint([watch, build], forgeRotation)
    expect(upcoming.map(u => u.ticket.id)).toEqual(['w', 'b'])
  })
})

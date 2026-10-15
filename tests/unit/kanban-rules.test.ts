import { describe, expect, it } from 'vitest'
import {
  altStep, boardTickets, buildBoard, cardMenuTargets, clampNote, decideDrop, filterBoard, hoursText, sprintBudgetMin, sprintHeader, sprintWindow,
} from '../../src/rules/kanban'
import type { Lane, Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const at = (iso: string) => new Date(`${iso}+05:30`).getTime()
const NOW = at('2026-11-04T10:00:00')
const DEFAULT = [90, 60, 60, 60, 30, 30, 150]
const tk = (id: string, lane: Lane, order: number, extra: Partial<Ticket> = {}): Ticket =>
  mkTicket({ id, lane, order, title: id, estMin: 45, track: lane === 'path' ? 'ai' : 'interview', kind: lane === 'dsa' ? 'problem' : 'watch', ...extra })

describe('sprint window (BOARD-02, BOARD-03)', () => {
  it('clock 2026-11-04 with start 2026-10-14 is sprint 2, 2026-10-28 to 2026-11-10', () => {
    expect(sprintWindow(NOW, '2026-10-14')).toEqual({ n: 2, start: '2026-10-28', end: '2026-11-10' })
    expect(sprintHeader(sprintWindow(NOW, '2026-10-14'))).toBe('Sprint 2 · 28 Oct–10 Nov')
  })
  it('follows the clock at the window edges and clamps to 1 and 72', () => {
    const w = (iso: string) => sprintWindow(at(`${iso}T10:00:00`), '2026-10-14')
    expect(w('2026-10-27')).toEqual({ n: 1, start: '2026-10-14', end: '2026-10-27' })
    expect(w('2026-10-28').n).toBe(2)
    expect(w('2026-11-10')).toEqual({ n: 2, start: '2026-10-28', end: '2026-11-10' })
    expect(w('2026-11-11')).toEqual({ n: 3, start: '2026-11-11', end: '2026-11-24' })
    expect(w('2026-10-10')).toEqual({ n: 1, start: '2026-10-14', end: '2026-10-27' })
    expect(w('2029-12-31').n).toBe(72)
  })
})

describe('budget and hours (BOARD-04, BOARD-05, BOARD-06)', () => {
  it('is twice the weekly total: 960 by default, 1080 with Monday at 120, 990 after Wednesday is 15', () => {
    const win = sprintWindow(NOW, '2026-10-14')
    expect(sprintBudgetMin(win, DEFAULT)).toBe(960)
    expect(sprintBudgetMin(win, [90, 120, 60, 60, 30, 30, 150])).toBe(1080)
    expect(sprintBudgetMin(win, [90, 120, 60, 15, 30, 30, 150])).toBe(990)
  })
  it('writes hours rounded to one decimal with a trailing .0 dropped', () => {
    expect(hoursText(215)).toBe('3.6 h')
    expect(hoursText(960)).toBe('16 h')
    expect(hoursText(0)).toBe('0 h')
    expect(hoursText(45)).toBe('0.8 h')
  })
})

describe('the board model', () => {
  const day = (iso: string) => at(`${iso}T11:00:00`)
  const base = (): Ticket[] => [
    tk('q1', 'path', 1), tk('q2', 'dsa', 2), tk('q3', 'design', 3), tk('q4', 'path', 4), tk('q5', 'dsa', 5),
    tk('doing', 'path', 0.1, { status: 'doing', estMin: 45 }),
    tk('blk', 'path', 0.2, { status: 'blocked', blockedNote: 'Waiting' }), tk('hlp', 'dsa', 0.3, { status: 'help' }),
    tk('inA', 'path', 0.4, { status: 'done', doneAt: day('2026-11-03'), estMin: 60 }),
    tk('inB', 'dsa', 0.5, { status: 'done', doneAt: day('2026-11-04'), estMin: 30 }),
    tk('inC', 'dsa', 0.6, { status: 'done', doneAt: day('2026-10-28'), estMin: 30 }),
    tk('prev', 'path', 0.7, { status: 'done', doneAt: day('2026-10-27') }),
    tk('rit', 'ritual', 9, { kind: 'ritual' }), tk('car', 'career', 10), tk('arch', 'dsa', 11, { archived: true }), tk('mrg', 'dsa', 12, { mergedInto: 'q1' }),
  ]
  const build = (ts: Ticket[], over: Partial<Parameters<typeof buildBoard>[0]> = {}) =>
    buildBoard({ tickets: ts, careerLane: false, startDate: '2026-10-14', budgets: DEFAULT, nowMs: NOW, ...over })
  const ids = (ts: Ticket[]) => ts.map(t => t.id)

  it('uses minutes of doing and of this sprint\'s done tickets; budget minus used is remaining', () => {
    const b = build(base())
    expect(b.usedMin).toBe(45 + 60 + 30 + 30)
    expect(b.budgetMin).toBe(960)
    expect(b.remainingMin).toBe(960 - 165)
    expect(b.doneMin).toBe(120)
  })
  it('To do is the longest queue-order prefix that fits the remaining minutes; the rest is Backlog (BOARD-08)', () => {
    const ts = base().map(t => (t.id.startsWith('q') ? { ...t, estMin: 300 } : t))
    expect(ids(build(ts).todo)).toEqual(['q1', 'q2']) // 300 + 300 = 600 <= 795, a third would be 900
    expect(ids(build(ts).backlog)).toEqual(['q3', 'q4', 'q5'])
  })
  it('the first ticket that would exceed ends the column, even when a later one would fit', () => {
    const ts = base().map(t => (t.id === 'q1' ? { ...t, estMin: 900 } : t.id === 'q2' ? { ...t, estMin: 10 } : t))
    expect(build(ts).todo).toEqual([])
    expect(ids(build(ts).backlog)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5'])
  })
  it('a negative remaining leaves To do empty and changes no status (BOARD-09)', () => {
    const ts = base().map(t => (t.id === 'doing' ? { ...t, estMin: 2000 } : t))
    const b = build(ts)
    expect(b.remainingMin).toBeLessThan(0)
    expect(b.todo).toEqual([])
    expect(b.backlog.every(t => t.status === 'todo')).toBe(true)
  })
  it('queue order is effective order across all lanes (orderOverride wins)', () => {
    const ts = base().map(t => (t.id === 'q5' ? { ...t, orderOverride: 0.05 } : t))
    expect(ids(build(ts).todo)).toEqual(['q5', 'q1', 'q2', 'q3', 'q4'])
  })
  it('Doing, Blocked and Need help hold their statuses; Done is this sprint\'s, newest first (BOARD-12, BOARD-13)', () => {
    const b = build(base())
    expect(ids(b.doing)).toEqual(['doing'])
    expect(ids(b.blocked)).toEqual(['blk'])
    expect(ids(b.help)).toEqual(['hlp'])
    expect(ids(b.done)).toEqual(['inB', 'inA', 'inC'])
  })
  it('never shows ritual, archived, merged or (while off) career tickets (BOARD-14)', () => {
    const all = [...build(base()).todo, ...build(base()).backlog]
    for (const id of ['rit', 'car', 'arch', 'mrg']) expect(ids(all)).not.toContain(id)
    expect(ids(boardTickets(base(), true))).toContain('car')
    expect(ids(build(base(), { careerLane: true }).todo)).toContain('car')
  })
  it('a bank ticket counts as DSA (done only)', () => {
    const b = build([...base(), tk('bank', 'bank', 20, { status: 'done', doneAt: day('2026-11-03'), origin: 'bank:blind75' })])
    expect(ids(b.done)).toContain('bank')
  })
  it('progress counts To do, Doing, Blocked, Need help and Done; Backlog is not counted (BOARD-04)', () => {
    const b = build(base())
    expect(b.progress).toEqual({ done: 3, total: b.todo.length + 1 + 1 + 1 + 3 })
  })
  it('a lane filter changes what is drawn, not who belongs: counts per column are the filtered number (BOARD-44)', () => {
    const b = build(base())
    const f = filterBoard(b, 'dsa')
    expect(f.todo.every(t => t.lane === 'dsa')).toBe(true)
    expect(ids(f.todo)).toEqual(ids(b.todo.filter(t => t.lane === 'dsa')))
    expect(f.count.todo).toBe(f.todo.length)
    expect(f.progress).toEqual(b.progress)
    expect(f.hours).toEqual(b.hours)
    expect(ids(f.help)).toEqual(['hlp'])
    expect(f.blocked).toEqual([])
  })
})

describe('drops (BOARD-17 to BOARD-31)', () => {
  const t = (status: Ticket['status'], kind: Ticket['kind'] = 'watch', extra: Partial<Ticket> = {}) => mkTicket({ id: 'x', status, kind, ...extra })
  it('to Doing: from todo, blocked and help sets doing; from doing or done changes nothing', () => {
    for (const s of ['todo', 'blocked', 'help'] as const) expect(decideDrop(t(s), 'doing')).toEqual({ do: 'set', status: 'doing' })
    expect(decideDrop(t('doing'), 'doing')).toEqual({ do: 'none' })
    expect(decideDrop(t('done'), 'doing')).toEqual({ do: 'none' })
  })
  it('to Blocked or Need help sets the status and opens the reason editor, prefilled when it came from the other one', () => {
    expect(decideDrop(t('todo'), 'blocked')).toEqual({ do: 'set', status: 'blocked', editor: { prefill: '' } })
    expect(decideDrop(t('doing'), 'help')).toEqual({ do: 'set', status: 'help', editor: { prefill: '' } })
    expect(decideDrop(t('blocked', 'watch', { blockedNote: 'Waiting' }), 'help')).toEqual({ do: 'set', status: 'help', editor: { prefill: 'Waiting' } })
    expect(decideDrop(t('blocked'), 'blocked')).toEqual({ do: 'none' })
  })
  it('to To do or Backlog: todo from doing/blocked/help; a todo card dropped there says the sprint is filled in Path order', () => {
    for (const s of ['doing', 'blocked', 'help'] as const) for (const c of ['todo', 'backlog'] as const) expect(decideDrop(t(s), c)).toEqual({ do: 'set', status: 'todo' })
    const same = decideDrop(t('todo'), 'todo')
    expect(same.do).toBe('toast')
    expect(same.do === 'toast' && same.message).toMatch(/Path order/)
    expect(decideDrop(t('todo'), 'backlog').do).toBe('toast')
    expect(decideDrop(t('done'), 'todo')).toEqual({ do: 'none' })
  })
  it('to Done: a problem asks for the outcome, design and write-up are refused with a sentence about the session, others complete', () => {
    expect(decideDrop(t('todo', 'problem'), 'done')).toEqual({ do: 'outcome' })
    const d = decideDrop(t('todo', 'design'), 'done')
    expect(d.do).toBe('toast')
    expect(d.do === 'toast' && d.message).toMatch(/session/)
    expect(decideDrop(t('doing', 'writeup'), 'done').do).toBe('toast')
    for (const k of ['watch', 'read', 'task', 'build'] as const) expect(decideDrop(t('blocked', k), 'done')).toEqual({ do: 'complete' })
    expect(decideDrop(t('done'), 'done')).toEqual({ do: 'none' })
  })
  it('a Done card never moves', () => {
    for (const c of ['todo', 'backlog', 'doing', 'blocked', 'help'] as const) expect(decideDrop(t('done'), c)).toEqual({ do: 'none' })
  })
})

describe('keys and menu (BOARD-33 to BOARD-35)', () => {
  it('Alt+Arrow steps To do, Doing, Blocked, Need help, Done and skips Backlog', () => {
    expect(altStep('doing', 1)).toBe('blocked')
    expect(altStep('blocked', 1)).toBe('help')
    expect(altStep('help', 1)).toBe('done')
    expect(altStep('done', 1)).toBeNull()
    expect(altStep('todo', 1)).toBe('doing')
    expect(altStep('backlog', 1)).toBe('doing')
    expect(altStep('doing', -1)).toBe('todo')
    expect(altStep('blocked', -1)).toBe('doing')
    expect(altStep('help', -1)).toBe('blocked')
    expect(altStep('todo', -1)).toBeNull()
    expect(altStep('backlog', -1)).toBeNull()
    expect(altStep('done', -1)).toBeNull()
  })
  it('the menu lists every other column but Backlog; Done only for kinds that finish on the Board', () => {
    expect(cardMenuTargets('todo', 'watch')).toEqual(['doing', 'blocked', 'help', 'done'])
    expect(cardMenuTargets('backlog', 'watch')).toEqual(['doing', 'blocked', 'help', 'done'])
    expect(cardMenuTargets('doing', 'problem')).toEqual(['todo', 'blocked', 'help', 'done'])
    expect(cardMenuTargets('blocked', 'build')).toEqual(['todo', 'doing', 'help', 'done'])
    expect(cardMenuTargets('help', 'design')).toEqual(['todo', 'doing', 'blocked'])
    expect(cardMenuTargets('todo', 'writeup')).toEqual(['doing', 'blocked', 'help'])
    expect(cardMenuTargets('done', 'watch')).toEqual([])
  })
})

describe('reason text (BOARD-20, BOARD-21)', () => {
  it('trims and keeps at most 140 characters', () => {
    expect(clampNote('  Waiting for the lab key  ')).toBe('Waiting for the lab key')
    expect(clampNote('x'.repeat(160))).toHaveLength(140)
    expect(clampNote('   ')).toBe('')
  })
})

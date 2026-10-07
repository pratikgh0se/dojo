import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../src/data/types'
import {
  carrotHp, milestoneBadges, pomPose, sprintDates, sprintDays, sprintTasks,
} from '../../src/rules/vitals'
import { mkTicket } from '../helpers/tickets'

const ROT = { Mon: 'AI · watch', Tue: 'Interview · code', Wed: 'AI · rebuild', Thu: 'Interview · design', Fri: 'Off', Sat: 'AI · build + break', Sun: 'Interview + teach-back' }
const task = (id: string, sprint: number, p: Partial<Ticket> = {}) => mkTicket({ id, sprint, plannedSprint: sprint, ...p })

describe('sprintTasks', () => {
  it('keeps task and stage tickets in the sprint; drops problems, designs, archived and slid history rows', () => {
    const ts = [
      task('a', 2, { order: 2 }), task('b', 2, { kind: 'stage', order: 1 }), task('p1', 2, { kind: 'problem' }),
      task('d1', 2, { kind: 'design' }), task('x', 2, { archived: true }), task('a@1', 2, { status: 'slid' }), task('c', 3),
    ]
    expect(sprintTasks(ts, 2).map(t => t.id)).toEqual(['b', 'a'])
  })
})

describe('sprintDays (14-cell strip)', () => {
  it('marks past, past rest (Friday), today and future from day 8 of a Monday-start sprint', () => {
    const d = sprintDays('2026-10-05', 1, 8, ROT)
    expect(d).toHaveLength(14)
    expect(d.slice(0, 8)).toEqual(['past', 'past', 'past', 'past', 'past-rest', 'past', 'past', 'today'])
    expect(d.slice(8)).toEqual(Array(6).fill('future'))
  })
  it('before the start date every cell is future', () => {
    expect(sprintDays('2026-10-05', 1, 0, ROT)).toEqual(Array(14).fill('future'))
  })
})

describe('sprintDates', () => {
  it('formats the 14-day span', () => {
    expect(sprintDates('2026-10-05', 1)).toBe('Oct 5 – Oct 18')
    expect(sprintDates('2026-09-07', 2)).toBe('Sep 21 – Oct 4')
  })
})

describe('carrotHp', () => {
  it('max = sprint tasks, left = not done', () => {
    expect(carrotHp([task('a', 1), task('b', 1, { status: 'done' }), task('p', 1, { kind: 'problem' })], 1)).toEqual({ max: 2, left: 1 })
  })
})

describe('milestoneBadges (prototype MB)', () => {
  const glyphs = (ts: Ticket[]) => Object.fromEntries(milestoneBadges(ts).map(b => [b.glyph, b.on]))
  it('all off with nothing done', () => {
    expect(glyphs([task('a', 1)])).toEqual({ '1': false, G: false, H: false, D: false, B: false, '½': false })
  })
  it('1 lights on any done ticket; G when every DSA problem planned in sprints 1–4 is done', () => {
    const ts = [
      task('p1', 1, { kind: 'problem', status: 'done' }), task('p2', 4, { kind: 'problem', status: 'done' }),
      task('p3', 5, { kind: 'problem' }),
    ]
    expect(glyphs(ts)).toMatchObject({ '1': true, G: true })
  })
  it('H at 10 hard problems, D at 5 designs, with progress in the hint', () => {
    const hards = Array.from({ length: 10 }, (_, i) => task(`h${i}`, 9, { kind: 'problem', difficulty: 'H', status: 'done' }))
    const designs = Array.from({ length: 4 }, (_, i) => task(`d${i}`, 21, { kind: 'design', status: 'done' }))
    const b = milestoneBadges([...hards, ...designs])
    expect(b.find(x => x.glyph === 'H')).toEqual({ glyph: 'H', hint: 'Ten hards · 10/10', on: true })
    expect(b.find(x => x.glyph === 'D')).toEqual({ glyph: 'D', hint: 'Designer · 4/5 designs', on: false })
  })
  it('B when every block-1 task (planned S1–S4) is done; ½ at ceil(tasks/2)', () => {
    const ts = [task('a', 1, { status: 'done' }), task('b', 4, { status: 'done' }), task('c', 5), task('d', 6)]
    const b = milestoneBadges(ts)
    expect(b.find(x => x.glyph === 'B')?.on).toBe(true)
    expect(b.find(x => x.glyph === '½')).toEqual({ glyph: '½', hint: 'Halfway · 2 tasks', on: true })
  })
})

describe('pomPose', () => {
  it('powerup wins; training when a sprint task is done; idle otherwise', () => {
    const ts = [task('a', 1, { status: 'done' }), task('b', 2)]
    expect(pomPose(true, ts, 2)).toBe('powerup')
    expect(pomPose(false, ts, 1)).toBe('training')
    expect(pomPose(false, ts, 2)).toBe('idle')
  })
})

import { describe, expect, it } from 'vitest'
import type { DojoEvent, Ticket } from '../../src/data/types'
import { parseLocalDate } from '../../src/lib/dates'
import { effectiveLastSprint, SPRINT_DAYS } from '../../src/rules/sprint'
import { roleTrack, sprintCalendar, WEEK_TARGET_MIN, weeklyMinutes, weekTiles } from '../../src/rules/week'
import { realPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'
import { splitTicket } from '../../src/rules/split'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const START = '2026-10-05' // Monday
const ROT = realPlan().rotation
const WED = ist('2026-10-07T21:10:00')

const sprint1 = (): Ticket[] => [
  mkTicket({ id: 'w', kind: 'stage', session: 'watch', order: 0 }),
  mkTicket({ id: 'r', kind: 'stage', session: 'rebuild', order: 1 }),
  mkTicket({ id: 'b', kind: 'stage', session: 'build', order: 2 }),
  mkTicket({ id: 'tb', kind: 'stage', session: 'teachback', order: 3 }),
  mkTicket({ id: 'p', track: 'interview', kind: 'problem', difficulty: 'M', order: 4 }),
  mkTicket({ id: 'd', track: 'interview', kind: 'design', order: 5 }),
]
const focus = (at: string, minutes: number): DojoEvent => ({ t: 'focus', id: 'p', at: ist(at), minutes })

describe('weekTiles', () => {
  it('lays out Mon–Sun with rotation labels and the day’s picks from pickToday', () => {
    const tiles = weekTiles(WED, START, ROT, sprint1(), [])
    expect(tiles.map(t => t.dateKey)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    expect(tiles.map(t => t.isToday)).toEqual([false, false, true, false, false, false, false])
    expect(tiles.map(t => t.tickets.map(x => x.id))).toEqual([['w'], ['p'], ['r'], ['d'], [], ['b'], ['tb', 'p', 'd']])
    expect(tiles.map(t => t.role)).toEqual(['AI · watch', 'Interview · code', 'AI · rebuild', 'Interview · design', 'Off', 'AI · build + break', 'Interview + teach-back'])
  })
  it('Friday rests', () => {
    const fri = weekTiles(WED, START, ROT, sprint1(), [])[4]
    expect(fri).toMatchObject({ day: 'Fri', rest: true, tickets: [], sprint: 1 })
  })
  it('counts done by doneAt day and focus minutes by the day each focus block finished; done tickets are not picked', () => {
    const ts = sprint1().map(t => (t.id === 'p' ? { ...t, status: 'done' as const, doneAt: ist('2026-10-06T21:40:00') } : t))
    const tiles = weekTiles(WED, START, ROT, ts, [focus('2026-10-06T21:35:00', 25), focus('2026-10-06T23:59:00', 5), focus('2026-10-07T00:01:00', 7)])
    expect(tiles[1]).toMatchObject({ done: 1, minutes: 30 })
    expect(tiles[2]).toMatchObject({ minutes: 7 })
    expect(tiles[1].tickets.map(t => t.id)).not.toContain('p')
  })
  it('outside the plan window tiles show the rotation only (Review Focus #5)', () => {
    const tiles = weekTiles(ist('2026-10-01T10:00:00'), START, ROT, sprint1(), [focus('2026-09-29T21:10:00', 25)])
    expect(tiles.every(t => t.sprint === null && t.tickets.length === 0 && t.done === 0 && t.minutes === 0)).toBe(true)
    expect(tiles[0].role).toBe('AI · watch')
    expect(weekTiles(ist('2026-10-04T10:00:00'), START, ROT, sprint1(), []).every(t => t.sprint === null)).toBe(true)
  })
  it('after sprint 72 tiles show the rotation only (A5)', () => {
    expect(weekTiles(ist('2029-08-01T10:00:00'), START, ROT, sprint1(), []).every(t => t.sprint === null)).toBe(true)
  })
})

// Controller ruling 22 D2 (UAT r7 P3 #2): the plan puts an interview card on a second day on purpose (Sunday re-solves
// the week's interview cards); Week marks that repeat with "↻ again", and nothing else.
describe('weekTiles: the second pass (ruling 22 D2)', () => {
  it('marks only the later listing of an interview card: Sunday\'s problem (from Tue) and design (from Thu)', () => {
    const tiles = weekTiles(WED, START, ROT, sprint1(), [])
    expect(tiles.map(t => t.again)).toEqual([[], [], [], [], [], [], ['p', 'd']])
  })
  // UAT cu-3p P3-11: the lone open card of a sprint fills every AI day; each later listing says it is a repeat
  it('an AI card listed again only as a fallback (its own day\'s card is done) is marked on its later days too', () => {
    const ts = sprint1().map(t => (t.id === 'r' ? { ...t, status: 'done' as const } : t))
    const tiles = weekTiles(WED, START, ROT, ts, [])
    expect(tiles[2].tickets.map(t => t.id)).toEqual(['w']) // Wed (rebuild is done): the watch card again
    expect(tiles[2].again).toEqual(['w'])
    expect(tiles[0].again).toEqual([]) // Mon is its first listing
  })
  it('one card left in the sprint: listed on every working day, marked on all but the first', () => {
    const lone = [mkTicket({ id: 'only', kind: 'stage', session: 'watch', order: 0 })]
    const tiles = weekTiles(WED, START, ROT, lone, [])
    expect(tiles.map(t => t.tickets.map(x => x.id))).toEqual([['only'], ['only'], ['only'], ['only'], [], ['only'], ['only']])
    expect(tiles.map(t => t.again)).toEqual([[], ['only'], ['only'], ['only'], [], ['only'], ['only']])
  })
  it('a split card\'s parts are marked on the second day too', () => {
    const base = sprint1()
    const r = splitTicket({ ...base.find(t => t.id === 'p')!, estMin: 35 }, 3)
    const tiles = weekTiles(WED, START, ROT, [...base.filter(t => t.id !== 'p'), r.parent, ...r.children], [])
    expect(tiles[1].tickets.map(t => t.id)).toEqual(['p~1', 'p~2', 'p~3'])
    expect(tiles[1].again).toEqual([])
    expect(tiles[6].again).toEqual(['p~1', 'p~2', 'p~3', 'd'])
  })
  it('outside the plan window nothing is marked', () => {
    expect(weekTiles(ist('2026-10-01T10:00:00'), START, ROT, sprint1(), []).every(t => t.again.length === 0)).toBe(true)
  })
})

describe('weeklyMinutes', () => {
  it('sums the logged focus of the last 8 local weeks, Monday to Sunday, oldest first', () => {
    const now = ist('2026-10-21T10:00:00')
    const rows = weeklyMinutes(
      [focus('2026-10-18T23:59:00', 30), focus('2026-10-19T00:00:00', 20), focus('2026-08-01T10:00:00', 99)],
      now,
    )
    expect(rows).toHaveLength(8)
    expect(rows[7]).toEqual({ weekStart: parseLocalDate('2026-10-19'), minutes: 20 })
    expect(rows[6]).toEqual({ weekStart: parseLocalDate('2026-10-12'), minutes: 30 })
    expect(rows[0].weekStart).toBe(parseLocalDate('2026-08-31'))
    expect(rows.reduce((a, r) => a + r.minutes, 0)).toBe(50)
    expect(WEEK_TARGET_MIN).toBe(540)
  })
})

describe('sprintCalendar', () => {
  it('threads lastSprint so a ticket slid past S72 keeps a calendar for S73', () => {
    const lastSprint = effectiveLastSprint([mkTicket({ id: 'slid', sprint: 74, status: 'todo' })])
    expect(lastSprint).toBe(74)
    const s73Start = parseLocalDate(START) + (73 - 1) * SPRINT_DAYS * 86_400_000
    const cal = sprintCalendar(s73Start + 3 * 86_400_000, START, ROT, lastSprint)!
    expect(cal.sprint).toBe(73)
    expect(cal.days).toHaveLength(14)
  })
  it('lists the current sprint’s 14 days with a track per day', () => {
    const cal = sprintCalendar(WED, START, ROT)!
    expect(cal.sprint).toBe(1)
    expect(cal.days).toHaveLength(14)
    expect(cal.days[0].dateKey).toBe('2026-10-05')
    expect(cal.days.slice(0, 7).map(d => d.track)).toEqual(['ai', 'interview', 'ai', 'interview', 'off', 'ai', 'interview'])
    expect(cal.days.map(d => d.isToday).indexOf(true)).toBe(2)
    expect(cal.days.slice(0, 3).map(d => d.past)).toEqual([true, true, false])
  })
  it('is null outside the plan window', () => {
    expect(sprintCalendar(ist('2026-10-01T10:00:00'), START, ROT)).toBeNull()
  })
  it('maps role text to a track', () => {
    expect(['AI · watch', 'Interview · code', 'Off', 'Interview + teach-back', ''].map(roleTrack)).toEqual(['ai', 'interview', 'off', 'interview', null])
  })
})

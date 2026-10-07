import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { nowTileModel } from '../../src/rules/nowTile'
import { splitTicket } from '../../src/rules/split'
import { weekTiles } from '../../src/rules/week'
import { realPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

// Controller ruling 22 D1 (UAT r7 P2): in the day plan (Today's NOW and Week), a split card's OPEN parts take its
// place, in order, in the same slot and on the same day; done parts drop out; everything else in the slot stays.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const START = '2026-10-05' // Monday
const PLAN = realPlan()
const FOCUS = 'Stage 00: Setup + math by picture'
const DAY = { Mon: '2026-10-05', Tue: '2026-10-06', Wed: '2026-10-07', Thu: '2026-10-08', Sat: '2026-10-10', Sun: '2026-10-11' } as const

const sprint1 = (): Ticket[] => [
  mkTicket({ id: 'w', kind: 'stage', session: 'watch', title: 'Stage 00 watch', order: 0, links: [{ label: '3Blue1Brown calculus', url: 'https://a' }] }),
  mkTicket({ id: 'r', kind: 'stage', session: 'rebuild', title: 'Stage 00 rebuild', order: 1 }),
  mkTicket({ id: 'b', kind: 'stage', session: 'build', title: 'Stage 00 build', order: 2, estMin: 180 }),
  mkTicket({ id: 'tb', kind: 'stage', session: 'teachback', title: 'Stage 00 teach-back', order: 3, estMin: 120 }),
  mkTicket({ id: 'p200', track: 'interview', kind: 'problem', title: '200 · Number of Islands', order: 4, estMin: 35 }),
  mkTicket({ id: 'p695', track: 'interview', kind: 'problem', title: '695 · Max Area of Island', order: 5, estMin: 25 }),
  mkTicket({ id: 'd', track: 'interview', kind: 'design', title: 'URL shortener', order: 6, estMin: 90 }),
]
/** The card replaced by its parent (now a container) and its parts, as Split leaves the store. */
function split(ts: Ticket[], id: string, parts: number): Ticket[] {
  const r = splitTicket(ts.find(t => t.id === id)!, parts)
  return [...ts.filter(t => t.id !== id), r.parent, ...r.children]
}
const done = (ts: Ticket[], ...ids: string[]) => ts.map(t => (ids.includes(t.id) ? { ...t, status: 'done' as const, doneAt: ist('2026-10-06T22:00:00') } : t))
const now = (day: keyof typeof DAY, ts: Ticket[]) => nowTileModel({ nowMs: ist(`${DAY[day]}T21:10:00`), startDate: START, plan: PLAN, tickets: ts })
const week = (ts: Ticket[]) => Object.fromEntries(weekTiles(ist('2026-10-06T21:10:00'), START, PLAN.rotation, ts, []).map(t => [t.day, t.tickets.map(x => x.id)]))

describe('ruling 22 D1: code (Tue)', () => {
  it('200 split in 3: its parts stand in its place and 695 stays (UAT r7: the block was cut to one 12-min part)', () => {
    const ts = split(sprint1(), 'p200', 3)
    expect(week(sprint1()).Tue).toEqual(['p200', 'p695'])
    expect(week(ts).Tue).toEqual(['p200~1', 'p200~2', 'p200~3', 'p695'])
    const m = now('Tue', ts)
    expect(m.primaryId).toBe('p200~1') // NOW names the first open item
    expect(m.verb).toBe('Code · 2 × 25 min') // the block is unchanged: the parts sum to the card
    expect(m.sentence).toBe(
      'Two timed problems in four sessions, no agent: 200 · Number of Islands — part 1 of 3 · 12 min, part 2 of 3 · 12 min, part 3 of 3 · 11 min · 695 Max Area of Island',
    )
  })
  it('a done part drops out; the next open part leads', () => {
    const ts = done(split(sprint1(), 'p200', 3), 'p200~1')
    expect(week(ts).Tue).toEqual(['p200~2', 'p200~3', 'p695'])
    const m = now('Tue', ts)
    expect(m.primaryId).toBe('p200~2')
    expect(m.sentence).toBe('Two timed problems in three sessions, no agent: 200 · Number of Islands — part 2 of 3 · 12 min, part 3 of 3 · 11 min · 695 Max Area of Island')
  })
  it('the second problem split: the first stays, the parts follow it in its place', () => {
    const ts = split(sprint1(), 'p695', 2)
    expect(week(ts).Tue).toEqual(['p200', 'p695~1', 'p695~2'])
    expect(now('Tue', ts).primaryId).toBe('p200')
    expect(now('Tue', ts).sentence).toBe('Two timed problems in three sessions, no agent: 200 Number of Islands · 695 · Max Area of Island — part 1 of 2 · 13 min, part 2 of 2 · 12 min')
  })
  it('only one card\'s parts left: the block stays; a lone part is one session with its own minutes (ruling 20 S5)', () => {
    const two = done(split(sprint1(), 'p200', 3), 'p200~1', 'p695')
    expect(week(two).Tue).toEqual(['p200~2', 'p200~3'])
    expect(now('Tue', two)).toMatchObject({
      verb: 'Code · 2 × 25 min', sentence: 'One timed problem in two sessions, no agent: 200 · Number of Islands — part 2 of 3 · 12 min, part 3 of 3 · 11 min',
    })
    expect(now('Tue', two).sentence).not.toContain('Two timed problems')
    const one = done(two, 'p200~2')
    expect(now('Tue', one)).toMatchObject({
      primaryId: 'p200~3', verb: 'Code · 11 min', sentence: 'One timed session, no agent: 200 · Number of Islands — part 3 of 3 · 11 min',
    })
  })
  it('all parts done: the card is gone from the slot and the next problem moves up', () => {
    const ts = done(split(sprint1(), 'p200', 3), 'p200~1', 'p200~2', 'p200~3').map(t => (t.id === 'p200' ? { ...t, status: 'done' as const } : t))
    expect(week(ts).Tue).toEqual(['p695'])
  })
})

describe('ruling 22 D1: the other slots', () => {
  it('watch (Mon): the watch card\'s parts, in order; the rest of the week is unchanged', () => {
    const ts = split(sprint1(), 'w', 2)
    const w = week(ts)
    expect(w.Mon).toEqual(['w~1', 'w~2'])
    expect(w.Wed).toEqual(['r'])
    const m = now('Mon', ts)
    expect(m).toMatchObject({ primaryId: 'w~1', verb: 'Watch · 50 min' })
    expect(m.sentence).toBe(`Watch and type along: ${FOCUS} — 3Blue1Brown calculus · Stage 00 watch — part 1 of 2 · 25 min, part 2 of 2 · 25 min`)
    expect(now('Mon', done(ts, 'w~1'))).toMatchObject({ primaryId: 'w~2', verb: 'Watch · 25 min' })
    expect(week(done(ts, 'w~1')).Mon).toEqual(['w~2'])
  })
  it('rebuild (Wed)', () => {
    const ts = split(sprint1(), 'r', 2)
    expect(week(ts).Wed).toEqual(['r~1', 'r~2'])
    const m = now('Wed', ts)
    expect(m).toMatchObject({ primaryId: 'r~1', verb: 'Rebuild · 50 min' })
    expect(m.sentence).toBe(`Rebuild Monday's work from a blank editor, no video, no agent. ${FOCUS} · Stage 00 rebuild — part 1 of 2 · 25 min, part 2 of 2 · 25 min`)
    expect(week(done(ts, 'r~1')).Wed).toEqual(['r~2'])
  })
  it('build + break (Sat)', () => {
    const ts = split(sprint1(), 'b', 3)
    expect(week(ts).Sat).toEqual(['b~1', 'b~2', 'b~3'])
    const m = now('Sat', ts)
    expect(m).toMatchObject({ primaryId: 'b~1', verb: 'Build · 3 h' })
    expect(m.sentence).toBe(
      `Build + break: ${FOCUS} · Stage 00 build — part 1 of 3 · 60 min, part 2 of 3 · 60 min, part 3 of 3 · 60 min. The 30 min news slot comes first, timer on.`,
    )
    expect(week(done(ts, 'b~2')).Sat).toEqual(['b~1', 'b~3'])
  })
  it('teach-back (Sun): the teach-back\'s parts lead, the interview cards stay after them', () => {
    const ts = split(sprint1(), 'tb', 2)
    expect(week(sprint1()).Sun).toEqual(['tb', 'p200', 'p695'])
    expect(week(ts).Sun).toEqual(['tb~1', 'tb~2', 'p200', 'p695'])
    const m = now('Sun', ts)
    expect(m).toMatchObject({ primaryId: 'tb~1', verb: 'Teach-back · 2 h' })
    expect(m.sentence).toBe(
      `Teach back ${FOCUS} · Stage 00 teach-back — part 1 of 2 · 60 min, part 2 of 2 · 60 min: sketch it on paper or explain it in writing, then grade it against the rubric. Then: 200 Number of Islands · 695 Max Area of Island. Tick tasks, five lines in the vault.`,
    )
    expect(week(done(ts, 'tb~1')).Sun).toEqual(['tb~2', 'p200', 'p695'])
  })
  it('teach-back (Sun): a split interview card in the slot keeps its place, with its open parts', () => {
    const ts = done(split(sprint1(), 'p200', 3), 'p200~2')
    expect(week(ts).Sun).toEqual(['tb', 'p200~1', 'p200~3', 'p695'])
    expect(now('Sun', ts).sentence).toBe(
      `Teach back ${FOCUS}: sketch it on paper or explain it in writing, then grade it against the rubric. Then: 200 · Number of Islands — part 1 of 3 · 12 min, part 3 of 3 · 11 min · 695 Max Area of Island. Tick tasks, five lines in the vault.`,
    )
  })
  it('design (Thu)', () => {
    const ts = split(sprint1(), 'd', 2)
    expect(week(ts).Thu).toEqual(['d~1', 'd~2'])
    const m = now('Thu', ts)
    expect(m).toMatchObject({ primaryId: 'd~1', verb: 'Design · 45 min' })
    expect(m.sentence).toBe('One design in two sessions, recorded: URL shortener — part 1 of 2 · 45 min, part 2 of 2 · 45 min')
    expect(now('Thu', done(ts, 'd~1'))).toMatchObject({
      primaryId: 'd~2', verb: 'Design · 45 min', sentence: 'One design session, recorded: URL shortener — part 2 of 2 · 45 min',
    })
  })
})

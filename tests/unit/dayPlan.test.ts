import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { SAMPLE_SCHEDULE, scheduleOf } from '../../src/content/schedule'
import { cardRole, dayTime, daySentence, dayVerb, linkShort } from '../../src/rules/dayPlan'
import { mkTicket } from '../helpers/tickets'

const LIVE = {
  Mon: 'AI · watch', Tue: 'Interview · code', Wed: 'AI · rebuild', Thu: 'Interview · design',
  Fri: 'Off', Sat: 'AI · build + break', Sun: 'Interview + teach-back',
} as const
const FOCUS = 'Stage 00: Setup + math by picture'
const stage = (session: Ticket['session'], extra: Partial<Ticket> = {}) =>
  mkTicket({ id: `st-${session}`, kind: 'stage', session, track: 'ai', ...extra })
const prob = (num: number, name: string) =>
  mkTicket({ id: `p${num}`, kind: 'problem', track: 'interview', title: `${num} · ${name}`, links: [{ label: `LeetCode ${num}`, url: `https://leetcode.com/problems/p-${num}/` }] })
const design = mkTicket({ id: 'd1', kind: 'design', track: 'interview', title: 'URL shortener' })
const ivTask = mkTicket({ id: 'm1w1i1', kind: 'task', track: 'interview', title: 'Set the routine' })

describe('dayVerb on the live forge rotation', () => {
  it.each([
    ['Mon', stage('watch'), 'Watch · 50 min', 'watch', 'ai'],
    ['Tue', prob(200, 'Number of Islands'), 'Code · 2 × 25 min', 'code', 'interview'],
    ['Wed', stage('rebuild'), 'Rebuild · 50 min', 'rebuild', 'ai'],
    ['Thu', design, 'Design · 45 min', 'design', 'interview'],
    ['Thu', ivTask, 'Read · 50 min', 'read', 'interview'],
    ['Sat', stage('build'), 'Build · 3 h', 'build', 'ai'],
    ['Sun', stage('teachback'), 'Teach-back · 2 h', 'teachback', 'ai'],
  ] as const)('%s → %s', (day, lead, verb, kind, tone) => {
    expect(dayVerb(LIVE[day], day, lead)).toEqual({ verb, kind, tone })
  })

  it('Friday is Rest · off in the off tone, lead or not', () => {
    expect(dayVerb('Off', 'Fri', null)).toEqual({ verb: 'Rest · off', kind: 'rest', tone: 'off' })
  })

  it('with no lead ticket the tone falls back to the role track', () => {
    expect(dayVerb(LIVE.Mon, 'Mon', null).tone).toBe('ai')
    expect(dayVerb(LIVE.Tue, 'Tue', null).tone).toBe('interview')
  })
})

describe('dayVerb on legacy fixture roles', () => {
  it('maps weekday AI build, weekend build + news, weekend review, and unknown roles', () => {
    expect(dayVerb('AI · build', 'Wed', null).verb).toBe('Build · 50 min')
    expect(dayVerb('AI build + news slot', 'Sat', null).verb).toBe('Build · 3 h')
    expect(dayVerb('Interview + review', 'Sun', null).verb).toBe('Interview · 2 h')
    expect(dayVerb('Interview + review', 'Tue', null).verb).toBe('Interview · 50 min')
    expect(dayVerb('Juggling', 'Tue', null)).toMatchObject({ verb: 'Today', kind: 'other' })
  })
})

describe('dayTime (prototype dayPlan time block)', () => {
  it('has the weeknight, Friday, Saturday and Sunday slots', () => {
    expect(dayTime('Mon')).toBe('21:00 – 21:50')
    expect(dayTime('Thu')).toBe('21:00 – 21:50')
    expect(dayTime('Fri')).toBe('0 min')
    expect(dayTime('Sat')).toBe('3 h + 30 min news')
    expect(dayTime('Sun')).toBe('2 h + 30 min review')
  })
  it('G6: the weeknight block is plan data (plan.schedule.block), the sample when the plan has none', () => {
    const own = scheduleOf({ schedule: { block: { start: '19:30', end: '20:20' } } })
    expect(dayTime('Tue', own)).toBe('19:30 – 20:20')
    expect(dayTime('Sat', own)).toBe('3 h + 30 min news')
    expect(dayTime('Wed', scheduleOf({}))).toBe(dayTime('Wed', SAMPLE_SCHEDULE))
  })
})

describe('linkShort (prototype today.linkShort)', () => {
  it('drops parentheses, cuts at : or ·, and ellipsises past 22 chars to 20', () => {
    expect(linkShort('3Blue1Brown linear algebra (Essence of LA)')).toBe('3Blue1Brown linear a…')
    expect(linkShort('Anthropic Academy: Claude with the Anthropic API (free)')).toBe('Anthropic Academy')
    expect(linkShort('NeetCode · Graphs')).toBe('NeetCode')
    expect(linkShort('LeetCode 200')).toBe('LeetCode 200')
  })
})

describe('daySentence', () => {
  it('watch: stage focus plus the reference labels; legacy watch uses the title', () => {
    const w = stage('watch', { links: [{ label: '3Blue1Brown calculus', url: 'https://a' }, { label: '3Blue1Brown neural nets', url: 'https://b' }] })
    expect(daySentence('watch', [w], FOCUS)).toBe(
      'Watch and type along: Stage 00: Setup + math by picture — 3Blue1Brown calculus · 3Blue1Brown neural nets',
    )
    const legacy = mkTicket({ id: 'm1w2t1', title: 'Watch Essence of Linear Algebra chapters 1 to 8' })
    expect(daySentence('watch', [legacy], FOCUS)).toBe('Watch and type along: Watch Essence of Linear Algebra chapters 1 to 8')
  })
  it('UAT J3: a watch stage whose own text says "not code to type along with" is just "Watch" (Today agrees with Do)', () => {
    const videos = stage('watch', {
      text: 'Stage 00 Setup + math by picture, watch 1 of 1. Monday: watch the reference below — these are videos, not code to type along with. The brief is forge/stages/00-setup/brief.md',
      links: [{ label: '3Blue1Brown calculus', url: 'https://a' }],
    })
    expect(daySentence('watch', [videos], FOCUS)).toBe('Watch: Stage 00: Setup + math by picture — 3Blue1Brown calculus')
    const typed = stage('watch', { text: 'Stage 01 micrograd, watch 1 of 3. Monday: open the reference below and type along with it; do not copy.' })
    expect(daySentence('watch', [typed], FOCUS)).toBe('Watch and type along: Stage 00: Setup + math by picture')
  })
  it('rebuild, build and teach-back use the stage focus', () => {
    expect(daySentence('rebuild', [stage('rebuild')], FOCUS)).toBe(
      "Rebuild Monday's work from a blank editor, no video, no agent. Stage 00: Setup + math by picture",
    )
    expect(daySentence('build', [stage('build')], FOCUS)).toBe(
      'Build + break: Stage 00: Setup + math by picture. The 30 min news slot comes first, timer on.',
    )
    expect(daySentence('teachback', [stage('teachback'), ivTask], FOCUS)).toBe(
      'Teach back Stage 00: Setup + math by picture: sketch it on paper or explain it in writing, then grade it against the rubric. Then: Set the routine. Tick tasks, five lines in your notes.',
    )
  })
  it('code: two, one, or no problems', () => {
    expect(daySentence('code', [prob(200, 'Number of Islands'), prob(695, 'Max Area of Island')], FOCUS)).toBe(
      'Two timed problems, 25 min each, no agent: 200 Number of Islands · 695 Max Area of Island',
    )
    expect(daySentence('code', [prob(200, 'Number of Islands')], FOCUS)).toBe('One timed problem, 25 min, no agent: 200 Number of Islands')
    expect(daySentence('code', [ivTask], FOCUS)).toBe('Timed practice, no agent: Set the routine')
  })
  it('design, read, interview, rest, and a day with nothing left', () => {
    expect(daySentence('design', [design], FOCUS)).toBe('One design in 45 min, recorded: URL shortener')
    expect(daySentence('read', [ivTask], FOCUS)).toBe('Reading for the interview track: Set the routine')
    expect(daySentence('interview', [ivTask, prob(1, 'Two Sum')], FOCUS)).toBe('Set the routine · 1 Two Sum. Tick tasks, five lines in your notes.')
    expect(daySentence('rest', [], FOCUS)).toBe('Rest, exercise, nothing else.')
    expect(daySentence('rest', [], FOCUS, scheduleOf({ schedule: { restDay: 'A slow walk.' } }))).toBe('A slow walk.')
    expect(daySentence('code', [], FOCUS)).toBe('Nothing left for today in this sprint. Pick anything from the Board.')
  })
})

describe('UAT r2 J3: the eyebrow names the card shown', () => {
  it('dayVerb says when it names the lead card instead of the role', () => {
    expect(dayVerb('AI · watch', 'Mon', stage('watch')).byCard).toBeUndefined()
    expect(dayVerb('AI · watch', 'Mon', stage('rebuild'))).toMatchObject({ kind: 'rebuild', byCard: true })
  })
  it('cardRole writes the card in the rotation\'s words', () => {
    expect(cardRole(stage('rebuild'))).toBe('AI · rebuild')
    expect(cardRole(stage('build'))).toBe('AI · build + break')
    expect(cardRole(stage('teachback'))).toBe('AI · teach-back')
    expect(cardRole(mkTicket({ id: 'p1', kind: 'problem', track: 'interview' }))).toBe('Interview · code')
  })
})

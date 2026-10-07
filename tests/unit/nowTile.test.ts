import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { nowTileModel } from '../../src/rules/nowTile'
import { splitTicket } from '../../src/rules/split'
import { smallPlan } from '../helpers/plan'
import { smallTickets } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const at = (s: string, tickets: Ticket[] = smallTickets()) =>
  nowTileModel({ nowMs: ist(s), startDate: '2026-09-07', plan: smallPlan, tickets })

describe('nowTileModel', () => {
  it('active Monday: eyebrow, time, verb, tone, sentence, lead (Start ▸ target), secondary Open link', () => {
    const m = at('2026-09-07T21:10:00')
    expect(m).toMatchObject({
      phase: 'active', eyebrow: 'SPRINT 1 · DAY 1 OF 14 · AI · watch', time: '21:00 – 21:50',
      verb: 'Watch · 50 min', tone: 'ai', primaryId: 'm1w1t1', sprint: 1, dayInSprint: 1,
      sentence: 'Watch and type along: Rung 1, the API call',
    })
    expect(m.link).toEqual({
      url: 'https://example.com/academy',
      label: 'Anthropic Academy: Claude with the Anthropic API (free)',
      short: 'Anthropic Academy',
    })
  })

  it('before the start date previews Sprint 1 day 1 as a full command center', () => {
    const m = at('2026-09-01T09:00:00')
    expect(m).toMatchObject({
      phase: 'before', eyebrow: 'PLAN STARTS 2026-09-07 · SPRINT 1 · DAY 1 OF 14 · AI · watch',
      time: 'in 6 days · 21:00 – 21:50', verb: 'Watch · 50 min', primaryId: 'm1w1t1', sprint: 1, dayInSprint: 0,
    })
    expect(at('2026-09-06T09:00:00').time).toBe('in 1 day · 21:00 – 21:50')
  })

  it('Friday is a rest day with no lead and no link', () => {
    expect(at('2026-09-11T21:00:00')).toMatchObject({
      verb: 'Rest · off', tone: 'off', sentence: 'Rest, exercise, nothing else.', primaryId: null, link: null, time: '0 min',
    })
  })

  it('after the plan: Plan complete, no lead (Review Focus #5)', () => {
    const m = at('2029-06-11T09:00:00')
    expect(m).toMatchObject({ phase: 'after', verb: 'Plan complete', tone: 'off', primaryId: null, link: null, sprint: 72, dayInSprint: 14 })
    expect(m.sentence.startsWith('All 72 sprints are behind you.')).toBe(true)
  })

  it('never turns a non-web link into Open ↗ (Review Focus #2)', () => {
    const withHash = smallTickets().map(t =>
      t.id === 'm1w1t1'
        ? { ...t, links: [{ label: 'DSA bank tab', url: '#bank' }, { label: '3Blue1Brown linear algebra (Essence)', url: 'https://www.3blue1brown.com/' }] }
        : t,
    )
    expect(at('2026-09-07T21:10:00', withHash).link).toEqual({
      url: 'https://www.3blue1brown.com/', label: '3Blue1Brown linear algebra (Essence)', short: '3Blue1Brown linear a…',
    })
    const onlyHash = smallTickets().map(t => (t.id === 'm1w1t1' ? { ...t, links: [{ label: 'DSA bank tab', url: '#bank' }] } : t))
    expect(at('2026-09-07T21:10:00', onlyHash).link).toBeNull()
  })

  it('Tuesday on the fixture picks problems and reads as a code day', () => {
    const m = at('2026-09-08T21:10:00')
    expect(m.verb).toBe('Code · 2 × 25 min')
    expect(m.tone).toBe('interview')
    expect(m.sentence).toBe('Two timed problems, 25 min each, no agent: 200 Number of Islands · 127 Word Ladder')
    expect(m.link?.short).toBe('LeetCode 200')
  })

  it('ruling 20 S5 + 22 D1: after a split, the parts stand in the card\'s place; NOW names the first, never "two timed problems" for parts of one', () => {
    const base = smallTickets()
    const p200 = base.find(t => t.id === 'p200')!
    const { parent, children } = splitTicket({ ...p200, estMin: 35 }, 3)
    const tickets = [...base.filter(t => t.id !== 'p200'), parent, ...children]
    const m = at('2026-09-08T21:10:00', tickets)
    expect(m.primaryId).toBe('p200~1')
    expect(m.verb).toBe('Code · 2 × 25 min')
    expect(m.sentence).toBe(
      'Two timed problems in four sessions, no agent: 200 · Number of Islands — part 1 of 3 · 12 min, part 2 of 3 · 12 min, part 3 of 3 · 11 min · 127 Word Ladder',
    )
    // part 1 done: it drops out, the next part leads
    const next = at('2026-09-08T21:10:00', tickets.map(t => (t.id === 'p200~1' ? { ...t, status: 'done' as const } : t)))
    expect(next.primaryId).toBe('p200~2')
    expect(next.sentence).toBe('Two timed problems in three sessions, no agent: 200 · Number of Islands — part 2 of 3 · 12 min, part 3 of 3 · 11 min · 127 Word Ladder')
  })
})

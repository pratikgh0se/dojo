// @vitest-environment jsdom
// R1 scope 2, W3 + W8 + W9: the pure rules (destinations, keys, palette, Designs search, Path filter memory, Guide copy).
import { describe, expect, it } from 'vitest'
import { GUIDE } from '../../src/content/guide'
import { DESTINATIONS, MORE_IDS, TAB_IDS, currentDestination, titleFor } from '../../src/rules/nav'
import { rank, skillItems, STATIC_ITEMS, ticketItems, type PaletteItem } from '../../src/rules/palette'
import { filterDesigns, normalizeQuery } from '../../src/rules/designSearch'
import { clearPathFilter, loadPathFilter, savePathFilter } from '../../src/rules/pathFilter'
import { designTiers } from '../../src/rules/designs'
import type { PlanJson } from '../../src/data/types'
import { flatPlanV2 } from '../helpers/plan'
import { mkPlanV2, mkTicket } from '../helpers/planV2'

describe('NAV-01/02: the twelve destinations', () => {
  it('lists them in rail order with routes, groups and keys 1 to 6 on the first six only', () => {
    expect(DESTINATIONS.map(d => [d.id, d.to, d.label, d.group, d.key ?? null])).toEqual([
      ['today', '/', 'Today', 'main', '1'], ['path', '/path', 'Path', 'main', '2'], ['board', '/board', 'Board', 'main', '3'],
      ['journal', '/journal', 'Journal', 'main', '4'], ['skills', '/skills', 'Skills', 'main', '5'], ['review', '/review', 'Review', 'main', '6'],
      ['ai', '/ai-topics', 'AI', 'topics', null], ['dsa', '/dsa', 'DSA', 'topics', null], ['designs', '/designs', 'Designs', 'topics', null],
      ['banks', '/banks', 'Banks', 'practice', null], ['atlas', '/atlas', 'Atlas', 'practice', null], ['guide', '/guide', 'Guide', 'foot', null],
    ])
  })
  it('splits the phone: four tabs and the eight others in the More sheet (NAV-09, NAV-10)', () => {
    expect(TAB_IDS).toEqual(['today', 'path', 'board', 'review'])
    expect(MORE_IDS).toEqual(['journal', 'skills', 'ai', 'dsa', 'designs', 'banks', 'atlas', 'guide'])
  })
})

describe('NAV-03: the current item follows the route', () => {
  it('maps every route', () => {
    const cases: [string, string | null][] = [
      ['/', 'today'], ['/path', 'path'], ['/board', 'board'], ['/journal', 'journal'], ['/skills', 'skills'], ['/skills/area/llm', 'skills'],
      ['/skills/stats', 'skills'], ['/review', 'review'], ['/ai-topics', 'ai'], ['/dsa', 'dsa'], ['/designs', 'designs'], ['/banks', 'banks'],
      ['/atlas', 'atlas'], ['/guide', 'guide'], ['/do/t1', null], ['/designs/session/d1', null], ['/settings', null],
    ]
    for (const [p, id] of cases) expect(currentDestination(p), p).toBe(id)
  })
  it('gives the header title only where the screen draws no h1 of its own', () => {
    expect(titleFor('/journal')).toBe('Journal')
    for (const p of ['/board', '/ai-topics', '/guide', '/dsa', '/designs', '/atlas', '/banks']) expect(titleFor(p), p).toBe('')
    expect(titleFor('/settings')).toBe('Settings')
  })
})

describe('NAV-37/38/39: the palette', () => {
  const plan = mkPlanV2()
  const tickets = [
    mkTicket({ id: 'd-kv', kind: 'design', title: 'Design a key-value store', status: 'todo' }),
    mkTicket({ id: 'd-done', kind: 'design', title: 'Design a chat service', status: 'done' }),
    mkTicket({ id: 'w-up', kind: 'writeup', title: 'Write-up of the scheduler', status: 'doing' }),
    mkTicket({ id: 'p1', kind: 'problem', title: 'Number of islands' }),
    mkTicket({ id: 'r1', kind: 'read', title: 'Read the Raft paper' }),
  ]
  const all: PaletteItem[] = [...STATIC_ITEMS, ...skillItems(plan), ...ticketItems(tickets)]
  const targetOf = (q: string) => rank(all, q).map(i => i.target)
  it('sends every design and write-up ticket, in any status, to the design session', () => {
    expect(targetOf('key-value')).toContain('/designs/session/d-kv')
    expect(targetOf('key-value')).not.toContain('/do/d-kv')
    expect(targetOf('chat service')).toContain('/designs/session/d-done')
    expect(targetOf('scheduler')).toContain('/designs/session/w-up')
  })
  it('keeps /do for the other kinds', () => {
    expect(targetOf('islands')).toContain('/do/p1')
    expect(targetOf('raft')).toContain('/do/r1')
  })
  it('lists Today to Review first with keys 1 to 6 under an empty query', () => {
    const r = rank(all, '')
    expect(r.slice(0, 6).map(i => [i.label, i.target, i.key])).toEqual([
      ['Today', '/', '1'], ['Path', '/path', '2'], ['Board', '/board', '3'], ['Journal', '/journal', '4'], ['Skills', '/skills', '5'], ['Review', '/review', '6'],
    ])
  })
  it('finds the other destinations by name', () => {
    for (const [q, to] of [['board', '/board'], ['journal', '/journal'], ['ai topics', '/ai-topics'], ['guide', '/guide'], ['dsa', '/dsa'], ['designs', '/designs'], ['banks', '/banks'], ['atlas', '/atlas']] as const) {
      expect(targetOf(q), q).toContain(to)
    }
    expect(rank(all, 'board')[0].target).toBe('/board')
  })
})

describe('NAV-33: what a Designs query matches', () => {
  const plan: PlanJson = {
    ...flatPlanV2,
    design_bank: [
      { tier: 'Foundations (sprints 1 to 4)', skill: 'sysd', items: [
        { id: 'd-a', title: 'Rate limiter', difficulty: 'M', deep_dives: ['x'], refs: [] },
        { id: 'd-b', title: 'Cache layer', difficulty: 'H', deep_dives: ['x'], refs: [] },
      ] },
      { tier: 'Hard classic designs (sprints 5 to 8)', skill: 'sysd', items: [
        { id: 'd-c', title: 'News feed', difficulty: 'M', deep_dives: ['x'], refs: [] },
        { id: 'd-d', title: 'Payments cache', difficulty: 'H', deep_dives: ['x'], refs: [] },
      ] },
    ],
  } as PlanJson
  const tiers = designTiers(plan, [])
  const ids = (q: string) => filterDesigns(tiers, q).flatMap(g => g.items.map(i => i.id))
  it('matches a title word, in any order, case-insensitively', () => {
    expect(ids('limiter')).toEqual(['d-a'])
    expect(ids('LIMITER RATE')).toEqual(['d-a'])
    expect(ids('cache')).toEqual(['d-b', 'd-d'])
  })
  it('matches a tier name, a difficulty word, and combines words with AND', () => {
    expect(ids('foundations')).toEqual(['d-a', 'd-b'])
    expect(ids('hard')).toEqual(expect.arrayContaining(['d-b', 'd-d']))
    expect(ids('medium')).toEqual(['d-a', 'd-c'])
    expect(ids('cache foundations')).toEqual(['d-b'])
    expect(ids('limiter classic')).toEqual([])
  })
  it('ignores the sprint suffix of the tier and extra spaces; spaces only is empty', () => {
    expect(ids('sprints')).toEqual([])
    expect(ids('  rate    limiter  ')).toEqual(['d-a'])
    expect(normalizeQuery('   ')).toBe('')
    expect(normalizeQuery('  A  b ')).toBe('a b')
  })
  it('groups by tier, in tier and bank order, and drops empty tiers', () => {
    const g = filterDesigns(tiers, 'cache')
    expect(g.map(x => [x.tier.index, x.tier.label, x.items.length])).toEqual([[1, 'Foundations', 1], [2, 'Hard classic designs', 1]])
  })
})

describe('NAV-40/41: Path remembers its filter for the tab', () => {
  const mem = (): Storage => {
    const m = new Map<string, string>()
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage
  }
  it('round-trips a lane and a query; a default state stores nothing', () => {
    const s = mem()
    expect(loadPathFilter(s)).toEqual({ lane: 'all', query: '' })
    savePathFilter({ lane: 'dsa', query: 'graph' }, s)
    expect(loadPathFilter(s)).toEqual({ lane: 'dsa', query: 'graph' })
    savePathFilter({ lane: 'all', query: '' }, s)
    expect(s.getItem('dojo.path.filter')).toBeNull()
  })
  it('falls back to the defaults on junk or a missing storage', () => {
    const s = mem()
    s.setItem('dojo.path.filter', '{not json')
    expect(loadPathFilter(s)).toEqual({ lane: 'all', query: '' })
    s.setItem('dojo.path.filter', JSON.stringify({ lane: 'nope', query: 7 }))
    expect(loadPathFilter(s)).toEqual({ lane: 'all', query: '' })
    expect(loadPathFilter(null)).toEqual({ lane: 'all', query: '' })
    expect(() => savePathFilter({ lane: 'dsa', query: 'x' }, null)).not.toThrow()
    s.setItem('dojo.path.filter', JSON.stringify({ lane: 'dsa', query: 'x' }))
    clearPathFilter(s)
    expect(loadPathFilter(s)).toEqual({ lane: 'all', query: '' })
  })
})

describe('NAV-27/28: the Guide copy', () => {
  const text = (id: string) => JSON.stringify(GUIDE.find(s => s.id === id)).toLowerCase()
  it('has the nine sections in order', () => {
    expect(GUIDE.map(s => s.id)).toEqual(['overview', 'destinations', 'board', 'review', 'skills', 'ritual', 'design', 'mentors', 'shortcuts'])
    expect(GUIDE.find(s => s.id === 'overview')!.title.startsWith('The daily loop')).toBe(true)
    expect(GUIDE.find(s => s.id === 'destinations')!.title).toBe('Where things live')
    expect(GUIDE.find(s => s.id === 'board')!.title).toBe('Board and sprints')
    expect(GUIDE.find(s => s.id === 'review')!.title).toBe('Review and banks')
    expect(GUIDE.find(s => s.id === 'skills')!.title).toBe('Skills and topics')
    expect(GUIDE.find(s => s.id === 'design')!.title).toBe('Design sessions')
    expect(GUIDE.find(s => s.id === 'shortcuts')!.title).toBe('Shortcuts')
  })
  it('names what the contract says each section names', () => {
    const o = text('overview')
    for (const w of ['today', 'done', 'journal']) expect(o).toContain(w)
    expect(o.indexOf('today')).toBeLessThan(o.indexOf('ticket'))
    expect(o.indexOf('ticket')).toBeLessThan(o.indexOf('done'))
    expect(o.indexOf('done')).toBeLessThan(o.indexOf('journal'))
    for (const w of ['board', 'sprint', 'blocked', 'need help', 'backlog']) expect(text('board')).toContain(w)
    for (const w of ['review', 'banks']) expect(text('review')).toContain(w)
    for (const w of ['skills', 'ai', 'dsa', 'designs']) expect(text('skills')).toContain(w)
    for (const w of ['pulse', 'try a model']) expect(text('ritual')).toContain(w)
    expect(text('design')).toContain('design session')
  })
  it('avoids the banned words (GLOBAL-01)', () => {
    const all = JSON.stringify(GUIDE).toLowerCase()
    expect(all).not.toMatch(/interview|streak|overdue|behind schedule|you missed|falling behind/)
  })
})

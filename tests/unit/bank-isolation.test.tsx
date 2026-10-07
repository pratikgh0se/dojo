import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { runReconcile } from '../../src/data/seed'
import { debtBar } from '../../src/rules/board'
import { bankItemXp, bankTicket, linkLabel, originFor, originLabel } from '../../src/rules/bankTickets'
import { leftBehind } from '../../src/rules/load'
import { sprintPath } from '../../src/rules/map'
import { burnUp, pace, rings } from '../../src/rules/progress'
import { carrotHp, milestoneBadges } from '../../src/rules/vitals'
import { cfXp, planXp, ticketBaseXp, totalXp } from '../../src/rules/xp'
import { Vitals } from '../../src/ui/Vitals'
import type { BankEntry } from '../../src/rules/banks'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { mkTicket, smallTickets } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00')
const entry = (p: Partial<BankEntry> & { id: string }): BankEntry =>
  ({ name: p.id, url: 'https://leetcode.com/problems/x/', difficulty: 'E', pattern: null, group: 'g', kind: 'problem', ...p })

describe('bank XP (DATA "XP")', () => {
  it('E 5, M 10, H 15, design 20, Codeforces round(rating/100) − 7', () => {
    expect([bankItemXp(entry({ id: 'a' })), bankItemXp(entry({ id: 'b', difficulty: 'M' })), bankItemXp(entry({ id: 'c', difficulty: 'H' }))]).toEqual([5, 10, 15])
    expect(bankItemXp(entry({ id: 'hi-x', kind: 'design', difficulty: null }))).toBe(20)
    expect([cfXp(1200), cfXp(1600), cfXp(1700)]).toEqual([5, 9, 10])
    expect(bankItemXp(entry({ id: 'cf-1A', difficulty: 1600 }))).toBe(9)
    expect(ticketBaseXp(mkTicket({ id: 'cf-1A', kind: 'problem', rating: 1300 }))).toBe(6)
    expect(ticketBaseXp(mkTicket({ id: 'p1', kind: 'problem', difficulty: 'H' }))).toBe(15)
  })
})

describe('bankTicket', () => {
  it('creates a done ticket in the current sprint with the bank origin', () => {
    const t = bankTicket(entry({ id: 'p1', name: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/' }), 'blind75', NOW, 3)
    expect(t).toMatchObject({
      id: 'p1', origin: 'bank:blind75', track: 'interview', kind: 'problem', title: 'Two Sum', status: 'done',
      sprint: 3, plannedSprint: 3, doneAt: NOW, xp: 5, order: NOW, slidFrom: [], difficulty: 'E', estMin: 30,
      links: [{ label: 'LeetCode', url: 'https://leetcode.com/problems/two-sum/' }],
    })
    const cf = bankTicket(entry({ id: 'cf-4C', difficulty: 1300, url: 'https://codeforces.com/problemset/problem/4/C' }), 'codeforces', NOW, 1)
    expect(cf.rating).toBe(1300)
    expect(cf.difficulty).toBeUndefined()
    expect(cf.xp).toBe(6)
    const text = bankTicket(entry({ id: 'mine-x', url: null, difficulty: 'H' }), 'mine', NOW, 1)
    expect(text.origin).toBe('mine')
    expect(text.links).toEqual([])
  })
  it('labels origins with the tab label', () => {
    expect(originFor('hellointerview')).toBe('bank:hellointerview')
    expect(originLabel('bank:blind75')).toBe('Fixture Set B')
    expect(originLabel('mine')).toBe('Mine')
    expect(originLabel('plan')).toBeNull()
    expect(linkLabel('https://codeforces.com/problemset/problem/4/C')).toBe('Codeforces')
    expect(linkLabel('https://practice.geeksforgeeks.org/problems/x')).toBe('GFG')
  })
})

describe('plan-side rules ignore bank tickets', () => {
  const plan = smallTickets()
  const bank = [
    bankTicket(entry({ id: 'p9001', difficulty: 'H' }), 'blind75', NOW, 1),
    bankTicket(entry({ id: 'hi-bitly', kind: 'design', difficulty: null }), 'hellointerview', NOW, 1),
  ]
  const both = [...plan, ...bank]
  it('XP: total counts bank ticks, plan XP (form) does not', () => {
    expect(totalXp(both) - totalXp(plan)).toBe(35)
    expect(planXp(both)).toBe(planXp(plan))
  })
  it('Board load, progress, map cubes, Carrot HP, left-behind and badges are unchanged', () => {
    expect(debtBar(both, 1)).toEqual(debtBar(plan, 1))
    expect(rings(both)).toEqual(rings(plan))
    expect(burnUp(both, '2026-09-07', 1, 3)).toEqual(burnUp(plan, '2026-09-07', 1, 3))
    expect(pace(both, [], '2026-09-07', NOW)).toEqual(pace(plan, [], '2026-09-07', NOW))
    expect(sprintPath(smallPlan, both, 1)).toEqual(sprintPath(smallPlan, plan, 1))
    expect(carrotHp(both, 1)).toEqual(carrotHp(plan, 1))
    expect(leftBehind(both, 2)).toEqual(leftBehind(plan, 2))
    expect(milestoneBadges(both).filter(b => b.glyph !== '1')).toEqual(milestoneBadges(plan).filter(b => b.glyph !== '1'))
  })
})

describe('reconcile keeps bank tickets', () => {
  it('a bank ticket survives a second reconcile (reload) untouched', async () => {
    const d = await seededDb()
    const t = bankTicket(entry({ id: 'p9001' }), 'blind75', NOW, 1)
    await d.tickets.put(t)
    await runReconcile(d, smallPlan)
    expect(await d.tickets.get('p9001')).toEqual(t)
  })
})

describe('moveTicket with bank tickets', () => {
  it('moving a done bank ticket out of Done deletes it and refunds its XP', async () => {
    const d = await seededDb()
    await d.tickets.put(bankTicket(entry({ id: 'p9001' }), 'blind75', NOW, 1))
    expect(await moveTicket(d, 'p9001', 'doing', NOW)).toEqual({ ok: true, xpDelta: -5 })
    expect(await d.tickets.get('p9001')).toBeUndefined()
    expect((await d.events.toArray()).at(-1)).toMatchObject({ t: 'untick', id: 'p9001' })
  })
  it('plan tickets still use their base XP', async () => {
    const d = await seededDb()
    const id = smallTickets().find(t => t.kind === 'problem')!.id
    const res = await moveTicket(d, id, 'done', NOW)
    expect(res.ok).toBe(true)
  })
})

describe('Vitals', () => {
  it('uses formXp for the form and xp for LV and the XP total', () => {
    render(<Vitals xp={600} formXp={0} possible={6015} pose="idle" />)
    expect(screen.getByTestId('form-name')).toHaveTextContent('BASE')
    expect(screen.getByTestId('level')).toHaveTextContent('LV 60')
    expect(screen.getByTestId('xp-total')).toHaveTextContent('600 XP')
  })
})

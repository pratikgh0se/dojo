import { describe, expect, it } from 'vitest'
import { reconcilePlan, resolveId } from '../../src/rules/reconcile'
import { planToTickets } from '../../src/rules/planTickets'
import type { Ticket } from '../../src/data/types'
import { smallPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const content = planToTickets(smallPlan)
const byId = (ts: Ticket[]) => Object.fromEntries(ts.map(t => [t.id, t]))
const sorted = (ts: Ticket[]) => [...ts].sort((a, b) => a.id.localeCompare(b.id))
const seeded = () => reconcilePlan([], content, {}).puts

describe('resolveId', () => {
  const live = (id: string) => ['c', 'm1w1t1'].includes(id)
  it('follows chains to the first live id', () => {
    expect(resolveId('a', { a: 'b', b: 'c' }, live)).toBe('c')
    expect(resolveId('a', { a: 'c', c: 'd' }, live)).toBe('c')
  })
  it('returns null for dead ends and cycles', () => {
    expect(resolveId('a', { a: 'b' }, live)).toBeNull()
    expect(resolveId('q', { q: 'r', r: 'q' }, live)).toBeNull()
    expect(resolveId('z', {}, live)).toBeNull()
  })
})

describe('reconcilePlan', () => {
  it('first run inserts every plan id as todo at plannedSprint', () => {
    const r = reconcilePlan([], content, {})
    expect(r.inserted).toHaveLength(10)
    expect(r.puts).toHaveLength(10)
    expect(r.puts.every(t => t.status === 'todo' && t.sprint === t.plannedSprint && t.xp === 0 && t.archived === false)).toBe(true)
    expect(r).toMatchObject({ deletes: [], renames: [], archived: [] })
  })

  it('is idempotent', () => {
    const first = seeded()
    const second = reconcilePlan(first, content, {})
    expect(second).toMatchObject({ inserted: [], deletes: [], renames: [], archived: [] })
    expect(sorted(second.puts)).toEqual(sorted(first))
  })

  it('refreshes content but keeps state for ids in both', () => {
    const worked = seeded().map(t =>
      t.id === 'm1w1t1' ? { ...t, status: 'done' as const, xp: 10, doneAt: 5, sprint: 2, slidFrom: [1], proof: { repo: 'r' } } : t,
    )
    const edited = content.map(c => (c.id === 'm1w1t1' ? { ...c, title: 'New title' } : c))
    const t = byId(reconcilePlan(worked, edited, {}).puts).m1w1t1
    expect(t).toMatchObject({ title: 'New title', status: 'done', xp: 10, doneAt: 5, sprint: 2, slidFrom: [1], proof: { repo: 'r' } })
  })

  it('archives vanished ids with no idMap entry, keeping xp and doneAt', () => {
    const gone = mkTicket({ id: 'm9w9t9', status: 'done', xp: 10, doneAt: 5 })
    const r = reconcilePlan([...seeded(), gone], content, {})
    expect(byId(r.puts).m9w9t9).toMatchObject({ archived: true, status: 'done', xp: 10, doneAt: 5 })
    expect(r.archived).toEqual(['m9w9t9'])
    expect(r.deletes).toEqual([])
    expect(reconcilePlan(r.puts, content, {}).archived).toEqual([])
  })

  it('renames via idMap, moving state onto the new id (sprint resets to the plan, per fix round 1 amendment)', () => {
    const old = mkTicket({ id: 'old1', status: 'done', xp: 10, doneAt: 7, sprint: 4, slidFrom: [1, 2, 3], proof: { note: 'n' } })
    const r = reconcilePlan([old], content, { old1: 'm1w1t1' })
    const t = byId(r.puts).m1w1t1
    expect(t).toMatchObject({ title: 'Rung 1, the API call', status: 'done', xp: 10, doneAt: 7, sprint: 1, slidFrom: [1, 2, 3], proof: { note: 'n' }, archived: false })
    expect(byId(r.puts).old1).toBeUndefined()
    expect(r.deletes).toEqual(['old1'])
    expect(r.renames).toEqual([{ from: 'old1', to: 'm1w1t1' }])
    expect(r.inserted).not.toContain('m1w1t1')
    expect(r.puts).toHaveLength(10)
  })
})

describe('idMap chains and re-added ids (Review Focus #6)', () => {
  it('(a) merges a done+todo fan-in: keeps done status, sums xp, keeps doneAt', () => {
    const a = mkTicket({ id: 'a', status: 'done', xp: 10, doneAt: 7 })
    const b = mkTicket({ id: 'b', status: 'todo' })
    const r = reconcilePlan([a, b], content, { a: 'm1w1t1', b: 'm1w1t1' })
    expect(r.renames).toEqual([{ from: 'a', to: 'm1w1t1' }, { from: 'b', to: 'm1w1t1' }])
    expect(r.deletes).toEqual(['a', 'b'])
    expect(byId(r.puts).m1w1t1).toMatchObject({ status: 'done', xp: 10, doneAt: 7 })
  })

  it('(b) sums xp across two done rows fanning into the same target; doneAt is the earlier one', () => {
    const a = mkTicket({ id: 'a', status: 'done', xp: 10, doneAt: 10 })
    const b = mkTicket({ id: 'b', status: 'done', xp: 10, doneAt: 3 })
    const r = reconcilePlan([a, b], content, { a: 'm1w1t1', b: 'm1w1t1' })
    expect(byId(r.puts).m1w1t1).toMatchObject({ status: 'done', xp: 20, doneAt: 3 })
  })

  it("(c) merges onto an existing target row, summing xp and keeping the target's own sprint", () => {
    const target = mkTicket({ id: 'm1w1t1', status: 'done', xp: 10, sprint: 3 })
    const old = mkTicket({ id: 'old1', status: 'done', xp: 10, sprint: 9 })
    const r = reconcilePlan([target, old], content, { old1: 'm1w1t1' })
    expect(byId(r.puts).m1w1t1).toMatchObject({ status: 'done', xp: 20, sprint: 3 })
  })

  it('(d) is deterministic regardless of existing-row order and idMap key order in a fan-in merge', () => {
    const a = mkTicket({ id: 'a', status: 'done', xp: 10, doneAt: 5 })
    const b = mkTicket({ id: 'b', status: 'doing' })
    const x = mkTicket({ id: 'x-gone' })
    const idMap1 = { a: 'm1w1t1', b: 'm1w1t1' }
    const idMap2 = { b: 'm1w1t1', a: 'm1w1t1' }
    const r1 = reconcilePlan([a, b, x], content, idMap1)
    const r2 = reconcilePlan([x, b, a], content, idMap2)
    expect(sorted(r2.puts)).toEqual(sorted(r1.puts))
    expect(r2.renames).toEqual(r1.renames)
    expect(r2.archived).toEqual(r1.archived)
  })

  it("(e) a brand-new target takes its planned sprint, not a vanished row's old sprint", () => {
    const old = mkTicket({ id: 'old2', status: 'todo', sprint: 9 })
    const r = reconcilePlan([old], content, { old2: 'm1w2t1' })
    expect(byId(r.puts).m1w2t1.sprint).toBe(2)
  })

  it('is deterministic regardless of existing-row order', () => {
    const a = mkTicket({ id: 'a', status: 'done', xp: 10 })
    const b = mkTicket({ id: 'b', sprint: 5 })
    const x = mkTicket({ id: 'x-gone' })
    const r1 = reconcilePlan([a, b, x], content, { a: 'b', b: 'm1w1t1' })
    const r2 = reconcilePlan([x, b, a], content, { a: 'b', b: 'm1w1t1' })
    expect(sorted(r2.puts)).toEqual(sorted(r1.puts))
    expect(r2.renames).toEqual(r1.renames)
    expect(r2.archived).toEqual(r1.archived)
  })

  it('never renames an id that is still in the plan (mapped away and re-added)', () => {
    const worked = seeded().map(t => (t.id === 'm1w1t1' ? { ...t, status: 'done' as const, xp: 10 } : t))
    const r = reconcilePlan(worked, content, { m1w1t1: 'm1w2t1' })
    expect(r.renames).toEqual([])
    expect(byId(r.puts).m1w1t1).toMatchObject({ status: 'done', xp: 10 })
    expect(byId(r.puts).m1w2t1).toMatchObject({ status: 'todo', xp: 0 })
  })

  it('un-archives an id that comes back into the plan', () => {
    const worked = seeded().map(t => (t.id === 'm1w1t1' ? { ...t, archived: true, xp: 10, status: 'done' as const } : t))
    const r = reconcilePlan(worked, content, {})
    expect(byId(r.puts).m1w1t1).toMatchObject({ archived: false, xp: 10, status: 'done' })
  })

  it('stops a chain at the first live id', () => {
    const x = mkTicket({ id: 'x', status: 'done', xp: 10 })
    const r = reconcilePlan([x], content, { x: 'm1w1t1', m1w1t1: 'm1w2t1' })
    expect(r.renames).toEqual([{ from: 'x', to: 'm1w1t1' }])
  })

  it('archives ids caught in an idMap cycle', () => {
    const q = mkTicket({ id: 'q', xp: 10, status: 'done' })
    const r = reconcilePlan([q], content, { q: 'r', r: 'q' })
    expect(byId(r.puts).q).toMatchObject({ archived: true, xp: 10 })
    expect(r.renames).toEqual([])
  })

  it('keeps a real bank/mine ticket exactly as it is, never archiving it', () => {
    const cf = mkTicket({ id: 'bank:codeforces:cf-4C', origin: 'bank:codeforces', xp: 5, status: 'done' })
    const mine = mkTicket({ id: 'mine:x', origin: 'mine', xp: 10, status: 'done' })
    const r = reconcilePlan([cf, mine], content, {})
    expect(byId(r.puts)['bank:codeforces:cf-4C']).toEqual(cf)
    expect(byId(r.puts)['mine:x']).toEqual(mine)
    expect(r.archived).toEqual([])
    expect(r.deletes).toEqual([])
  })

  it('treats an unknown/missing origin as plan, so it is archived like a vanished plan ticket instead of kept forever (isBankOrigin fix)', () => {
    const weird = mkTicket({ id: 'weird', xp: 10, status: 'done', origin: 'something-unexpected' as Ticket['origin'] })
    const r = reconcilePlan([weird], content, {})
    expect(r.archived).toEqual(['weird'])
    expect(byId(r.puts).weird).toMatchObject({ archived: true, xp: 10 })
  })
})

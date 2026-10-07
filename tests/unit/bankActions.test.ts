import { describe, expect, it } from 'vitest'
import { addMineItem, importLadder, removeMineItem, toggleBankItem, updateMineItem, type MineDraft } from '../../src/data/bankActions'
import type { ItemView } from '../../src/rules/banks'
import { seededDb } from '../helpers/db'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00')

const view = (p: Partial<ItemView> & { id: string }): ItemView => ({
  name: p.id, url: 'https://leetcode.com/problems/x/', difficulty: 'E', pattern: null, group: 'g', kind: 'problem',
  plan: null, ticketId: p.id, ticket: null, done: false, readOnly: false, ...p,
})

const draft = (p: Partial<MineDraft> & { key: string }): MineDraft => ({
  name: p.key, url: null, pattern: 'GREEDY', difficulty: 'H', source: 'Text', input: p.key, ticketId: p.key, ...p,
})

describe('toggleBankItem', () => {
  it('bank-only: the first tick creates a done ticket and a tick event; the second deletes it', async () => {
    const d = await seededDb()
    const item = view({ id: 'p9001', name: 'Probe' })
    expect(await toggleBankItem(d, item, 'blind75', NOW, 2)).toEqual({ ok: true, xpDelta: 5 })
    expect(await d.tickets.get('p9001')).toMatchObject({ origin: 'bank:blind75', status: 'done', sprint: 2, xp: 5, title: 'Probe' })
    expect((await d.events.toArray()).at(-1)).toMatchObject({ t: 'tick', id: 'p9001', xp: 5 })
    expect(await toggleBankItem(d, item, 'neetcode150', NOW, 2)).toEqual({ ok: true, xpDelta: -5 })
    expect(await d.tickets.get('p9001')).toBeUndefined()
    expect((await d.events.toArray()).at(-1)).toMatchObject({ t: 'untick', id: 'p9001' })
  })
  it('Codeforces and design items use their own XP', async () => {
    const d = await seededDb()
    expect(await toggleBankItem(d, view({ id: 'cf-1A', difficulty: 1600 }), 'codeforces', NOW, 1)).toEqual({ ok: true, xpDelta: 9 })
    expect(await toggleBankItem(d, view({ id: 'hi-bitly', kind: 'design', difficulty: null }), 'hellointerview', NOW, 1)).toEqual({ ok: true, xpDelta: 20 })
    expect((await d.tickets.get('cf-1A'))?.rating).toBe(1600)
  })
  it('in-plan: ticks the plan ticket, origin stays plan', async () => {
    const d = await seededDb()
    const plan = (await d.tickets.toArray()).find(t => t.kind === 'problem')!
    const item = view({ id: plan.id, plan: { ticketId: plan.id, marker: 'Plan · S1', href: '/dsa?topic=1', cubeLabel: 'in plan S1' }, ticketId: plan.id })
    const res = await toggleBankItem(d, item, 'blind75', NOW, 1)
    expect(res.ok && res.xpDelta > 0).toBe(true)
    expect(await d.tickets.get(plan.id)).toMatchObject({ origin: 'plan', status: 'done' })
    expect(await toggleBankItem(d, item, 'blind75', NOW, 1)).toMatchObject({ ok: true })
    expect((await d.tickets.get(plan.id))?.status).toBe('todo')
  })
  it('in-plan with a missing plan ticket fails', async () => {
    const d = await seededDb()
    const item = view({ id: 'p424242', plan: { ticketId: 'p424242', marker: 'Plan · S1', href: '/dsa?topic=1', cubeLabel: 'in plan S1' } })
    expect(await toggleBankItem(d, item, 'blind75', NOW, 1)).toMatchObject({ ok: false, reason: 'missing' })
  })
  it('contract DECISION 9: a row whose own id differs from its shared ticketId ticks by ticketId, not by row id', async () => {
    const d = await seededDb()
    // A Striver LC-94 variant row: id is the row's own slug, ticketId is the shared p94.
    const morris = view({ id: 'striver-morris-inorder-traversal-of-a-binary-tree', name: 'Morris Inorder Traversal of a Binary Tree', ticketId: 'p94' })
    expect(await toggleBankItem(d, morris, 'striver', NOW, 1)).toEqual({ ok: true, xpDelta: 5 })
    expect(await d.tickets.get('p94')).toMatchObject({ status: 'done' })
    expect(await d.tickets.get('striver-morris-inorder-traversal-of-a-binary-tree')).toBeUndefined()
    const canonical = view({ id: 'p94', name: 'Binary Tree Inorder Traversal', ticketId: 'p94', done: true })
    expect(await toggleBankItem(d, canonical, 'striver', NOW, 1)).toEqual({ ok: true, xpDelta: -5 })
    expect(await d.tickets.get('p94')).toBeUndefined()
  })
})

describe('Mine rows', () => {
  it('adds, refuses a duplicate, updates and removes', async () => {
    const d = await seededDb()
    expect(await addMineItem(d, draft({ key: 'mine-a', url: 'https://leetcode.com/problems/a/', source: 'LeetCode' }), NOW)).toEqual({ ok: true })
    expect(await d.bankItems.get('mine:mine-a')).toMatchObject({ bank: 'mine', key: 'mine-a', name: 'mine-a', pattern: 'GREEDY', difficulty: 'H', status: 'todo', ticketId: 'mine-a', addedAt: NOW, inputKind: 'url', source: 'LeetCode' })
    expect(await addMineItem(d, draft({ key: 'mine-a' }), NOW)).toEqual({ ok: false, message: 'Already in Mine' })
    expect(await updateMineItem(d, 'mine:mine-a', { name: 'Renamed', pattern: null, difficulty: 'E' })).toEqual({ ok: true })
    expect(await d.bankItems.get('mine:mine-a')).toMatchObject({ name: 'Renamed', pattern: null, difficulty: 'E' })
    expect(await removeMineItem(d, 'mine:mine-a')).toEqual({ ok: true })
    expect(await d.bankItems.get('mine:mine-a')).toBeUndefined()
  })
  it('refuses to remove a done item', async () => {
    const d = await seededDb()
    await addMineItem(d, draft({ key: 'mine-b' }), NOW)
    await toggleBankItem(d, view({ id: 'mine-b', difficulty: 'H' }), 'mine', NOW, 1)
    expect(await removeMineItem(d, 'mine:mine-b')).toEqual({ ok: false, message: 'Untick it before removing it' })
    expect(await d.bankItems.get('mine:mine-b')).toBeDefined()
  })
})

describe('importLadder', () => {
  it('adds new rows and reports what was already present; re-running is safe', async () => {
    const d = await seededDb()
    const items = [{ contestId: 9999, index: 'Z', name: 'Probe', rating: 1700, tags: ['greedy'] }]
    expect(await importLadder(d, items, new Set(), NOW)).toEqual({ added: 1, present: 0 })
    expect(await importLadder(d, items, new Set(['cf-9999Z']), NOW)).toEqual({ added: 0, present: 1 })
    expect(await d.bankItems.count()).toBe(1)
  })
})

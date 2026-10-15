import { describe, expect, it } from 'vitest'
import { loadPlan, runReconcile } from '../../src/data/seed'
import { createDb, getSettings } from '../../src/data/db'
import { PlanDataError } from '../../src/rules/planTickets'
import type { PlanV2 } from '../../src/data/planV2'
import { failingDb, freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const fakeFetch = (status: number, body: () => Promise<unknown>): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: body }) as unknown as Response)

describe('runReconcile — seed once (Review Focus #1)', () => {
  it('seeds every ticket on first launch and writes planVersion/possibleXp, no events', async () => {
    const d = freshDb()
    await runReconcile(d, flatPlanV2)
    expect(await d.tickets.count()).toBe(10)
    expect(await d.events.count()).toBe(0)
    expect(await getSettings(d)).toMatchObject({ planVersion: 'fx-v2-1', possibleXp: 130, startDate: '' })
  })

  it('a reload (second run) changes nothing and duplicates nothing', async () => {
    const d = freshDb()
    await runReconcile(d, flatPlanV2)
    const before = await d.tickets.orderBy('id').toArray()
    await runReconcile(d, flatPlanV2)
    expect(await d.tickets.orderBy('id').toArray()).toEqual(before)
    expect(await d.events.count()).toBe(0)
  })

  it('two tabs seeding the same database at once still produce each ticket once', async () => {
    const name = `tabs-${Math.random().toString(36).slice(2)}`
    const tabA = createDb(name)
    const tabB = createDb(name)
    await Promise.all([runReconcile(tabA, flatPlanV2), runReconcile(tabB, flatPlanV2)])
    expect(await tabA.tickets.count()).toBe(10)
    expect(await tabB.events.count()).toBe(0)
  })
})

describe('runReconcile — no partial seed (Review Focus #2)', () => {
  it('rejects a malformed plan before writing anything', async () => {
    const d = freshDb()
    const bad = JSON.parse(JSON.stringify(flatPlanV2)) as PlanV2
    ;(bad.tickets[2] as { id?: string }).id = undefined
    await expect(runReconcile(d, bad)).rejects.toBeInstanceOf(PlanDataError)
    expect(await d.tickets.count()).toBe(0)
    expect((await getSettings(d)).planVersion).toBe('')
  })

  it('rolls back ticket writes when a later write in the transaction fails', async () => {
    const d = failingDb('settings')
    await expect(runReconcile(d, flatPlanV2)).rejects.toThrow('boom')
    expect(await d.tickets.count()).toBe(0)
  })
})

describe('runReconcile — renames keep history (Review Focus #6)', () => {
  it('re-points sessions and events of every renamed id', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 'a', status: 'done', xp: 10 }), mkTicket({ id: 'b', sprint: 5 })])
    await d.sessions.bulkPut([
      { id: 's1', ticketId: 'a', start: 1, end: 2, minutes: 0, outcome: 'solved', xpDelta: 10 },
      { id: 's2', ticketId: 'b', start: 3, end: 4, minutes: 0, outcome: 'gave_up', xpDelta: 0 },
    ])
    await d.events.bulkAdd([
      { t: 'tick', id: 'a', at: 1, xp: 10 },
      { t: 'column', id: 'b', at: 2, from: 'todo', to: 'doing' } as never, // legacy type, no longer in DojoEvent
      { t: 'slide_sprint', at: 3, sprint: 4, to: 5, count: 2, ids: ['a', 'z'] } as never, // legacy type
    ])
    const plan2: PlanV2 = { ...flatPlanV2, planVersion: 'fx-2', idMap: { a: 'b', b: 'm1w1t1' } }
    await runReconcile(d, plan2)

    expect(await d.tickets.get('a')).toBeUndefined()
    expect(await d.tickets.get('b')).toBeUndefined()
    expect((await d.sessions.toArray()).map(s => s.ticketId)).toEqual(['m1w1t1', 'm1w1t1'])
    const ev = await d.events.orderBy('seq').toArray()
    expect(ev[0]).toMatchObject({ t: 'tick', id: 'm1w1t1' })
    expect(ev[1]).toMatchObject({ t: 'column', id: 'm1w1t1' })
    expect(ev[2]).toMatchObject({ t: 'slide_sprint', ids: ['m1w1t1', 'z'] })
    expect((await getSettings(d)).planVersion).toBe('fx-2')
  })

  it('remaps the KEYS of a shift_plan event\'s `to` map on rename (minor #9)', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 'a', sprint: 5 }), mkTicket({ id: 'zz', sprint: 6 })])
    await d.events.bulkAdd([
      { t: 'shift_plan', at: 1, fromSprint: 4, ids: ['a', 'zz'], to: { a: 5, zz: 6 } } as never, // legacy type
    ])
    const plan2: PlanV2 = { ...flatPlanV2, planVersion: 'fx-2', idMap: { a: 'm1w1t1' } }
    await runReconcile(d, plan2)
    const ev = (await d.events.toArray())[0] as unknown as { to: Record<string, number>; ids: string[] }
    expect(ev.to).toEqual({ m1w1t1: 5, zz: 6 })
    expect(ev.ids).toEqual(['m1w1t1', 'zz'])
  })

  it('keeps sessions on archived tickets', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'gone', xp: 10, status: 'done' }))
    await d.sessions.put({ id: 's1', ticketId: 'gone', start: 1, end: 2, minutes: 0, outcome: 'solved', xpDelta: 10 })
    await runReconcile(d, flatPlanV2)
    expect(await d.tickets.get('gone')).toMatchObject({ archived: true, xp: 10 })
    expect(await d.sessions.get('s1')).toMatchObject({ ticketId: 'gone' })
  })
})

describe('loadPlan (Review Focus #2)', () => {
  it('loads a valid plan', async () => {
    const r = await loadPlan(fakeFetch(200, async () => flatPlanV2))
    expect(r).toEqual({
      ok: true, v2: flatPlanV2,
      plan: { planVersion: flatPlanV2.planVersion, idMap: flatPlanV2.idMap, dsa_bank: flatPlanV2.dsa_bank, design_bank: flatPlanV2.design_bank },
    })
  })
  it('reports a missing file', async () => {
    const r = await loadPlan(fakeFetch(404, async () => ({})))
    expect(r).toEqual({ ok: false, error: '/data/plan.json returned HTTP 404' })
  })
  it('reports an empty or unparsable body', async () => {
    const r = await loadPlan(fakeFetch(200, async () => { throw new SyntaxError('Unexpected end of JSON input') }))
    expect(r).toEqual({ ok: false, error: '/data/plan.json is not valid JSON' })
  })
  it('reports a wrong shape', async () => {
    const r = await loadPlan(fakeFetch(200, async () => ({ sprints: [] })))
    expect(r).toEqual({ ok: false, error: '/data/plan.json is not a plan v2 (planFormat 2)' })
  })
  it('reports a network failure', async () => {
    const r = await loadPlan((async () => { throw new TypeError('Failed to fetch') }) as typeof fetch)
    expect(r).toEqual({ ok: false, error: 'Could not fetch /data/plan.json: TypeError: Failed to fetch' })
  })
})

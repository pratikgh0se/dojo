import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { splitIntoSessions } from '../../src/data/splitActions'
import {
  canSplit, containerState, minutesList, offersSplit, partMinutes, splitBodyText, splitMaxParts, splitMinutes, splitTicket, suggestedParts, suggestedText,
} from '../../src/rules/split'
import { reconcilePlan } from '../../src/rules/reconcile'
import { planToTickets } from '../../src/rules/planTickets'
import { canMove } from '../../src/rules/board'
import { planXp, totalXp } from '../../src/rules/xp'
import { draftBrief } from '../../src/data/briefActions'
import { freshDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'
import type { Ticket } from '../../src/data/types'

const NOW = 1_800_000_000_000

describe('splitTicket (pure)', () => {
  const parent = mkTicket({ id: 'big', title: 'Essence of Calculus', kind: 'task', estMin: 180, sprint: 3, order: 10, links: [{ label: 'v', url: 'https://x.test' }], skill: 's' })
  it('makes n children in the parent\'s sprint with origin = parent id, sharing minutes and XP', () => {
    const r = splitTicket(parent, 3)
    expect(r.children.map(c => c.id)).toEqual(['big~1', 'big~2', 'big~3'])
    for (const c of r.children) {
      expect(c).toMatchObject({ origin: 'big', childOf: 'big', sprint: 3, plannedSprint: 3, status: 'todo', xp: 0, estMin: 60, kind: 'task', track: 'ai' })
    }
    expect(r.children.map(c => c.title)).toEqual(['Essence of Calculus · part 1 of 3', 'Essence of Calculus · part 2 of 3', 'Essence of Calculus · part 3 of 3'])
    expect(r.children.map(c => c.xpBase)).toEqual([4, 3, 3])
    expect(r.parent.children).toEqual(['big~1', 'big~2', 'big~3'])
    expect(r.children.every(c => c.order > 10 && c.order < 11)).toBe(true)
  })
  it('uses the proposed titles when given', () => {
    expect(splitTicket(parent, 2, ['Ep 1', ' ']).children.map(c => c.title)).toEqual(['Ep 1', 'Essence of Calculus · part 2 of 2'])
  })
  it('refuses bad splits', () => {
    expect(canSplit(parent, 1)).toEqual({ ok: false, message: 'Split into 2 to 8 parts' }) // ruling 20 S2: at most 8
    expect(canSplit(parent, 9).ok).toBe(false)
    expect(canSplit(parent, 8).ok).toBe(true)
    expect(canSplit({ ...parent, status: 'done' }, 3).ok).toBe(false)
    expect(canSplit({ ...parent, children: ['a'] }, 3)).toEqual({ ok: false, message: 'Already split into sessions' })
    expect(canSplit({ ...parent, childOf: 'x' }, 3).ok).toBe(false)
    expect(canSplit({ ...parent, status: 'doing' }, 3)).toEqual({ ok: true }) // ruling 18 F9: a started card splits too
    expect(canSplit({ ...parent, deepestRung: 2 }, 3).ok).toBe(false)
  })
  it('the container is done exactly when all live children are', () => {
    const { parent: p, children } = splitTicket(parent, 2)
    expect(containerState(p, children, NOW)).toBeNull()
    const one = [{ ...children[0], status: 'done' as const }, children[1]]
    expect(containerState(p, one, NOW)).toBeNull()
    const both = one.map(c => ({ ...c, status: 'done' as const }))
    expect(containerState(p, both, NOW)).toMatchObject({ status: 'done', doneAt: NOW })
    const reopened = containerState({ ...p, status: 'done', doneAt: NOW }, one, NOW + 1)!
    expect(reopened.status).toBe('todo')
    expect(reopened.doneAt).toBeUndefined()
  })
})

describe('ruling 20 S1/S2: split minutes and the dialog', () => {
  const card = (estMin: number, extra: Partial<Ticket> = {}) => mkTicket({ id: 'p200', kind: 'problem', estMin, ...extra })
  const brief = { minutes: 35 } as Ticket['brief']
  it('S1: parts sum exactly to the card, by largest remainder (35 → 12, 12, 11), never rounded up', () => {
    expect(splitMinutes(35, 3)).toEqual([12, 12, 11])
    expect(splitMinutes(35, 2)).toEqual([18, 17])
    expect(splitMinutes(90, 3)).toEqual([30, 30, 30])
    const r = splitTicket(card(35), 3)
    expect(r.children.map(c => c.estMin)).toEqual([12, 12, 11])
    expect(splitTicket(card(50, { brief: { ...brief!, minutes: 35 } }), 3).children.map(c => c.estMin)).toEqual([12, 12, 11]) // the brief's minutes win
  })
  it('S1 (UAT r5): an even split, 110 min in 2 parts is 55 + 55, never the brief\'s per-step 50 + 60', () => {
    expect(partMinutes(card(110), 2)).toEqual([55, 55])
    const proposal = { minutes: 110, splitSuggestion: [{ title: 'Build', minutes: 50 }, { title: 'Break', minutes: 60 }] } as Ticket['brief']
    expect(partMinutes(card(110, { brief: proposal }), 2)).toEqual([55, 55])
    const r = splitTicket(card(110, { brief: proposal }), 2, ['Build', 'Break'])
    expect(r.children.map(c => [c.title, c.estMin])).toEqual([['Build', 55], ['Break', 55]])
  })
  it('S1: for every (minutes, parts) the parts sum to the card and differ by at most 1 min', () => {
    for (let total = 20; total <= 480; total++) {
      for (let parts = 2; parts <= splitMaxParts(card(total)); parts++) {
        for (const ms of [splitMinutes(total, parts), partMinutes(card(total), parts), splitTicket(card(total), parts).children.map(c => c.estMin)]) {
          expect(ms).toHaveLength(parts)
          expect(ms.reduce((a, m) => a + m, 0)).toBe(total)
          expect(Math.max(...ms) - Math.min(...ms)).toBeLessThanOrEqual(1)
          expect(Math.min(...ms)).toBeGreaterThanOrEqual(10)
        }
      }
    }
  })
  it('S2: Parts runs 2 to min(8, ⌊minutes/10⌋); Split is offered from 20 min, never on a part or a split card', () => {
    expect([splitMaxParts(card(35)), splitMaxParts(card(20)), splitMaxParts(card(79)), splitMaxParts(card(240))]).toEqual([3, 2, 7, 8])
    const b = { brief: { minutes: 35 } as Ticket['brief'] }
    expect(offersSplit({ ...card(35), ...b })).toBe(true)
    expect(offersSplit(card(35))).toBe(false) // no brief
    expect(offersSplit({ ...card(19), brief: { minutes: 19 } as Ticket['brief'] })).toBe(false)
    expect(offersSplit({ ...card(20), brief: { minutes: 20 } as Ticket['brief'] })).toBe(true)
    expect(offersSplit({ ...card(35), ...b, children: ['p200~1'] })).toBe(false)
    expect(offersSplit({ ...card(35), ...b, childOf: 'x' })).toBe(false)
    expect(canSplit(card(35), 4)).toEqual({ ok: false, message: 'Split into 2 to 3 parts' })
    expect(canSplit(card(15), 2).ok).toBe(false)
  })
  it('S2: the body states the result; the 45–90 advice only from 90 min', () => {
    expect(minutesList([12, 12, 11])).toBe('12, 12 and 11 min')
    expect(splitBodyText([12, 12, 11])).toBe('Cut this card into 3 sessions (12, 12 and 11 min). Each session is its own card in the same sprint; this card is done when all of them are.')
    expect(suggestedParts(card(35))).toBeNull()
    expect(suggestedParts(card(89))).toBeNull()
    expect(suggestedParts(card(90))).toBe(2)
    expect(suggestedParts(card(180))).toBe(3)
    expect(suggestedText(3)).toBe('Suggested: 3 parts (about 45–90 min each)')
  })
})

describe('splitting in the database', () => {
  async function setup() {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'big', title: 'Big', kind: 'task', estMin: 150, sprint: 1, order: 1 }))
    return d
  }
  it('BR-08: the parent becomes done only once all 3 children are done; XP comes from the children, once', async () => {
    const d = await setup()
    const r = await splitIntoSessions(d, 'big', 3)
    expect(r.ok).toBe(true)
    const kids = (await d.tickets.toArray()).filter(t => t.childOf === 'big')
    expect(kids).toHaveLength(3)
    expect(kids.every(k => k.origin === 'big')).toBe(true)
    await moveTicket(d, 'big~1', 'done', NOW)
    await moveTicket(d, 'big~2', 'done', NOW)
    expect((await d.tickets.get('big'))!.status).toBe('todo')
    await moveTicket(d, 'big~3', 'done', NOW)
    expect(await d.tickets.get('big')).toMatchObject({ status: 'done', doneAt: NOW, xp: 0 })
    const all = await d.tickets.toArray()
    expect(totalXp(all)).toBe(10)
    expect(planXp(all)).toBe(10)
    await moveTicket(d, 'big~2', 'todo', NOW + 1)
    expect((await d.tickets.get('big'))!.status).toBe('todo')
  })
  it('a container cannot be finished by hand while sessions are open', async () => {
    const d = await setup()
    await splitIntoSessions(d, 'big', 2)
    const all = await d.tickets.toArray()
    expect(canMove(all, 'big', 'done')).toEqual({ ok: false, reason: 'container' })
    expect(await moveTicket(d, 'big', 'done', NOW)).toMatchObject({ ok: false, reason: 'container' })
    expect((await d.tickets.get('big'))!.status).toBe('todo')
  })
  it('ruling 10 Q22: a briefed watch card splits; its check stays on the parent, which finishes only after the check, once every child is done', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'w', kind: 'watch', title: 'Hash maps', estMin: 100 }))
    await draftBrief(d, 'w', NOW)
    const r = await splitIntoSessions(d, 'w', 2)
    expect(r.ok).toBe(true)
    const parent = (await d.tickets.get('w'))!
    expect(parent.children).toHaveLength(2)
    expect(parent.brief?.questions.length).toBeGreaterThan(0)
    const kids = (await d.tickets.bulkGet(parent.children!)) as Ticket[]
    for (const k of kids) expect(k.brief).toBeUndefined() // children have no check
    const done = kids.map(c => ({ ...c, status: 'done' as const }))
    expect(containerState(parent, done, NOW)).toBeNull() // the parent's check is still owed
    expect(containerState({ ...parent, checkPassedAt: NOW }, done, NOW)?.status).toBe('done')
    expect(containerState({ ...parent, checkPassedAt: NOW }, [done[0], kids[1]], NOW)).toBeNull()
  })
  it('a card with a live redo or a failed check cannot be split', async () => {
    const d = await setup()
    await d.redos.add({ id: 'r', ticketId: 'big', source: 'gave_up', createdAt: 1, stage: 0, due: 1, passed: [], helpCost: 0, refunded: 0 })
    expect(await splitIntoSessions(d, 'big', 2)).toEqual({ ok: false, message: 'A card with a redo waiting cannot be split' })
    const e = await setup()
    await e.checkAttempts.add({ id: 'a', ticketId: 'big', at: 1, answers: [], feedback: [], passed: false })
    expect(await splitIntoSessions(e, 'big', 2)).toEqual({ ok: false, message: 'A card with a failed check cannot be split' })
  })
  it('a card that already used help cannot be split (no XP minted after help); a started card can (ruling 18 F9)', async () => {
    const d = await setup()
    await d.rungUses.add({ id: 'ru', ticketId: 'big', attemptStart: 1, cycleId: 'c', rung: 2, at: 1, cost: 2, applied: 2, refunded: 0 })
    expect(await splitIntoSessions(d, 'big', 2)).toEqual({ ok: false, message: 'A card you already took help on cannot be split' })
    const e = await setup()
    expect(await splitIntoSessions(e, 'big', 2, [], { openCycle: true })).toMatchObject({ ok: false })
    await e.tickets.update('big', { status: 'doing' })
    expect(await splitIntoSessions(e, 'big', 2)).toMatchObject({ ok: true })
    const big = (await e.tickets.get('big'))!
    expect(big.status).toBe('doing') // the parent stays in its column
    for (const k of big.children!) expect((await e.tickets.get(k))!.status).toBe('todo')
  })
  it('the same card cannot be split twice, and a missing card is reported', async () => {
    const d = await setup()
    await splitIntoSessions(d, 'big', 2)
    expect(await splitIntoSessions(d, 'big', 2)).toEqual({ ok: false, message: 'Already split into sessions' })
    expect(await splitIntoSessions(d, 'nope', 2)).toEqual({ ok: false, message: 'Ticket not found' })
  })
})

describe('plan reconcile keeps sessions', () => {
  it('a child whose id is not in the plan is neither archived nor renamed', () => {
    const content = planToTickets(smallPlan)
    const child = mkTicket({ id: 'p1~1', origin: 'p1', childOf: 'p1' })
    const r = reconcilePlan([child], content, {})
    expect(r.archived).not.toContain('p1~1')
    expect(r.puts.find(t => t.id === 'p1~1')).toEqual(child)
  })
})

describe('ruling 20 S6: Undo is per app session, names its action, and takes back a split while no part has started', () => {
  it('a split is one undo step; Undo removes the parts and makes the parent whole', async () => {
    const { undoLast, undoSteps } = await import('../../src/data/boardActions')
    const { undoLabel } = await import('../../src/rules/slide')
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'big', title: 'Big', kind: 'task', estMin: 90, sprint: 1, order: 1 }))
    expect((await splitIntoSessions(d, 'big', 3)).ok).toBe(true)
    const steps = await undoSteps(d)
    expect(steps).toHaveLength(1)
    expect(undoLabel(steps[0], await d.tickets.toArray())).toBe("Undo: split 'Big' into 3 sessions")
    expect(await undoLast(d, NOW)).toMatchObject({ ok: true, count: 1 })
    expect(await d.tickets.get('big~1')).toBeUndefined()
    const big = (await d.tickets.get('big'))!
    expect(big.children).toBeUndefined()
    expect(await undoSteps(d)).toHaveLength(0)
    // and it can be split again
    expect((await splitIntoSessions(d, 'big', 2)).ok).toBe(true)
  })
  it('once a part has been started, the split leaves the history (older steps stay undoable)', async () => {
    const { moveOnBoard, undoSteps } = await import('../../src/data/boardActions')
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 'big', kind: 'task', estMin: 90, order: 1 }), mkTicket({ id: 'o', kind: 'task', order: 2 })])
    await moveOnBoard(d, 'o', 'doing', NOW)
    await splitIntoSessions(d, 'big', 2)
    expect((await undoSteps(d)).map(s => s[0].t)).toEqual(['split', 'column'])
    await d.tickets.update('big~1', { status: 'doing' })
    expect((await undoSteps(d)).map(s => s[0].t)).toEqual(['column'])
  })
  it('events another app session wrote are never offered (a relaunch starts empty)', async () => {
    const { undoableSteps } = await import('../../src/rules/slide')
    const { APP_SESSION } = await import('../../src/data/undoSession')
    const ev = [
      { t: 'moved' as const, id: 'a', at: 1, from: 1, to: 2, why: 'manual' as const, seq: 1, appSession: 'an-earlier-launch' },
      { t: 'moved' as const, id: 'b', at: 2, from: 1, to: 2, why: 'manual' as const, seq: 2 },
      { t: 'moved' as const, id: 'c', at: 3, from: 1, to: 2, why: 'manual' as const, seq: 3, appSession: APP_SESSION },
    ]
    expect(undoableSteps(ev, { appSession: APP_SESSION }).map(s => (s[0] as { id: string }).id)).toEqual(['c'])
  })
  it('the label names each kind of step', async () => {
    const { undoLabel } = await import('../../src/rules/slide')
    const ts = [mkTicket({ id: 'a', title: 'Rebuild' })]
    expect(undoLabel([{ t: 'column', id: 'a', at: 1, from: 'todo', to: 'doing' }], ts)).toBe("Undo: move 'Rebuild' to Doing")
    expect(undoLabel([{ t: 'moved', id: 'a', at: 1, from: 1, to: 2, why: 'manual' }], ts)).toBe("Undo: move 'Rebuild' to Sprint 2")
    expect(undoLabel([{ t: 'slide', id: 'a', at: 1, from: 1, to: 2, reason: 'manual' }], ts)).toBe("Undo: slide 'Rebuild' to Sprint 2")
    expect(undoLabel([{ t: 'slide_sprint', at: 1, sprint: 1, count: 4, to: 2, ids: [] }], ts)).toBe('Undo: slide 4 cards from Sprint 1 to Sprint 2')
    expect(undoLabel([{ t: 'shift_plan', at: 1, fromSprint: 3, ids: [], to: {} }], ts)).toBe('Undo: shift the plan from Sprint 3')
    expect(undoLabel(undefined, ts)).toBe('Nothing to undo')
  })
})

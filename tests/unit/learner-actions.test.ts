import { describe, expect, it } from 'vitest'
import { EXPLAIN_RESPONSE_MAX, LEARNER_NOTES_MAX, setExplainResponse, setLearnerNotes, setSelfMark } from '../../src/data/learnerActions'
import { runReconcile } from '../../src/data/seed'
import { isReadOnlyError } from '../../src/data/writer'
import { createDb } from '../../src/data/db'
import type { SyncGate } from '../../src/data/sync/middleware'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const seeded = async () => {
  const d = freshDb()
  await runReconcile(d, flatPlanV2) // m1w1t1 has one explain question
  await d.tickets.put(mkTicket({ id: 'two', explain: ['q1', 'q2'] }))
  return d
}

describe('setLearnerNotes', () => {
  it('stores the text and the time, and an empty text removes the field', async () => {
    const d = await seeded()
    expect(await setLearnerNotes(d, 'm1w2t1', 'remember the batch size', 50)).toEqual({ ok: true })
    expect(await d.tickets.get('m1w2t1')).toMatchObject({ learnerNotes: 'remember the batch size', learnerUpdatedAt: 50 })
    await setLearnerNotes(d, 'm1w2t1', '', 60)
    const t = (await d.tickets.get('m1w2t1'))!
    expect('learnerNotes' in t).toBe(false)
    expect(t.learnerUpdatedAt).toBe(60)
  })
  it('refuses text over the cap, and a missing or archived ticket, and changes nothing', async () => {
    const d = await seeded()
    expect(await setLearnerNotes(d, 'm1w2t1', 'x'.repeat(LEARNER_NOTES_MAX + 1), 1)).toMatchObject({ ok: false })
    expect(await setLearnerNotes(d, 'nope', 'x', 1)).toMatchObject({ ok: false })
    await d.tickets.update('m1w2t1', { archived: true })
    expect(await setLearnerNotes(d, 'm1w2t1', 'x', 1)).toMatchObject({ ok: false })
    expect((await d.tickets.get('m1w2t1'))!.learnerNotes).toBeUndefined()
  })
})

describe('setExplainResponse', () => {
  it('stores answers by index, padding the gaps with empty strings', async () => {
    const d = await seeded()
    await setExplainResponse(d, 'two', 1, 'second answer', 5)
    expect((await d.tickets.get('two'))!.explainResponses).toEqual(['', 'second answer'])
    await setExplainResponse(d, 'two', 0, 'first answer', 6)
    expect(await d.tickets.get('two')).toMatchObject({ explainResponses: ['first answer', 'second answer'], learnerUpdatedAt: 6 })
  })
  it('refuses an index outside the questions, a ticket without questions, and text over the cap', async () => {
    const d = await seeded()
    expect(await setExplainResponse(d, 'two', 2, 'x', 1)).toMatchObject({ ok: false })
    expect(await setExplainResponse(d, 'two', -1, 'x', 1)).toMatchObject({ ok: false })
    expect(await setExplainResponse(d, 'm1w2t1', 0, 'x', 1)).toMatchObject({ ok: false, message: expect.stringContaining('no questions') })
    expect(await setExplainResponse(d, 'two', 0, 'x'.repeat(EXPLAIN_RESPONSE_MAX + 1), 1)).toMatchObject({ ok: false })
    expect((await d.tickets.get('two'))!.explainResponses).toBeUndefined()
  })
})

describe('setSelfMark', () => {
  it('sets and clears the mark, and refuses an unknown one', async () => {
    const d = await seeded()
    await setSelfMark(d, 'm1w2t1', 'partial', 9)
    expect(await d.tickets.get('m1w2t1')).toMatchObject({ selfMark: 'partial', learnerUpdatedAt: 9 })
    await setSelfMark(d, 'm1w2t1', null, 10)
    expect('selfMark' in (await d.tickets.get('m1w2t1'))!).toBe(false)
    expect(await setSelfMark(d, 'm1w2t1', 'great' as never, 11)).toMatchObject({ ok: false })
  })
})

describe('learner fields and the rest of the system', () => {
  it('survive a plan refresh that rewrites the plan content of the same ticket (D11)', async () => {
    const d = await seeded()
    await setLearnerNotes(d, 'm1w1t1', 'notes', 1)
    await setExplainResponse(d, 'm1w1t1', 0, 'my answer', 2)
    await setSelfMark(d, 'm1w1t1', 'done', 3)
    const next = JSON.parse(JSON.stringify(flatPlanV2))
    next.planVersion = 'fx-v2-2'
    next.tickets[0].title = 'Watch the tour (revised)'
    next.tickets[0].explainAnswers = ['A revised reference answer.']
    await runReconcile(d, next)
    expect(await d.tickets.get('m1w1t1')).toMatchObject({
      title: 'Watch the tour (revised)', explainAnswers: ['A revised reference answer.'],
      learnerNotes: 'notes', explainResponses: ['my answer'], selfMark: 'done', learnerUpdatedAt: 3,
    })
  })
  it('are written through the outbox like any ticket field, and refused in a read-only browser', async () => {
    const gate: SyncGate = { bypass: false }
    const d = createDb(`learner-${Math.random()}`, gate)
    await d.tickets.put(mkTicket({ id: 'a' }))
    const before = await d._outbox.count()
    await setLearnerNotes(d, 'a', 'hello', 1)
    expect(await d._outbox.count()).toBe(before + 1)
    gate.readOnly = true
    await expect(setLearnerNotes(d, 'a', 'again', 2).catch(isReadOnlyError)).resolves.toBe(true)
  })
})

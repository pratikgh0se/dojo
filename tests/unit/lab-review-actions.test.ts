import { afterEach, describe, expect, it } from 'vitest'
import { requestReview } from '../../src/data/labActions'
import { fakeVariantKey } from '../../src/ai/fake'
import { LAB_REVIEW_INVALID } from '../../src/rules/labReview'
import { reviewCards } from '../../src/rules/reviewQueue'
import { freshDb } from '../helpers/db'
import { mkLabRow, mkRun } from '../helpers/labRows'
import { err, INFO, labServer, ok } from '../helpers/labServer'
import { mkTicket } from '../helpers/tickets'

const NOW = new Date(2026, 10, 4, 10, 0).getTime()
const DAY = 86_400_000
const WRITEUP = '# Writeup\n\n## Problem\nThe first check needed one small answer.\n'
const BUNDLE = { rubric: INFO.rubric, writeup: WRITEUP, files: [{ path: 'notes/c1.txt', diff: '+ok' }] }
const variant = (v: string | null) => { if (v === null) localStorage.removeItem(fakeVariantKey('lab_review')); else localStorage.setItem(fakeVariantKey('lab_review'), v) }
afterEach(() => variant(null))

const ALL_PASS = mkRun('t-lab', 100, { c1: 'pass', c2: 'pass', c3: 'pass' })
const server = (bundle: () => ReturnType<typeof ok> | ReturnType<typeof err> = () => ok({ bundle: BUNDLE })) =>
  labServer({ '/labs/info': () => ok({ ...INFO }), '/labs/bundle': bundle })

async function ready() {
  const d = freshDb()
  await d.labs.put(mkLabRow('t-lab', { root: '~/labs' }))
  await d.labRuns.put(ALL_PASS)
  await d.tickets.put(mkTicket({ id: 'tlab.build.3', kind: 'build', title: 'Lab step three', lane: 'path' }))
  return d
}

describe('requestReview', () => {
  it('a passing review: one row computed by the app, one aiLog row, the bundle asked for in the folder the lab was set up in, no Review cards', async () => {
    const d = await ready()
    const s = server()
    const r = await requestReview(d, 't-lab', NOW, s.f)
    expect(r.ok && r.review).toMatchObject({ id: `rev-t-lab-${NOW}`, labId: 't-lab', at: NOW, percent: 83, passed: true, summary: '[fake:review] Reviewed 4 items.' })
    expect(r.ok && r.review.items.map(i => i.score)).toEqual([3, 2, 3, 2])
    expect(r.ok && r.review.items[0].evidence).toEqual([{ quote: 'The first check needed one small answer.', file: 'WRITEUP.md', line: 4 }])
    expect(s.calls.find(c => c.path === '/labs/bundle')!.body).toEqual({ labId: 't-lab', labsRoot: '~/labs' })
    expect(await d.labReviews.count()).toBe(1)
    expect(await d.redos.count()).toBe(0)
    expect((await d.aiLog.toArray()).map(a => [a.job, a.provider, a.ok, a.ticketId])).toEqual([['lab_review', 'fake', true, 'tlab.build.3']])
  })

  it('the app, not the model, decides: borderline is 66 and Not yet although the reply claims 100 and passed', async () => {
    const d = await ready()
    variant('borderline')
    const r = await requestReview(d, 't-lab', NOW, server().f)
    expect(r.ok && [r.review.percent, r.review.passed]).toEqual([66, false])
    variant('pass-weak')
    const w = await requestReview(d, 't-lab', NOW + 1, server().f)
    expect(w.ok && [w.review.percent, w.review.passed]).toEqual([83, true])
  })

  it('fabricated quotes are dropped and the score capped: stored 3, 2, 1, 0, percent 50, cards for r3 and r4 only', async () => {
    const d = await ready()
    variant('fabricated')
    const r = await requestReview(d, 't-lab', NOW, server().f)
    expect(r.ok && r.review.items.map(i => i.score)).toEqual([3, 2, 1, 0])
    expect(r.ok && r.review.items[2].evidence).toEqual([])
    expect(r.ok && [r.review.percent, r.review.passed]).toEqual([50, false])
    expect((await d.redos.toArray()).map(x => x.id).sort()).toEqual(['lr-t-lab-r3', 'lr-t-lab-r4'])
  })

  it('LAB-71: malformed evidence is dropped, not the review: stored 3, 2, 1, 0, percent 50, one ok aiLog row, r3 has no evidence', async () => {
    const d = await ready()
    variant('malformed')
    const r = await requestReview(d, 't-lab', NOW, server().f)
    expect(r.ok && r.review.items.map(i => i.score)).toEqual([3, 2, 1, 0])
    expect(r.ok && r.review.items[1].evidence).toEqual([{ quote: 'The first check needed one small answer.', file: 'WRITEUP.md', line: 4 }])
    expect(r.ok && r.review.items[2].evidence).toEqual([])
    expect(r.ok && [r.review.percent, r.review.passed]).toEqual([50, false])
    expect(await d.labReviews.count()).toBe(1)
    expect((await d.aiLog.toArray()).map(a => [a.job, a.provider, a.ok])).toEqual([['lab_review', 'fake', true]])
  })

  it('weak items become Review cards: stage 0, due the next local day, on the closing ticket, with the rubric text and the stronger text', async () => {
    const d = await ready()
    variant('not-yet')
    await requestReview(d, 't-lab', NOW, server().f)
    const cards = (await d.redos.toArray()).sort((a, b) => a.id.localeCompare(b.id))
    expect(cards.map(c => c.id)).toEqual(['lr-t-lab-r1', 'lr-t-lab-r2', 'lr-t-lab-r3', 'lr-t-lab-r4'])
    expect(cards[0]).toEqual({
      id: 'lr-t-lab-r1', ticketId: 'tlab.build.3', source: 'lab_review', createdAt: NOW, stage: 0, due: '2026-11-05', passed: [], helpCost: 0, refunded: 0,
      piece: { topic: 'Tiny lab', question: 'States the problem.', answer: '[fake:review] A stronger answer for r1 adds one concrete detail.' },
    })
    // a passing review with one weak item (pass-weak) makes just that card
    const d2 = await ready()
    variant('pass-weak')
    await requestReview(d2, 't-lab', NOW, server().f)
    expect((await d2.redos.toArray()).map(x => x.id)).toEqual(['lr-t-lab-r4'])
  })

  it('a repeated review adds no duplicate card and leaves the open ones untouched; the newest review counts', async () => {
    const d = await ready()
    variant('not-yet')
    await requestReview(d, 't-lab', NOW, server().f)
    const before = await d.redos.toArray()
    await requestReview(d, 't-lab', NOW + 1000, server().f)
    expect(await d.redos.toArray()).toEqual(before)
    variant(null)
    await requestReview(d, 't-lab', NOW + 2000, server().f)
    expect(await d.redos.count()).toBe(4) // cards are never removed by a review
    expect((await d.labReviews.orderBy('at').toArray()).map(r => r.passed)).toEqual([false, false, true])
  })

  it('a closed card that scores weak again is opened again', async () => {
    const d = await ready()
    variant('not-yet')
    await requestReview(d, 't-lab', NOW, server().f)
    const r1 = (await d.redos.get('lr-t-lab-r1'))!
    await d.redos.put({ ...r1, closedAt: NOW + 5, stage: 2 })
    await requestReview(d, 't-lab', NOW + DAY, server().f)
    expect(await d.redos.get('lr-t-lab-r1')).toMatchObject({ stage: 0, createdAt: NOW + DAY })
    expect((await d.redos.get('lr-t-lab-r1'))!.closedAt).toBeUndefined()
  })

  it('an unusable reply (a repeated id and a score of 7) stores no review and no card, logs one failed call, and Retry works', async () => {
    const d = await ready()
    variant('invalid')
    const r = await requestReview(d, 't-lab', NOW, server().f)
    expect(r).toEqual({ ok: false, code: 'invalid_output', message: LAB_REVIEW_INVALID })
    expect(await d.labReviews.count() + await d.redos.count()).toBe(0)
    expect((await d.aiLog.toArray()).map(a => [a.job, a.ok])).toEqual([['lab_review', false]])
    variant('pass')
    expect((await requestReview(d, 't-lab', NOW + 1, server().f)).ok).toBe(true)
    expect(await d.labReviews.count()).toBe(1)
  })

  it('a reply that is well formed but leaves out a rubric id is also unusable', async () => {
    const d = await ready()
    const smallRubric = { ...BUNDLE, rubric: INFO.rubric.slice(0, 3) } // the bundle the model saw had 3, the definition has 4
    const r = await requestReview(d, 't-lab', NOW, server(() => ok({ bundle: smallRubric })).f)
    expect(r).toMatchObject({ ok: false, code: 'invalid_output', message: LAB_REVIEW_INVALID })
    expect(await d.labReviews.count()).toBe(0)
  })

  it('needs a set-up lab and every milestone passed (not the closing ticket Done); nothing is asked of the server or the AI before that', async () => {
    const s = server()
    expect(await requestReview(freshDb(), 't-lab', NOW, s.f)).toMatchObject({ ok: false, code: 'not_set_up' })
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab'))
    await d.labRuns.put(mkRun('t-lab', 1, { c1: 'pass', c2: 'pass', c3: 'fail' }))
    expect(await requestReview(d, 't-lab', NOW, s.f)).toMatchObject({ ok: false, code: 'not_ready' })
    expect(s.calls.map(c => c.path)).toEqual(['/labs/info'])
    expect(await d.aiLog.count()).toBe(0)
  })

  it('milestones passed in different runs count (monotonic); the closing ticket need not be Done', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab'))
    await d.labRuns.bulkPut([mkRun('t-lab', 1, { c1: 'pass', c2: 'fail', c3: 'fail' }), mkRun('t-lab', 2, { c1: 'fail', c2: 'pass', c3: 'fail' }), mkRun('t-lab', 3, { c1: 'fail', c2: 'fail', c3: 'pass' })])
    await d.tickets.put(mkTicket({ id: 'tlab.build.3', kind: 'build', status: 'todo' }))
    expect((await requestReview(d, 't-lab', NOW, server().f)).ok).toBe(true)
  })

  it('lab_dirty, not_set_up (folder gone), bad_root and a dead server come back as their plain lines and store nothing', async () => {
    const d = await ready()
    for (const [code, status, message] of [
      ['lab_dirty', 409, 'Commit your work in the lab folder first, then request the review.'],
      ['not_set_up', 409, 'The lab folder was not found. Set up the lab again to create it.'],
      ['bad_root', 400, 'The labs folder must be inside your home folder, and not the home folder itself.'],
    ] as const) {
      expect(await requestReview(d, 't-lab', NOW, server(() => err(status, code, message)).f)).toEqual({ ok: false, code, message })
    }
    expect(await requestReview(d, 't-lab', NOW, (() => Promise.reject(new Error('down'))) as unknown as typeof fetch)).toMatchObject({ ok: false, code: 'no_server' })
    expect(await d.labReviews.count() + await d.aiLog.count()).toBe(0)
  })

  it('an AI failure (the helper is down) keeps its own error and stores nothing', async () => {
    const d = await ready()
    localStorage.setItem('dojo-ai-fake-fail', 'lab_review:claude_missing')
    const r = await requestReview(d, 't-lab', NOW, server().f)
    localStorage.removeItem('dojo-ai-fake-fail')
    expect(r).toMatchObject({ ok: false, code: 'claude_missing' })
    expect(await d.labReviews.count()).toBe(0)
  })
})

describe('a lab_review card in Review (REVIEW-30)', () => {
  it('is a check card on the closing ticket: titled by the lab, the rubric text as the question, due the next day, no redo button target needed', async () => {
    const d = await ready()
    variant('not-yet')
    await requestReview(d, 't-lab', NOW, server().f)
    const tickets = await d.tickets.toArray()
    const redos = await d.redos.toArray()
    expect(reviewCards({ redos, tickets, nowMs: NOW })).toEqual([]) // due tomorrow, not today
    const cards = reviewCards({ redos, tickets, nowMs: NOW + DAY })
    expect(cards).toHaveLength(4)
    expect(cards[0]).toMatchObject({ kind: 'check', ticketId: 'tlab.build.3', ticketKind: 'build', title: 'Tiny lab', lane: 'path', prompt: 'States the problem.', stored: '[fake:review] A stronger answer for r1 adds one concrete detail.' })
  })
})

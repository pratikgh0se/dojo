import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncGate } from '../../src/data/db'
import { submitExplainCheck } from '../../src/data/checkActions'
import { CHECK_REDO_DAYS, checkRedoDue, explainQuestions } from '../../src/rules/check'
import { isRedoDue } from '../../src/rules/redoQueue'
import { Do } from '../../src/screens/Do'
import { useCompleteTicket } from '../../src/study/useCompleteTicket'
import type { Ticket } from '../../src/data/types'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const ai = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../../src/data/aiActions', () => ({ callJob: (...a: unknown[]) => ai.call(...a) }))
const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

const AT = new Date(2026, 10, 4, 10).getTime()
const t1 = mkTicket({ id: 'w1', kind: 'watch', status: 'done', explain: ['What is a weight?', 'What does training change?'], explainAnswers: ['One adjustable number.', 'The weights.'] })
const verdicts = (v: 'pass' | 'fail') => ({ ok: true, output: { results: [{ id: 'explain-1', verdict: v, correction: '', pointer: '' }, { id: 'explain-2', verdict: v, correction: '', pointer: '' }] } })
beforeEach(() => { ai.call.mockReset() })
afterEach(() => { cleanup(); ro.on = false; syncGate.readOnly = false; syncGate.modelLocked = false })

describe('explainQuestions', () => {
  it('derives open questions from explain, with the reference as the key idea, and never reads a legacy brief', () => {
    const q = [{ id: 'q1', kind: 'open' as const, q: 'Why?', keyIdeas: ['x'] }]
    expect(explainQuestions(t1)).toEqual([
      { id: 'explain-1', kind: 'open', q: 'What is a weight?', keyIdeas: ['One adjustable number.'] },
      { id: 'explain-2', kind: 'open', q: 'What does training change?', keyIdeas: ['The weights.'] },
    ])
    expect(explainQuestions({ ...t1, brief: { questions: q } as never } as never).map(x => x.id)).toEqual(['explain-1', 'explain-2'])
    expect(explainQuestions(mkTicket({ id: 'x' }))).toEqual([])
  })
})

describe('submitExplainCheck', () => {
  async function setup(t = t1) {
    const d = freshDb()
    await d.tickets.put(t)
    return d
  }
  it('stores a pass and leaves the finished ticket and its XP alone', async () => {
    ai.call.mockResolvedValue(verdicts('pass'))
    const d = await setup()
    const r = await submitExplainCheck(d, 'w1', ['a weight', 'it nudges them'], AT)
    expect(r).toMatchObject({ ok: true, passed: true })
    const rows = await d.checkAttempts.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ticketId: 'w1', passed: true })
    // W5: a pass schedules the explain Review cards, 0-based ids, nothing else
    expect((await d.redos.toArray()).map(r => [r.id, r.source, r.stage])).toEqual([['ex-w1-0', 'explain', 0], ['ex-w1-1', 'explain', 0]])
    expect(await d.tickets.get('w1')).toMatchObject({ status: 'done', xp: 0 })
  })

  it('a pass uses the given topic for the cards and a second pass creates nothing new', async () => {
    ai.call.mockResolvedValue(verdicts('pass'))
    const d = await setup()
    await submitExplainCheck(d, 'w1', ['a', 'b'], AT, 'Neural network basics')
    expect((await d.redos.get('ex-w1-0'))!.piece).toMatchObject({ topic: 'Neural network basics' })
    await submitExplainCheck(d, 'w1', ['a', 'b'], AT + 1000, 'Neural network basics')
    expect(await d.redos.count()).toBe(2)
  })

  it('a fail makes the check_failed redo and no explain cards; a skipped check makes nothing', async () => {
    ai.call.mockResolvedValue(verdicts('fail'))
    const d = await setup()
    await submitExplainCheck(d, 'w1', ['x', 'y'], AT)
    expect((await d.redos.toArray()).map(r => r.source)).toEqual(['check_failed'])
    const d2 = await setup({ ...t1, id: 'w9', explainAnswers: undefined })
    await submitExplainCheck(d2, 'w9', ['x', 'y'], AT)
    expect(await d2.redos.count()).toBe(0)
  })

  it('a re-run check does not close or push back an explain card', async () => {
    ai.call.mockResolvedValue(verdicts('pass'))
    const d = await setup()
    await submitExplainCheck(d, 'w1', ['a', 'b'], AT)
    ai.call.mockResolvedValue(verdicts('fail'))
    await submitExplainCheck(d, 'w1', ['a', 'b'], AT + 86_400_000)
    const all = await d.redos.toArray()
    const ex = all.filter(r => r.source === 'explain')
    expect(ex).toHaveLength(2)
    expect(ex.every(r => r.closedAt === undefined && r.due === ex[0].due && r.passed.length === 0)).toBe(true)
    expect(all.filter(r => r.source === 'check_failed')).toHaveLength(1)
  })

  it('schedules the same three-day check redo on a fail', async () => {
    ai.call.mockResolvedValue(verdicts('fail'))
    const d = await setup()
    await submitExplainCheck(d, 'w1', ['x', 'y'], AT)
    const redos = await d.redos.toArray()
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({ ticketId: 'w1', source: 'check_failed', stage: 0, due: checkRedoDue(AT) })
    expect(isRedoDue(redos[0], AT)).toBe(false)
    expect(isRedoDue(redos[0], AT + 3 * 86_400_000)).toBe(true)
    expect((await d.tickets.get('w1'))!.status).toBe('done')
  })

  it('skips without calling the AI when an answer is empty, there is no reference, or there are no questions', async () => {
    const d = await setup()
    expect(await submitExplainCheck(d, 'w1', ['x', '  '], AT)).toMatchObject({ ok: false, code: 'skipped' })
    const d2 = await setup({ ...t1, id: 'w2', explainAnswers: undefined })
    expect(await submitExplainCheck(d2, 'w2', ['x', 'y'], AT)).toMatchObject({ ok: false, code: 'skipped' })
    const d3 = await setup(mkTicket({ id: 'w3', kind: 'watch' }))
    expect(await submitExplainCheck(d3, 'w3', [], AT)).toMatchObject({ ok: false, code: 'skipped' })
    const d4 = await setup({ ...t1, id: 'w4', explainAnswers: ['Only the first reference.'] }) // a reference answer for every question, or no check
    expect(await submitExplainCheck(d4, 'w4', ['x', 'y'], AT)).toMatchObject({ ok: false, code: 'skipped' })
    expect(ai.call).not.toHaveBeenCalled()
  })

  it('reports an unavailable AI without throwing or writing', async () => {
    ai.call.mockResolvedValue({ ok: false, code: 'unavailable', error: 'Claude Code is not signed in' })
    const d = await setup()
    expect(await submitExplainCheck(d, 'w1', ['x', 'y'], AT)).toMatchObject({ ok: false, code: 'unavailable' })
    expect(await d.checkAttempts.count()).toBe(0)
    expect(await d.redos.count()).toBe(0)
  })

  it('grades the explain answers even when a legacy brief with other questions is present', async () => {
    ai.call.mockResolvedValue(verdicts('pass'))
    const brief = { questions: [{ id: 'q1', kind: 'open', q: 'Why?', keyIdeas: ['x'] }] }
    const d = await setup({ ...t1, brief: brief as never })
    expect(await submitExplainCheck(d, 'w1', ['a weight', 'it nudges them'], AT)).toMatchObject({ ok: true, passed: true })
    const sent = JSON.stringify(ai.call.mock.calls[0].slice(1))
    expect(sent).toContain('explain-1')
    expect(sent).toContain('explain-2')
    expect(sent).not.toContain('"q1"')
  })
})

describe('useCompleteTicket: a second Done on the same ticket', () => {
  const plans = appPlans()
  async function twice(run: (complete: (t: Ticket) => Promise<boolean>, t: Ticket) => Promise<unknown>) {
    ai.call.mockResolvedValue(verdicts('fail'))
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    const t = mkTicket({ id: 'w1', kind: 'watch', lane: 'path', explain: t1.explain, explainAnswers: t1.explainAnswers, explainResponses: ['a weight', 'it nudges them'] })
    await d.tickets.put(t)
    let complete!: (t: Ticket) => Promise<boolean>
    function Probe() { complete = useCompleteTicket(); return null }
    renderWithApp(<Probe />, { db: d, ...plans })
    await run(complete, t)
    await new Promise(r => setTimeout(r, 50))
    return d
  }
  function expectOneCheck(d: Awaited<ReturnType<typeof twice>>) {
    expect(ai.call).toHaveBeenCalledTimes(1)
    return Promise.all([d.checkAttempts.count(), d.redos.toArray()]).then(([n, redos]) => {
      expect(n).toBe(1)
      expect(redos).toHaveLength(1)
      expect(redos[0].passed).toEqual([])
    })
  }
  it('one after the other: the second finds the ticket done and checks nothing', async () => {
    await expectOneCheck(await twice(async (c, t) => { await c(t); await c(t) }))
  })
  it('at the same time: still one check', async () => {
    await expectOneCheck(await twice(async (c, t) => { await Promise.all([c(t), c(t)]) }))
  })
})

describe('the ticket view after Done', () => {
  const plans = appPlans()
  async function startedWatch(responses: string[] = ['a weight', 'it nudges them']) {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', lane: 'path', explain: t1.explain, explainAnswers: t1.explainAnswers, explainResponses: responses }))
    return d
  }
  it('sends the answers saved on the ticket to the check job when Done is pressed', async () => {
    ai.call.mockResolvedValue(verdicts('pass'))
    const d = await startedWatch()
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    await waitFor(async () => expect(await d.checkAttempts.count()).toBe(1))
    expect(ai.call).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(ai.call.mock.calls[0].slice(1))).toContain('it nudges them')
  })
  it('does not wait for the check: Done shows and XP is awarded while the AI call is still pending', async () => {
    ai.call.mockReturnValue(new Promise(() => {}))
    const d = await startedWatch()
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    expect(await d.tickets.get('w1')).toMatchObject({ status: 'done', xp: 10 })
    await waitFor(() => expect(ai.call).toHaveBeenCalledTimes(1))
  })
  it('stays done and quiet when the AI call rejects', async () => {
    ai.call.mockRejectedValue(new Error('boom'))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const d = await startedWatch()
      renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
      fireEvent.click(await screen.findByTestId('ticket-start'))
      fireEvent.click(await screen.findByTestId('ticket-done'))
      expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
      await waitFor(() => expect(ai.call).toHaveBeenCalledTimes(1))
      await new Promise(r => setTimeout(r, 20))
      expect(unhandled).not.toHaveBeenCalled()
      expect(await d.tickets.get('w1')).toMatchObject({ status: 'done', xp: 10 })
      expect(await d.checkAttempts.count()).toBe(0)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
  it('runs the check once for two quick Done clicks: one AI call, one attempt row, one redo with no extra result', async () => {
    ai.call.mockResolvedValue(verdicts('fail'))
    const d = await startedWatch()
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    const done = await screen.findByTestId('ticket-done')
    fireEvent.click(done)
    fireEvent.click(done)
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    await waitFor(async () => expect(await d.checkAttempts.count()).toBe(1))
    await new Promise(r => setTimeout(r, 50))
    expect(ai.call).toHaveBeenCalledTimes(1)
    expect(await d.checkAttempts.count()).toBe(1)
    const redos = await d.redos.toArray()
    expect(redos).toHaveLength(1)
    expect(redos[0].passed).toEqual([])
    expect(document.querySelector('[data-tone="danger"]')).toBeNull() // the second click is ignored, not refused with a toast
  })
  it('tells the learner when the answers come back in Review', async () => {
    ai.call.mockResolvedValue(verdicts('fail'))
    const d = await startedWatch()
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    expect(await screen.findByText(`Your answers come back in Review in ${CHECK_REDO_DAYS} days.`)).toBeInTheDocument()
  })
  it('makes no AI call and writes nothing in a read-only browser: Done is disabled', async () => {
    ro.on = true
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put(mkTicket({ id: 'r1', kind: 'ritual', lane: 'path', explain: t1.explain, explainAnswers: t1.explainAnswers, explainResponses: ['a', 'b'] }))
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/r1', path: '/do/:ticketId' })
    const done = await screen.findByTestId('ticket-done')
    expect(done).toBeDisabled()
    fireEvent.click(done)
    await new Promise(r => setTimeout(r, 20))
    expect(ai.call).not.toHaveBeenCalled()
    expect(await d.checkAttempts.count()).toBe(0)
    expect(await d.redos.count()).toBe(0)
    expect((await d.tickets.get('r1'))!.status).not.toBe('done')
  })
  it.each(['readOnly', 'modelLocked'] as const)('makes no AI call when the sync gate is %s, though Done still lands', async flag => {
    const d = await startedWatch()
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    const done = await screen.findByTestId('ticket-done')
    syncGate[flag] = true
    fireEvent.click(done)
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    await new Promise(r => setTimeout(r, 30))
    expect(ai.call).not.toHaveBeenCalled()
    expect(await d.checkAttempts.count()).toBe(0)
  })
  it('does not call the AI when an answer is empty', async () => {
    const d = await startedWatch(['only one', ''])
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    await new Promise(r => setTimeout(r, 20))
    expect(ai.call).not.toHaveBeenCalled()
  })
  async function doneWithAttempt(ticket: typeof t1, passed: boolean) {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put(ticket)
    await d.checkAttempts.add({ id: 'ca1', ticketId: ticket.id, at: AT, passed, answers: [], feedback: [] })
    renderWithApp(<Do />, { db: d, ...plans, route: `/do/${ticket.id}`, path: '/do/:ticketId' })
  }
  it('says what a failed check found, without blame', async () => {
    await doneWithAttempt(t1, false)
    const line = await screen.findByTestId('ticket-check-status')
    expect(line).toHaveTextContent(`Your answers were checked. They come back in Review in ${CHECK_REDO_DAYS} days.`)
    expect(line.textContent).not.toMatch(/fail|wrong|behind/i)
  })
  it('says a passed check is all good', async () => {
    await doneWithAttempt(t1, true)
    expect(await screen.findByTestId('ticket-check-status')).toHaveTextContent('Your answers were checked: all good.')
  })
  it('shows no check line on a build ticket, even with an attempt (TICKET-19)', async () => {
    await doneWithAttempt({ ...t1, id: 'b1', kind: 'build' } as typeof t1, false)
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    expect(screen.queryByTestId('ticket-check-status')).toBeNull()
  })
})

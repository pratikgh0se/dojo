import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeOutput } from '../../src/ai/fake'
import type { InterviewFinal } from '../../src/ai/types'
import { syncGate } from '../../src/data/db'
import { enterScore, lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import type { CloseAnswers, DesignSession } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { GradeView } from '../../src/screens/designSession/GradeView'
import { INVALID_REPLY, learnerWords } from '../../src/screens/designSession/designAi'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// Final fix wave: a failed write inside an automatic AI flow never strands the screen, a read-only browser makes no automatic call,
// and the model's words are shown without the stored job name (GLOBAL-01) while the stored data stays raw.
const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const LENS_NAMES = ['Load', 'Data', 'Consistency', 'Failure', 'Latency', 'Cost', 'Evolution']
const CLOSE: CloseAnswers = {
  tradeoff: { chose: 'sliding window counter in Redis', over: 'token bucket per node', because: 'global limit needs shared state' },
  breaksAt10x: 'Redis hot key', dataOwnership: 'Redis owns counters', couldNotAnswer: 1, readNext: 'Stripe rate limiter blog post',
}
const ROUTE = { route: '/designs/session/d-method', path: '/designs/session/:designId' }
type Db = Awaited<ReturnType<typeof seededDb>>

const spies: { mockRestore: () => void }[] = []
/** Rejects (as a full disk or an IndexedDB error would) every row write the test's predicate picks. */
function failWrites(d: Db, when: (row: DesignSession) => boolean, state = { on: true }) {
  const orig = d.designSessions.put.bind(d.designSessions)
  const spy = vi.spyOn(d.designSessions, 'put')
  spies.push(spy)
  spy.mockImplementation((async (row: DesignSession, ...rest: unknown[]) => {
    if (state.on && when(row)) throw new Error('QuotaExceededError: disk full')
    return (orig as (...a: unknown[]) => unknown)(row, ...rest)
  }) as unknown as typeof d.designSessions.put)
  return state
}
async function drawingPartner(prepare?: (d: Db) => void) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'ai-partner', deepDives: DIVES, nowMs: T - MIN })
  prepare?.(d)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, ...ROUTE })
  fireEvent.click(await screen.findByTestId('session-tab-partner'))
  await screen.findByTestId('session-interviewer')
  return { d, id: s.id }
}
async function scoring(mode: 'ai-partner' | 'solo', prepare?: (d: Db) => void) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - 12 * MIN })
  await lockDesignSession(d, s.id, T)
  await enterScore(d, s.id, CLOSE)
  prepare?.(d)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, ...ROUTE })
  await screen.findByTestId('session-score')
  return { d, id: s.id }
}
const msgs = () => screen.queryAllByTestId('session-msg')
const box = () => screen.getByTestId('session-chat-input')
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })
const hasAi = (r: DesignSession) => !!r.interview?.messages.some(m => m.from === 'interviewer')

afterEach(() => { cleanup(); localStorage.clear(); syncGate.readOnly = false; syncGate.modelLocked = false; spies.splice(0).forEach(sp => sp.mockRestore()) })

describe('a rejected write in the AI partner panel does not strand it (Review Focus 4)', () => {
  it('the opener cannot be stored: a plain sentence and Retry show, Send is not stuck, and Retry recovers', async () => {
    const gate = { on: true }
    await drawingPartner(d => failWrites(d, hasAi, gate))
    const err = await screen.findByTestId('session-ai-error')
    expect(err).toHaveTextContent(INVALID_REPLY.turn)
    expect(err.textContent).not.toMatch(/disk full|QuotaExceeded/)
    expect(screen.queryByTestId('ai-loader')).toBeNull()
    type(box(), 'my first answer')
    expect(screen.getByTestId('session-send')).toBeEnabled()
    gate.on = false
    fireEvent.click(within(err).getByTestId('ai-retry'))
    await waitFor(() => expect(msgs().some(m => m.dataset.from === 'ai')).toBe(true))
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })

  it('a Hint whose reply cannot be stored leaves Hint and Send usable, and costs none of the three', async () => {
    const gate = { on: false }
    await drawingPartner(d => failWrites(d, r => !!r.interview?.messages.some(m => m.hint), gate))
    await waitFor(() => expect(msgs()).toHaveLength(1))
    gate.on = true
    fireEvent.click(screen.getByTestId('session-hint'))
    const err = await screen.findByTestId('session-ai-error')
    expect(err).toHaveTextContent(INVALID_REPLY.turn)
    expect(screen.getByTestId('session-hint')).toBeEnabled()
    expect(screen.getByTestId('session-hint')).toHaveTextContent('3 left')
    type(box(), 'still here')
    expect(screen.getByTestId('session-send')).toBeEnabled()
  })

  it('a send whose own write is rejected shows the sentence, keeps the words in the box and no unhandled rejection', async () => {
    const gate = { on: false }
    await drawingPartner(d => failWrites(d, r => !!r.interview?.messages.some(m => m.from === 'you'), gate))
    await waitFor(() => expect(msgs()).toHaveLength(1))
    gate.on = true
    type(box(), 'keep these words')
    fireEvent.click(screen.getByTestId('session-send'))
    await screen.findByTestId('session-ai-error')
    expect(box()).toHaveValue('keep these words')
    expect(screen.getByTestId('session-send')).toBeEnabled()
  })
})

describe('a rejected grade write leaves the score form usable (Review Focus 4)', () => {
  it('shows the grade sentence and Retry, the form is editable and COMPLETE · SESSION enables once scored by hand', async () => {
    const gate = { on: true }
    await scoring('ai-partner', d => failWrites(d, r => !!r.interview?.final, gate))
    const err = await screen.findByTestId('session-ai-error')
    expect(err).toHaveTextContent(INVALID_REPLY.grade)
    expect(err.textContent).not.toMatch(/disk full|QuotaExceeded/)
    expect(screen.queryByTestId('session-score-loading')).toBeNull()
    DIVES.forEach((_, i) => fireEvent.click(screen.getByTestId(`session-dive-score-${i + 1}-1`)))
    for (const l of LENS_NAMES) fireEvent.click(within(screen.getByRole('radiogroup', { name: l })).getByRole('radio', { name: '1' }))
    const row2 = screen.getByTestId('session-tradeoff-row-2')
    for (const [name, v] of [['Chose', 'a'], ['Over', 'b'], ['Because', 'c']]) type(within(row2).getByRole('textbox', { name }), v)
    type(screen.getByTestId('session-rubric'), '14')
    expect(screen.getByTestId('session-complete')).toBeEnabled()
    gate.on = false
    fireEvent.click(screen.getByTestId('ai-retry'))
    await waitFor(() => expect(screen.getByTestId('session-grade')).toBeInTheDocument())
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })
})

describe('a rejected reference write in the done view is a sentence, not a throw', () => {
  it('shows the reference sentence with Retry', async () => {
    setNow(() => T)
    const d = await seededDb()
    const row = {
      id: 'ds-1', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12, mode: 'solo', view: '2d',
      canvas: { layout: 'manual', nodes: [], links: [], zones: [], flows: [] }, close: CLOSE,
      deepDives: DIVES.map((q, i) => ({ q, answered: [2, 1, 2, 0][i] })), tradeoffs: [CLOSE.tradeoff, CLOSE.tradeoff], rubric: 12, rubricBy: 'self',
      lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 },
    } as unknown as DesignSession
    await d.designSessions.add(row)
    failWrites(d, r => !!r.reference)
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
    const err = await screen.findByTestId('session-ai-error')
    expect(err).toHaveTextContent(INVALID_REPLY.diagram)
    expect(within(err).getByTestId('ai-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('session-reference-loading')).toBeNull()
  })
})

describe('a read-only browser makes no automatic AI call and shows no raw error', () => {
  it('drawing with an empty chat: no opener, no loader, no error, no aiLog row', async () => {
    setNow(() => T)
    const d = await seededDb()
    await startDesignSession(d, { designId: 'd-method', mode: 'ai-partner', deepDives: DIVES, nowMs: T - MIN })
    syncGate.readOnly = true
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, ...ROUTE })
    fireEvent.click(await screen.findByTestId('session-tab-partner'))
    await screen.findByTestId('session-interviewer')
    await new Promise(r => setTimeout(r, 80))
    expect(await d.aiLog.count()).toBe(0)
    expect(msgs()).toHaveLength(0)
    for (const id of ['session-ai-error', 'ai-loader']) expect(screen.queryByTestId(id), id).toBeNull()
    expect(document.body.textContent).not.toMatch(/disk full|ReadOnlyError/)
  })

  it('score phase of an AI partner session: no grade call, no loader, no error, the form is the learner\'s', async () => {
    setNow(() => T)
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'ai-partner', deepDives: DIVES, nowMs: T - 12 * MIN })
    await lockDesignSession(d, s.id, T)
    await enterScore(d, s.id, CLOSE)
    syncGate.readOnly = true
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, ...ROUTE })
    await screen.findByTestId('session-score')
    await new Promise(r => setTimeout(r, 80))
    expect(await d.aiLog.count()).toBe(0)
    for (const id of ['session-ai-error', 'session-score-loading', 'session-grade']) expect(screen.queryByTestId(id), id).toBeNull()
    DIVES.forEach((_, i) => fireEvent.click(screen.getByTestId(`session-dive-score-${i + 1}-1`)))
    expect(screen.getByTestId('session-score')).toBeInTheDocument()
  })
})

describe('no AI call while writes are refused (read-only browser or the model gate)', () => {
  for (const flag of ['readOnly', 'modelLocked'] as const) {
    it(`${flag}: mounting makes no call, and Hint and Send are disabled`, async () => {
      setNow(() => T)
      const d = await seededDb()
      await startDesignSession(d, { designId: 'd-method', mode: 'ai-partner', deepDives: DIVES, nowMs: T - MIN })
      syncGate[flag] = true
      renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, ...ROUTE })
      fireEvent.click(await screen.findByTestId('session-tab-partner'))
      await screen.findByTestId('session-interviewer')
      await new Promise(r => setTimeout(r, 80))
      expect(await d.aiLog.count()).toBe(0)
      expect(msgs()).toHaveLength(0)
      for (const id of ['session-ai-error', 'ai-loader']) expect(screen.queryByTestId(id), id).toBeNull()
      expect(screen.getByTestId('session-hint')).toBeDisabled()
      type(box(), 'a typed answer')
      expect(screen.getByTestId('session-send')).toBeDisabled()
      fireEvent.click(screen.getByTestId('session-send'))
      await new Promise(r => setTimeout(r, 40))
      expect(await d.aiLog.count()).toBe(0)
      expect(msgs()).toHaveLength(0)
    })
  }
  it('the writer is unchanged: the opener is asked once and Hint is available after it', async () => {
    const { d } = await drawingPartner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    expect((await d.aiLog.toArray()).filter(r => r.job === 'interview')).toHaveLength(1)
    type(box(), 'a typed answer')
    expect(screen.getByTestId('session-send')).toBeEnabled()
  })
})

describe('GLOBAL-01 on the model\'s own words: display-only', () => {
  it('learnerWords matches the whole word and keeps neighbours sensible', () => {
    expect(learnerWords('In this interview, the interviewer asked about interviews.')).not.toMatch(/\binterview/i)
    expect(learnerWords('interviewing')).toBe('session')
    expect(learnerWords('Interview')).toBe('Session')
    expect(learnerWords('no change here')).toBe('no change here')
  })

  it('a partner message that says "In this interview" renders without the word; the stored transcript keeps it', async () => {
    const raw = 'In this interview, we size the system. What is the daily load?'
    const { d, id } = await drawingPartner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    // replace the opener with a raw model line
    await d.designSessions.update(id, { interview: { messages: [{ from: 'interviewer', text: raw }] } })
    await waitFor(() => expect(screen.getByTestId('session-msg-text')).toHaveTextContent('In this session, we size the system.'))
    expect(screen.getByTestId('session-interviewer').textContent).not.toMatch(/\binterview/i)
    expect((await d.designSessions.get(id))!.interview!.messages[0].text).toBe(raw)
  })

  it('the learner\'s own words are shown as typed', async () => {
    const { d, id } = await drawingPartner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    await d.designSessions.update(id, { interview: { messages: [{ from: 'interviewer', text: 'Q?' }, { from: 'you', text: 'a mock interview prep tool' }] } })
    await waitFor(() => expect(msgs()).toHaveLength(2))
    expect(msgs()[1]).toHaveTextContent('a mock interview prep tool')
  })

  it('a grade whose notes, checks, stronger lines and study line say interviewer/interview renders without the word', () => {
    const final: InterviewFinal = {
      done: true, score: 15,
      perItem: [4, 2, 3, 4, 2].map((p, i) => ({ item: `Item ${i}`, points: p, note: `The interviewer wanted more on ${i}.` })),
      oneThingToStudy: 'Practise interviewing on partitioning.', deepDives: [2, 1, 1, 0],
      lenses: { load: 1, data: 1, consistency: 1, failure: 1, latency: 1, cost: 1, evolution: 1 },
      inconsistencies: ['In the interview you said Redis, the diagram has none.'], stronger: ['An interviewer would hear the failure mode.'],
    }
    const { container } = render(<GradeView final={final} />)
    expect(container.textContent).not.toMatch(/\binterview/i)
    expect(container.textContent).toContain('In the session you said Redis')
    expect(final.perItem[0].note).toContain('interviewer') // the stored grade is not touched
  })

  it('the done view shows a stored transcript and grade without the word', async () => {
    setNow(() => T)
    const d = await seededDb()
    const final: InterviewFinal = {
      done: true, score: 15, perItem: [4, 2, 3, 4, 2].map((p, i) => ({ item: `Item ${i}`, points: p, note: 'The interviewer liked it.' })),
      oneThingToStudy: 'x', deepDives: [2, 1, 1, 0], lenses: { load: 1, data: 1, consistency: 1, failure: 1, latency: 1, cost: 1, evolution: 1 },
    }
    const row = {
      id: 'ds-1', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12, mode: 'ai-partner', view: '2d',
      canvas: { layout: 'manual', nodes: [], links: [], zones: [], flows: [] }, close: CLOSE,
      deepDives: DIVES.map((q, i) => ({ q, answered: [2, 1, 2, 0][i] })), tradeoffs: [CLOSE.tradeoff, CLOSE.tradeoff], rubric: 12, rubricBy: 'self',
      lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 },
      reference: { layout: 'layered', nodes: [{ id: 'a', kind: 'service', label: 'A' }], links: [], zones: [], flows: [] },
      interview: { messages: [{ from: 'interviewer', text: 'Welcome to this interview. Ready?' }], final },
    } as unknown as DesignSession
    await d.designSessions.add(row)
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
    await screen.findByTestId('session-summary')
    expect(screen.getByTestId('session-msg-text')).toHaveTextContent('Welcome to this session.')
    expect(screen.getByTestId('session-grade').textContent).not.toMatch(/\binterview/i)
    expect((await d.designSessions.get('ds-1'))!.interview!.messages[0].text).toContain('interview')
  })

  it('the fake partner\'s own line never turns "interviewing" into "sessioning"', () => {
    const out = fakeOutput('interview', { ticket: { id: 'rate-limiter', title: 'Interviewing a rate limiter', track: 'design', difficulty: 2, links: [] }, context: { turn: 1, answers: [], deepDives: DIVES } } as never) as { say: string }
    expect(out.say).not.toMatch(/\binterview/i)
    expect(out.say).not.toMatch(/sessioning/)
  })
})

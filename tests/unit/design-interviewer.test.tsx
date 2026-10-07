import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TRANSCRIPT_TEXT_MAX } from '../../src/ai/prompts'
import { appendInterview, lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']

async function interviewer(prepare?: (d: Awaited<ReturnType<typeof seededDb>>, id: string) => Promise<void>) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'interviewer', deepDives: DIVES, nowMs: T - MIN })
  if (prepare) await prepare(d, s.id)
  const view = renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await screen.findByTestId('session-interviewer')
  return { d, id: s.id, view }
}
const msgs = () => screen.queryAllByTestId('session-msg')
const box = () => screen.getByRole('textbox', { name: 'Your answer' })
const send = async (text: string) => {
  const before = msgs().length
  fireEvent.change(box(), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(msgs()).toHaveLength(before + 2))
}

afterEach(() => localStorage.clear())

describe('InterviewerPanel (C-DESIGN §4.7)', () => {
  it('asks turn 0 on start (D-32)', async () => {
    await interviewer()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    expect(msgs()[0]).toHaveAttribute('data-from', 'interviewer')
    expect(msgs()[0].textContent).toMatch(/^\[fake:interview\]/)
    expect(msgs()[0].textContent).toContain('d-method')
    expect(screen.getByTestId('session-interview-status')).toHaveTextContent('Requirements')
    expect(screen.getByRole('region', { name: 'Interviewer' })).toBeInTheDocument()
    expect(screen.getByRole('log', { name: 'Interview transcript' })).toBeInTheDocument()
    // I2: the textarea itself caps how much a learner can type into one answer.
    expect(box()).toHaveAttribute('maxlength', String(TRANSCRIPT_TEXT_MAX))
  })

  it('takes 9 answers across the four deep dives (D-33)', async () => {
    await interviewer()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    await send('QPS 10k, p99 5 ms')
    expect(msgs()[1]).toHaveAttribute('data-from', 'you')
    expect(msgs()[1]).toHaveTextContent('QPS 10k, p99 5 ms')
    expect(box()).toHaveValue('')
    expect(box()).toHaveFocus()
    expect(screen.getByTestId('session-interview-status')).toHaveTextContent('Deep dive 1 of 4')
    expect(screen.getByTestId('session-dive-1')).toHaveAttribute('aria-current', 'step')
    for (let i = 2; i <= 9; i++) await send(`answer ${i}`)
    expect(msgs().filter(m => m.dataset.from === 'you')).toHaveLength(9)
    expect(msgs().filter(m => m.dataset.from === 'interviewer')).toHaveLength(10)
    expect(screen.getByTestId('session-interview-status')).toHaveTextContent('Interview complete · 4 of 4 deep dives')
    expect(box()).toBeDisabled()
  })

  it('never double-sends and ignores whitespace (D-34)', async () => {
    await interviewer()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    fireEvent.change(box(), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.change(box(), { target: { value: 'once' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(msgs()).toHaveLength(3))
    await new Promise(r => setTimeout(r, 20))
    expect(msgs()).toHaveLength(3)
  })

  it('sends with Ctrl+Enter', async () => {
    await interviewer()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    fireEvent.change(box(), { target: { value: 'via keys' } })
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(msgs()).toHaveLength(3))
  })

  it('does not re-ask on reload (D-35)', async () => {
    await interviewer(async (d, id) => {
      await appendInterview(d, id, [{ from: 'interviewer', text: '[fake:interview] Turn 0 for d-method' }])
      await appendInterview(d, id, [{ from: 'you', text: 'a1' }])
      await appendInterview(d, id, [{ from: 'interviewer', text: '[fake:interview] Turn 1 for d-method' }])
    })
    await new Promise(r => setTimeout(r, 20))
    expect(msgs()).toHaveLength(3)
  })

  it('stops when the canvas locks (D-36, Review Focus #1)', async () => {
    await interviewer(async (d, id) => {
      await appendInterview(d, id, [{ from: 'interviewer', text: 'q0' }])
      await lockDesignSession(d, id, T)
    })
    expect(screen.getByTestId('session-interview-status')).toHaveTextContent('Interview stopped')
    expect(screen.getByTestId('session-interview-status')).not.toHaveTextContent('45 minutes')
    expect(box()).toBeDisabled()
  })

  it('shows the raw error and Retry when a turn fails (Review Focus #5)', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'interview')
    await interviewer()
    const panel = screen.getByTestId('session-interviewer')
    expect(await within(panel).findByText(/fake interview unavailable/)).toBeInTheDocument()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(msgs()).toHaveLength(1))
  })

  it('keeps the newest message in view after Send (UAT cu-7 P3-3)', async () => {
    await interviewer()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    const log = screen.getByRole('log', { name: 'Interview transcript' })
    // jsdom lays nothing out: give the log a scroll height and see that a new message moves the view to it
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 900 })
    log.scrollTop = 0
    await send('a message')
    expect(log.scrollTop).toBe(900)
  })

  // UAT cu-7 P2-1: after the 9th answer the real model sometimes closed with {done:true} and no grade; the learner saw the validator's words
  const nineAnswers = async () => {
    await interviewer()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    for (let i = 1; i <= 8; i++) await send(`answer ${i}`)
  }
  const RAW = /score must be|perItem must be|oneThingToStudy|lenses must score|deepDives must be/

  it('takes a closing line sent as done:true (repaired, no error at all)', async () => {
    await nineAnswers()
    localStorage.setItem('dojo:fake-ai-interview', 'closing-done')
    await send('answer 9')
    expect(msgs().at(-1)).toHaveTextContent('thanks, that is the interview')
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
    expect(screen.getByTestId('session-interview-status')).toHaveTextContent('Interview complete')
  })

  it('shows a plain sentence, never the validator, when the closing reply is unusable, and Retry works', async () => {
    await nineAnswers()
    localStorage.setItem('dojo:fake-ai-interview', 'malformed')
    fireEvent.change(box(), { target: { value: 'answer 9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const panel = screen.getByTestId('session-interviewer')
    const err = await within(panel).findByTestId('session-ai-error')
    expect(err.textContent).not.toMatch(RAW)
    expect(err).toHaveTextContent('closing line did not come through')
    expect(err).toHaveTextContent('Your interview is complete')
    // Retry that fails again says the same plain thing; Retry once the model answers properly clears it
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    expect((await within(panel).findByTestId('session-ai-error')).textContent).not.toMatch(RAW)
    localStorage.removeItem('dojo:fake-ai-interview')
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(msgs().at(-1)).toHaveAttribute('data-from', 'interviewer'))
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })

  it('an unusable reply to an ordinary turn reads as a plain sentence and Retry asks again', async () => {
    await interviewer()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    localStorage.setItem('dojo:fake-ai-interview', 'malformed')
    fireEvent.change(box(), { target: { value: 'a1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const panel = screen.getByTestId('session-interviewer')
    const err = await within(panel).findByTestId('session-ai-error')
    expect(err.textContent).not.toMatch(RAW)
    expect(err).toHaveTextContent('reply did not come through')
    localStorage.removeItem('dojo:fake-ai-interview')
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(msgs()).toHaveLength(3))
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })
})

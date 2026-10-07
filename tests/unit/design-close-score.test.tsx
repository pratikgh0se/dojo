import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CLOSE_QUESTIONS } from '../../src/content/tracking'
import { enterScore, lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import type { CloseAnswers } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const LENS_NAMES = ['Load', 'Data', 'Consistency', 'Failure', 'Latency', 'Cost', 'Evolution']
const CLOSE: CloseAnswers = {
  tradeoff: { chose: 'sliding window counter in Redis', over: 'token bucket per node', because: 'global limit needs shared state; 2 ms Redis RTT is fine' },
  breaksAt10x: 'Redis hot key', dataOwnership: 'Redis owns counters', couldNotAnswer: 1, readNext: 'Stripe rate limiter blog post',
}

async function at(phase: 'close' | 'score', mode: 'solo' | 'interviewer' = 'solo', close: CloseAnswers = CLOSE) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - 12 * MIN })
  await lockDesignSession(d, s.id, T)
  if (phase === 'score') await enterScore(d, s.id, close)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await screen.findByTestId(phase === 'close' ? 'session-close' : 'session-score')
  return { d, id: s.id }
}
const form = (id: string) => screen.getByTestId(id)
const group = (name: string) => within(form('session-score')).getByRole('radiogroup', { name })
const pick = (name: string, v: 0 | 1 | 2) => fireEvent.click(within(group(name)).getByRole('radio', { name: String(v) }))
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })

afterEach(() => localStorage.clear())

describe('five-question close (D-24…D-27)', () => {
  it('asks the five fixed questions and gates Next: score', async () => {
    const { d, id } = await at('close')
    const close = form('session-close')
    expect(close).toHaveAccessibleName('Five-question close')
    CLOSE_QUESTIONS.forEach(q => expect(within(close).getByText(q, { exact: true })).toBeInTheDocument())
    const next = screen.getByRole('button', { name: 'Next: score' })
    expect(next).toBeDisabled()
    type(within(close).getByRole('textbox', { name: 'Chose' }), 'a')
    type(within(close).getByRole('textbox', { name: 'Over' }), 'b')
    type(within(close).getByRole('textbox', { name: 'Because' }), 'c')
    type(within(close).getByRole('textbox', { name: CLOSE_QUESTIONS[1] }), 'x')
    type(within(close).getByRole('textbox', { name: CLOSE_QUESTIONS[2] }), 'y')
    type(within(close).getByRole('textbox', { name: CLOSE_QUESTIONS[4] }), 'DDIA')
    expect(next).toBeDisabled()
    const q4 = within(close).getByRole('radiogroup', { name: CLOSE_QUESTIONS[3] })
    expect(within(q4).getAllByRole('radio').map(r => r.closest('label')?.textContent?.trim())).toEqual([...DIVES, 'None, I answered all four'])
    fireEvent.click(within(q4).getByRole('radio', { name: 'None, I answered all four' }))
    expect(next).toBeEnabled()
    await waitFor(async () => expect((await d.designSessions.get(id))?.close.readNext).toBe('DDIA'))
  })

  it('caps the Q4 dive and seeds trade-off 1 from Q1', async () => {
    await at('score')
    expect(within(group('API first')).getByRole('radio', { name: '2' })).toBeDisabled()
    expect(within(group('Requirements')).getByRole('radio', { name: '2' })).toBeEnabled()
    const row1 = screen.getByTestId('session-tradeoff-row-1')
    expect(within(row1).getByRole('textbox', { name: 'Chose' })).toHaveValue(CLOSE.tradeoff.chose)
    expect(within(row1).getByRole('textbox', { name: 'Over' })).toHaveValue(CLOSE.tradeoff.over)
    expect(within(row1).getByRole('textbox', { name: 'Because' })).toHaveValue(CLOSE.tradeoff.because)
    expect(screen.queryByTestId('session-close')).toBeNull()
  })
})

describe('score form (D-29, D-30, D-31, D-45)', () => {
  it('has the contract shape', async () => {
    await at('score')
    const score = form('session-score')
    expect(score).toHaveAccessibleName('Score the session')
    for (const q of DIVES) {
      const radios = within(group(q)).getAllByRole('radio')
      expect(radios.map(r => r.getAttribute('aria-label'))).toEqual(['0', '1', '2'])
      expect(radios[0]).toHaveAccessibleDescription('blank')
      expect(radios[1]).toHaveAccessibleDescription('hand-wave')
      expect(radios[2]).toHaveAccessibleDescription('trade-off with a number or failure mode')
    }
    const groups = within(score).getAllByRole('radiogroup').map(g => g.getAttribute('aria-label'))
    expect(groups).toEqual([...DIVES, ...LENS_NAMES])
    expect(score).toHaveTextContent('Requirements and numbers (4) · API and data model (3) · High-level design that meets the numbers (4) · Two deep dives with real trade-offs (6) · Failure modes and operations (3)')
    const rubric = within(score).getByRole('spinbutton', { name: 'Rubric (0–20)' })
    for (const bad of ['21', '12.5', '-1']) {
      type(rubric, bad)
      expect(rubric).toHaveAttribute('aria-invalid', 'true')
    }
    type(rubric, '12')
    expect(rubric).not.toHaveAttribute('aria-invalid')
  })

  it('gates Complete, completes S1 with +20 xp and queues a redesign', async () => {
    const { d, id } = await at('score')
    const complete = screen.getByRole('button', { name: 'Complete session' })
    DIVES.forEach((q, i) => pick(q, ([2, 1, 2, 0] as const)[i]))
    ;[2, 1, 1, 0, 2, 1, 1].forEach((v, i) => pick(LENS_NAMES[i], v as 0 | 1 | 2))
    type(screen.getByRole('spinbutton', { name: 'Rubric (0–20)' }), '12')
    expect(complete).toBeDisabled()
    const row2 = screen.getByTestId('session-tradeoff-row-2')
    type(within(row2).getByRole('textbox', { name: 'Chose' }), 'fail open')
    type(within(row2).getByRole('textbox', { name: 'Over' }), 'fail closed')
    expect(complete).toBeDisabled()
    type(within(row2).getByRole('textbox', { name: 'Because' }), 'limiter outage must not take the API down')
    expect(complete).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add trade-off' }))
    expect(screen.getByTestId('session-tradeoff-row-3')).toBeInTheDocument()
    expect(complete).toBeEnabled()
    fireEvent.click(complete)
    expect(await screen.findByText('+20 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('done'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', `?session=${id}`)
    const summary = screen.getByTestId('session-summary')
    expect(summary).toHaveTextContent('Solo · 12 min · rubric 12 / 20')
    expect(summary).toHaveTextContent('2 · 1 · 2 · 0')
    expect(summary).toHaveTextContent('Load 2 · Data 1 · Consistency 1 · Failure 0 · Latency 2 · Cost 1 · Evolution 1')
    expect(screen.getByTestId('session-redesign')).toHaveTextContent('Redesign due 2026-11-10')
    expect(await d.tickets.get('d-method')).toMatchObject({ status: 'done', xp: 20 })
  })

  it('persists two quick radio clicks (Review Focus #2)', async () => {
    const { d, id } = await at('score')
    pick('Requirements', 2)
    pick('One deep dive', 1)
    await waitFor(async () => expect((await d.designSessions.get(id))?.deepDives.map(x => x.answered)).toEqual([2, null, 1, null]))
  })
})

describe('interviewer grade prefill (D-26, D-37)', () => {
  it('prefills from the fake grade, lowers the Q4 dive, lets the learner override', async () => {
    const { d, id } = await at('score', 'interviewer', { ...CLOSE, couldNotAnswer: 0 })
    await waitFor(() => expect(within(group('Requirements')).getByRole('radio', { name: '1' })).toBeChecked())
    expect(DIVES.map(q => within(group(q)).getAllByRole('radio').findIndex(r => (r as HTMLInputElement).checked))).toEqual([1, 1, 2, 1])
    expect(LENS_NAMES.map(l => within(group(l)).getAllByRole('radio').findIndex(r => (r as HTMLInputElement).checked))).toEqual([2, 1, 1, 1, 1, 0, 1])
    expect(screen.getByRole('spinbutton', { name: 'Rubric (0–20)' })).toHaveValue(15)
    const grade = screen.getByTestId('session-grade')
    expect(within(grade).getAllByRole('listitem')).toHaveLength(5)
    expect(grade).toHaveTextContent('One thing to study: [fake:interview] d-method')
    pick('One deep dive', 1)
    await waitFor(async () => expect((await d.designSessions.get(id))?.deepDives[2].answered).toBe(1))
  })

  it('shows the pinned 3-block loader while the interview final turn runs (D-37)', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '20')
    await at('score', 'interviewer')
    expect(screen.getByTestId('session-score-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('session-score-loading')).not.toBeInTheDocument())
    localStorage.removeItem('dojo-ai-fake-delay-ms')
  })

  it('shows the raw error with Retry when the grade fails, and self-scoring still works (Review Focus #5)', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'interview')
    await at('score', 'interviewer')
    expect(await screen.findByText(/fake interview unavailable/)).toBeInTheDocument()
    DIVES.forEach(q => pick(q, 1))
    LENS_NAMES.forEach(l => pick(l, 1))
    const row2 = screen.getByTestId('session-tradeoff-row-2')
    for (const [name, v] of [['Chose', 'a'], ['Over', 'b'], ['Because', 'c']]) type(within(row2).getByRole('textbox', { name }), v)
    type(screen.getByRole('spinbutton', { name: 'Rubric (0–20)' }), '14')
    expect(screen.getByRole('button', { name: 'Complete session' })).toBeEnabled()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('session-grade')).toBeInTheDocument())
  })

  it('a grade that stays unusable reads as a plain sentence, never the validator, and self-scoring and Retry still work (UAT cu-7 P2-1)', async () => {
    localStorage.setItem('dojo:fake-ai-interview', 'malformed')
    await at('score', 'interviewer')
    const err = await screen.findByTestId('session-ai-error')
    expect(err.textContent).not.toMatch(/score must be|perItem must be|oneThingToStudy|lenses must score|deepDives must be/)
    expect(err).toHaveTextContent('interview grade did not come through')
    expect(err).toHaveTextContent('score the session yourself')
    DIVES.forEach(q => pick(q, 1))
    localStorage.removeItem('dojo:fake-ai-interview')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('session-grade')).toBeInTheDocument())
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })

  it('an invalid rubric says what is wrong, not just a red outline (UAT cu-7 P3-12)', async () => {
    await at('score', 'solo')
    const rubric = screen.getByRole('spinbutton', { name: 'Rubric (0–20)' })
    expect(screen.queryByTestId('session-rubric-error')).toBeNull()
    type(rubric, '25')
    expect(screen.getByTestId('session-rubric-error')).toHaveTextContent('whole number from 0 to 20')
    expect(rubric).toHaveAttribute('aria-describedby', 'session-rubric-error')
    type(rubric, '14')
    expect(screen.queryByTestId('session-rubric-error')).toBeNull()
  })
})

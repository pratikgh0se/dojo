import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_QUESTIONS } from '../../src/content/tracking'
import { enterScore, lockDesignSession, savePartner, startDesignSession } from '../../src/data/designSessionActions'
import type { CloseAnswers, PartnerScores } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanProse } from '../helpers/plan'
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

async function at(phase: 'close' | 'score', mode: 'solo' | 'interviewer' | 'ai-partner' | 'human-partner' = 'solo', close: CloseAnswers = CLOSE) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - 12 * MIN })
  await lockDesignSession(d, s.id, T)
  if (phase === 'score') await enterScore(d, s.id, close)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await screen.findByTestId(phase === 'close' ? 'session-close' : 'session-score')
  return { d, id: s.id }
}
const form = (id: string) => screen.getByTestId(id)
const group = (name: string) => within(form('session-score')).getByRole('radiogroup', { name })
const pick = (name: string, v: 0 | 1 | 2) => fireEvent.click(within(group(name)).getByRole('radio', { name: String(v) }))
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })

afterEach(() => localStorage.clear())

describe('five-question close (D-24…D-27)', () => {
  it('asks the five fixed questions and gates NEXT · SCORE', async () => {
    const { d, id } = await at('close')
    const close = form('session-close')
    expect(close).toHaveAccessibleName('Five-question close')
    CLOSE_QUESTIONS.forEach(q => expect(within(close).getByText(q, { exact: true })).toBeInTheDocument())
    const next = screen.getByRole('button', { name: 'NEXT · SCORE' })
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

  it('gates Complete on the four dives and a rubric only, completes S1 with +20 xp and queues a redesign', async () => {
    const { d, id } = await at('score')
    const complete = screen.getByRole('button', { name: 'COMPLETE · SESSION' })
    expect(complete).toBeDisabled()
    DIVES.slice(0, 3).forEach((q, i) => pick(q, ([2, 1, 2] as const)[i]))
    type(screen.getByRole('spinbutton', { name: 'Rubric (0–20)' }), '12')
    expect(complete).toBeDisabled() // a dive is still unscored
    pick(DIVES[3], 0)
    expect(complete).toBeEnabled() // lens groups and the second trade-off row stay optional (DESIGN-66, DESIGN-72)
    ;[2, 1, 1, 0, 2, 1, 1].forEach((v, i) => pick(LENS_NAMES[i], v as 0 | 1 | 2))
    const row2 = screen.getByTestId('session-tradeoff-row-2')
    type(within(row2).getByRole('textbox', { name: 'Chose' }), 'fail open')
    type(within(row2).getByRole('textbox', { name: 'Over' }), 'fail closed')
    type(within(row2).getByRole('textbox', { name: 'Because' }), 'limiter outage must not take the API down')
    expect(complete).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add trade-off' }))
    expect(screen.getByTestId('session-tradeoff-row-3')).toBeInTheDocument()
    expect(complete).toBeEnabled()
    fireEvent.click(complete)
    expect(await screen.findByText('+20 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('Done'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', `?session=${id}`)
    const summary = screen.getByTestId('session-summary')
    expect(summary).toHaveTextContent('Solo · 12 min · rubric 12 / 20')
    expect(summary).toHaveTextContent('2 · 1 · 2 · 0')
    expect(summary).toHaveTextContent('Load 2 · Data 1 · Consistency 1 · Failure 0 · Latency 2 · Cost 1 · Evolution 1')
    expect(screen.getByTestId('session-redesign-due')).toHaveTextContent('Redesign due 2026-11-10')
    expect(screen.getByTestId('session-redesign')).toHaveTextContent('REDO · DESIGN')
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
    expect(within(grade).getAllByTestId(/^session-grade-item-\d$/)).toHaveLength(5)
    expect(grade).toHaveTextContent('One thing to study: [fake:partner] d-method')
    pick('One deep dive', 1)
    await waitFor(async () => expect((await d.designSessions.get(id))?.deepDives[2].answered).toBe(1))
  })

  it('shows the pinned 3-block loader while the grade runs (D-37)', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '20')
    await at('score', 'interviewer')
    expect(screen.getByTestId('session-score-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('session-score-loading')).not.toBeInTheDocument())
    localStorage.removeItem('dojo-ai-fake-delay-ms')
  })

  it('shows the raw error with Retry when the grade fails, and self-scoring still works (Review Focus #5)', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'grade')
    await at('score', 'interviewer')
    expect(await screen.findByText(/fake grade unavailable/)).toBeInTheDocument()
    expect(screen.getByTestId('session-ai-error').textContent).not.toMatch(/interview/i)
    DIVES.forEach(q => pick(q, 1))
    LENS_NAMES.forEach(l => pick(l, 1))
    const row2 = screen.getByTestId('session-tradeoff-row-2')
    for (const [name, v] of [['Chose', 'a'], ['Over', 'b'], ['Because', 'c']]) type(within(row2).getByRole('textbox', { name }), v)
    type(screen.getByRole('spinbutton', { name: 'Rubric (0–20)' }), '14')
    expect(screen.getByRole('button', { name: 'COMPLETE · SESSION' })).toBeEnabled()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(screen.getByTestId('ai-retry'))
    await waitFor(() => expect(screen.getByTestId('session-grade')).toBeInTheDocument())
  })

  it('a grade that stays unusable reads as a plain sentence, never the validator, and self-scoring and Retry still work (UAT cu-7 P2-1)', async () => {
    localStorage.setItem('dojo:fake-ai-grade', 'malformed')
    await at('score', 'interviewer')
    const err = await screen.findByTestId('session-ai-error')
    expect(err.textContent).not.toMatch(/score must be|perItem must be|oneThingToStudy|lenses must score|deepDives must be/)
    expect(err.textContent).not.toMatch(/interview/i)
    expect(err).toHaveTextContent('The grade did not come through')
    expect(err).toHaveTextContent('score the session yourself')
    DIVES.forEach(q => pick(q, 1))
    localStorage.removeItem('dojo:fake-ai-grade')
    fireEvent.click(screen.getByTestId('ai-retry'))
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

describe('close and score hooks (DESIGN-72, 74)', () => {
  it('the close has fieldset q-1..5, its inputs, the Q4 radios and the one accent NEXT · SCORE last in the form', async () => {
    await at('close')
    const close = form('session-close')
    for (const n of [1, 2, 3, 4, 5]) expect(within(close).getByTestId(`session-close-q-${n}`).tagName).toBe('FIELDSET')
    expect(within(screen.getByTestId('session-close-q-1')).getByTestId('session-close-chose')).toBeInTheDocument()
    expect(within(screen.getByTestId('session-close-q-1')).getByTestId('session-close-over')).toBeInTheDocument()
    expect(within(screen.getByTestId('session-close-q-1')).getByTestId('session-close-because')).toBeInTheDocument()
    expect(within(screen.getByTestId('session-close-q-2')).getByTestId('session-close-answer-2').tagName).toBe('TEXTAREA')
    expect(within(screen.getByTestId('session-close-q-3')).getByTestId('session-close-answer-3').tagName).toBe('TEXTAREA')
    expect(within(screen.getByTestId('session-close-q-5')).getByTestId('session-close-answer-5').tagName).toBe('INPUT')
    const q4 = screen.getByTestId('session-close-q-4')
    for (const i of [0, 1, 2, 3]) expect(within(q4).getByTestId(`session-close-q4-${i}`)).toHaveAttribute('type', 'radio')
    expect(within(q4).getByTestId('session-close-q4-none')).toHaveAttribute('type', 'radio')
    expect(within(q4).queryByTestId('session-close-q4-4')).toBeNull()
    const next = screen.getByTestId('session-close-next')
    expect(next).toHaveTextContent(/^NEXT · SCORE$/)
    expect(next).toHaveAttribute('data-accent', 'primary')
    const focusable = Array.from(close.querySelectorAll<HTMLElement>('input, textarea, button, select'))
    expect(focusable[focusable.length - 1]).toBe(next)
  })

  it('the close can be completed through the hooks alone', async () => {
    const { d, id } = await at('close')
    const t = (k: string, v: string) => type(screen.getByTestId(k), v)
    t('session-close-chose', 'a'); t('session-close-over', 'b'); t('session-close-because', 'c')
    t('session-close-answer-2', 'x'); t('session-close-answer-3', 'y'); t('session-close-answer-5', 'DDIA')
    expect(screen.getByTestId('session-close-next')).toBeDisabled()
    fireEvent.click(screen.getByTestId('session-close-q4-none'))
    expect(screen.getByTestId('session-close-next')).toBeEnabled()
    fireEvent.click(screen.getByTestId('session-close-next'))
    await screen.findByTestId('session-score')
    expect((await d.designSessions.get(id))?.phase).toBe('score')
  })

  it('GLOBAL-03: exactly one data-accent="primary" in the close phase', async () => {
    await at('close')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-accent="primary"]')[0]).toBe(screen.getByTestId('session-close-next'))
  })

  it('GLOBAL-03: exactly one data-accent="primary" in the score phase', async () => {
    await at('score')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-accent="primary"]')[0]).toBe(screen.getByTestId('session-complete'))
  })

  it('the score form: radiogroups session-dive-score-1..4 with radios -0..-2, the rubric hook and the one accent COMPLETE · SESSION last', async () => {
    const { d, id } = await at('score')
    for (const n of [1, 2, 3, 4]) {
      const g = screen.getByTestId(`session-dive-score-${n}`)
      expect(g).toHaveAttribute('role', 'radiogroup')
      for (const v of [0, 1, 2]) expect(within(g).getByTestId(`session-dive-score-${n}-${v}`)).toHaveAttribute('type', 'radio')
    }
    expect(screen.queryByTestId('session-dive-score-5')).toBeNull()
    fireEvent.click(screen.getByTestId('session-dive-score-1-2'))
    expect(screen.getByTestId('session-dive-score-1-2')).toBeChecked()
    await waitFor(async () => expect((await d.designSessions.get(id))?.deepDives[0].answered).toBe(2))
    const rubric = screen.getByTestId('session-rubric')
    expect(rubric).toHaveAttribute('type', 'number')
    expect(rubric).toHaveAccessibleName('Rubric (0–20)')
    type(rubric, '30')
    expect(screen.getByTestId('session-rubric-error')).toBeInTheDocument()
    const complete = screen.getByTestId('session-complete')
    expect(complete).toHaveTextContent(/^COMPLETE · SESSION$/)
    expect(complete).toHaveAttribute('data-accent', 'primary')
    const focusable = Array.from(form('session-score').querySelectorAll<HTMLElement>('input, textarea, button, select'))
    expect(focusable[focusable.length - 1]).toBe(complete)
  })
})

describe('grade by mode (DESIGN-52, 54, 68)', () => {
  it('ai-partner: one grade row (not interview), total 15 of 20, rubric field prefilled with 15, five graded items', async () => {
    const { d } = await at('score', 'ai-partner')
    await waitFor(() => expect(screen.getByTestId('session-grade')).toBeInTheDocument())
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('15 of 20')
    expect(screen.getByTestId('session-rubric')).toHaveValue(15)
    const rows = await d.aiLog.toArray()
    expect(rows.filter(r => r.job === 'grade')).toHaveLength(1)
    expect(rows.filter(r => r.job === 'interview')).toHaveLength(0)
    const sum = [1, 2, 3, 4, 5].reduce((a, n) => a + Number(screen.getByTestId(`session-grade-item-${n}`).getAttribute('data-score')), 0)
    expect(sum).toBe(15)
    expect(document.body.textContent).not.toMatch(/interview/i)
  })

  it('ai-partner: a grade stored through the form sets rubric equal to the total after Complete', async () => {
    const { d, id } = await at('score', 'ai-partner', { ...CLOSE, couldNotAnswer: 'none' })
    await waitFor(() => expect(screen.getByTestId('session-grade')).toBeInTheDocument())
    const row2 = screen.getByTestId('session-tradeoff-row-2')
    for (const [name, v] of [['Chose', 'a'], ['Over', 'b'], ['Because', 'c']]) type(within(row2).getByRole('textbox', { name }), v)
    await waitFor(() => expect(screen.getByTestId('session-complete')).toBeEnabled())
    fireEvent.click(screen.getByTestId('session-complete'))
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('Done'))
    expect((await d.designSessions.get(id))?.rubric).toBe(15)
  })

  it('human-partner: no grade runs, aiLog stays empty, and nothing AI is offered in the score phase', async () => {
    const { d } = await at('score', 'human-partner')
    await new Promise(r => setTimeout(r, 40))
    expect(await d.aiLog.count()).toBe(0)
    for (const id of ['session-score-loading', 'ai-loader', 'ai-retry', 'session-ai-error', 'session-hint', 'session-chat-input', 'session-grade']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(screen.queryAllByRole('button').filter(b => /grade.*AI|AI.*grade/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))).toHaveLength(0)
  })

  it('a grade failure sentence never contains the word interview, even from a raw error', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'grade')
    await at('score', 'ai-partner')
    const err = await screen.findByTestId('session-ai-error')
    expect(err.textContent).not.toMatch(/interview/i)
    expect(screen.queryByTestId('session-score-loading')).toBeNull()
    expect(document.body.textContent).not.toMatch(/interview/i)
    localStorage.removeItem('dojo-ai-fake-fail')
  })
})

describe('human-partner closed, scored and finished (DESIGN-54)', () => {
  it('leaves aiLog unchanged and shows no AI control in the close, score or done view', async () => {
    const { d } = await at('close', 'human-partner')
    const before = await d.aiLog.count()
    const t = (k: string, v: string) => type(screen.getByTestId(k), v)
    t('session-close-chose', 'a'); t('session-close-over', 'b'); t('session-close-because', 'c')
    t('session-close-answer-2', 'x'); t('session-close-answer-3', 'y'); t('session-close-answer-5', 'DDIA')
    fireEvent.click(screen.getByTestId('session-close-q4-none'))
    fireEvent.click(screen.getByTestId('session-close-next'))
    await screen.findByTestId('session-score')
    DIVES.forEach((_, i) => fireEvent.click(screen.getByTestId(`session-dive-score-${i + 1}-1`)))
    LENS_NAMES.forEach(l => pick(l, 1))
    const row2 = screen.getByTestId('session-tradeoff-row-2')
    for (const [name, v] of [['Chose', 'a'], ['Over', 'b'], ['Because', 'c']]) type(within(row2).getByRole('textbox', { name }), v)
    type(screen.getByTestId('session-rubric'), '12')
    fireEvent.click(screen.getByTestId('session-complete'))
    await screen.findByTestId('session-summary')
    await new Promise(r => setTimeout(r, 60))
    expect(await d.aiLog.count()).toBe(before)
    for (const id of ['ai-loader', 'session-reference-loading', 'ai-retry', 'session-ai-error', 'session-hint', 'session-chat-input']) {
      expect(screen.queryByTestId(id), id).toBeNull()
    }
    expect(screen.queryAllByRole('button').filter(b => /grade.*AI|AI.*grade/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))).toHaveLength(0)
    expect(screen.getByTestId('session-reference')).toHaveTextContent('this session used none')
    // rubric 12 queues a redesign: REDO · DESIGN starts the next human-partner session beside session-diff, still with no AI row
    fireEvent.click(screen.getByTestId('session-redesign'))
    await screen.findByTestId('session-diff')
    expect(await d.aiLog.count()).toBe(before)
  })
})


async function atPartner(scores: PartnerScores) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'human-partner', deepDives: DIVES, nowMs: T - 12 * MIN })
  await savePartner(d, s.id, { name: 'Sam', scores }, T - 6 * MIN)
  await lockDesignSession(d, s.id, T)
  await enterScore(d, s.id, { ...CLOSE, couldNotAnswer: 'none' })
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await screen.findByTestId('session-score')
  // findBy resolves the moment the form is in the DOM, outside act, so its mount effect (adopting the partner's sheet into the rubric and
  // dives) may not have run yet. Flush it here: the tests read the prefilled state right away.
  await act(async () => {})
  return { d, id: s.id }
}
const dive = (n: number, v: 0 | 1 | 2) => fireEvent.click(screen.getByTestId(`session-dive-score-${n}-${v}`))
/** everything the partner did not give: lenses, the second trade-off, and the listed (1-based) dives */
const byHand = (blankDives: number[]) => {
  blankDives.forEach(n => dive(n, 1))
  LENS_NAMES.forEach(l => pick(l, 1))
  const row2 = screen.getByTestId('session-tradeoff-row-2')
  for (const [name, v] of [['Chose', 'a'], ['Over', 'b'], ['Because', 'c']]) type(within(row2).getByRole('textbox', { name }), v)
}
const rubricBox = () => screen.getByTestId('session-rubric')
const complete = () => screen.getByTestId('session-complete')
const diveChecked = (n: number) => [0, 1, 2].map(v => (screen.getByTestId(`session-dive-score-${n}-${v}`) as HTMLInputElement).checked)

describe('partner scores in the score form (DESIGN-66, 67)', () => {
  const SHEET: PartnerScores = { perItem: [3, 3, 3, 3, 2], deepDives: [2, 1, 2, null] }

  it('prefills the rubric to the partner total with a note, leaves the unscored dive blank, and attributes to the partner when confirmed unedited', async () => {
    const { d, id } = await atPartner(SHEET)
    expect(rubricBox()).toHaveValue(14)
    expect(screen.getByTestId('session-score-prefilled')).toHaveTextContent('partner')
    expect(screen.getByTestId('session-score-prefilled')).toHaveTextContent('Sam')
    expect(diveChecked(1)).toEqual([false, false, true])
    expect(diveChecked(4)).toEqual([false, false, false])
    expect(complete()).toBeDisabled()
    byHand([4])
    expect(complete()).toBeEnabled()
    fireEvent.click(complete())
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('done'))
    const row = (await d.designSessions.get(id))!
    expect(row).toMatchObject({ rubric: 14, rubricBy: 'partner' })
    expect(row.deepDives.map(x => x.by)).toEqual(['partner', 'partner', 'partner', 'self'])
    expect(await d.aiLog.count()).toBe(0)
  })

  it('editing the prefilled rubric makes rubricBy self while the untouched dives stay partner', async () => {
    const { d, id } = await atPartner(SHEET)
    byHand([4])
    type(rubricBox(), '15')
    fireEvent.click(complete())
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('done'))
    const row = (await d.designSessions.get(id))!
    expect(row).toMatchObject({ rubric: 15, rubricBy: 'self' })
    expect(row.deepDives.map(x => x.by)).toEqual(['partner', 'partner', 'partner', 'self'])
  })

  it('editing a prefilled dive makes rubricBy self too', async () => {
    const { d, id } = await atPartner(SHEET)
    byHand([4])
    dive(1, 0)
    fireEvent.click(complete())
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('done'))
    expect(await d.designSessions.get(id)).toMatchObject({ rubric: 14, rubricBy: 'self' })
  })

  it('a partial sheet leaves the rubric blank and blocks Complete until it is filled by hand', async () => {
    await atPartner({ perItem: [3, 3, 3, null, null], deepDives: [2, 1, 2, null] })
    expect(rubricBox()).toHaveValue(null)
    expect(screen.getByTestId('session-score-prefilled')).toBeInTheDocument()
    byHand([4])
    expect(complete()).toBeDisabled()
    type(rubricBox(), '12')
    expect(complete()).toBeEnabled()
  })

  it('a partial sheet plus a hand-typed rubric is rubricBy self while the partner-scored dives keep by partner', async () => {
    const { d, id } = await atPartner({ perItem: [3, 3, 3, null, null], deepDives: [2, 1, 2, null] })
    byHand([4])
    type(rubricBox(), '12')
    fireEvent.click(complete())
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('done'))
    const row = (await d.designSessions.get(id))!
    expect(row).toMatchObject({ rubric: 12, rubricBy: 'self' })
    expect(row.deepDives.map(x => x.by)).toEqual(['partner', 'partner', 'partner', 'self'])
  })

  it('adopts the sheet once: the write count stays constant when the live query re-emits', async () => {
    const put = vi.fn()
    const { d, id } = await atPartner(SHEET)
    await waitFor(async () => expect((await d.designSessions.get(id))!.rubricBy).toBe('partner'))
    const orig = d.designSessions.put.bind(d.designSessions)
    vi.spyOn(d.designSessions, 'put').mockImplementation(((...a: Parameters<typeof orig>) => { put(); return orig(...a) }) as typeof d.designSessions.put)
    await new Promise(r => setTimeout(r, 300))
    expect(put).toHaveBeenCalledTimes(0)
    // an unrelated write to the row makes the live query emit a new partner object with the same sheet
    await savePartner(d, id, { name: 'Sam', scores: SHEET }, T)
    await new Promise(r => setTimeout(r, 300))
    expect(put).toHaveBeenCalledTimes(1)
    expect(rubricBox()).toHaveValue(14)
  })

  it('takes a later change to the sheet while the host has not touched the values, and never overwrites a dive the host scored', async () => {
    const { d, id } = await atPartner({ perItem: [null, null, null, null, null], deepDives: [2, null, null, null] })
    dive(4, 0)
    await savePartner(d, id, { scores: { perItem: [4, 4, 4, 4, 4], deepDives: [2, 1, null, 2] } }, T)
    await waitFor(() => expect(rubricBox()).toHaveValue(20))
    expect(diveChecked(2)).toEqual([false, true, false])
    expect(diveChecked(4)).toEqual([true, false, false])
  })
})

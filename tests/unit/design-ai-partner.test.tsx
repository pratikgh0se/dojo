import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TRANSCRIPT_TEXT_MAX } from '../../src/ai/prompts'
import { appendInterview, lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanProse } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
type Db = Awaited<ReturnType<typeof seededDb>>
const ROUTE = { route: '/designs/session/d-method', path: '/designs/session/:designId' }

async function partner(prepare?: (d: Db, id: string) => Promise<void>) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'ai-partner', deepDives: DIVES, nowMs: T - MIN })
  if (prepare) await prepare(d, s.id)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, ...ROUTE })
  fireEvent.click(await screen.findByTestId('session-tab-partner'))
  await screen.findByTestId('session-interviewer')
  return { d, id: s.id }
}
const msgs = () => screen.queryAllByTestId('session-msg')
const text = (m: HTMLElement) => within(m).getByTestId('session-msg-text').textContent ?? ''
const box = () => screen.getByTestId('session-chat-input')
const send = async (words: string) => {
  const before = msgs().length
  fireEvent.change(box(), { target: { value: words } })
  fireEvent.click(screen.getByTestId('session-send'))
  await waitFor(() => expect(msgs()).toHaveLength(before + 2))
}
const aiLogRows = async (d: Db) => (await d.aiLog.toArray()).filter(r => r.job === 'interview').length
afterEach(() => localStorage.clear())

describe('the AI speaks first (DESIGN-45)', () => {
  it('opens with the prompt and exactly one question, topic requirements, labelled AI partner', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    const m = msgs()[0]
    expect(m).toHaveAttribute('data-from', 'ai')
    expect(m).toHaveAttribute('data-topic', 'requirements')
    expect(m).toHaveAttribute('data-kind', 'turn')
    expect(text(m)).toContain('The method, on a whiteboard, in 45 minutes')
    expect(text(m).match(/\?/g)).toHaveLength(1)
    expect(within(m).getByTestId('session-msg-label')).toHaveTextContent('AI partner')
    expect(screen.getByTestId('session-interview-status')).toHaveTextContent('Requirements')
    expect(box()).toHaveAttribute('maxlength', String(TRANSCRIPT_TEXT_MAX))
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument()
    expect(screen.getByTestId('session-interviewer')).toHaveAccessibleName('AI partner')
  })
  it('says the word interview nowhere a learner can read it, and Send is not an accent button', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    expect(document.body.textContent).not.toMatch(/interview/i)
    const panel = screen.getByTestId('session-interviewer')
    expect(panel.innerHTML).not.toMatch(/aria-label="[^"]*interview/i)
    for (const id of ['session-send', 'session-hint']) expect(screen.getByTestId(id)).not.toHaveAttribute('data-accent')
    expect(screen.getByTestId('session-send')).not.toHaveClass('sr-btn-accent')
  })
  it('does not re-ask on reload when a conversation exists, and logs exactly one interview row', async () => {
    const { d } = await partner(async (dd, id) => { await appendInterview(dd, id, [{ from: 'interviewer', text: 'q0?' }]) })
    await new Promise(r => setTimeout(r, 30))
    expect(msgs()).toHaveLength(1)
    expect(await aiLogRows(d)).toBe(0)
  })
  it('asks once on an empty conversation: one message, one aiLog row', async () => {
    const { d } = await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    await new Promise(r => setTimeout(r, 30))
    expect(msgs()).toHaveLength(1)
    expect(await aiLogRows(d)).toBe(1)
  })
})

describe('the conversation (DESIGN-46 to 48, 50, 52)', () => {
  it('twelve short answers: one question each, topics in order, a challenge within twelve, no list markers, one log row per AI message', async () => {
    const { d } = await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    for (let i = 1; i <= 12; i++) await send(`answer ${i}`)
    const ai = msgs().filter(m => m.dataset.from === 'ai')
    expect(ai).toHaveLength(13)
    for (const m of ai.slice(1)) {
      const t = text(m)
      expect(t.match(/\?/g)).toHaveLength(1)
      expect(t.trim().endsWith('?')).toBe(true)
      expect(t).not.toMatch(/(^|\n)\s*([-*]|\d+\.)\s/)
      expect(t).not.toMatch(/you could|you should|I suggest|consider using|the answer is/i)
    }
    const topics = ai.map(m => m.dataset.topic)
    const order = ['requirements', 'estimates', 'design', 'tradeoffs']
    const flow = topics.filter(t => t !== 'challenge').map(t => order.indexOf(t!))
    expect(flow).toEqual([...flow].sort((a, b) => a - b))
    for (const p of order) expect(topics).toContain(p)
    expect(topics.slice(0, 12)).toContain('challenge')
    expect(await aiLogRows(d)).toBe(13)
    // open-ended: nothing locks the box after the thirteenth question
    expect(box()).not.toHaveAttribute('readonly')
    expect(screen.getByTestId('session-send')).toBeDisabled() // empty box only
    fireEvent.change(box(), { target: { value: 'still going' } })
    expect(screen.getByTestId('session-send')).toBeEnabled()
  })
  it('the learner message carries its own label and text hook', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    await send('5M daily users')
    const me = msgs()[1]
    expect(me).toHaveAttribute('data-from', 'you')
    expect(within(me).getByTestId('session-msg-label')).toHaveTextContent('You')
    expect(text(me)).toBe('5M daily users')
    expect(box()).toHaveValue('')
    expect(box()).toHaveFocus()
  })
  it('while a reply is pending Send and Hint are disabled and the loader shows', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '150')
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1), { timeout: 3000 })
    fireEvent.change(box(), { target: { value: '5M daily users' } })
    fireEvent.click(screen.getByTestId('session-send'))
    await waitFor(() => expect(screen.getByTestId('ai-loader')).toBeInTheDocument())
    expect(screen.getByTestId('session-send')).toBeDisabled()
    expect(screen.getByTestId('session-hint')).toBeDisabled()
    await waitFor(() => expect(msgs()).toHaveLength(3), { timeout: 3000 })
    expect(msgs()[1]).toHaveAttribute('data-from', 'you')
    expect(screen.queryByTestId('ai-loader')).toBeNull()
  })
  it('Ctrl+Enter sends, a plain Enter does not, whitespace never sends, a double click sends once', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    fireEvent.change(box(), { target: { value: '   ' } })
    expect(screen.getByTestId('session-send')).toBeDisabled()
    fireEvent.change(box(), { target: { value: 'via keys' } })
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(true)
    expect(msgs()).toHaveLength(1)
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(msgs()).toHaveLength(3))
    fireEvent.change(box(), { target: { value: 'mac' } })
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(msgs()).toHaveLength(5))
    fireEvent.change(box(), { target: { value: 'once' } })
    fireEvent.click(screen.getByTestId('session-send'))
    fireEvent.click(screen.getByTestId('session-send'))
    await waitFor(() => expect(msgs()).toHaveLength(7))
    await new Promise(r => setTimeout(r, 30))
    expect(msgs()).toHaveLength(7)
  })
  it('typing the shortcut letters in the chat box adds nothing to the canvas (DESIGN-18)', async () => {
    await partner()
    for (const key of 'nctgl?1234'.split('')) expect(fireEvent.keyDown(box(), { key }), key).toBe(true)
    expect(screen.getByTestId('kit-count')).toHaveTextContent('0 nodes')
  })
  it('keeps the newest message in view after Send (UAT cu-7 P3-3)', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    const log = screen.getByRole('log', { name: 'Conversation' })
    // jsdom lays nothing out: give the log a scroll height and see that a new message moves the view to it
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 900 })
    log.scrollTop = 0
    await send('a message')
    expect(log.scrollTop).toBe(900)
  })
})

describe('Hint (DESIGN-49, Review Focus 4)', () => {
  it('adds exactly one AI message, kind hint, one question, the topic of the question it sharpens', async () => {
    const { d } = await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    fireEvent.click(screen.getByTestId('session-hint'))
    await waitFor(() => expect(msgs()).toHaveLength(2))
    const hint = msgs()[1]
    expect(hint).toHaveAttribute('data-from', 'ai')
    expect(hint).toHaveAttribute('data-kind', 'hint')
    expect(hint).toHaveAttribute('data-topic', msgs()[0].dataset.topic!)
    expect(text(hint).match(/\?/g)).toHaveLength(1)
    expect(text(hint)).not.toMatch(/you could|you should|I suggest|consider using|the answer is/i)
    expect(screen.getByTestId('session-hint')).toHaveTextContent('2 left')
    expect(await aiLogRows(d)).toBe(2)
  })
  it('a hint after a challenge or later turn takes the topic of the previous non-hint question', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    for (let i = 1; i <= 6; i++) await send(`answer ${i}`) // AI turn 6 is the first design turn
    const before = msgs().length
    fireEvent.click(screen.getByTestId('session-hint'))
    await waitFor(() => expect(msgs()).toHaveLength(before + 1))
    const all = msgs()
    expect(all.at(-1)).toHaveAttribute('data-kind', 'hint')
    expect(all.at(-1)!.dataset.topic).toBe(all.at(-2)!.dataset.topic)
    expect(all.at(-2)!.dataset.topic).toBe('design')
  })
  it('is limited to three', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    for (let i = 1; i <= 3; i++) { fireEvent.click(screen.getByTestId('session-hint')); await waitFor(() => expect(msgs()).toHaveLength(1 + i)) }
    expect(screen.getByTestId('session-hint')).toBeDisabled()
    expect(screen.getByTestId('session-hint')).toHaveTextContent('0 left')
  })
  it('is disabled when the last line is the learner, and again once the AI has asked', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '100')
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1), { timeout: 3000 })
    fireEvent.change(box(), { target: { value: 'an answer' } })
    fireEvent.click(screen.getByTestId('session-send'))
    await waitFor(() => expect(msgs()).toHaveLength(2))
    expect(screen.getByTestId('session-hint')).toBeDisabled()
    await waitFor(() => expect(msgs()).toHaveLength(3), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('session-hint')).toBeEnabled())
  })
  it('is disabled until the AI has asked something', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'interview')
    await partner()
    await screen.findByTestId('session-ai-error')
    expect(screen.getByTestId('session-hint')).toBeDisabled()
  })
  it('a failed Hint shows a plain sentence and Retry, adds nothing and uses none of the three', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    localStorage.setItem('dojo-ai-fake-fail', 'interview')
    fireEvent.click(screen.getByTestId('session-hint'))
    const err = await screen.findByTestId('session-ai-error')
    expect(err.textContent).toMatch(/unavailable/)
    expect(err.textContent).not.toMatch(/interview/i)
    expect(msgs()).toHaveLength(1)
    expect(screen.getByTestId('session-hint')).toHaveTextContent('3 left')
    expect(screen.getByTestId('session-hint')).toBeEnabled() // never stuck: Hint can be tried again too
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(within(err).getByTestId('ai-retry'))
    await waitFor(() => expect(msgs()).toHaveLength(2))
    expect(msgs()[1]).toHaveAttribute('data-kind', 'hint')
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
    expect(screen.getByTestId('session-hint')).toHaveTextContent('2 left')
  })
})

describe('failure (Review Focus 4, DESIGN-53)', () => {
  it('shows a plain sentence and Retry when the opening fails, then recovers', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'interview')
    await partner()
    const err = await screen.findByTestId('session-ai-error')
    expect(err.textContent).not.toMatch(/interview/i)
    expect(document.body.textContent).not.toMatch(/interview/i)
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(within(err).getByTestId('ai-retry'))
    await waitFor(() => expect(msgs()).toHaveLength(1))
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })
  it('a failed reply to an answer keeps the answer in the chat and Retry asks again', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    localStorage.setItem('dojo-ai-fake-fail', 'interview')
    fireEvent.change(box(), { target: { value: 'my answer' } })
    fireEvent.click(screen.getByTestId('session-send'))
    const err = await screen.findByTestId('session-ai-error')
    expect(msgs()).toHaveLength(2)
    expect(text(msgs()[1])).toBe('my answer')
    expect(screen.getByTestId('session-send')).toBeDisabled() // empty box
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(within(err).getByTestId('ai-retry'))
    await waitFor(() => expect(msgs()).toHaveLength(3))
    expect(msgs()[2]).toHaveAttribute('data-from', 'ai')
  })
  it('an unusable reply reads as a plain sentence and Retry asks again', async () => {
    await partner()
    await waitFor(() => expect(msgs()).toHaveLength(1))
    localStorage.setItem('dojo:fake-ai-interview', 'malformed')
    fireEvent.change(box(), { target: { value: 'a1' } })
    fireEvent.click(screen.getByTestId('session-send'))
    const err = await screen.findByTestId('session-ai-error')
    expect(err.textContent).not.toMatch(/score must be|perItem must be|oneThingToStudy|deepDives must be/)
    expect(err).toHaveTextContent('reply did not come through')
    localStorage.removeItem('dojo:fake-ai-interview')
    fireEvent.click(within(err).getByTestId('ai-retry'))
    await waitFor(() => expect(msgs()).toHaveLength(3))
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })
})

describe('only the AI partner mode has this panel (DESIGN-54, DESIGN-12)', () => {
  const ABSENT = ['session-interviewer', 'session-hint', 'session-chat-input', 'ai-loader', 'ai-retry', 'session-ai-error', 'session-send']
  const startAs = async (mode: 'human-partner' | 'solo') => {
    setNow(() => T)
    const d = await seededDb()
    await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, ...ROUTE })
    await screen.findByTestId('session-tabs')
    return d
  }
  it.each(['human-partner', 'solo'] as const)('%s renders none of it and writes no aiLog row', async mode => {
    const d = await startAs(mode)
    const partnerTab = screen.queryByTestId('session-tab-partner')
    if (partnerTab) fireEvent.click(partnerTab)
    await new Promise(r => setTimeout(r, 30))
    for (const id of ABSENT) expect(screen.queryByTestId(id), id).toBeNull()
    expect(screen.queryAllByTestId('session-msg')).toHaveLength(0)
    expect(await d.aiLog.count()).toBe(0)
  })
  it('after the canvas locks the tabs, and so the chat, are gone', async () => {
    const { d, id } = await partner(async (dd, sid) => { await appendInterview(dd, sid, [{ from: 'interviewer', text: 'q0?' }]) })
    await waitFor(() => expect(msgs()).toHaveLength(1))
    await lockDesignSession(d, id, T)
    await waitFor(() => expect(screen.queryByTestId('session-tabs')).toBeNull())
    for (const hook of ABSENT) expect(screen.queryByTestId(hook), hook).toBeNull()
  })
})

describe('the chat box is a typing surface for the global keys (SHELL-18, R-F5)', () => {
  it('the AI partner section carries data-no-global-keys, so 1-4, ? and G typed in the chat never switch screens', async () => {
    await partner()
    const panel = screen.getByTestId('session-interviewer')
    expect(panel).toHaveAttribute('data-no-global-keys')
    expect(panel.contains(box())).toBe(true)
    expect(box().closest('[data-no-global-keys]')).toBe(panel)
  })
})

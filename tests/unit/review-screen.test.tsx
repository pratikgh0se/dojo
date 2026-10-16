import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Redo, Ticket } from '../../src/data/types'
import { resetNow, setNow } from '../../src/lib/clock'
import { Review } from '../../src/screens/Review'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))
afterEach(() => { ro.on = false; resetNow() })

const NOW = new Date(2026, 10, 4, 10).getTime()
const DAY = 86_400_000
const redo = (id: string, ticketId: string, daysAgo: number): Redo =>
  ({ id, ticketId, source: 'check_failed', createdAt: NOW - 9 * DAY, stage: 0, due: NOW - daysAgo * DAY, passed: [], helpCost: 0, refunded: 0 })
const watch = (n: number): Ticket => mkTicket({ id: `w${n}`, kind: 'watch', lane: 'path', title: `Watch ${n}`, explain: [`Question ${n}?`], explainAnswers: [`Stored answer ${n}.`] })
const problem = mkTicket({ id: 'p1', kind: 'problem', lane: 'dsa', title: '200 · Number of Islands' })
const design = mkTicket({ id: 'd1', kind: 'design', lane: 'design', title: 'Design a URL shortener' })
const writeup = mkTicket({ id: 'u1', kind: 'writeup', lane: 'design', title: 'Write up the shortener' })
const plans = appPlans()

async function setup(redos: Redo[], tickets: Ticket[]) {
  setNow(() => NOW)
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.bulkPut(tickets)
  await d.redos.bulkPut(redos)
  renderWithApp(<Review />, { db: d, ...plans })
  return d
}
const base = () => ({
  tickets: [watch(1), watch(2), problem, mkTicket({ id: 'gone', kind: 'problem', lane: 'dsa', title: 'Archived Gone Ticket', archived: true })],
  redos: [redo('r1', 'w1', 2), redo('r2', 'w2', 1), redo('r3', 'p1', 0), redo('r4', 'gone', 5)],
})
async function reveal(text = 'x') {
  fireEvent.change(await screen.findByTestId('review-answer'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('review-reveal'))
}

describe('Review screen', () => {
  it('shows the queue summary and one card, oldest first, skipping the archived ticket', async () => {
    const { tickets, redos } = base()
    await setup(redos, tickets)
    const count = await screen.findByTestId('review-count')
    expect(count).toHaveTextContent('3')
    expect(count).toHaveAttribute('data-count', '3')
    expect(within(screen.getByTestId('review-queue')).getByText('due')).toBeInTheDocument()
    expect(screen.getByTestId('review-oldest')).toHaveTextContent('Oldest 2 days')
    expect(screen.getByTestId('review-split')).toHaveTextContent('AI 2 · DSA 1')
    expect(screen.getAllByTestId('review-card')).toHaveLength(1)
    expect(screen.getByTestId('review-position')).toHaveTextContent('Card 1 of 3')
    expect(screen.getByTestId('review-card')).toHaveAttribute('data-ticket-id', 'w1')
    expect(screen.getByTestId('review-card')).toHaveAttribute('data-kind', 'check')
    expect(document.body.textContent).not.toContain('Archived Gone Ticket')
  })

  it('shows the lane, title, kind and question of the card, with plan text marked (REVIEW-04)', async () => {
    const { tickets, redos } = base()
    await setup(redos, tickets)
    const lane = await screen.findByTestId('review-card-lane')
    expect(lane).toHaveTextContent('AI')
    expect(lane).toHaveAttribute('data-lane', 'path')
    const title = screen.getByTestId('review-card-title')
    expect(title).toHaveTextContent(/^Watch 1$/)
    expect(title).toHaveAttribute('data-content', 'plan')
    expect(screen.getByTestId('review-card-kind')).toHaveTextContent(/^Watch$/)
    const q = screen.getByTestId('review-card-question')
    expect(q).toHaveTextContent('Question 1?')
    expect(q).toHaveAttribute('data-content', 'plan')
  })

  it('hides the stored answer until an answer is typed and revealed, and the reveal is the only accent', async () => {
    const { tickets, redos } = base()
    await setup(redos, tickets)
    const reveal = await screen.findByTestId('review-reveal')
    expect(document.body.textContent).not.toContain('Stored answer 1.')
    expect(screen.queryByText('Stored answer 1.')).toBeNull()
    expect(screen.getByTestId('review-answer')).toBeEnabled()
    expect(screen.getByTestId('review-answer')).toHaveValue('')
    expect(reveal).toBeDisabled()
    expect(reveal).toHaveTextContent(/REVEAL · ANSWER/i)
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    fireEvent.change(screen.getByTestId('review-answer'), { target: { value: '   ' } })
    expect(reveal).toBeDisabled()
    fireEvent.change(screen.getByTestId('review-answer'), { target: { value: 'It re-reads the weights.' } })
    expect(reveal).toBeEnabled()
    fireEvent.click(reveal)
    expect(screen.getByTestId('review-your-answer')).toHaveTextContent('It re-reads the weights.')
    expect(screen.getByTestId('review-your-answer').tagName).toBe('BLOCKQUOTE')
    expect(screen.getByTestId('review-stored-answer')).toHaveTextContent('Stored answer 1.')
    expect(screen.getByTestId('review-stored-answer')).toHaveAttribute('data-content', 'plan')
    expect(screen.queryByTestId('review-reveal')).toBeNull()
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
    expect(screen.getByTestId('review-grade-missed')).toHaveTextContent('Missed it')
    expect(screen.getByTestId('review-grade-close')).toHaveTextContent('Close')
    expect(screen.getByTestId('review-grade-got')).toHaveTextContent('Got it')
    const cls = ['missed', 'close', 'got'].map(g => screen.getByTestId(`review-grade-${g}`).className)
    expect(new Set(cls).size).toBe(1)
  })

  it('Got it takes the card out of the queue and writes the next step', async () => {
    const { tickets, redos } = base()
    const d = await setup(redos, tickets)
    await reveal()
    fireEvent.click(screen.getByTestId('review-grade-got'))
    await waitFor(() => expect(screen.getByTestId('review-count')).toHaveTextContent('2'))
    expect(screen.getByTestId('review-count')).toHaveAttribute('data-count', '2')
    expect(screen.getByTestId('review-position')).toHaveTextContent('Card 1 of 2')
    const r = (await d.redos.get('r1'))!
    expect(r.stage).toBe(1)
    expect(r.passed).toEqual([true])
  })

  it('Close brings the redo back tomorrow at the same step', async () => {
    const { tickets, redos } = base()
    const d = await setup(redos, tickets)
    await reveal()
    fireEvent.click(screen.getByTestId('review-grade-close'))
    await waitFor(() => expect(screen.getByTestId('review-count')).toHaveTextContent('2'))
    const r = (await d.redos.get('r1'))!
    expect(r.stage).toBe(0)
    expect(r.closedAt).toBeUndefined()
    expect(new Date(r.due as number).getDate()).toBe(5)
  })

  it('Missed it writes nothing, keeps the count and sends the card behind the others (Review Focus 5)', async () => {
    const { tickets, redos } = base()
    const d = await setup(redos, tickets)
    await reveal()
    fireEvent.click(screen.getByTestId('review-grade-missed'))
    expect(screen.getByTestId('review-count')).toHaveTextContent('3')
    expect(screen.getByTestId('review-card')).toHaveAttribute('data-ticket-id', 'w2')
    expect((await d.redos.get('r1'))).toEqual(redos[0])
    expect(document.body.textContent).not.toMatch(/fail|penalt|lost/i)
  })

  it('Skip for today shows another card and leaves the redo due', async () => {
    const { tickets, redos } = base()
    const d = await setup(redos, tickets)
    fireEvent.click(await screen.findByTestId('review-skip'))
    expect(screen.getByTestId('review-skip')).toHaveTextContent('Skip for today')
    expect(screen.getByTestId('review-card')).toHaveAttribute('data-ticket-id', 'w2')
    expect(screen.getByTestId('review-count')).toHaveTextContent('3')
    expect((await d.redos.get('r1'))!.closedAt).toBeUndefined()
    expect(document.body.textContent).not.toMatch(/overdue|behind|missed day|you didn't/i)
  })

  it('with a queue of one, Missed it and Skip bring the card back answer-first and write nothing (REVIEW-10, 13)', async () => {
    const { tickets } = base()
    const one = redo('r1', 'w1', 2)
    const d = await setup([one], tickets)
    fireEvent.change(await screen.findByTestId('review-answer'), { target: { value: 'half an answer' } })
    fireEvent.click(screen.getByTestId('review-skip'))
    expect((screen.getByTestId('review-answer') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByTestId('review-stored-answer')).toBeNull()
    await reveal('my answer')
    expect(screen.getByTestId('review-stored-answer')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('review-grade-missed'))
    expect(screen.queryByTestId('review-stored-answer')).toBeNull()
    expect(screen.queryByTestId('review-your-answer')).toBeNull()
    expect((screen.getByTestId('review-answer') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByTestId('review-count')).toHaveTextContent('1')
    expect(await d.redos.get('r1')).toEqual(one)
  })

  it('never shows or counts a due redo on an archived ticket', async () => {
    const { tickets } = base()
    await setup([redo('r4', 'gone', 5)], tickets)
    expect(await screen.findByTestId('review-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('review-card')).toBeNull()
    expect(screen.queryByTestId('review-count')).toBeNull()
  })

  it('shows a replay card for a problem with the accent REDO · PROBLEM button that opens it', async () => {
    const { tickets } = base()
    await setup([redo('r3', 'p1', 0)], tickets)
    const card = await screen.findByTestId('review-card')
    expect(card).toHaveAttribute('data-kind', 'replay')
    expect(screen.getByTestId('review-card-kind')).toHaveTextContent(/^Problem$/)
    expect(screen.getByTestId('review-card-title')).toHaveTextContent(/^200 · Number of Islands$/)
    expect(screen.getByTestId('review-card-lane')).toHaveTextContent('DSA')
    expect(screen.getByTestId('review-card-question')).not.toHaveAttribute('data-content')
    expect(screen.queryByTestId('review-answer')).toBeNull()
    expect(screen.queryByTestId('review-reveal')).toBeNull()
    const go = screen.getByTestId('review-redo')
    expect(go.tagName).toBe('BUTTON')
    expect(go).toHaveTextContent('REDO · PROBLEM')
    expect(go).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    fireEvent.click(go)
    expect(screen.getByTestId('location')).toHaveTextContent('/do/p1')
  })

  it('a design replay card says REDO · DESIGN and opens the design session', async () => {
    await setup([redo('r5', 'd1', 3), redo('r3', 'p1', 0)], [design, problem])
    const card = await screen.findByTestId('review-card')
    expect(card).toHaveAttribute('data-ticket-id', 'd1')
    expect(screen.getByTestId('review-card-kind')).toHaveTextContent(/^Design$/)
    expect(screen.getByTestId('review-card-lane')).toHaveTextContent('Design')
    fireEvent.click(screen.getByTestId('review-redo'))
    expect(screen.getByTestId('review-redo')).toHaveTextContent('REDO · DESIGN')
    expect(screen.getByTestId('location')).toHaveTextContent('/designs/session/d1')
  })

  it('a write-up replay card says REDO · WRITE-UP', async () => {
    await setup([redo('r6', 'u1', 1)], [writeup])
    expect(await screen.findByTestId('review-redo')).toHaveTextContent('REDO · WRITE-UP')
    expect(screen.getByTestId('review-card-kind')).toHaveTextContent(/^Write-up$/)
  })

  it('is empty with one sentence and one action when nothing is due, and clears without a reload', async () => {
    const { tickets } = base()
    await setup([redo('r1', 'w1', 1)], tickets)
    await reveal()
    fireEvent.click(screen.getByTestId('review-grade-got'))
    const empty = await screen.findByTestId('review-empty')
    expect(empty).toHaveAttribute('data-empty', 'true')
    expect(empty).toHaveTextContent('Nothing is due.')
    expect(screen.getByTestId('review-empty-action')).toHaveAttribute('href', '/')
    expect(screen.getByTestId('review-empty-action')).toHaveTextContent('Go to Today')
    expect(empty.querySelectorAll('p')).toHaveLength(1)
    expect(empty.querySelectorAll('a, button')).toHaveLength(1)
    expect(screen.queryByTestId('review-card')).toBeNull()
  })

  it('shows 11 as a plain count with no backlog wording', async () => {
    const ts = Array.from({ length: 11 }, (_, i) => watch(i + 1))
    await setup(ts.map((t, i) => redo(`r${i}`, t.id, 1)), ts)
    expect(await screen.findByTestId('review-count')).toHaveTextContent('11')
    expect(document.body.textContent).not.toMatch(/overdue|backlog|behind/i)
  })

  it('stays under 15 controls, with one accent before the reveal and none after', async () => {
    const { tickets, redos } = base()
    await setup(redos, tickets)
    const root = await screen.findByTestId('review-card')
    const controls = () => root.parentElement!.querySelectorAll('a[href], button, textarea, input, select').length
    expect(controls()).toBeLessThanOrEqual(15)
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    await reveal()
    expect(controls()).toBeLessThanOrEqual(15)
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
  })

  it('marks plan and learner text so word scans skip it', async () => {
    const { tickets, redos } = base()
    await setup(redos, tickets)
    expect(await screen.findByTestId('review-answer')).toHaveAttribute('data-content', 'learner')
    await reveal('My words.')
    expect(screen.getByTestId('review-your-answer')).toHaveAttribute('data-content', 'learner')
  })
})

describe('a read-only browser (Review Focus 4)', () => {
  it('cannot grade: the answer box and grades are disabled and nothing is written', async () => {
    ro.on = true
    const d = await setup([redo('r1', 'w1', 1)], [watch(1)])
    const before = JSON.stringify(await d.redos.toArray())
    expect(await screen.findByTestId('review-answer')).toBeDisabled()
    // the field cannot be typed into, but a stray change event still must not unlock a write
    fireEvent.change(screen.getByTestId('review-answer'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('review-reveal'))
    for (const g of ['missed', 'close', 'got']) expect(screen.getByTestId(`review-grade-${g}`)).toBeDisabled()
    fireEvent.click(screen.getByTestId('review-grade-got'))
    fireEvent.click(screen.getByTestId('review-grade-close'))
    await new Promise(r => setTimeout(r, 60))
    expect(JSON.stringify(await d.redos.toArray())).toBe(before)
    expect(screen.getByTestId('review-count')).toHaveTextContent('1')
  })

  it('cannot start a redo: the replay action is disabled and goes nowhere', async () => {
    ro.on = true
    const d = await setup([redo('r3', 'p1', 0)], [problem])
    const before = JSON.stringify(await d.redos.toArray())
    const go = await screen.findByTestId('review-redo')
    expect(go).toBeDisabled()
    fireEvent.click(go)
    expect(screen.getByTestId('location')).toHaveTextContent('/')
    expect(screen.getByTestId('location')).not.toHaveTextContent('/do/')
    expect(JSON.stringify(await d.redos.toArray())).toBe(before)
  })
})

describe('grading twice in a row', () => {
  it('moves the redo up one step only', async () => {
    const d = await setup([redo('r1', 'w1', 1), redo('r2', 'w2', 1)], [watch(1), watch(2)])
    await reveal()
    const got = screen.getByTestId('review-grade-got')
    fireEvent.click(got)
    fireEvent.click(got)
    await waitFor(() => expect(screen.getByTestId('review-count')).toHaveTextContent('1'))
    expect((await d.redos.get('r1'))!.stage).toBe(1)
  })
})

describe('review-card-due (RIT-04)', () => {
  it('reads "due today", "due 1 day ago" and "due <n> days ago", never overdue', async () => {
    await setup([redo('r1', 'w1', 0), redo('r2', 'w2', 1), redo('r3', 'p1', 3)], [watch(1), watch(2), problem])
    // oldest first: the 3-day card, then 1 day, then today
    expect(await screen.findByTestId('review-card-due')).toHaveTextContent(/^due 3 days ago$/)
    fireEvent.click(screen.getByTestId('review-skip'))
    await waitFor(() => expect(screen.getByTestId('review-card-due')).toHaveTextContent(/^due 1 day ago$/))
    fireEvent.click(screen.getByTestId('review-skip'))
    await waitFor(() => expect(screen.getByTestId('review-card-due')).toHaveTextContent(/^due today$/))
    expect(document.body.textContent).not.toMatch(/overdue/i)
  })
})

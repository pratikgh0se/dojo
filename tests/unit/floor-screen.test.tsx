import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Redo } from '../../src/data/types'
import { resetNow, setNow } from '../../src/lib/clock'
import { Floor } from '../../src/screens/Floor'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

const NOW = new Date(2026, 10, 4, 10).getTime()
const DAY = 86_400_000
afterEach(() => { resetNow(); ro.on = false })

const redo = (i: number, daysAgo: number, over: Partial<Redo> = {}): Redo => ({
  id: `ex-w${i}-0`, ticketId: `w${i}`, source: 'explain', createdAt: NOW - 9 * DAY, stage: 0, due: NOW - daysAgo * DAY,
  passed: [], helpCost: 0, refunded: 0, piece: { topic: 'T', question: `Question ${i}?`, answer: `Answer ${i}.` }, ...over,
})
async function setup(n: number, extra: (d: ReturnType<typeof freshDb>) => Promise<void> = async () => {}) {
  setNow(() => NOW)
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-10-01', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.bulkPut(Array.from({ length: n }, (_, i) => mkTicket({ id: `w${i}`, kind: 'watch', title: `Watch ${i}`, explain: [`Question ${i}?`], explainAnswers: [`Answer ${i}.`] })))
  await d.redos.bulkPut(Array.from({ length: n }, (_, i) => redo(i, n - i)))
  await extra(d)
  renderWithApp(<Floor />, { db: d, ...appPlans() })
  return d
}
const answerAndGrade = async (grade: 'got' | 'close' | 'missed') => {
  fireEvent.change(await screen.findByTestId('floor-answer'), { target: { value: 'my answer' } })
  fireEvent.click(screen.getByTestId('floor-reveal'))
  fireEvent.click(await screen.findByTestId(`floor-grade-${grade}`))
}

describe('the /floor session', () => {
  it('with no due card it is just the line: data-step line, no card, no position, no sentence about missing cards', async () => {
    await setup(0)
    const line = await screen.findByTestId('floor-line')
    expect(screen.getByTestId('screen-floor')).toHaveAttribute('data-step', 'line')
    expect(screen.getByTestId('floor-title')).toHaveTextContent('Floor: 15 minutes')
    expect(screen.queryByTestId('floor-card')).toBeNull()
    expect(screen.queryByTestId('floor-position')).toBeNull()
    expect(line).toHaveAttribute('maxlength', '200')
    expect(screen.getByLabelText(/One line about today/)).toBe(line)
    expect(screen.getByTestId('screen-floor').textContent).not.toMatch(/no cards|nothing is due|missing/i)
  })
  it('Save is disabled for an empty or space-only line, and writes today\'s studied floor row and leaves', async () => {
    const d = await setup(0)
    const input = await screen.findByTestId('floor-line')
    const save = screen.getByTestId('floor-save')
    expect(save).toHaveTextContent('SAVE · FLOOR')
    expect(save).toHaveAttribute('data-accent', 'primary')
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: '   ' } })
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: '  Read about batching  ' } })
    fireEvent.click(save)
    await waitFor(async () => expect(await d.journal.get('journal-2026-11-04')).toEqual({ id: 'journal-2026-11-04', day: '2026-11-04', at: NOW, mode: 'studied', items: [], line: 'Read about batching', floor: true }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
    expect(await d.tickets.count()).toBe(0)
    expect(await d.sessions.count()).toBe(0)
  })
  it('250 typed characters leave 200 and digits stay in the field; no other element carries the accent', async () => {
    await setup(0)
    const input = await screen.findByTestId('floor-line') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'x'.repeat(250) } })
    expect(input.value).toHaveLength(200)
    fireEvent.change(input, { target: { value: '1234?' } })
    expect(input.value).toBe('1234?')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('shows at most 5 due cards, oldest first, "Card 1 of 5", then the line; the sixth stays due', async () => {
    const d = await setup(8)
    expect(await screen.findByTestId('floor-card-title')).toHaveTextContent('Watch 0')
    expect(screen.getByTestId('floor-position')).toHaveTextContent('Card 1 of 5')
    expect(screen.getByTestId('screen-floor')).toHaveAttribute('data-step', 'cards')
    for (let i = 0; i < 5; i++) await answerAndGrade('got')
    await screen.findByTestId('floor-line')
    expect((await d.redos.toArray()).filter(r => r.stage === 0 && r.closedAt === undefined)).toHaveLength(3)
  })
  it('a check card is answer first: the stored answer is hidden until reveal, grades have no accent, no age is shown', async () => {
    await setup(2)
    const card = await screen.findByTestId('floor-card')
    expect(card).toHaveAttribute('data-kind', 'check')
    expect(screen.getByTestId('floor-answer')).toHaveValue('')
    expect(card.textContent).not.toContain('Answer 0.')
    expect(card.textContent).not.toMatch(/due|ago|overdue/i)
    expect(screen.getByTestId('floor-card-kind')).toHaveTextContent('Watch')
    expect(screen.getByTestId('floor-card-question')).toHaveTextContent('Question 0?')
    expect(screen.getByTestId('floor-reveal')).toBeDisabled()
    expect(screen.getByTestId('floor-reveal')).toHaveAttribute('data-accent', 'primary')
    fireEvent.change(screen.getByTestId('floor-answer'), { target: { value: 'my answer' } })
    fireEvent.click(screen.getByTestId('floor-reveal'))
    expect(await screen.findByTestId('floor-stored-answer')).toHaveTextContent('Answer 0.')
    expect(screen.getByTestId('floor-your-answer')).toHaveTextContent('my answer')
    for (const g of ['missed', 'close', 'got']) expect(screen.getByTestId(`floor-grade-${g}`)).not.toHaveAttribute('data-accent')
  })
  it('Got it and Close change the redo as in Review and show the next card; Missed it changes nothing and also shows the next card', async () => {
    const d = await setup(3)
    await answerAndGrade('got')
    await waitFor(() => expect(screen.getByTestId('floor-card-title')).toHaveTextContent('Watch 1'))
    expect(screen.getByTestId('floor-position')).toHaveTextContent('Card 2 of 3')
    expect((await d.redos.get('ex-w0-0'))!.stage).toBe(1)
    await answerAndGrade('missed')
    await waitFor(() => expect(screen.getByTestId('floor-card-title')).toHaveTextContent('Watch 2'))
    expect((await d.redos.get('ex-w1-0'))).toMatchObject({ stage: 0, passed: [] })
    await answerAndGrade('close')
    await screen.findByTestId('floor-line') // the floor does not come back to the missed card
    expect((await d.redos.get('ex-w2-0'))!.stage).toBe(0)
    expect(new Date((await d.redos.get('ex-w2-0'))!.due as number).getDate()).toBe(5)
  })
  it('Skip for today shows the next card and changes no data', async () => {
    const d = await setup(2)
    await screen.findByTestId('floor-card')
    const before = JSON.stringify(await d.redos.toArray())
    fireEvent.click(screen.getByTestId('floor-skip'))
    await waitFor(() => expect(screen.getByTestId('floor-card-title')).toHaveTextContent('Watch 1'))
    expect(JSON.stringify(await d.redos.toArray())).toBe(before)
  })
  it('a replay card has no answer box: REDO · PROBLEM leads to the ticket', async () => {
    await setup(0, async d => {
      await d.tickets.put(mkTicket({ id: 'p1', kind: 'problem', lane: 'dsa', title: '200 · Number of Islands' }))
      await d.redos.put({ id: 'r-p1', ticketId: 'p1', source: 'gave_up', createdAt: NOW - 9 * DAY, stage: 0, due: NOW - DAY, passed: [], helpCost: 0, refunded: 0 })
    })
    expect(await screen.findByTestId('floor-card')).toHaveAttribute('data-kind', 'replay')
    expect(screen.queryByTestId('floor-answer')).toBeNull()
    expect(screen.getByTestId('floor-redo')).toHaveTextContent('REDO · PROBLEM')
    expect(screen.getByTestId('floor-redo')).toHaveAttribute('data-accent', 'primary')
    fireEvent.click(screen.getByTestId('floor-redo'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/p1'))
  })
  it('opening and leaving write nothing; the explain cap applies (12 explain cards: at most 5 shown)', async () => {
    const d = await setup(12)
    expect(await screen.findByTestId('floor-position')).toHaveTextContent('Card 1 of 5')
    expect(await d.journal.count()).toBe(0)
    expect((await d.redos.toArray()).map(r => r.stage)).toEqual(Array(12).fill(0))
  })
  it('in a read-only browser the cards can be read but nothing can be used', async () => {
    ro.on = true
    const d = await setup(2)
    await screen.findByTestId('floor-card')
    expect(screen.getByTestId('floor-answer')).toBeDisabled()
    expect(screen.getByTestId('floor-reveal')).toBeDisabled()
    expect(screen.getByTestId('floor-skip')).toBeDisabled()
    expect(await d.redos.count()).toBe(2)
  })
  it('in a read-only browser the line step is disabled', async () => {
    ro.on = true
    await setup(0)
    expect(await screen.findByTestId('floor-line')).toBeDisabled()
    expect(screen.getByTestId('floor-save')).toBeDisabled()
  })
})

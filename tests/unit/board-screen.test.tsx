import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Board } from '../../src/screens/Board'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

async function setup() {
  setNow(() => ist('2026-09-08T10:00:00'))
  const d = await seededDb()
  renderWithApp(<Board />, { db: d, plan: smallPlan, route: '/board', path: '/board' })
  await screen.findByTestId('card-p127')
  return d
}

const drag = (id: string, target: HTMLElement) => {
  fireEvent.dragStart(screen.getByTestId(`card-${id}`))
  fireEvent.dragOver(target)
  fireEvent.drop(target)
}

describe('Board screen', () => {
  it('shows the current sprint with plan-ordered cards and metadata', async () => {
    await setup()
    expect(screen.getByTestId('board-sprint')).toHaveTextContent('S1')
    expect(screen.getByTestId('count-todo')).toHaveTextContent('5')
    const card = screen.getByTestId('card-m1w1t1')
    expect(within(card).getByText('S1 · 50 min')).toBeInTheDocument()
    expect(within(card).getByText('Anthropic Academy')).toBeInTheDocument()
  })

  it('changes sprint with arrow keys on the strip', async () => {
    await setup()
    const strip = screen.getByTestId('strip')
    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(screen.getByTestId('board-sprint')).toHaveTextContent('S2')
    expect(screen.getByTestId('count-todo')).toHaveTextContent('3')
    fireEvent.keyDown(strip, { key: 'ArrowLeft' })
    expect(screen.getByTestId('board-sprint')).toHaveTextContent('S1')
  })

  it('drags between columns and pays XP on Done', async () => {
    const d = await setup()
    drag('p1', screen.getByTestId('col-doing'))
    await waitFor(() => expect(screen.getByTestId('count-doing')).toHaveTextContent('1'))
    drag('p1', screen.getByTestId('col-done'))
    expect(await screen.findByText('+5 xp · Saved')).toBeInTheDocument()
    expect((await d.tickets.get('p1'))!.status).toBe('done')
  })

  it('drops a card on a strip cell to slide it there', async () => {
    const d = await setup()
    drag('p1', screen.getByTestId('strip-3'))
    await waitFor(async () => expect(await d.tickets.get('p1')).toMatchObject({ sprint: 3, slidFrom: [1] }))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sprints' })).getByRole('button', { name: 'Sprint 3' }))
    const card = await screen.findByTestId('card-p1')
    expect(card).toHaveClass('slid')
    expect(within(screen.getByTestId('col-slid')).getByTestId('card-p1')).toBeInTheDocument()
    expect(within(card).getByText('S3 · 30 min · from S1')).toBeInTheDocument()
    expect(screen.getByTestId('debt-own')).toHaveTextContent('own 2')
    expect(screen.getByTestId('debt-slid')).toHaveTextContent('slid in 1')
    // UAT J2: what the numbers count, in plain words
    expect(screen.getByText('Plan items this sprint:')).toBeInTheDocument() // ruling 20 S4
    expect(screen.getByTestId('debt-own')).toHaveAttribute('title', 'plan items planned for this sprint (a split card counts once)')
    expect(screen.getByTestId('debt-slid')).toHaveAttribute('title', 'cards slid in from earlier sprints')
    expect(screen.getByTestId('debt-avg')).toHaveAttribute('title', "the plan's average cards per sprint (the line on the bar)")
  })

  it('card keys: d marks done, s slides, Enter opens Do', async () => {
    const d = await setup()
    const card = screen.getByTestId('card-m1w1i1')
    card.focus()
    fireEvent.keyDown(card, { key: 's' })
    await waitFor(async () => expect((await d.tickets.get('m1w1i1'))!.sprint).toBe(2))
    const p127 = screen.getByTestId('card-p127')
    fireEvent.keyDown(p127, { key: 'd' })
    expect(await screen.findByText('+15 xp · Saved')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('card-p200'), { key: 'Enter' })
    expect(screen.getByTestId('location')).toHaveTextContent('/do/p200')
  })

  it('UAT r2 J7: a click on a card opens it; a click on its own buttons, or the end of a drag, does not', async () => {
    const d = await setup()
    const card = screen.getByTestId('card-p200')
    // a drag: the pointer travelled
    fireEvent.mouseDown(card, { clientX: 10, clientY: 10 })
    fireEvent.click(within(card).getByText(/./, { selector: '.card-title' }), { clientX: 40, clientY: 12 })
    expect(screen.getByTestId('location')).toHaveTextContent('/board')
    // its own button
    fireEvent.mouseDown(card, { clientX: 10, clientY: 10 })
    fireEvent.click(within(card).getByRole('button', { name: 'Slide ›' }), { clientX: 10, clientY: 10 })
    await waitFor(async () => expect((await d.tickets.get('p200'))!.sprint).toBe(2))
    expect(screen.getByTestId('location')).toHaveTextContent('/board')
    // a plain click on the card body
    const other = screen.getByTestId('card-p127')
    fireEvent.mouseDown(other, { clientX: 20, clientY: 20 })
    fireEvent.click(within(other).getByText(/./, { selector: '.card-title' }), { clientX: 21, clientY: 20 })
    expect(screen.getByTestId('location')).toHaveTextContent('/do/p127')
  })

  it('focuses the moved card after a successful Shift+ArrowRight', async () => {
    await setup()
    const card = screen.getByTestId('card-m1w1t1')
    card.focus()
    fireEvent.keyDown(card, { key: 'ArrowRight', shiftKey: true })
    await waitFor(() => expect(screen.getByTestId('count-doing')).toHaveTextContent('1'))
    const moved = screen.getByTestId('card-m1w1t1')
    expect(within(screen.getByTestId('col-doing')).getByTestId('card-m1w1t1')).toBeInTheDocument()
    expect(document.activeElement).toBe(moved)
  })

  it('focuses the sibling that took its place after a successful slide', async () => {
    const d = await setup()
    const card = screen.getByTestId('card-m1w1t1')
    card.focus()
    fireEvent.keyDown(card, { key: 's' })
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(2))
    expect(document.activeElement).toBe(screen.getByTestId('card-m1w1i1'))
  })
})

describe('Doing cap on the Board (Review Focus #5)', () => {
  async function withThreeDoing() {
    const d = await setup()
    // the limit is per sprint (ruling 25 R2): the three Doing cards sit in the sprint on screen
    await d.tickets.bulkUpdate([
      { key: 'm1w1t1', changes: { status: 'doing' } },
      { key: 'm1w2t1', changes: { status: 'doing', sprint: 1 } },
      { key: 'm1w3t1', changes: { status: 'doing', sprint: 1 } },
    ])
    await waitFor(() => expect(screen.getByTestId('count-doing')).toHaveTextContent('3'))
    return d
  }

  it('bounces a 4th card dragged into Doing', async () => {
    const d = await withThreeDoing()
    drag('p127', screen.getByTestId('col-doing'))
    expect(await screen.findByText(/Doing is full \(3\/3\)/)).toBeInTheDocument()
    expect(screen.getByTestId('card-p127')).toHaveClass('bounce')
    expect((await d.tickets.get('p127'))!.status).toBe('todo')
  })

  it('bounces a 4th card moved into Doing by keyboard', async () => {
    const d = await withThreeDoing()
    const card = screen.getByTestId('card-p127')
    card.focus()
    fireEvent.keyDown(card, { key: 'ArrowRight', shiftKey: true })
    expect(await screen.findByText(/Doing is full \(3\/3\)/)).toBeInTheDocument()
    expect(screen.getByTestId('card-p127')).toHaveClass('bounce')
    expect((await d.tickets.get('p127'))!.status).toBe('todo')
  })
})

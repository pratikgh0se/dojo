import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Board } from '../../src/screens/Board'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

function stubPhone(phone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({
      matches: phone && q.includes('max-width: 767px'), media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  })
}

async function setup() {
  setNow(() => ist('2026-09-08T10:00:00'))
  const d = await seededDb()
  renderWithApp(<Board />, { db: d, plan: smallPlan, route: '/board', path: '/board' })
  await screen.findByTestId('count-todo')
  return d
}

afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia })

describe('Board on phone (ui-board B3)', () => {
  it('stacks columns with header toggles; only Todo and Doing start open', async () => {
    stubPhone(true)
    await setup()
    const toggle = (col: string) => screen.getByTestId(`col-${col}`).querySelector<HTMLButtonElement>('h2 > button')!
    expect(toggle('slid')).toHaveAttribute('aria-expanded', 'false')
    expect(toggle('todo')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('doing')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('done')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('card-m1w1t1')).toBeInTheDocument()
    expect(within(screen.getByTestId('col-done')).queryByText('Drop cards here')).toBeNull()
    fireEvent.click(toggle('done'))
    expect(toggle('done')).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByTestId('col-done')).getByText('Drop cards here')).toBeInTheDocument()
    fireEvent.click(toggle('todo'))
    expect(screen.queryByTestId('card-m1w1t1')).toBeNull()
    expect(screen.getByTestId('count-todo')).toHaveTextContent('5')
  })

  it('desktop: every column is open with a plain h2 and empty columns say so (B4)', async () => {
    stubPhone(false)
    await setup()
    for (const c of ['slid', 'todo', 'doing', 'done']) {
      expect(screen.getByTestId(`col-${c}`).querySelector('h2 button')).toBeNull()
    }
    expect(within(screen.getByTestId('col-slid')).getByText('Nothing slid in')).toBeInTheDocument()
    expect(within(screen.getByTestId('col-doing')).getByText('Drop cards here')).toBeInTheDocument()
  })

  it('the sprint strip is a navigation of buttons, the selected one aria-current (B1.3)', async () => {
    stubPhone(false)
    await setup()
    const nav = screen.getByRole('navigation', { name: 'Sprints' })
    expect(within(nav).getByRole('button', { name: 'Sprint 1' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(nav).getByRole('button', { name: 'Sprint 2' }))
    expect(screen.getByTestId('board-sprint')).toHaveTextContent('S2')
    expect(within(nav).getByRole('button', { name: 'Sprint 2' })).toHaveAttribute('aria-current', 'true')
  })

  it('the card rail Do ▸ is a link named "Do: <title>" with do-<id>', async () => {
    stubPhone(false)
    await setup()
    const card = screen.getByTestId('card-m1w1t1')
    const link = within(card).getByTestId('do-m1w1t1')
    expect(link.tagName).toBe('A')
    expect(link).toHaveAccessibleName(/^Do: /)
    expect(link).toHaveAttribute('href', '/do/m1w1t1')
  })

  it('a keyboard move into a collapsed column focuses that column\'s toggle and leaves no stale pending focus (G4 review 4)', async () => {
    stubPhone(true)
    const d = await setup()
    const card = screen.getByTestId('card-p127')
    card.focus()
    fireEvent.keyDown(card, { key: 'd' })
    await waitFor(async () => expect((await d.tickets.get('p127'))!.status).toBe('done'))
    const doneToggle = screen.getByTestId('col-done').querySelector<HTMLButtonElement>('h2 > button')!
    await waitFor(() => expect(document.activeElement).toBe(doneToggle))
    // opening Done later must not yank focus to the card (the pending focus was cleared)
    const todoToggle = screen.getByTestId('col-todo').querySelector<HTMLButtonElement>('h2 > button')!
    todoToggle.focus()
    fireEvent.click(doneToggle)
    expect(await within(screen.getByTestId('col-done')).findByTestId('card-p127')).toBeInTheDocument()
    expect(document.activeElement).not.toBe(screen.getByTestId('card-p127'))
  })
})


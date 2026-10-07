import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => vi.restoreAllMocks())

describe('Board sprint actions (DL11: house-style dialogs, no native confirm)', () => {
  it('slides the sprint after confirming in the slide dialog, with one event', async () => {
    const native = vi.spyOn(window, 'confirm')
    const d = await setup()
    const opener = screen.getByRole('button', { name: 'Slide sprint ›' })
    fireEvent.click(opener)
    const dlg = screen.getByRole('dialog', { name: 'Slide sprint?' })
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAttribute('data-testid', 'slide-dialog')
    expect(within(dlg).getByText(/^Move 5 unfinished cards from S1 to S2\? S2 will have 8 cards \([\d.]+ h\)\.$/)).toBeInTheDocument()
    expect(within(dlg).getAllByRole('button').map(b => b.textContent)).toEqual(['Slide 5 cards', 'Cancel'])
    fireEvent.click(within(dlg).getByRole('button', { name: 'Slide 5 cards' }))
    expect(await screen.findByText('Slid 5 to S2')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await d.events.toArray()).toMatchObject([{ t: 'slide_sprint', sprint: 1, to: 2, count: 5 }])
    expect(screen.getByTestId('count-todo')).toHaveTextContent('0')
    expect(native).not.toHaveBeenCalled()
  })

  // ruling 20 S6 / UAT cu-3 P2-1: the Undo button names the action it will undo, in its title and aria-label (and the bubble's
  // text), and the words follow the stack: newest step first, back to "Nothing to undo" when the stack is empty
  it('Undo names the action it will undo and follows the stack as steps are made and undone', async () => {
    const d = await setup()
    const undo = () => screen.getByTestId('undo')
    const says = (text: string) => {
      expect(undo()).not.toHaveAttribute('title') // one tooltip only: the bubble (cu-final)
      expect(undo()).toHaveAttribute('aria-label', text)
      expect(undo()).toHaveAttribute('data-tip', text)
    }
    says('Nothing to undo')
    expect(undo()).toBeDisabled()
    const title = (await d.tickets.get('m1w1t1'))!.title
    const card = screen.getByTestId('card-m1w1t1')
    card.focus()
    fireEvent.keyDown(card, { key: 's' })
    await waitFor(() => says(`Undo: slide '${title}' to Sprint 2`))
    expect(undo()).toHaveTextContent('Undo (1)')
    const other = screen.getByTestId('card-p127')
    const otherTitle = (await d.tickets.get('p127'))!.title
    other.focus()
    fireEvent.keyDown(other, { key: 'ArrowRight', shiftKey: true })
    await waitFor(() => says(`Undo: move '${otherTitle}' to Doing`))
    expect(undo()).toHaveTextContent('Undo (2)')
    fireEvent.click(undo())
    await waitFor(() => says(`Undo: slide '${title}' to Sprint 2`))
    fireEvent.click(undo())
    await waitFor(() => says('Nothing to undo'))
    expect(undo()).toBeDisabled()
    expect(undo()).toHaveTextContent('Undo (0)')
    // a sprint slide names the count, and a Move to sprint… names its target
    fireEvent.click(screen.getByRole('button', { name: 'Slide sprint ›' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Slide sprint?' })).getByRole('button', { name: /^Slide \d+ cards$/ }))
    await waitFor(() => says('Undo: slide 5 cards from Sprint 1 to Sprint 2'))
  })

  it('Cancel and Esc write nothing and return focus to the opener', async () => {
    const d = await setup()
    const slide = screen.getByRole('button', { name: 'Slide sprint ›' })
    slide.focus()
    fireEvent.click(slide)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Slide sprint?' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(slide))
    const shift = screen.getByRole('button', { name: 'Shift plan ›' })
    fireEvent.click(shift)
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Shift plan?' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(shift))
    expect(await d.events.count()).toBe(0)
  })

  it('shifts the plan through the shift dialog and undoes LIFO', async () => {
    const d = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Shift plan ›' }))
    const dlg = screen.getByRole('dialog', { name: 'Shift plan?' })
    expect(dlg).toHaveAttribute('data-testid', 'shift-dialog')
    // G4 review 5: the safe choice has focus first, as in Restore
    await waitFor(() => expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Cancel' })))
    expect(within(dlg).getByText('Shift every unfinished ticket from S1 onward by one sprint?')).toBeInTheDocument()
    expect(within(dlg).getAllByRole('button').map(b => b.textContent)).toEqual(['Shift plan', 'Cancel'])
    fireEvent.click(within(dlg).getByRole('button', { name: 'Shift plan' }))
    expect(await screen.findByText('Shifted 10 tickets')).toBeInTheDocument()
    const undo = await screen.findByTestId('undo')
    expect(undo).toHaveTextContent('Undo (1)')
    fireEvent.click(undo)
    expect(await screen.findByText('Undone')).toBeInTheDocument()
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(1))
    await waitFor(() => expect(screen.getByTestId('undo')).toHaveTextContent('Undo (0)'))
    expect(screen.getByTestId('undo')).toBeDisabled()
  })
})

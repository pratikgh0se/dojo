import { useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MoreMenu } from '../../src/app/MoreMenu'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <MoreMenu open={open} onOpenChange={setOpen} />
      <p data-testid="outside">outside</p>
    </>
  )
}

async function setup(route = '/board') {
  const d = await seededDb()
  renderWithApp(<Harness />, { db: d, plan: smallPlan, route })
}

const at = () => screen.getByTestId('location').textContent
const key = (k: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key: k })

describe('More menu', () => {
  it('opens on click with one row per overflow tab and focuses the first', async () => {
    await setup()
    const btn = screen.getByTestId('more-button')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    const items = screen.getAllByRole('menuitem')
    expect(items.map(i => i.getAttribute('aria-label'))).toEqual(
      ['Map', 'Progress', 'Week', 'Overview', 'Atlas', 'Banks', 'Mentors', 'Ritual', 'Settings'],
    )
    expect(items[0]).toHaveAttribute('aria-keyshortcuts', '6')
    expect(items[4]).toHaveAttribute('aria-keyshortcuts', 'a')
    expect(items[5]).toHaveAttribute('aria-keyshortcuts', 'b')
    expect(items[6]).not.toHaveAttribute('aria-keyshortcuts')
    expect(document.activeElement).toBe(items[0])
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves with arrows (wrapping) and opens the route on Enter', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('more-button'))
    key('ArrowUp')
    expect(document.activeElement).toHaveAttribute('aria-label', 'Settings')
    key('ArrowDown')
    expect(document.activeElement).toHaveAttribute('aria-label', 'Map')
    key('ArrowDown')
    expect(document.activeElement).toHaveAttribute('aria-label', 'Progress')
    key('Enter')
    await waitFor(() => expect(at()).toBe('/progress'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Esc and returns focus to the More button', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('more-button'))
    key('Escape')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('more-button'))
  })

  it('closes on an outside click', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('more-button'))
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('reads More · <tab> in the pressed state on an overflow route', async () => {
    await setup('/map')
    const btn = screen.getByTestId('more-button')
    expect(btn).toHaveTextContent('More · Map ▾')
    expect(btn).toHaveClass('tab-on')
  })

  it('reads plain More on a primary route', async () => {
    await setup('/board')
    const btn = screen.getByTestId('more-button')
    expect(btn).toHaveTextContent(/^More ▾$/)
    expect(btn).not.toHaveClass('tab-on')
  })

})

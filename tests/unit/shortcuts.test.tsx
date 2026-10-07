import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GLOBAL_KEYS, legendText, TODAY_KEYS } from '../../src/app/legend'
import { SHORTCUT_ROUTES, useShortcuts } from '../../src/app/shortcuts'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

function Probe({ onMore }: { onMore?: () => void }) {
  useShortcuts(onMore)
  return <input aria-label="typing" />
}

async function setup(route = '/', onMore?: () => void) {
  const d = await seededDb()
  renderWithApp(<Probe onMore={onMore} />, { db: d, plan: smallPlan, route })
}

const at = () => screen.getByTestId('location').textContent

describe('global shortcuts (Review Focus #1)', () => {
  it('1–9, 0, a and b switch tabs, t jumps to Today', async () => {
    await setup()
    const expected: Array<[string, string]> = [
      ['2', '/board'], ['3', '/dsa'], ['4', '/designs'], ['5', '/ai'], ['6', '/map'],
      ['7', '/progress'], ['8', '/week'], ['9', '/overview'], ['0', '/settings'], ['a', '/atlas'], ['b', '/banks'], ['1', '/'],
    ]
    for (const [key, path] of expected) {
      fireEvent.keyDown(document.body, { key })
      await waitFor(() => expect(at()).toBe(path))
    }
    fireEvent.keyDown(document.body, { key: '2' })
    fireEvent.keyDown(document.body, { key: 't' })
    await waitFor(() => expect(at()).toBe('/'))
  })

  it('gives Mentors and Ritual no number key', () => {
    expect(Object.values(SHORTCUT_ROUTES)).not.toContain('/mentors')
    expect(Object.values(SHORTCUT_ROUTES)).not.toContain('/ritual')
    expect(SHORTCUT_ROUTES['3']).toBe('/dsa')
    expect(SHORTCUT_ROUTES['0']).toBe('/settings')
  })

  it('m calls the More handler and never navigates', async () => {
    const onMore = vi.fn()
    await setup('/board', onMore)
    fireEvent.keyDown(document.body, { key: 'm' })
    expect(onMore).toHaveBeenCalledTimes(1)
    expect(at()).toBe('/board')
  })

  it('ignores keys typed into inputs or with modifiers, including m', async () => {
    const onMore = vi.fn()
    await setup('/', onMore)
    fireEvent.keyDown(screen.getByLabelText('typing'), { key: '2' })
    fireEvent.keyDown(screen.getByLabelText('typing'), { key: 'm' })
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '3', metaKey: true })
    expect(at()).toBe('/')
    expect(onMore).not.toHaveBeenCalled()
  })

  it('does not leave Do by number keys or m', async () => {
    const onMore = vi.fn()
    await setup('/do/p127', onMore)
    fireEvent.keyDown(document.body, { key: '2' })
    fireEvent.keyDown(document.body, { key: 't' })
    fireEvent.keyDown(document.body, { key: 'm' })
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(at()).toBe('/do/p127')
    expect(onMore).not.toHaveBeenCalled()
  })

  it('ignores tab keys on the full-screen design session route (C-DESIGN D-18.7)', async () => {
    await setup('/designs/session/d-method', vi.fn())
    fireEvent.keyDown(document.body, { key: '1' })
    fireEvent.keyDown(document.body, { key: 't' })
    expect(at()).toBe('/designs/session/d-method')
  })

  it('documents every global shortcut; a screen adds only the keys it answers (ruling 23 K1)', () => {
    expect(GLOBAL_KEYS).toBe('1–9, 0 tabs · a atlas · b banks · m more · t today')
    expect(legendText()).toBe('1–9, 0 tabs · a atlas · b banks · m more · t today')
    expect(legendText(TODAY_KEYS)).toBe('1–9, 0 tabs · a atlas · b banks · m more · t today · Enter start · space timer · d done · s slide')
  })
})

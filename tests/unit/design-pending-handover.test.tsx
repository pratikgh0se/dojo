import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPending, partHash, readPending, stashPending } from '../../src/data/designPending'
import { lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { emptyCanvas } from '../../src/rules/designCanvas'
import { emptyNotes } from '../../src/rules/designNotes'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']

async function drawing() {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 10 * MIN })
  return { d, id: s.id }
}
const mount = (d: Awaited<ReturnType<typeof drawing>>['d']) =>
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method', path: '/designs/session/:designId' })

afterEach(() => localStorage.clear())

describe('the pagehide hand-over (DESIGN-16: a reload right after the last keystroke keeps the text)', () => {
  it('pagehide stashes the newest notes synchronously, before any write can finish', async () => {
    const { d, id } = await drawing()
    mount(d)
    const box = await screen.findByTestId('notes-field-open')
    fireEvent.change(box, { target: { value: 'what about offline?' } })
    fireEvent(window, new Event('pagehide'))
    expect(readPending(id)?.notes?.open).toBe('what about offline?')
    // the page survived: the queue drains and the stash is removed once it has
    await waitFor(() => expect(readPending(id)).toBeNull())
    expect((await d.designSessions.get(id))?.notes?.open).toBe('what about offline?')
  })

  it('the next load applies a stash: the box opens with the text and the stored row holds it', async () => {
    const { d, id } = await drawing()
    const row = (await d.designSessions.get(id))!
    stashPending(id, {
      notes: { ...emptyNotes(), open: 'kept across the reload', api: 'GET /x' }, canvas: emptyCanvas(), view: 'iso',
      known: { notes: [partHash(row.notes)], canvas: [partHash(row.canvas)], view: [partHash(row.view)] },
    })
    mount(d)
    expect(await screen.findByTestId('notes-field-open')).toHaveValue('kept across the reload')
    expect(screen.getByTestId('notes-field-api')).toHaveValue('GET /x')
    await waitFor(async () => expect((await d.designSessions.get(id))?.notes?.open).toBe('kept across the reload'))
    expect((await d.designSessions.get(id))?.view).toBe('iso')
    expect(readPending(id)).toBeNull()
  })

  it('a stash for a session that has moved past drawing is dropped without touching it', async () => {
    const { d, id } = await drawing()
    await lockDesignSession(d, id, T)
    const before = await d.designSessions.get(id)
    const p = stashPending(id, { notes: { ...emptyNotes(), open: 'late' }, canvas: emptyCanvas(), view: '2d', known: {} })
    expect(await applyPending(d, id, readPending(id)!)).toEqual({})
    expect(p).toBeTruthy()
    expect(readPending(id)).toBeNull()
    expect(await d.designSessions.get(id)).toEqual(before)
  })
})

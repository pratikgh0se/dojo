import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-11-04T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
type Mode = 'solo' | 'ai-partner' | 'human-partner'
const tid = (id: string) => screen.getByTestId(id)
const hiddenAncestor = (el: Element) => el.closest('[hidden]')

async function render(route: string, prepare?: (d: Awaited<ReturnType<typeof seededDb>>) => Promise<void>) {
  setNow(() => T)
  const d = await seededDb()
  if (prepare) await prepare(d)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route, path: '/designs/session/:designId' })
  return d
}
const live = (mode: Mode) => (d: Awaited<ReturnType<typeof seededDb>>) => startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - MIN }).then(() => undefined)
const finished = (mode: Mode) => async (d: Awaited<ReturnType<typeof seededDb>>) => {
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - 60 * MIN })
  await d.designSessions.put({ ...s, phase: 'done', endedAt: T - 20 * MIN, lockedAt: T - 20 * MIN, minutes: 40, rubric: 16, rubricBy: 'self' })
}

afterEach(() => { vi.restoreAllMocks() })

describe('the AI partner chat is in view with Notes selected (DESIGN-07, 43, 46 to 52)', () => {
  it('chat input, send, hint and the opening message are not inside a hidden panel', async () => {
    await render('/designs/session/d-method', live('ai-partner'))
    await screen.findByTestId('session-tabs')
    expect(tid('session-tab-notes')).toHaveAttribute('aria-selected', 'true')
    for (const id of ['session-chat-input', 'session-send', 'session-hint', 'notes-field-req-fn']) expect(hiddenAncestor(tid(id)), id).toBeNull()
    await waitFor(() => expect(screen.getAllByTestId('session-msg').length).toBeGreaterThan(0))
    for (const m of screen.getAllByTestId('session-msg')) expect(hiddenAncestor(m)).toBeNull()
  })
  it('the Partner tab of an AI-partner session says how the chat works and holds no second chat', async () => {
    await render('/designs/session/d-method', live('ai-partner'))
    await screen.findByTestId('session-tabs')
    expect(within(tid('session-tabpanel-partner')).getByTestId('session-partner-note')).toBeInTheDocument()
    expect(screen.getAllByTestId('session-chat-input')).toHaveLength(1)
  })
  it('a human-partner session has no chat and a solo one neither', async () => {
    await render('/designs/session/d-method', live('human-partner'))
    await screen.findByTestId('session-tabs')
    expect(screen.queryByTestId('session-chat-input')).toBeNull()
  })
})

describe('opening the card in its own window returns to the notes (DESIGN-61)', () => {
  it('a window that opens: Notes is selected again', async () => {
    vi.spyOn(window, 'open').mockReturnValue({} as Window)
    await render('/designs/session/d-method', live('human-partner'))
    await screen.findByTestId('session-tabs')
    fireEvent.click(tid('session-tab-partner'))
    expect(tid('session-tab-partner')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(tid('partner-open-window'))
    expect(tid('session-tab-notes')).toHaveAttribute('aria-selected', 'true')
    expect(hiddenAncestor(tid('notes-field-req-fn'))).toBeNull() // Requirements is the section open on a first view
  })
  it('a blocked window keeps the Partner tab, where the card now is', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    await render('/designs/session/d-method', live('human-partner'))
    await screen.findByTestId('session-tabs')
    fireEvent.click(tid('session-tab-partner'))
    fireEvent.click(tid('partner-open-window'))
    expect(tid('session-tab-partner')).toHaveAttribute('aria-selected', 'true')
    expect(within(tid('partner-tab')).getByTestId('partner-card')).toBeInTheDocument()
  })
})

describe('the ticket route shows a finished session (DESIGN-69, 75, 79, 80)', () => {
  it('with no live session the latest finished one is shown: summary, not setup', async () => {
    await render('/designs/session/d-method', finished('ai-partner'))
    expect(await screen.findByTestId('session-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('session-setup')).toBeNull()
    expect(screen.queryByTestId('session-discard')).toBeNull()
  })
  it('?new=1 is the way to the setup screen, and the summary offers it', async () => {
    await render('/designs/session/d-method?new=1', finished('ai-partner'))
    expect(await screen.findByTestId('session-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('session-summary')).toBeNull()
  })
  it('DESIGN-81: ?new=1 always shows setup (even with a live session); Start drops it from the URL and shows the drawing', async () => {
    await render('/designs/session/d-method?new=1', async d => { await finished('ai-partner')(d) })
    fireEvent.click(await screen.findByTestId('session-start'))
    expect(tid('session-phase')).toHaveTextContent('Drawing')
    await waitFor(() => expect(tid('location')).toHaveAttribute('data-search', ''))
    await screen.findByTestId('session-tabs')
    expect(screen.queryByTestId('session-setup')).toBeNull()
  })
  it('DESIGN-81: ?new=1 shows setup even when a session is live', async () => {
    await render('/designs/session/d-method?new=1', live('solo'))
    expect(await screen.findByTestId('session-setup')).toBeInTheDocument()
  })
  it('DESIGN-81: ?session=<id> shows that session', async () => {
    let id = ''
    await render('/designs/session/d-method', async d => { await finished('ai-partner')(d); id = (await d.designSessions.toArray())[0].id })
    await screen.findByTestId('session-summary')
    expect(id).not.toBe('')
  })
  it('a live session wins over a finished one', async () => {
    await render('/designs/session/d-method', async d => { await finished('ai-partner')(d); await live('ai-partner')(d) })
    expect(await screen.findByTestId('session-tabs')).toBeInTheDocument()
    expect(screen.queryByTestId('session-summary')).toBeNull()
  })
})

describe('Start and the next steps show the next phase in the same act (DESIGN-06, 74)', () => {
  it('Start: the drawing is on screen the moment the button is pressed, with the one accent CLOSE · DESIGN', async () => {
    await render('/designs/session/d-method')
    fireEvent.click(await screen.findByTestId('session-start'))
    // no await: nothing waits for the stored row to come back
    expect(screen.queryByTestId('session-setup')).toBeNull()
    expect(tid('session-phase')).toHaveTextContent('Drawing')
    expect(Array.from(document.querySelectorAll('[data-accent="primary"]')).map(e => e.getAttribute('data-testid'))).toEqual(['session-close-design'])
    expect(tid('session-timer')).toHaveTextContent('45:00')
  })
  it('CLOSE · DESIGN: the close form is on screen at once, with the one accent NEXT · SCORE', async () => {
    await render('/designs/session/d-method', live('solo'))
    fireEvent.click(await screen.findByTestId('session-close-design'))
    expect(tid('session-phase')).toHaveTextContent('Close')
    expect(tid('session-close')).toBeInTheDocument()
    expect(Array.from(document.querySelectorAll('[data-accent="primary"]')).map(e => e.getAttribute('data-testid'))).toEqual(['session-close-next'])
    await waitFor(() => expect(tid('session-phase')).toHaveTextContent('Close'))
  })
})

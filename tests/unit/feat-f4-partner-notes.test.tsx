import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import legacy from '../fixtures/design-session.legacy-interviewer.json'
import { enterScore, lockDesignSession, savePartner, startDesignSession } from '../../src/data/designSessionActions'
import type { CloseAnswers, DesignSession } from '../../src/data/types'
import { resetNow, setNow } from '../../src/lib/clock'
import type { PlanDesignRef } from '../../src/rules/designs'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { PartnerCard } from '../../src/screens/designSession/partner/PartnerCard'
import { seededDb } from '../helpers/db'
import { flatPlanProse, flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-13T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const CLOSE: CloseAnswers = {
  tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: 'DDIA',
}
const tid = (id: string) => screen.getByTestId(id)

const ITEM = { id: 'd-method', title: 'Design a photo editor', difficulty: 'M', deepDives: ['dive a', 'dive b', 'dive c', 'dive d'], refs: [], tier: 1, tierName: '', tierLabel: '', tierShort: '', order: 0 } as PlanDesignRef
const SESSION = { ...(legacy as unknown as DesignSession), mode: 'human-partner', phase: 'drawing', partner: {} } as DesignSession
const card = (over: Partial<DesignSession> = {}, props: { readOnly?: boolean; onSave?: (p: unknown) => Promise<void> } = {}) =>
  render(<PartnerCard item={ITEM} session={{ ...SESSION, ...over }} readOnly={props.readOnly} onSave={(props.onSave ?? (async () => {})) as never} />)

describe('F4 savePartner stores notes', () => {
  it('stores notes with the name and scores, keeps at once, and an empty note is valid', async () => {
    const d = await seededDb()
    const h = await startDesignSession(d, { designId: 'd-method', mode: 'human-partner', deepDives: DIVES, nowMs: T })
    expect(await savePartner(d, h.id, { name: 'Sam', notes: 'Asked about scale first.' }, T + 5)).toBe(true)
    expect((await d.designSessions.get(h.id))!.partner).toEqual({ name: 'Sam', at: T + 5, notes: 'Asked about scale first.' })
    expect(await savePartner(d, h.id, { notes: '' }, T + 9)).toBe(true)
    expect((await d.designSessions.get(h.id))!.partner).toEqual({ name: 'Sam', at: T + 5, notes: '' })
  })
  it('refuses notes for a solo session, and caps them at 2000 characters', async () => {
    const d = await seededDb()
    const solo = await startDesignSession(d, { designId: 'd-estimate', mode: 'solo', deepDives: DIVES, nowMs: T })
    expect(await savePartner(d, solo.id, { notes: 'x' }, T)).toBe(false)
    const h = await startDesignSession(d, { designId: 'd-method', mode: 'human-partner', deepDives: DIVES, nowMs: T })
    await savePartner(d, h.id, { notes: 'y'.repeat(2500) }, T)
    expect((await d.designSessions.get(h.id))!.partner!.notes).toHaveLength(2000)
  })
})

describe('F4 partner card notes box', () => {
  it('shows Your notes below the scoring sheet with a counter and the hint, empty at first', () => {
    card()
    const ta = tid('partner-notes') as HTMLTextAreaElement
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta.value).toBe('')
    expect(ta).toHaveAttribute('maxlength', '2000')
    expect(ta).toHaveAttribute('data-content', 'learner')
    expect(tid('partner-notes-counter')).toHaveTextContent('0 / 2000')
    expect(screen.getByText('Your notes')).toBeInTheDocument()
    expect(document.body.textContent).toContain('Your scores and notes reach the host when you save. No AI speaks in this mode.')
    const sheet = screen.getByRole('form', { name: 'Scoring sheet' })
    expect(sheet.compareDocumentPosition(ta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('starts from the stored notes and counts characters', () => {
    card({ partner: { notes: 'hello' } })
    expect(tid('partner-notes')).toHaveValue('hello')
    expect(tid('partner-notes-counter')).toHaveTextContent('5 / 2000')
  })
  it('typing more than 2000 characters leaves exactly 2000 and the counter reads 2000 / 2000', () => {
    card()
    fireEvent.change(tid('partner-notes'), { target: { value: 'z'.repeat(2500) } })
    expect((tid('partner-notes') as HTMLTextAreaElement).value).toHaveLength(2000)
    expect(tid('partner-notes-counter')).toHaveTextContent('2000 / 2000')
  })
  it('a finished session still shows the saved note and the counter', () => {
    card({ phase: 'done', partner: { notes: 'kept' } })
    expect(tid('partner-notes')).toHaveValue('kept')
    expect(tid('partner-notes-counter')).toHaveTextContent('4 / 2000')
  })
  it('typing a note alone sets Unsaved changes and Save hands the notes over with the scores', async () => {
    const onSave = vi.fn(async () => {})
    card({}, { onSave })
    fireEvent.change(tid('partner-notes'), { target: { value: 'Went quiet on layers.' } })
    expect(tid('partner-status')).toHaveTextContent('Unsaved changes')
    expect(tid('partner-notes-counter')).toHaveTextContent('21 / 2000')
    expect(tid('partner-save')).toBeEnabled()
    fireEvent.click(tid('partner-save'))
    await waitFor(() => expect(tid('partner-status')).toHaveTextContent('Saved'))
    expect(onSave).toHaveBeenCalledWith({ name: '', notes: 'Went quiet on layers.', scores: { perItem: [null, null, null, null, null], deepDives: [null, null, null, null] } })
  })
  it('an empty note stays out of the payload when nothing was stored, and is sent as empty to clear a stored one', async () => {
    const a = vi.fn(async (_p: unknown) => {})
    const first = card({}, { onSave: a })
    fireEvent.click(tid('partner-save'))
    await waitFor(() => expect(a).toHaveBeenCalled())
    expect(a.mock.calls[0]![0]).not.toHaveProperty('notes')
    first.unmount()
    const b = vi.fn(async (_p: unknown) => {})
    card({ partner: { notes: 'old' } }, { onSave: b })
    fireEvent.change(tid('partner-notes'), { target: { value: '' } })
    fireEvent.click(tid('partner-save'))
    await waitFor(() => expect(b).toHaveBeenCalled())
    expect(b.mock.calls[0]![0]).toMatchObject({ notes: '' })
  })
  it('a finished session or a read-only browser disables the box', () => {
    const a = card({ phase: 'done' })
    expect(tid('partner-notes')).toBeDisabled()
    a.unmount()
    card({}, { readOnly: true })
    expect(tid('partner-notes')).toBeDisabled()
  })
  it('keeps one accent on the card and says no banned word', () => {
    card()
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/interview/i)
  })
})

async function scorePhase(partner: DesignSession['partner']) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'human-partner', deepDives: DIVES, nowMs: T - 12 * MIN })
  await savePartner(d, s.id, { name: 'Sam', ...partner }, T - 6 * MIN)
  await lockDesignSession(d, s.id, T)
  await enterScore(d, s.id, { ...CLOSE, couldNotAnswer: 'none' })
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await screen.findByTestId('session-score')
  return d
}

describe('F4 host sees the notes read-only', () => {
  afterEach(() => { localStorage.clear(); resetNow() })

  it('score phase: session-partner-notes shows the text after the prefilled line, with no input', async () => {
    await scorePhase({ notes: 'Asked about scale.\nNo sums for reads.', scores: { perItem: [3, 3, 3, 3, 2], deepDives: [2, 1, 2, null] } })
    const box = tid('session-partner-notes')
    const text = tid('session-partner-notes-text')
    expect(box).toHaveTextContent("Your partner's notes")
    expect(box).toContainElement(text)
    expect(text).toHaveTextContent('Asked about scale.')
    expect(text).toHaveTextContent('No sums for reads.')
    expect(text.tagName).toBe('BLOCKQUOTE')
    expect(text).not.toHaveTextContent("Your partner's notes")
    expect(box.querySelector('input, textarea')).toBeNull()
    expect(text).toHaveAttribute('data-content', 'learner')
    expect(tid('session-score-prefilled').compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('score phase: absent when the notes are empty or missing', async () => {
    await scorePhase({ notes: '   ', scores: { perItem: [3, 3, 3, 3, 2], deepDives: [2, 1, 2, null] } })
    expect(screen.queryByTestId('session-partner-notes')).toBeNull()
  })
  it('done view: Your partner\'s notes sit in the scored grade, and are absent when empty', async () => {
    const base = {
      id: 'ds-1', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12,
      mode: 'human-partner', view: '2d', canvas: { layout: 'manual', nodes: [], links: [], zones: [], flows: [] },
      close: CLOSE, deepDives: DIVES.map((q, i) => ({ q, answered: ([2, 1, 2, 0] as const)[i] })),
      tradeoffs: [CLOSE.tradeoff, CLOSE.tradeoff], rubric: 14, rubricBy: 'partner', lenses: {},
    }
    setNow(() => T)
    const d = await seededDb()
    await d.designSessions.add({ ...base, partner: { name: 'Sam', at: T - 10 * MIN, notes: 'Quiet on layers.', scores: { perItem: [4, 3, 3, 2, 2], deepDives: [2, 1, 2, 0] } } } as DesignSession)
    const view = renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
    const grade = await screen.findByTestId('session-grade')
    const notes = tid('session-partner-notes')
    expect(grade).toContainElement(notes)
    expect(notes).toHaveTextContent("Your partner's notes")
    expect(tid('session-partner-notes-text').tagName).toBe('BLOCKQUOTE')
    expect(notes).toContainElement(tid('session-partner-notes-text'))
    expect(tid('session-partner-notes-text')).toHaveTextContent(/^Quiet on layers\.$/)
    view.unmount()
    await d.designSessions.update('ds-1', { 'partner.notes': '' })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
    await screen.findByTestId('session-grade')
    expect(screen.queryByTestId('session-partner-notes')).toBeNull()
  })
})

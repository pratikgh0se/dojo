import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import legacy from '../fixtures/design-session.legacy-interviewer.json'
import { enterScore, lockDesignSession, savePartner, startDesignSession } from '../../src/data/designSessionActions'
import type { DesignSession } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { PartnerWindow } from '../../src/screens/designSession/partner/PartnerWindow'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const CLOSE = { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 'none' as const, readNext: 'z' }
const BANNED = /\binterview|\bSpar\b|\bRetreat\b|Dig in|Load check|Slid in|Shift plan/i
const GUILT = /overdue|\bmissed (a |an |\d+ )?(days?|sessions?)\b|\bbehind\b|streak (lost|broken)|you didn['’]?t|days? (since|without)/i
const ROUTE = { route: '/designs/session/d-method', path: '/designs/session/:designId' }

/** Visible text outside plan or learner content, plus the text of accessible attributes. */
function visible(): string {
  const parts: string[] = []
  const walk = (el: Element) => {
    if (el.closest('[data-content]')) return
    // data-content-label: the element's own aria-label / title is plan text (a deep-dive name); its children are still app copy
    const planLabel = el.hasAttribute('data-content-label')
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) { const v = el.getAttribute(a); if (v && !(planLabel && (a === 'aria-label' || a === 'title'))) parts.push(v) }
    for (const n of el.childNodes) { if (n.nodeType === 3) parts.push(n.textContent ?? ''); else if (n.nodeType === 1) walk(n as Element) }
  }
  walk(document.body)
  return parts.join(' ')
}
const expectClean = (where: string) => {
  const t = visible()
  expect(t, `${where}: banned`).not.toMatch(BANNED)
  expect(t, `${where}: guilt`).not.toMatch(GUILT)
}
afterEach(() => localStorage.clear())

async function open(mode: 'solo' | 'ai-partner' | 'human-partner', phase: 'drawing' | 'close' | 'score') {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - 12 * MIN })
  if (mode === 'human-partner') await savePartner(d, s.id, { name: 'Sam', scores: { perItem: [3, 3, 3, 3, 2], deepDives: [2, 1, 2, 1] } }, T)
  if (phase !== 'drawing') await lockDesignSession(d, s.id, T)
  if (phase === 'score') await enterScore(d, s.id, CLOSE)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, ...ROUTE })
  await screen.findByTestId(phase === 'drawing' ? 'session-tabs' : phase === 'close' ? 'session-close' : 'session-score')
  return { d, id: s.id }
}

/** A finished session shown through ?session=<id>, with a redesign due, in the given mode. */
async function done(mode: 'solo' | 'ai-partner' | 'human-partner') {
  setNow(() => T)
  const d = await seededDb()
  const row = {
    id: 'ds-done', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12, mode, view: '2d',
    canvas: { layout: 'manual', nodes: [{ id: 'gateway-1', kind: 'gateway', label: 'Gateway 1', x: 1, y: 1 }, { id: 'sql-1', kind: 'sql', label: 'Sql 1', x: 7, y: 1 }], links: [{ from: 'gateway-1', to: 'sql-1', kind: 'write' }], zones: [], flows: [] },
    close: CLOSE, deepDives: [2, 1, 2, 0].map((answered, i) => ({ q: DIVES[i], answered })),
    tradeoffs: [{ chose: 'a', over: 'b', because: 'c' }], rubric: 12, rubricBy: mode === 'human-partner' ? 'partner' : 'self',
    lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 }, redesignDue: new Date('2026-11-10T00:00:00+05:30').getTime(),
    ...(mode === 'human-partner' ? { partner: { name: 'Sam', scores: { perItem: [3, 3, 3, 3, 2], deepDives: [2, 1, 2, 1] } } } : {}),
  } as unknown as DesignSession
  await d.designSessions.add(row)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-done', path: '/designs/session/:designId' })
  await screen.findByTestId('session-summary')
  return d
}

describe('GLOBAL-01 and 02 on the design session (DESIGN-08)', () => {
  it('setup', async () => {
    setNow(() => T)
    const d = await seededDb()
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, ...ROUTE })
    await screen.findByTestId('session-setup')
    expectClean('setup')
  })

  it.each(['solo', 'ai-partner', 'human-partner'] as const)('drawing, %s', async mode => {
    await open(mode, 'drawing')
    // the Notes and Deep dives tabs are always there; the Partner tab only when there is a partner
    for (const tab of ['notes', 'dives', 'partner']) {
      const el = screen.queryByTestId(`session-tab-${tab}`)
      if (tab === 'partner' && mode === 'solo') { expect(el, 'solo has no partner tab').toBeNull(); continue }
      expect(el, `drawing ${mode}: tab ${tab} exists`).not.toBeNull()
      fireEvent.click(el!)
      expectClean(`drawing ${mode} tab ${tab}`)
    }
    if (mode === 'ai-partner') {
      fireEvent.click(screen.getByTestId('session-tab-partner'))
      await waitFor(() => expect(screen.getAllByTestId('session-msg').length).toBe(1))
      expectClean('ai partner opening message')
      fireEvent.click(screen.getByTestId('session-hint'))
      await waitFor(() => expect(screen.getAllByTestId('session-msg').length).toBeGreaterThan(1))
      expectClean('ai partner hint')
      for (let i = 0; i < 6; i++) {
        const before = screen.getAllByTestId('session-msg').length
        fireEvent.change(screen.getByTestId('session-chat-input'), { target: { value: 'I would shard by user id and cache hot keys.' } })
        fireEvent.click(screen.getByTestId('session-send'))
        await waitFor(() => expect(screen.getAllByTestId('session-msg').length).toBeGreaterThanOrEqual(before + 2))
        expectClean(`ai partner turn ${i + 1}`)
      }
    }
    if (mode === 'human-partner') {
      fireEvent.click(screen.getByTestId('session-tab-partner'))
      fireEvent.click(screen.getByTestId('partner-toggle'))
      await screen.findByTestId('partner-card')
    }
    fireEvent.click(screen.getByTestId('kit-add-custom'))
    expectClean(`drawing ${mode}`)
  })

  it.each(['close', 'score'] as const)('%s', async phase => {
    await open('ai-partner', phase)
    if (phase === 'score') await screen.findByTestId('session-grade')
    expectClean(phase)
  })

  it.each(['close', 'score'] as const)('the human-partner %s phase', async phase => {
    await open('human-partner', phase)
    expectClean(`human ${phase}`)
  })

  it.each(['drawing', 'close', 'score'] as const)('the discard dialog open in the %s phase', async phase => {
    await open('solo', phase)
    fireEvent.click(screen.getByTestId('session-discard'))
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByRole('button', { name: /discard/i })).toBeInTheDocument()
    expectClean(`discard dialog ${phase}`)
  })

  it('the partner card window, its missing state, and the keys overlay', async () => {
    const { d, id } = await open('human-partner', 'drawing')
    expectClean('human drawing')
    fireEvent.keyDown(screen.getByTestId('kit-canvas'), { key: '?' })
    await screen.findByTestId('session-keys')
    expectClean('keys overlay')
    const { unmount } = renderWithApp(<PartnerWindow sessionId={id} readOnly={false} />, { db: d, plan: flatPlanV2 })
    await screen.findAllByTestId('partner-card')
    expectClean('partner window')
    unmount()
    const ro = renderWithApp(<PartnerWindow sessionId={id} readOnly />, { db: d, plan: flatPlanV2 })
    await screen.findAllByTestId('partner-card')
    expectClean('partner window, read only')
    ro.unmount()
    renderWithApp(<PartnerWindow sessionId="ds-nope" readOnly={false} />, { db: d, plan: flatPlanV2 })
    await screen.findByTestId('partner-missing')
    expectClean('partner window, missing')
  })

  it.each(['ai-partner', 'human-partner', 'solo'] as const)('a finished %s session, with REDO · DESIGN', async mode => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '0')
    await done(mode)
    expect(screen.getByTestId('session-redesign')).toHaveTextContent('REDO · DESIGN')
    expectClean(`done (${mode}) loading`)
    if (mode !== 'human-partner') await waitFor(() => expect(screen.queryByTestId('session-reference-loading')).toBeNull(), { timeout: 3000 })
    expectClean(`done (${mode})`)
  })

  it('the guilt and banned patterns catch what they should (straight and curly apostrophes, counted days)', () => {
    for (const bad of ["you didn't", 'you didn’t', 'you didnt', 'missed 3 days', 'missed a day', 'missed 2 sessions', 'overdue', 'days since', 'streak lost']) expect(bad, bad).toMatch(GUILT)
    for (const ok of ['Redesign due 2026-11-10', 'Saved', 'Session not found']) expect(ok, ok).not.toMatch(GUILT)
  })

  it('a plan-owned deep-dive name in an aria-label is not scanned (the partner card), app copy beside it still is', async () => {
    setNow(() => T)
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'human-partner', deepDives: ['Handle overdue retries', 'Who is behind the cache', 'Three', 'Four'], nowMs: T - 12 * MIN })
    renderWithApp(<PartnerWindow sessionId={s.id} readOnly={false} />, { db: d, plan: flatPlanV2 })
    await screen.findAllByTestId('partner-card')
    expect(screen.getByRole('radiogroup', { name: 'Handle overdue retries' })).toBeInTheDocument() // the plan text is really in an aria-label
    expectClean('partner card with plan text that looks like guilt copy')
  })

  it.each([['interview', 'the AI partner turn'], ['grade', 'the grade'], ['diagram', 'the reference']] as const)('a failing %s call: the error and Retry copy are clean (%s)', async (job, _what) => {
    localStorage.setItem('dojo-ai-fake-fail', job)
    if (job === 'interview') {
      await open('ai-partner', 'drawing')
      fireEvent.click(screen.getByTestId('session-tab-partner'))
    } else if (job === 'grade') {
      await open('ai-partner', 'score')
    } else {
      await done('ai-partner')
    }
    const err = await screen.findByTestId('session-ai-error')
    expect(within(err).getByTestId('ai-retry')).toBeInTheDocument()
    expect(err.textContent).toMatch(/\S/)
    expectClean(`failing ${job}`)
  })

  it('a finished legacy session', async () => {
    setNow(() => T)
    const d = await seededDb()
    await d.designSessions.put({ ...(legacy as unknown as DesignSession), designId: 'd-method' })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-legacy-1', path: '/designs/session/:designId' })
    await screen.findByTestId('session-summary')
    expectClean('done (legacy)')
  })
})

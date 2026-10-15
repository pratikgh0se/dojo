import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { clearStudy, loadStudy, saveStudy } from '../../src/lib/studyStore'
import { loadTimer } from '../../src/lib/timer'
import { startStudy } from '../../src/rules/studySession'
import { sessionLengthText } from '../../src/rules/sessionLength'
import { pauseStudy } from '../../src/rules/studySession'
import { beginStudy, closeStudyOnCheckPass, finishStudy, runTick } from '../../src/study/runner'
import { SessionPill } from '../../src/study/SessionPill'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'

const MIN = 60_000
const fx = () => ({ chime: vi.fn(), toast: vi.fn(), onError: vi.fn() })

describe('a single-block session in the runner', () => {
  it('ticks once to over: block credited, timer stopped at 00:00, nothing more happens', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = (await d.tickets.toArray()).find(t => t.status === 'todo' && t.kind !== 'design')!
    const t0 = Date.now()
    expect(await beginStudy({ d, ticket, plan: { goal: '', focusMin: 25, breakMin: 5, cardIds: [ticket.id], chime: false, single: true }, nowMs: t0, ...fx() })).toBe(true)
    expect(loadStudy()).toMatchObject({ single: true })
    await runTick(d, t0 + 25 * MIN, fx())
    expect(loadStudy()).toMatchObject({ over: true, blocks: 1, phase: 'focus' })
    expect(loadTimer()).toMatchObject({ running: false, notified: true })
    expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1)
    await runTick(d, t0 + 90 * MIN, fx())
    expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1)
    clearStudy()
  })
})

describe('a single session ended before its block runs out records the minutes actually focused', () => {
  async function begin() {
    clearStudy()
    const d = await seededDb()
    const ticket = (await d.tickets.toArray()).find(t => t.status === 'todo' && t.kind !== 'design')!
    const t0 = Date.now()
    await beginStudy({ d, ticket, plan: { goal: '', focusMin: 25, breakMin: 5, cardIds: [ticket.id], chime: false, single: true }, nowMs: t0, ...fx() })
    return { d, ticket, t0 }
  }

  it('an early Done (check pass) says the minutes, not zero focus blocks', async () => {
    const { d, ticket, t0 } = await begin()
    const f = fx()
    expect(await closeStudyOnCheckPass({ d, ticketId: ticket.id, nowMs: t0 + 7 * MIN, ...f })).toBe(true)
    const row = (await d.sessions.toArray()).find(r => r.ticketId === ticket.id)!
    expect(row.focusMinutes).toBe(7)
    expect(sessionLengthText(row)).toContain('7 min focus')
    expect(f.toast).toHaveBeenCalledWith('Session ended · 7 min focus')
    expect(loadStudy()).toBeNull()
  })

  it('End session records the minutes so far, minus a pause, and never more than the block', async () => {
    const { d, ticket, t0 } = await begin()
    saveStudy(pauseStudy(loadStudy()!, t0 + 5 * MIN)) // 5 min focused, then paused
    expect(await finishStudy({ d, log: {}, nowMs: t0 + 40 * MIN, ...fx() })).toBe(true)
    expect((await d.sessions.toArray()).find(r => r.ticketId === ticket.id)!.focusMinutes).toBe(5)
    const second = await begin()
    expect(await finishStudy({ d: second.d, log: {}, nowMs: second.t0 + 90 * MIN, ...fx() })).toBe(true)
    expect((await second.d.sessions.toArray()).find(r => r.ticketId === second.ticket.id)!.focusMinutes).toBe(25)
  })
})

describe('the session pill once the time is up', () => {
  it('reads 00:00 and offers no Pause or Resume', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = (await d.tickets.toArray())[0]
    const base = startStudy({ id: 's', ticketId: ticket.id, goal: '', cardIds: [ticket.id], focusMin: 25, breakMin: 5, chime: false, now: Date.now() - 30 * MIN, single: true })
    saveStudy({ ...base, blocks: 1, over: true })
    render(
      <MemoryRouter><AppProviders db={d} plan={flatPlanV2}><SessionPill /></AppProviders></MemoryRouter>,
    )
    expect((await screen.findByTestId('session-pill-time')).textContent).toBe('00:00')
    expect(screen.queryByTestId('session-pill-pause')).toBeNull()
    expect(screen.queryByTestId('session-pill-resume')).toBeNull()
    clearStudy()
  })
})

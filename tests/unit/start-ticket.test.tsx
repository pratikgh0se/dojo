import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { patchSettings } from '../../src/data/db'
import type { Ticket } from '../../src/data/types'
import { clearStudy, loadStudy, saveStudy } from '../../src/lib/studyStore'
import { loadTimer } from '../../src/lib/timer'
import { advance, startStudy } from '../../src/rules/studySession'
import { onEndRequest } from '../../src/study/controls'
import { useCompleteTicket } from '../../src/study/useCompleteTicket'
import { sessionRouteFor, useStartTicket } from '../../src/study/useStartTicket'
import { seedBrief } from '../helpers/briefs'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const ladder = vi.hoisted(() => ({ failClose: false }))
vi.mock('../../src/data/ladderActions', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/data/ladderActions')>()
  return { ...real, closeLadderSession: (...a: Parameters<typeof real.closeLadderSession>) => { if (ladder.failClose) throw new Error('disk full'); return real.closeLadderSession(...a) } }
})

function Harness({ ticket }: { ticket: Ticket }) {
  const start = useStartTicket()
  const complete = useCompleteTicket()
  return (
    <>
      <button onClick={() => void start(ticket)}>start</button>
      <button onClick={() => void complete(ticket)}>done</button>
    </>
  )
}

async function setup(sessionMinutes?: number, pick?: (t: Ticket) => boolean) {
  clearStudy()
  const d = await seededDb()
  if (sessionMinutes) await patchSettings(d, { sessionMinutes })
  const ticket = (await d.tickets.toArray()).find(pick ?? (t => t.status === 'todo' && t.kind !== 'design'))!
  renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
  return { d, ticket }
}

describe('useStartTicket', () => {
  it('starts one single-block session at the remembered length, marks the ticket doing and opens it', async () => {
    const { d, ticket } = await setup(40)
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ticket.id}`))
    expect(loadStudy()).toMatchObject({ ticketId: ticket.id, single: true, focusMin: 40, phase: 'focus' })
    expect((await d.tickets.get(ticket.id))!.status).toBe('doing')
    expect((await d.tickets.get(ticket.id))!.order).toBe(ticket.order)
    clearStudy()
  })

  it('starting another ticket while a session runs on one saves that session quietly and begins the new one (PATH-18, TICKET-08)', async () => {
    const { d, ticket } = await setup()
    const other = (await d.tickets.toArray()).find(t => t.id !== ticket.id && t.kind !== 'design')!
    saveStudy(startStudy({ id: 'x', ticketId: other.id, goal: '', cardIds: [other.id], focusMin: 25, breakMin: 5, chime: false, now: Date.now() - 5 * 60_000, single: true }))
    let asked = 0
    const off = onEndRequest(() => { asked += 1 })
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ticket.id}`))
    off()
    expect(asked).toBe(0)
    expect(loadStudy()).toMatchObject({ ticketId: ticket.id, single: true })
    expect((await d.tickets.get(ticket.id))!.status).toBe('doing')
    expect((await d.sessions.toArray()).filter(s => s.id === 's-x')).toHaveLength(1)
    clearStudy()
  })

  it('does the same while the other ticket session is paused', async () => {
    const { d, ticket } = await setup()
    const other = (await d.tickets.toArray()).find(t => t.id !== ticket.id && t.kind !== 'design')!
    const base = startStudy({ id: 'x', ticketId: other.id, goal: '', cardIds: [other.id], focusMin: 25, breakMin: 5, chime: false, now: Date.now(), single: true })
    saveStudy({ ...base, paused: 10 * 60_000 })
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ticket.id}`))
    expect(loadStudy()).toMatchObject({ ticketId: ticket.id })
    expect((await d.sessions.toArray()).filter(s => s.id === 's-x')).toHaveLength(1)
    clearStudy()
  })

  it('ends a session whose time is up silently and starts the new ticket (PATH-18)', async () => {
    const { d, ticket } = await setup()
    const other = (await d.tickets.toArray()).find(t => t.id !== ticket.id && t.kind !== 'design')!
    const old = startStudy({ id: 'x', ticketId: other.id, goal: '', cardIds: [other.id], focusMin: 25, breakMin: 5, chime: false, now: Date.now() - 30 * 60_000, single: true })
    saveStudy(advance(old, Date.now()).study)
    expect(loadStudy()!.over).toBe(true)
    let asked = 0
    const off = onEndRequest(() => { asked += 1 })
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ticket.id}`))
    off()
    expect(asked).toBe(0)
    expect(loadStudy()).toMatchObject({ ticketId: ticket.id, single: true })
    expect((await d.tickets.get(ticket.id))!.status).toBe('doing')
    expect((await d.sessions.toArray()).filter(s => s.id === 's-x')).toHaveLength(1)
    clearStudy()
  })

  it('saves an away session on another ticket quietly and starts the new ticket', async () => {
    const { d, ticket } = await setup()
    const other = (await d.tickets.toArray()).find(t => t.id !== ticket.id && t.kind !== 'design')!
    const base = startStudy({ id: 'aw', ticketId: other.id, goal: '', cardIds: [other.id], focusMin: 25, breakMin: 5, chime: false, now: Date.now() - 60 * 60_000 })
    saveStudy({ ...base, away: Date.now() - 30 * 60_000 })
    let asked = 0
    const off = onEndRequest(() => { asked += 1 })
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ticket.id}`))
    off()
    expect(asked).toBe(0)
    expect(loadStudy()).toMatchObject({ ticketId: ticket.id, single: true })
    expect((await d.tickets.get(ticket.id))!.status).toBe('doing')
    expect((await d.sessions.toArray()).filter(r => r.id === 's-aw')).toHaveLength(1)
    clearStudy()
  })

  it('two quick clicks start one session: the second call does nothing while the first is writing', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = mkTicket({ id: 'dbl-1', kind: 'task', status: 'doing' }) // already doing, so the only guard is the in-flight one
    await d.tickets.put(ticket)
    const results: boolean[] = []
    function Twice() {
      const start = useStartTicket()
      return <button onClick={() => { void start(ticket).then(r => results.push(r)); void start(ticket).then(r => results.push(r)) }}>twice</button>
    }
    renderWithApp(<Twice />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('twice'))
    await waitFor(() => expect(results).toHaveLength(2))
    expect([...results].sort()).toEqual([false, true])
    expect(loadStudy()).toMatchObject({ ticketId: ticket.id, single: true })
    clearStudy()
  })

  it('just opens the ticket when its own session is already running', async () => {
    const { ticket } = await setup()
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ticket.id}`))
    const id = loadStudy()!.id
    fireEvent.click(screen.getByText('start'))
    expect(loadStudy()!.id).toBe(id)
    clearStudy()
  })

  it('marks a design ticket doing and opens its design session, with no study session (SKILLS-17, TICKET-27)', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = mkTicket({ id: 'dz-1', kind: 'design', status: 'todo', order: 7 })
    await d.tickets.put(ticket)
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/designs/session/dz-1'))
    await waitFor(async () => expect((await d.tickets.get('dz-1'))!.status).toBe('doing'))
    expect((await d.tickets.get('dz-1'))!.order).toBe(7)
    expect(loadStudy()).toBeNull()
  })

  it('opens a write-up ticket the same way', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = mkTicket({ id: 'wu-1', kind: 'writeup', status: 'todo' })
    await d.tickets.put(ticket)
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/designs/session/wu-1'))
    await waitFor(async () => expect((await d.tickets.get('wu-1'))!.status).toBe('doing'))
  })

  it('routes by kind', () => {
    expect(sessionRouteFor({ id: 'a', kind: 'design' })).toBe('/designs/session/a')
    expect(sessionRouteFor({ id: 'a', kind: 'writeup' })).toBe('/designs/session/a')
    expect(sessionRouteFor({ id: 'a', kind: 'watch' })).toBe('/do/a')
  })
})

describe('useCompleteTicket', () => {
  it('marks the ticket done once, writes one session and ends the running session', async () => {
    const { d, ticket } = await setup()
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(loadStudy()).not.toBeNull())
    fireEvent.click(screen.getByText('done'))
    await waitFor(async () => expect((await d.tickets.get(ticket.id))!.status).toBe('done'))
    await waitFor(() => expect(loadStudy()).toBeNull())
    const after = (await d.tickets.get(ticket.id))!
    expect(after.xp).toBeGreaterThan(0)
    expect(after.order).toBe(ticket.order)
    expect((await d.sessions.toArray()).filter(s => s.ticketId === ticket.id)).toHaveLength(1)
  })

  it('completes a watch ticket that carries a stored brief (TICKET-16: no check_required gate)', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = mkTicket({ id: 'w-1', kind: 'watch', status: 'todo' })
    await d.tickets.put(ticket)
    await seedBrief(d, 'w-1')
    const t = (await d.tickets.get('w-1'))!
    renderWithApp(<Harness ticket={t} />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(loadStudy()).not.toBeNull())
    fireEvent.click(screen.getByText('done'))
    await waitFor(async () => expect((await d.tickets.get('w-1'))!.status).toBe('done'))
    await waitFor(() => expect(loadStudy()).toBeNull())
    expect((await d.sessions.toArray()).filter(s => s.ticketId === 'w-1')).toHaveLength(1)
  })

  it('Done on an unstarted ritual ticket writes exactly one session row; a second Done adds none', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = mkTicket({ id: 'rt-1', kind: 'ritual', lane: 'ritual', status: 'todo' })
    await d.tickets.put(ticket)
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('done'))
    await waitFor(async () => expect((await d.tickets.get('rt-1'))!.status).toBe('done'))
    const rows = async () => (await d.sessions.toArray()).filter(r => r.ticketId === 'rt-1')
    await waitFor(async () => expect(await rows()).toHaveLength(1))
    expect((await rows())[0]).toMatchObject({ outcome: 'solved', xpDelta: (await d.tickets.get('rt-1'))!.xp })
    fireEvent.click(screen.getByText('done'))
    await new Promise(r => setTimeout(r, 50))
    expect(await rows()).toHaveLength(1)
  })

  it('Done on a doing ticket with no stored session writes exactly one session row; a second Done adds none', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = mkTicket({ id: 'dg-1', kind: 'task', status: 'doing' })
    await d.tickets.put(ticket)
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    expect(loadStudy()).toBeNull()
    fireEvent.click(screen.getByText('done'))
    await waitFor(async () => expect((await d.tickets.get('dg-1'))!.status).toBe('done'))
    const rows = async () => (await d.sessions.toArray()).filter(r => r.ticketId === 'dg-1')
    await waitFor(async () => expect(await rows()).toHaveLength(1))
    fireEvent.click(screen.getByText('done'))
    await new Promise(r => setTimeout(r, 50))
    expect(await rows()).toHaveLength(1)
  })

  it('rolls the move back and toasts when the session row cannot be written (ticket stays doing)', async () => {
    clearStudy()
    const d = await seededDb()
    const ticket = mkTicket({ id: 'fail-1', kind: 'task', status: 'doing' })
    await d.tickets.put(ticket)
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    ladder.failClose = true
    try {
      fireEvent.click(screen.getByText('done'))
      expect(await screen.findByText('disk full')).toBeInTheDocument()
      expect((await d.tickets.get('fail-1'))!.status).toBe('doing')
      expect((await d.sessions.toArray()).filter(r => r.ticketId === 'fail-1')).toHaveLength(0)
    } finally { ladder.failClose = false }
  })
})

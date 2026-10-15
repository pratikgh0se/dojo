import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { READ_ONLY_MESSAGE } from '../../src/data/writer'
import { loadStudy } from '../../src/lib/studyStore'
import { useCompleteTicket } from '../../src/study/useCompleteTicket'
import { useStartTicket } from '../../src/study/useStartTicket'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => true }))

describe('a read-only browser (Review Focus 4)', () => {
  it('starts nothing and writes nothing', async () => {
    const d = await seededDb()
    const ticket = (await d.tickets.toArray()).find(t => t.status === 'todo' && t.kind !== 'design')!
    function H() { const start = useStartTicket(); return <button onClick={() => void start(ticket)}>start</button> }
    renderWithApp(<H />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('start'))
    await new Promise(r => setTimeout(r, 50))
    expect(loadStudy()).toBeNull()
    expect((await d.tickets.get(ticket.id))!.status).toBe('todo')
  })
  it('opens a design ticket without marking it doing', async () => {
    const d = await seededDb()
    const ticket = mkTicket({ id: 'dz-1', kind: 'design', status: 'todo' })
    await d.tickets.put(ticket)
    function H() { const start = useStartTicket(); return <button onClick={() => void start(ticket)}>start</button> }
    renderWithApp(<H />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('start'))
    await new Promise(r => setTimeout(r, 50))
    expect((await d.tickets.get(ticket.id))!.status).toBe('todo')
    expect(screen.getByTestId('location')).not.toHaveTextContent('/designs/session')
  })
  it('Done writes nothing and says the browser is read-only', async () => {
    const d = await seededDb()
    const ticket = mkTicket({ id: 'dn-1', kind: 'task', status: 'doing' })
    await d.tickets.put(ticket)
    function H() { const done = useCompleteTicket(); return <button onClick={() => void done(ticket)}>done</button> }
    renderWithApp(<H />, { db: d, plan: flatPlanV2 })
    fireEvent.click(screen.getByText('done'))
    expect(await screen.findByText(READ_ONLY_MESSAGE)).toBeInTheDocument()
    expect((await d.tickets.get('dn-1'))!.status).toBe('doing')
    expect((await d.sessions.toArray()).filter(r => r.ticketId === 'dn-1')).toHaveLength(0)
  })
})

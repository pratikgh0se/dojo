import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { useTicket } from '../../src/data/hooks'
import { startDoing } from '../../src/data/sessionActions'
import { setNow } from '../../src/lib/clock'
import { TicketRow } from '../../src/ui/TicketRow'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00')

function LiveRow({ id }: { id: string }) {
  const t = useTicket(id)
  if (t === undefined) return null
  return <TicketRow ticket={t} title={t?.title ?? id} />
}

async function setup(id: string) {
  setNow(() => NOW)
  const d = await seededDb()
  renderWithApp(<LiveRow id={id} />, { db: d, plan: smallPlan })
  await screen.findByTestId(`row-${id}`)
  return d
}

const checked = (id: string) => screen.getByTestId(`tick-${id}`).getAttribute('aria-checked')

describe('TicketRow tick (Review Focus #2)', () => {
  it('writes the same ticket and event as the Board Done move, with toast', async () => {
    const d = await setup('p127')
    fireEvent.click(screen.getByTestId('tick-p127'))
    expect(await screen.findByText('+15 xp · Saved')).toBeInTheDocument()
    expect(document.documentElement.dataset.powerups).toBeDefined()
    await waitFor(() => expect(checked('p127')).toBe('true'))

    const ref = await seededDb()
    await moveTicket(ref, 'p127', 'done', NOW)
    expect(await d.tickets.get('p127')).toEqual(await ref.tickets.get('p127'))
    expect(await d.events.toArray()).toEqual(await ref.events.toArray())
    expect(await d.events.toArray()).toEqual([{ seq: 1, t: 'tick', id: 'p127', at: NOW, xp: 15 }])
  })

  it('unticks a done row: untick event, XP paid back, doneAt dropped', async () => {
    const d = await setup('p127')
    fireEvent.click(screen.getByTestId('tick-p127'))
    await waitFor(() => expect(checked('p127')).toBe('true'))
    fireEvent.click(screen.getByTestId('tick-p127'))
    await waitFor(() => expect(checked('p127')).toBe('false'))
    const t = (await d.tickets.get('p127'))!
    expect(t).toMatchObject({ status: 'todo', xp: 0 })
    expect(t.doneAt).toBeUndefined()
    expect((await d.events.toArray()).map(e => e.t)).toEqual(['tick', 'untick'])
  })

  it('ticks while Doing is full and never adds to Doing', async () => {
    const d = await setup('p127')
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await startDoing(d, id, NOW)
    fireEvent.click(screen.getByTestId('tick-p127'))
    await waitFor(() => expect(checked('p127')).toBe('true'))
    const doing = (await d.tickets.toArray()).filter(t => t.status === 'doing').map(t => t.id).sort()
    expect(doing).toEqual(['m1w1t1', 'm1w2t1', 'm1w3t1'])
  })

  it('ticking a Doing ticket done frees its Doing slot', async () => {
    const d = await setup('m1w1t1')
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await startDoing(d, id, NOW)
    fireEvent.click(screen.getByTestId('tick-m1w1t1'))
    await waitFor(() => expect(checked('m1w1t1')).toBe('true'))
    expect((await d.tickets.toArray()).filter(t => t.status === 'doing')).toHaveLength(2)
  })

  it('reflects a tick made elsewhere (live query)', async () => {
    const d = await setup('p127')
    await moveTicket(d, 'p127', 'done', NOW)
    await waitFor(() => expect(checked('p127')).toBe('true'))
  })

  it('shows S<sprint> · from S<n> for a slid ticket and links Do ▸', async () => {
    const d = await setup('p127')
    await d.tickets.update('p127', { sprint: 3, slidFrom: [1] })
    expect(await screen.findByText('S3 · from S1')).toBeInTheDocument()
    expect(screen.getByTestId('do-p127')).toHaveAttribute('href', '/do/p127')
  })

  it('renders a plan item without a ticket read-only', async () => {
    const d = await seededDb()
    renderWithApp(<TicketRow ticket={null} title="Ghost" />, { db: d, plan: smallPlan })
    expect(screen.getByTestId('row-readonly')).toHaveTextContent('Ghost')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

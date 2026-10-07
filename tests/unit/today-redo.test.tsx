import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DojoDB } from '../../src/data/db'
import type { Redo } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { Today } from '../../src/screens/Today'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const redo = (p: Partial<Redo>): Redo => ({
  id: 'r1', ticketId: 'p200', source: 'gave_up', createdAt: ist('2026-09-19T21:20:00'), stage: 0,
  due: ist('2026-09-22T21:20:00'), passed: [], helpCost: 10, refunded: 0, ...p,
})
async function today(at: string, seed: (d: DojoDB) => Promise<unknown>) {
  setNow(() => ist(at))
  const d = await seededDb()
  await seed(d)
  await d.sessions.put({ id: 's1', ticketId: 'p200', start: ist('2026-09-19T21:10:00'), end: ist('2026-09-19T21:20:00'), minutes: 10, outcome: 'gave_up', xpDelta: 0 })
  renderWithApp(<Today />, { db: d, plan: smallPlan, route: '/' })
  await screen.findByTestId('drawer-dsa')
}

describe('Today Redo drawer', () => {
  it('is absent when nothing is due', async () => {
    await today('2026-09-22T00:01:00', d => d.redos.put(redo({ due: ist('2026-09-23T09:00:00') })))
    expect(screen.queryByTestId('today-redo-drawer')).toBeNull()
  })

  it('H-25 sits between Left behind and DSA, collapsed, with the row text; the row opens Do', async () => {
    await today('2026-09-22T00:01:00', d => d.redos.put(redo({})))
    const drawer = await screen.findByTestId('today-redo-drawer')
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(screen.getByTestId('drawer-carry'), drawer)).toBe(true)
    expect(follows(drawer, screen.getByTestId('drawer-dsa'))).toBe(true)
    const toggle = screen.getByTestId('today-redo-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAccessibleName(/Redo · 1/)
    fireEvent.click(toggle)
    const row = screen.getByTestId('today-redo-row-p200')
    expect(row).toHaveAccessibleName('Redo Number of Islands')
    expect(row.textContent).toBe('Number of Islands · 3d since first try · +5 xp waiting')
    const describedById = row.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    expect(document.getElementById(describedById!)).toHaveTextContent('Number of Islands · 3d since first try · +5 xp waiting')
    fireEvent.click(row)
    expect(screen.getByTestId('location')).toHaveTextContent('/do/p200')
  })

  it('H-38 counts every due redo', async () => {
    await today('2026-09-22T00:01:00', d => d.redos.bulkPut([redo({ helpCost: 5 }), redo({ id: 'r2', ticketId: 'p127', helpCost: 5 })]))
    expect(await screen.findByTestId('today-redo-toggle')).toHaveAccessibleName(/Redo · 2/)
    fireEvent.click(screen.getByTestId('today-redo-toggle'))
    expect(screen.getByTestId('today-redo-row-p127').textContent).toMatch(/\+2 xp waiting$/)
  })

  it('C-INT §7 / I-26: a due redesign is a link `Redesign {title}` to the design session with the rubric text', async () => {
    await today('2026-10-11T00:01:00', async d => {
      await d.designSessions.put({
        id: 'ds1', designId: 'd-method', at: ist('2026-09-01T10:00:00'), phase: 'done', minutes: 45, mode: 'solo',
        view: '2d', canvas: { layout: 'layered', nodes: [], links: [], zones: [], flows: [] },
        close: { tradeoff: { chose: '', over: '', because: '' }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: 0, readNext: '' },
        deepDives: [], tradeoffs: [], rubric: 14, lenses: {}, redesignDue: ist('2026-10-01T00:00:00'),
      })
    })
    const toggle = await screen.findByTestId('today-redo-toggle')
    expect(toggle).toHaveAccessibleName(/Redo · 1/)
    fireEvent.click(toggle)
    expect(screen.queryByTestId('today-redo-row-d-method')).toBeNull()
    const row = screen.getByTestId('today-redo-design-d-method')
    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', '/designs/session/d-method')
    const title = 'The method, on a whiteboard, in 45 minutes'
    expect(row).toHaveAccessibleName(`Redesign ${title}`)
    expect(row.textContent).toBe(`${title} · redesign · previous rubric 14/20`)
    fireEvent.click(row)
    expect(screen.getByTestId('location')).toHaveTextContent('/designs/session/d-method')
  })

  it('C-INT §7 / I-27: a ticket redo and a due redesign both count, ticket rows first', async () => {
    await today('2026-10-11T00:01:00', async d => {
      await d.redos.put(redo({ due: ist('2026-10-10T09:00:00') }))
      await d.designSessions.put({
        id: 'ds1', designId: 'd-method', at: ist('2026-09-01T10:00:00'), phase: 'done', minutes: 45, mode: 'solo',
        view: '2d', canvas: { layout: 'layered', nodes: [], links: [], zones: [], flows: [] },
        close: { tradeoff: { chose: '', over: '', because: '' }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: 0, readNext: '' },
        deepDives: [], tradeoffs: [], rubric: 14, lenses: {}, redesignDue: ist('2026-10-01T00:00:00'),
      })
    })
    const toggle = await screen.findByTestId('today-redo-toggle')
    expect(toggle).toHaveAccessibleName(/Redo · 2/)
    fireEvent.click(toggle)
    const drawer = screen.getByTestId('today-redo-drawer')
    const ids = [...drawer.querySelectorAll('[data-testid^="today-redo-row-"], [data-testid^="today-redo-design-"]')].map(e => e.getAttribute('data-testid'))
    expect(ids).toEqual(['today-redo-row-p200', 'today-redo-design-d-method'])
  })
})

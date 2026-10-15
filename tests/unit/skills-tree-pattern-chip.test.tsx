import { fireEvent, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanArea, PlanNode } from '../../src/data/planV2'
import type { Ticket } from '../../src/data/types'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { Skills } from '../../src/screens/Skills'
import { freshDb } from '../helpers/db'
import { appPlans, AREAS, mkAiTickets, mkTicket, NODES } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

vi.mock('../../src/rules/atlasPattern', () => ({
  patternForProblem: (id: string) => (id === 'p4' || id === 'p5' ? { slug: id === 'p4' ? 'sliding-window' : 'two-pointers', label: id === 'p4' ? 'Sliding window' : 'Two pointers' } : null),
}))

const quest = vi.hoisted(() => ({ ticketId: 'ai.l3.learn' as string | null }))
vi.mock('../../src/data/flatHooks', () => ({
  useTodayModel: () => {
    const t = quest.ticketId ? { id: quest.ticketId, kind: 'watch', title: quest.ticketId, estMin: 30 } : null
    return { next: t ? { kind: 'start', ticket: t, reason: '' } : { kind: 'wait', ticket: null, reason: '' }, mix: {}, pathNote: null, budgets: [], careerLane: false, dueReviews: 0, pick: { doing: [], waiting: [] } }
  },
}))

const treeAreas: PlanArea[] = [
  { id: 'dsa', name: 'Data structures and algorithms', tag: 'DS', why: 'w', pre: [] },
  { id: 'design', name: 'System design', tag: 'SD', why: 'w', pre: [] },
]
const nd = (id: string, area: string, pre: string[], title = id): PlanNode => ({ id, area, phase: 1, kind: 'topic', title, oneLiner: `${title} in one line.`, why: 'w', pre, explain: [], hours: 1 })
const treeNodes: PlanNode[] = [
  nd('DA01', 'dsa', [], 'Hashing'), nd('DA02', 'dsa', ['DA01'], 'Windows'), nd('DA03', 'dsa', ['DA02'], 'Graphs'),
  nd('SD01', 'design', [], 'Method'), nd('SD02', 'design', ['SD01'], 'Caching'),
]
const planOver = { areas: [...AREAS, ...treeAreas], nodes: [...NODES, ...treeNodes] }

let seq = 100
const prob = (num: number, node: string, status: string, diff: 'E' | 'M' | 'H' = 'M'): Ticket =>
  mkTicket({ id: `p${num}`, node, area: 'dsa', lane: 'dsa', kind: 'problem', title: `${num} · Problem ${num}`, order: (seq += 1), status: status as never, difficulty: diff, xp: status === 'done' ? 5 : 0 })
const dsg = (id: string, node: string, status: string, diff: 'M' | 'H' = 'H'): Ticket =>
  mkTicket({ id, node, area: 'design', lane: 'design', kind: 'design', title: `Design ${id}`, order: (seq += 1), status: status as never, difficulty: diff })

const TREE_TICKETS = (): Ticket[] => [
  prob(1, 'DA01', 'done', 'E'), prob(2, 'DA01', 'done'),
  prob(3, 'DA02', 'done'), prob(4, 'DA02', 'todo', 'H'), prob(5, 'DA02', 'todo'),
  prob(6, 'DA03', 'todo'),
  dsg('d-a', 'SD01', 'done'), dsg('d-b', 'SD02', 'todo'), dsg('d-c', 'SD02', 'todo', 'M'),
]

function phone(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === NARROW_QUERY, media: q, addEventListener() {}, removeEventListener() {} }))
}
afterEach(() => { vi.unstubAllGlobals(); quest.ticketId = 'ai.l3.learn' })

async function setup(route: string, extra: Ticket[] = TREE_TICKETS()) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, coreMinutes: 960 })
  await d.tickets.bulkPut([...mkAiTickets(), ...extra])
  renderWithApp(<Routes><Route path="/skills/*" element={<Skills />} /><Route path="*" element={null} /></Routes>, { db: d, ...appPlans(planOver), route })
  return d
}
const selected = () => [...document.querySelectorAll('[data-testid^="skills-node-"][aria-current="true"], [data-testid^="skills-node-"][aria-selected="true"]')]
  .filter(e => /^skills-node-[A-Z]{2}\d+$/.test(e.getAttribute('data-testid') ?? ''))


describe('TREE-17 DSA problems show their pattern', () => {
  it('a DSA row holds the Atlas pattern chip beside (not inside) its link, with the label and the /atlas?pattern= target; a problem with no pattern has none', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA02'))
    const list = within(screen.getByTestId('skills-node-panel')).getByTestId('skills-node-items')
    const chip4 = within(list).getByTestId('skills-node-item-pattern-p4')
    expect(chip4).toHaveTextContent('Sliding window')
    expect(chip4).toHaveAttribute('href', '/atlas?pattern=sliding-window')
    expect(within(list).getByTestId('skills-node-item-pattern-p5')).toHaveAttribute('href', '/atlas?pattern=two-pointers')
    expect(within(list).queryByTestId('skills-node-item-pattern-p3')).toBeNull()
    expect(screen.getByTestId('skills-node-item-p4').contains(chip4)).toBe(false) // no link inside a link
    expect(chip4.closest('li')).toBe(screen.getByTestId('skills-node-item-p4').closest('li'))
  })
  it('Design rows have no pattern chip', async () => {
    await setup('/skills/design')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-SD02'))
    expect(document.querySelector('[data-testid^="skills-node-item-pattern-"]')).toBeNull()
  })
})

import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetLabInfoCache } from '../../src/data/labHooks'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { Skills } from '../../src/screens/Skills'
import { freshDb } from '../helpers/db'
import { INFO } from '../helpers/labServer'
import { mkReview, mkRun } from '../helpers/labRows'
import type { PlanNode } from '../../src/data/planV2'
import { appPlans, AREAS, mkAiTickets, mkTicket, NODES } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const act = vi.hoisted(() => ({ fetchLabInfo: vi.fn() }))
vi.mock('../../src/data/labActions', () => act)
vi.mock('../../src/data/flatHooks', () => ({
  useTodayModel: () => ({ next: { kind: 'wait', ticket: null, reason: '' }, mix: {}, pathNote: null, budgets: [], careerLane: false, dueReviews: 0, pick: { doing: [], lanes: [] } }),
}))
beforeEach(() => { resetLabInfoCache(); act.fetchLabInfo.mockReset(); act.fetchLabInfo.mockResolvedValue(null) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const dsaNode: PlanNode = { id: 'DA01', area: 'dsa', phase: 1, kind: 'topic', title: 'Hashing', oneLiner: 'Hashing in one line.', why: 'w', pre: [], explain: [], hours: 1 }
const plans = appPlans({ areas: [...AREAS, { id: 'dsa', name: 'Data structures and algorithms', tag: 'DS', why: 'w', pre: [] }], nodes: [...NODES, dsaNode] })
const phone = (on: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === NARROW_QUERY, media: q, addEventListener() {}, removeEventListener() {} }))
// node L3: a learn ticket (done), a lab build (done) and the lab's closing build ticket
const l3 = [
  mkTicket({ id: 'ai.l3.learn', node: 'L3', area: 'llm', phase: 1, order: 3, status: 'done', kind: 'read', title: 'Read L3' }),
  mkTicket({ id: 'tlab.build.1', node: 'L3', area: 'llm', phase: 1, order: 4, status: 'done', kind: 'build', title: 'Build L3', lab: { id: 't-lab', gpu: 'none' } }),
]
// the lab's other two build tickets live on other nodes, so their milestones are not this node's business
const rest = [
  mkTicket({ id: 'tlab.build.2', node: 'M1', area: 'measure', phase: 1, order: 20, status: 'todo', kind: 'build', title: 'Build M1', lab: { id: 't-lab', gpu: 'none' } }),
  mkTicket({ id: 'tlab.build.3', node: 'M1', area: 'measure', phase: 1, order: 21, status: 'todo', kind: 'build', title: 'Close the lab', lab: { id: 't-lab', gpu: 'none' } }),
]
const info = { ...INFO, closingTicket: 'tlab.build.3' }
async function setup(route: string, seed?: (d: ReturnType<typeof freshDb>) => Promise<void>) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, coreMinutes: 960 })
  await d.tickets.bulkPut([mkTicket({ id: 'p1', node: 'DA01', area: 'dsa', lane: 'dsa', kind: 'problem', title: 'Two sum', status: 'done' }), ...mkAiTickets().filter(t => t.node !== 'L3' && t.node !== 'M1'), mkTicket({ id: 'ai.m1.learn', node: 'M1', area: 'measure', phase: 1, order: 7, status: 'todo', title: 'Watch ai.m1.learn' }), ...l3, ...rest])
  if (seed) await seed(d)
  renderWithApp(<Routes><Route path="/skills/*" element={<Skills />} /><Route path="*" element={null} /></Routes>, { db: d, ...plans, route })
  return d
}

describe('topic badges on an AI area map', () => {
  it('shows Learned on a node whose learn tickets are done; no badge on a node nothing was done in; the five node states are unchanged', async () => {
    await setup('/skills/area/llm')
    const badge = await screen.findByTestId('skills-node-badge-L1')
    expect(badge).toHaveTextContent('Learned')
    expect(badge).toHaveAttribute('data-topic-state', 'learned')
    expect(screen.getByTestId('skills-node-L1')).toContainElement(badge)
    expect(screen.queryByTestId('skills-node-badge-L4')).toBeNull()
    const node = screen.getByTestId('skills-node-L1')
    expect(node).toHaveAttribute('data-state', 'done')
    expect(node).toHaveAttribute('aria-label', 'Neural network basics, Done, Learned') // the accessible name carries the badge word (SKILLS-22)
    expect(screen.getByTestId('skills-node-L4')).toHaveAttribute('aria-label', 'How inference works, Available')
  })
  it('walks learned, built, proven for a lab node, and back to built after a Not yet', async () => {
    act.fetchLabInfo.mockResolvedValue({ ...info, milestones: [{ ticket: 'tlab.build.1', checkIds: ['c1'] }, { ticket: 'tlab.build.2', checkIds: ['c2'] }, { ticket: 'tlab.build.3', checkIds: ['c3'] }] })
    const d = await setup('/skills/area/llm')
    await waitFor(() => expect(screen.getByTestId('skills-node-badge-L3')).toHaveTextContent('Learned'))
    await d.labRuns.put(mkRun('t-lab', 1, { c1: 'pass' }))
    await waitFor(() => expect(screen.getByTestId('skills-node-badge-L3')).toHaveTextContent('Built'))
    await d.labReviews.put(mkReview('t-lab', 2, true))
    await waitFor(() => expect(screen.getByTestId('skills-node-badge-L3')).toHaveTextContent('Proven'))
    expect(screen.getByTestId('skills-node-badge-L3')).toHaveAttribute('data-topic-state', 'proven')
    await d.labReviews.put(mkReview('t-lab', 3, false))
    await waitFor(() => expect(screen.getByTestId('skills-node-badge-L3')).toHaveTextContent('Built'))
  })
  it('caps a node at Learning when the server does not know its lab, and shows no error', async () => {
    await setup('/skills/area/llm', async d => { await d.labRuns.put(mkRun('t-lab', 1, { c1: 'pass' })) })
    await waitFor(() => expect(screen.getByTestId('skills-node-badge-L3')).toHaveTextContent('Learning'))
    expect(screen.queryByTestId('screen-error')).toBeNull()
  })
  it('shows the badge on a phone row, beside the glyph, and the next-step line in the open row', async () => {
    phone(true)
    await setup('/skills/area/llm?node=L1')
    const row = await screen.findByTestId('skills-row-L1')
    expect(await within(row).findByTestId('skills-node-badge-L1')).toHaveTextContent('Learned')
    expect(row.getAttribute('aria-label')).toBe('Neural network basics, Done, Learned')
    expect(within(row).queryByTestId('skills-node-nextline')).toBeNull() // nothing left to open on L1
  })
  it('shows no badge and no line on the DSA and Design trees', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    await new Promise(r => setTimeout(r, 50))
    expect(document.querySelector('[data-testid^="skills-node-badge-"], [data-testid="skills-node-nextline"]')).toBeNull()
  })
})

describe('next-step line in the node panel', () => {
  it('follows the topic state: Build it, Request the review, Proven', async () => {
    act.fetchLabInfo.mockResolvedValue({ ...info, milestones: [{ ticket: 'tlab.build.1', checkIds: ['c1'] }, { ticket: 'tlab.build.2', checkIds: ['c2'] }, { ticket: 'tlab.build.3', checkIds: ['c3'] }] })
    // the node's own build is the open one first
    const d = await setup('/skills/area/llm?node=L3', async d2 => { await d2.tickets.update('tlab.build.1', { status: 'todo' }) })
    const panel = await screen.findByTestId('skills-node-panel')
    await waitFor(() => expect(within(panel).getByTestId('skills-node-nextline')).toBeInTheDocument())
    expect(within(panel).getByTestId('skills-node-nextline')).toHaveTextContent('Build L3') // learning: the title of the next ticket
    await d.tickets.update('tlab.build.1', { status: 'done' })
    await waitFor(() => expect(within(panel).getByTestId('skills-node-nextline')).toHaveTextContent('Build it: Build L3'))
    expect(within(panel).getByTestId('skills-node-nextline')).toHaveAttribute('data-topic-state', 'learned')
    await d.labRuns.put(mkRun('t-lab', 1, { c1: 'pass' }))
    await waitFor(() => expect(within(panel).getByTestId('skills-node-nextline')).toHaveTextContent('Request the review on Close the lab'))
    await d.labReviews.put(mkReview('t-lab', 2, true))
    await waitFor(() => expect(within(panel).getByTestId('skills-node-nextline')).toHaveTextContent(/^Proven$/))
  })
  it('a node nothing was touched in still shows its next ticket, with data-topic-state none', async () => {
    await setup('/skills/area/llm?node=L4')
    const panel = await screen.findByTestId('skills-node-panel')
    const line = await within(panel).findByTestId('skills-node-nextline')
    expect(line).toHaveTextContent('Watch ai.l4.learn')
    expect(line).toHaveAttribute('data-topic-state', 'none')
    expect(within(panel).queryByTestId(/^skills-node-badge-/)).toBeNull()
    expect(within(panel).getByTestId('skills-node-start')).toBeInTheDocument() // the line and Start are separate elements
  })
  it('a node with no next ticket and no state above Learning has no line', async () => {
    await setup('/skills/area/llm?node=L1')
    const panel = await screen.findByTestId('skills-node-panel')
    await within(panel).findByText('Neural network basics')
    expect(within(panel).queryByTestId('skills-node-nextline')).toBeNull()
  })
})

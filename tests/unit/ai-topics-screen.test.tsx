import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { PlanArea, PlanNode } from '../../src/data/planV2'
import { AiTopics } from '../../src/screens/AiTopics'
import { freshDb } from '../helpers/db'
import { appPlans, AREAS, mkTicket, NODES } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const treeArea: PlanArea = { id: 'dsa', name: 'DSA', tag: 'DS', why: 'w', pre: [] }
const treeNode: PlanNode = { id: 'DA01', area: 'dsa', phase: 1, kind: 'topic', title: 'Hashing', oneLiner: 'o', why: 'w', pre: [], explain: [], hours: 1 }
const planOver = { areas: [...AREAS, treeArea], nodes: [...NODES, treeNode] }
const t = (id: string, node: string, kind: string, status: string, estMin: number, over = {}) =>
  mkTicket({ id, node, kind: kind as never, status: status as never, estMin, ...over })
const TICKETS = [
  t('a', 'L1', 'watch', 'done', 45), t('b', 'L1', 'build', 'todo', 75), t('c', 'L1', 'build', 'done', 30),
  t('d', 'L2', 'read', 'doing', 40), t('e', 'M1', 'watch', 'todo', 45),
  t('x', 'L1', 'read', 'done', 99, { archived: true }),
  mkTicket({ id: 'p1', node: 'DA01', area: 'dsa', kind: 'problem', status: 'done', estMin: 30 }),
]

async function setup(route = '/ai-topics') {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, coreMinutes: 960 })
  await d.tickets.bulkPut(TICKETS)
  renderWithApp(<Routes><Route path="/ai-topics" element={<AiTopics />} /><Route path="*" element={null} /></Routes>, { db: d, ...appPlans(planOver), route })
  return d
}
const search = () => screen.getByTestId('location').getAttribute('data-search')

describe('AI topics screen', () => {
  it('NAV-15/16: title, one section per AI area in plan order, one row per node in plan order, none for the trees', async () => {
    await setup()
    expect(await screen.findByTestId('ai-topics-title')).toHaveTextContent('AI topics')
    const areas = screen.getAllByTestId(/^ai-topics-area-[a-z]+$/).map(a => a.getAttribute('data-testid'))
    expect(areas).toEqual(['ai-topics-area-llm', 'ai-topics-area-measure', 'ai-topics-area-sched', 'ai-topics-area-ai'])
    expect(screen.queryByTestId('ai-topics-area-dsa')).toBeNull()
    expect(screen.queryByTestId('ai-topics-node-DA01')).toBeNull()
    const rows = within(screen.getByTestId('ai-topics-area-llm')).getAllByTestId(/^ai-topics-node-[A-Z]\d$/).map(r => r.getAttribute('data-testid'))
    expect(rows).toEqual(['ai-topics-node-L1', 'ai-topics-node-L2', 'ai-topics-node-L3', 'ai-topics-node-L4', 'ai-topics-node-R1'])
    expect(screen.getByTestId('ai-topics-area-title-llm')).toHaveTextContent('LL')
    const l1 = screen.getByTestId('ai-topics-node-L1')
    expect(l1).toHaveAttribute('data-area', 'llm')
    expect(l1).toHaveAttribute('data-phase', '1')
    expect(l1).toHaveAttribute('data-done', '2')
    expect(l1).toHaveAttribute('data-total', '3')
    expect(l1.querySelector('[data-content="plan"]')).toHaveTextContent('Neural network basics')
  })

  it('NAV-17: node figures, kind chips in the fixed order, an empty node, archived tickets ignored', async () => {
    await setup()
    await screen.findByTestId('ai-topics-title')
    expect(screen.getByTestId('ai-topics-node-count-L1')).toHaveTextContent('3 tickets')
    expect(screen.getByTestId('ai-topics-node-count-L1')).toHaveAttribute('data-count', '3')
    expect(screen.getByTestId('ai-topics-node-count-L2')).toHaveTextContent('1 ticket')
    expect(screen.getByTestId('ai-topics-node-done-L1')).toHaveTextContent('2 done')
    const hours = screen.getByTestId('ai-topics-node-hours-L1')
    expect(hours).toHaveTextContent('2.5 h')
    expect(hours).toHaveAttribute('data-minutes', '150')
    const chips = within(screen.getByTestId('ai-topics-node-kinds-L1')).getAllByTestId(/^ai-topics-kind-L1-/)
    expect(chips.map(c => c.textContent)).toEqual(['Watch 1', 'Build 2'])
    expect(screen.getByTestId('ai-topics-kind-L1-build')).toHaveAttribute('data-count', '2')
    expect(screen.getByTestId('ai-topics-node-count-S1')).toHaveTextContent('0 tickets')
    expect(screen.getByTestId('ai-topics-node-done-S1')).toHaveTextContent('0 done')
    expect(screen.getByTestId('ai-topics-node-hours-S1')).toHaveTextContent('0 h')
    expect(within(screen.getByTestId('ai-topics-node-kinds-S1')).queryAllByTestId(/^ai-topics-kind-/)).toHaveLength(0)
  })

  it('NAV-18: area count, summary with the total minutes rounded once', async () => {
    await setup()
    await screen.findByTestId('ai-topics-title')
    const c = screen.getByTestId('ai-topics-area-count-llm')
    expect(c).toHaveTextContent('2 of 4 tickets done')
    expect(c).toHaveAttribute('data-done', '2')
    expect(c).toHaveAttribute('data-total', '4')
    expect(c).toHaveAttribute('data-minutes', '190')
    const s = screen.getByTestId('ai-topics-summary')
    expect(s).toHaveTextContent('2 of 5 tickets done · 3.9 h')
    expect(s).toHaveAttribute('data-minutes', '235')
  })

  it('NAV-19/20/21: phase and kind chips filter, combine, live in the URL and recompute the figures', async () => {
    await setup()
    await screen.findByTestId('ai-topics-title')
    expect(screen.getByTestId('ai-topics-filter-phase-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ai-topics-filter-phase-2')).toHaveTextContent('Phase 2')
    expect(screen.queryByTestId('ai-topics-filter-phase-3')).toBeNull()
    expect(screen.getAllByTestId(/^ai-topics-filter-kind-(?!all)/).map(b => b.textContent)).toEqual(['Watch', 'Read', 'Build'])
    fireEvent.click(screen.getByTestId('ai-topics-filter-kind-build'))
    expect(screen.getByTestId('ai-topics-filter-kind-build')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('ai-topics-node-L2')).toBeNull()
    expect(screen.queryByTestId('ai-topics-area-measure')).toBeNull()
    expect(screen.getByTestId('ai-topics-node-count-L1')).toHaveTextContent('2 tickets')
    expect(screen.getByTestId('ai-topics-summary')).toHaveTextContent('1 of 2 tickets done · 1.8 h')
    fireEvent.click(screen.getByTestId('ai-topics-filter-phase-1'))
    expect(search()).toBe('?phase=1&kind=build')
    fireEvent.click(screen.getByTestId('ai-topics-filter-kind-all'))
    expect(search()).toBe('?phase=1')
    fireEvent.click(screen.getByTestId('ai-topics-filter-phase-all'))
    expect(search()).toBe('')
    expect(screen.getByTestId('ai-topics-node-L2')).toBeInTheDocument()
  })

  it('NAV-21: a URL with filters shows the same chips pressed and the same rows', async () => {
    await setup('/ai-topics?phase=1&kind=build')
    await screen.findByTestId('ai-topics-title')
    expect(screen.getByTestId('ai-topics-filter-phase-1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ai-topics-filter-kind-build')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId(/^ai-topics-node-[A-Z]\d$/)).toHaveLength(1)
  })

  it('NAV-22: no match shows one sentence and a Clear filters action; an unknown value means all', async () => {
    await setup('/ai-topics?phase=2&kind=build')
    expect(await screen.findByTestId('ai-topics-empty')).toHaveAttribute('data-empty', 'true')
    expect(screen.queryByTestId('ai-topics-area-llm')).toBeNull()
    fireEvent.click(screen.getByTestId('ai-topics-filter-clear'))
    await waitFor(() => expect(screen.getByTestId('ai-topics-area-llm')).toBeInTheDocument())
    expect(search()).toBe('')
    expect(screen.getByTestId('ai-topics-filter-phase-all')).toHaveAttribute('aria-pressed', 'true')
  })
  it('NAV-22: an unknown phase or kind in the URL is treated as all', async () => {
    await setup('/ai-topics?phase=99&kind=ritual')
    await screen.findByTestId('ai-topics-title')
    expect(screen.getByTestId('ai-topics-filter-phase-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ai-topics-filter-kind-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ai-topics-node-L1')).toBeInTheDocument()
  })

  it('NAV-23: a row is a link to the node in Skills', async () => {
    await setup()
    await screen.findByTestId('ai-topics-title')
    const row = screen.getByTestId('ai-topics-node-L4')
    expect(row).toHaveAttribute('href', '/skills/area/llm?node=L4')
    expect(screen.getByTestId('ai-topics-node-S1')).toHaveAttribute('href', '/skills/area/sched?node=S1')
  })

  it('NAV-26: loading, filtering and clearing write nothing', async () => {
    const d = await setup()
    await screen.findByTestId('ai-topics-title')
    const before = JSON.stringify(await d.tickets.toArray())
    const events = await d.events.count()
    fireEvent.click(screen.getByTestId('ai-topics-filter-kind-build'))
    fireEvent.click(screen.getByTestId('ai-topics-filter-kind-all'))
    expect(JSON.stringify(await d.tickets.toArray())).toBe(before)
    expect(await d.events.count()).toBe(events)
  })
})

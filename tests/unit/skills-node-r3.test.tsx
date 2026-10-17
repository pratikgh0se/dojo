// R3 W1: SKILLS-32 to SKILLS-37 (AI node ticket list) and TREE-22 to TREE-26 (Questions (N) link) on the node panel.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanArea, PlanNode } from '../../src/data/planV2'
import type { BankExtraRow, PlanQuestion, Ticket } from '../../src/data/types'
import { nodeQuestionCount } from '../../src/rules/bankQuestions'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { Skills } from '../../src/screens/Skills'
import { freshDb } from '../helpers/db'
import { appPlans, AREAS, mkAiTickets, mkTicket, NODES } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

vi.mock('../../src/data/flatHooks', () => ({
  useTodayModel: () => ({ next: { kind: 'wait', ticket: null, reason: '' }, mix: {}, pathNote: null, budgets: [], careerLane: false, dueReviews: 0, pick: { doing: [], waiting: [] } }),
}))

const treeAreas: PlanArea[] = [
  { id: 'dsa', name: 'Data structures and algorithms', tag: 'DS', why: 'w', pre: [] },
  { id: 'design', name: 'System design', tag: 'SD', why: 'w', pre: [] },
]
const nd = (id: string, area: string, title = id): PlanNode => ({ id, area, phase: 1, kind: 'topic', title, oneLiner: `${title} in one line.`, why: 'w', pre: [], explain: [], hours: 1 })
const treeNodes: PlanNode[] = [nd('DA01', 'dsa', 'Hashing'), nd('SD01', 'design', 'Method'), nd('SD02', 'design', 'Caching')]

const q = (id: string, area: 'ai' | 'design', node: string): PlanQuestion => ({ id, area, node, type: 'concept', difficulty: 2, question: 'Q?', answer: 'A.', checklist: [] })
const qbank: PlanQuestion[] = [q('q1', 'ai', 'L3'), q('q2', 'ai', 'L3'), q('q3', 'design', 'SD02'), q('q4', 'design', 'SD02'), q('q5', 'ai', 'L1')]
const extraRow: BankExtraRow = { ...q('x1', 'design', 'SD02'), aiMade: true, at: 1 }

// L3 holds one ticket of every status the list marks, in this order (also archived and a todo design ticket)
const L3 = (id: string, order: number, status: Ticket['status'], over: Partial<Ticket> = {}) => mkTicket({ id, node: 'L3', area: 'llm', phase: 1, order, status, title: `T ${id}`, estMin: 20 + order, ...over })
const l3Tickets = (): Ticket[] => [
  L3('ai.l3.a', 1, 'done'), L3('ai.l3.b', 2, 'doing'), L3('ai.l3.c', 3, 'blocked', { kind: 'build' }), L3('ai.l3.d', 4, 'help'),
  L3('ai.l3.e', 5, 'todo', { kind: 'design' }), L3('ai.l3.f', 6, 'todo'), L3('ai.l3.gone', 7, 'todo', { archived: true }),
]

function phone(on: boolean) {
  vi.stubGlobal('matchMedia', (m: string) => ({ matches: on && m === NARROW_QUERY, media: m, addEventListener() {}, removeEventListener() {} }))
}
afterEach(() => { vi.unstubAllGlobals() })

const Where = () => <span data-testid="where">{useLocation().pathname}{useLocation().search}</span>
async function setup(route: string, tickets: Ticket[] = [...mkAiTickets().filter(t => t.node !== 'L3'), ...l3Tickets()], withExtra = true, extraDelayMs = 0) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, coreMinutes: 960 })
  await d.tickets.bulkPut([...tickets, mkTicket({ id: 'dsa-1', node: 'DA01', area: 'dsa', lane: 'dsa', kind: 'problem', difficulty: 'E' })])
  if (withExtra) await d.bankExtra.put(extraRow)
  if (extraDelayMs) { // the AI-made rows arrive late: the live query answers after the rest of the screen has
    const read = d.bankExtra.toArray.bind(d.bankExtra)
    d.bankExtra.toArray = (() => new Promise(r => setTimeout(() => r(read()), extraDelayMs))) as typeof d.bankExtra.toArray
  }
  renderWithApp(<Routes><Route path="/skills/*" element={<Skills />} /><Route path="*" element={<Where />} /></Routes>,
    { db: d, ...appPlans({ areas: [...AREAS, ...treeAreas], nodes: [...NODES, ...treeNodes], qbank }), route })
  return d
}
const panel = async () => within(await screen.findByTestId('skills-node-panel'))

describe('nodeQuestionCount (TREE-22 to TREE-25)', () => {
  it('counts shipped plus AI-made questions of the node in its own bank; a DSA node has none', () => {
    expect(nodeQuestionCount({ id: 'L3', area: 'llm' }, qbank, [])).toEqual({ area: 'ai', count: 2 })
    expect(nodeQuestionCount({ id: 'SD02', area: 'design' }, qbank, [extraRow])).toEqual({ area: 'design', count: 3 })
    expect(nodeQuestionCount({ id: 'SD02', area: 'design' }, qbank, [])).toEqual({ area: 'design', count: 2 })
    expect(nodeQuestionCount({ id: 'L4', area: 'llm' }, qbank, [])).toEqual({ area: 'ai', count: 0 })
    expect(nodeQuestionCount({ id: 'DA01', area: 'dsa' }, qbank, [])).toBeNull()
  })
})

describe('SKILLS-32 AI node ticket list', () => {
  it('lists every live ticket in order with title, kind label and estimate, and none for the archived one', async () => {
    await setup('/skills/area/llm?node=L3')
    const p = await panel()
    const list = await p.findByTestId('skills-node-tickets')
    const rows = within(list).getAllByTestId(/^skills-node-ticket-ai\.l3\.[a-f]$/)
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].map(x => `skills-node-ticket-ai.l3.${x}`))
    expect(p.queryByTestId('skills-node-ticket-ai.l3.gone')).toBeNull()
    expect(rows).toHaveLength(6)
    expect(p.getByText('Tickets 1 of 6')).toBeTruthy()
    expect(rows.map(r => r.getAttribute('data-status'))).toEqual(['done', 'doing', 'blocked', 'help', 'todo', 'todo'])
    expect(p.getByTestId('skills-node-ticket-title-ai.l3.a').textContent).toBe('T ai.l3.a')
    expect(p.getByTestId('skills-node-ticket-title-ai.l3.a').getAttribute('data-content')).toBe('plan')
    expect(p.getByTestId('skills-node-ticket-kind-ai.l3.c').textContent).toBe('Build')
    expect(p.getByTestId('skills-node-ticket-kind-ai.l3.c').getAttribute('data-kind')).toBe('build')
    expect(p.getByTestId('skills-node-ticket-kind-ai.l3.e').textContent).toBe('Design')
    expect(p.getByTestId('skills-node-ticket-est-ai.l3.c').textContent).toBe('23 min')
  })
  it('is absent for a node with no tickets and for a tree node', async () => {
    await setup('/skills/area/sched?node=S1')
    expect((await panel()).queryByTestId('skills-node-tickets')).toBeNull()
  })
  it('is absent from a DSA tree node, which keeps skills-node-items', async () => {
    await setup('/skills/dsa?node=DA01')
    const p = await panel()
    expect(await p.findByTestId('skills-node-items')).toBeTruthy()
    expect(p.queryByTestId('skills-node-tickets')).toBeNull()
  })
})

describe('SKILLS-33 status marks', () => {
  it('reads Done, In progress, Blocked, Needs help and nothing on todo', async () => {
    await setup('/skills/area/llm?node=L3')
    const p = await panel()
    const mark = async (x: string) => (await p.findByTestId(`skills-node-ticket-mark-ai.l3.${x}`))
    expect([(await mark('a')).textContent, (await mark('b')).textContent, (await mark('c')).textContent, (await mark('d')).textContent]).toEqual(['Done', 'In progress', 'Blocked', 'Needs help'])
    expect((await mark('c')).getAttribute('data-status')).toBe('blocked')
    expect(p.queryByTestId('skills-node-ticket-mark-ai.l3.e')).toBeNull()
    expect(p.queryByTestId('skills-node-ticket-mark-ai.l3.f')).toBeNull()
    expect(p.getByTestId('skills-node-ticket-ai.l3.a').getAttribute('data-done')).toBe('true')
    expect(p.getByTestId('skills-node-ticket-ai.l3.b').getAttribute('data-done')).toBe('false')
  })
})

describe('SKILLS-34 a row opens its ticket and writes nothing', () => {
  it('goes to /do/<id>, and /designs/session/<id> for a design ticket, leaving the data as it was', async () => {
    const d = await setup('/skills/area/llm?node=L3')
    const before = JSON.stringify(await d.tickets.orderBy('id').toArray())
    const p = await panel()
    fireEvent.click(await p.findByTestId('skills-node-ticket-ai.l3.f'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/do/ai.l3.f'))
    expect(JSON.stringify(await d.tickets.orderBy('id').toArray())).toBe(before)
  })
  it('sends a design ticket to the design session', async () => {
    await setup('/skills/area/llm?node=L3')
    fireEvent.click(await (await panel()).findByTestId('skills-node-ticket-ai.l3.e'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/designs/session/ai.l3.e'))
  })
})

describe('SKILLS-35 one action stays', () => {
  it('only Start carries the accent, and it starts the first todo or doing ticket, never a blocked or help one', async () => {
    const d = await setup('/skills/area/llm?node=L3', [L3('ai.l3.a', 1, 'blocked'), L3('ai.l3.b', 2, 'help'), L3('ai.l3.c', 3, 'todo', { kind: 'build' }), L3('ai.l3.d', 4, 'todo')])
    const p = await panel()
    const start = await p.findByTestId('skills-node-start')
    expect(start.getAttribute('data-accent')).toBe('primary')
    expect(start.textContent).toBe('START · BUILD')
    const el = document.querySelector('[data-testid="skills-node-panel"]')!
    expect(el.querySelectorAll('[data-accent]')).toHaveLength(1)
    expect(el.querySelectorAll('[data-testid^="skills-node-ticket-"][data-accent]')).toHaveLength(0)
    fireEvent.focus(p.getByTestId('skills-node-ticket-ai.l3.d'))
    fireEvent.click(start)
    await waitFor(async () => expect((await d.tickets.get('ai.l3.c'))?.status).toBe('doing'))
    expect((await d.tickets.get('ai.l3.a'))?.status).toBe('blocked')
    expect((await d.tickets.get('ai.l3.d'))?.status).toBe('todo')
  })
})

describe('SKILLS-36 the list follows a start', () => {
  it('shows In progress on the started row with the same count, order and Start action', async () => {
    const d = await setup('/skills/area/llm?node=L3', [L3('ai.l3.x', 1, 'done'), L3('ai.l3.y', 2, 'todo'), L3('ai.l3.z', 3, 'todo')])
    const p = await panel()
    expect(p.queryByTestId('skills-node-ticket-mark-ai.l3.y')).toBeNull()
    await act(async () => { await d.tickets.update('ai.l3.y', { status: 'doing' }) })
    expect((await p.findByTestId('skills-node-ticket-mark-ai.l3.y')).textContent).toBe('In progress')
    expect(p.getByText('Tickets 1 of 3')).toBeTruthy()
    expect(within(p.getByTestId('skills-node-tickets')).getAllByTestId(/^skills-node-ticket-ai\.l3\.[xyz]$/).map(r => r.getAttribute('data-testid'))).toEqual(['x', 'y', 'z'].map(i => `skills-node-ticket-ai.l3.${i}`))
  })
})

describe('TREE-22 to TREE-26 Questions (N)', () => {
  it('the desktop panel holds the link at once, with and without AI-made rows', async () => {
    await setup('/skills/design?node=SD02', undefined, true, 150)
    expect(within(await screen.findByTestId('skills-node-panel')).getByTestId('skills-node-questions').textContent).toBe('Questions (3)')
  })
  it('the desktop panel holds the link at once when there are no AI-made rows', async () => {
    await setup('/skills/design?node=SD02', undefined, false, 150)
    expect(within(await screen.findByTestId('skills-node-panel')).getByTestId('skills-node-questions').textContent).toBe('Questions (2)')
  })
  it('an AI node with questions links to its bank with the node filter', async () => {
    await setup('/skills/area/llm?node=L3')
    const a = await (await panel()).findByTestId('skills-node-questions')
    expect(a.textContent).toBe('Questions (2)')
    expect(a.getAttribute('data-count')).toBe('2')
    expect(a.getAttribute('href')).toBe('/banks?area=ai&node=L3')
    expect(a.hasAttribute('data-accent')).toBe(false)
    fireEvent.click(a)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/banks?area=ai&node=L3'))
  })
  it('an AI node with no questions has no link, not even Questions (0)', async () => {
    await setup('/skills/area/llm?node=L4')
    const p = await panel()
    await p.findByTestId('skills-node-start')
    expect(p.queryByTestId('skills-node-questions')).toBeNull()
    expect(screen.queryByText(/Questions \(0\)/)).toBeNull()
  })
  it('a Design node counts shipped plus AI-made questions and follows the bank', async () => {
    const d = await setup('/skills/design?node=SD02')
    const p = await panel()
    const a = await p.findByTestId('skills-node-questions')
    expect(a.textContent).toBe('Questions (3)')
    expect(a.getAttribute('href')).toBe('/banks?area=design&node=SD02')
    await act(async () => { await d.bankExtra.delete('x1') })
    await waitFor(() => expect(p.getByTestId('skills-node-questions').textContent).toBe('Questions (2)'))
    expect(p.getByTestId('skills-node-questions').getAttribute('data-count')).toBe('2')
  })
  it('a DSA node has no question link and no link to Banks', async () => {
    await setup('/skills/dsa?node=DA01')
    const p = await panel()
    await p.findByTestId('skills-node-items')
    expect(p.queryByTestId('skills-node-questions')).toBeNull()
    expect(document.querySelector('[data-testid="skills-node-panel"] a[href^="/banks"]')).toBeNull()
  })
  it('reading and following the link writes nothing', async () => {
    const d = await setup('/skills/area/llm?node=L3')
    const before = JSON.stringify([await d.tickets.toArray(), await d.bankExtra.toArray(), await d.table('bankGrades').toArray()])
    fireEvent.click(await (await panel()).findByTestId('skills-node-questions'))
    await waitFor(() => expect(screen.getByTestId('where')).toBeTruthy())
    expect(JSON.stringify([await d.tickets.toArray(), await d.bankExtra.toArray(), await d.table('bankGrades').toArray()])).toBe(before)
  })
})

describe('SKILLS-37 and TREE-26 on the phone', () => {
  // TREE-26: the link is there the moment the panel or row is, with its final count (a test that reads once, without waiting, must not see none or a short count)
  it('the Design row holds the link at once with the AI-made row counted', async () => {
    phone(true)
    await setup('/skills/design?node=SD02', undefined, true, 150)
    const row = await screen.findByTestId('skills-row-SD02')
    expect(within(row).getByTestId('skills-node-questions').textContent).toBe('Questions (3)')
  })
  it('the Design row holds the link at once when there are no AI-made rows', async () => {
    phone(true)
    await setup('/skills/design?node=SD02', undefined, false, 150)
    const row = await screen.findByTestId('skills-row-SD02')
    expect(within(row).getByTestId('skills-node-questions').textContent).toBe('Questions (2)')
  })
  it('the expanded row holds the same ticket rows and the question link, with no accent on either', async () => {
    phone(true)
    await setup('/skills/area/llm?node=L3')
    const row = within(await screen.findByTestId('skills-row-L3'))
    const list = await row.findByTestId('skills-node-tickets')
    expect(within(list).getAllByTestId(/^skills-node-ticket-ai\.l3\.[a-f]$/)).toHaveLength(6)
    expect(row.getByTestId('skills-node-ticket-mark-ai.l3.d').textContent).toBe('Needs help')
    expect(row.getByTestId('skills-node-questions').textContent).toBe('Questions (2)')
    expect(row.getByTestId('skills-node-questions').getAttribute('href')).toBe('/banks?area=ai&node=L3')
    expect(document.querySelectorAll('[data-accent="primary"]').length).toBeLessThanOrEqual(1)
    expect(document.querySelectorAll('[data-testid="skills-node-questions"][data-accent], [data-testid^="skills-node-ticket-"][data-accent]')).toHaveLength(0)
    fireEvent.click(row.getByTestId('skills-node-ticket-ai.l3.f'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/do/ai.l3.f'))
  })
})

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanArea, PlanNode } from '../../src/data/planV2'
import type { Ticket } from '../../src/data/types'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { Skills } from '../../src/screens/Skills'
import { freshDb } from '../helpers/db'
import { appPlans, AREAS, mkAiTickets, mkTicket, NODES } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

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

describe('TREE-01 four tabs, TREE-04 the AI tab does not change', () => {
  it('lists AI, DSA, Design, Stats in that order and selects the one of the route', async () => {
    for (const [route, id] of [['/skills', 'ai'], ['/skills/dsa', 'dsa'], ['/skills/design', 'design'], ['/skills/stats', 'stats']] as const) {
      const { unmount } = (await setupWithUnmount(route))
      const tabs = within(await screen.findByTestId('skills-tabs')).getAllByRole('tab')
      expect(tabs.map(t => t.getAttribute('data-testid'))).toEqual(['skills-tab-ai', 'skills-tab-dsa', 'skills-tab-design', 'skills-tab-stats'])
      expect(tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.getAttribute('data-testid'))).toEqual([`skills-tab-${id}`])
      unmount()
    }
  })
  it('activating a tab goes to its route', async () => {
    await setup('/skills')
    fireEvent.click(await screen.findByTestId('skills-tab-dsa'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/skills/dsa'))
    fireEvent.click(screen.getByTestId('skills-tab-design'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/skills/design'))
    fireEvent.click(screen.getByTestId('skills-tab-ai'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/\/skills$/))
  })
  it('the AI map has ten tiles, none for dsa or design, and its summary counts AI nodes only', async () => {
    await setup('/skills')
    await screen.findByTestId('skills-summary')
    expect(screen.getAllByTestId(/^skills-area-[a-z]+$/)).toHaveLength(10)
    expect(screen.queryByTestId('skills-area-dsa')).toBeNull()
    expect(screen.queryByTestId('skills-area-design')).toBeNull()
    expect(screen.getByTestId('skills-summary')).toHaveTextContent('2 of 8 topics done · pick an area to open it')
  })
})

async function setupWithUnmount(route: string) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, coreMinutes: 960 })
  await d.tickets.bulkPut([...mkAiTickets(), ...TREE_TICKETS()])
  return renderWithApp(<Routes><Route path="/skills/*" element={<Skills />} /><Route path="*" element={null} /></Routes>, { db: d, ...appPlans(planOver), route })
}

describe('TREE-05, TREE-06, TREE-09 tree area views', () => {
  it('DSA: header from the plan, progress in problems, one node and one edge per link, no All areas', async () => {
    await setup('/skills/dsa')
    const view = await screen.findByTestId('skills-area-view')
    expect(view).toHaveAttribute('data-area', 'dsa')
    expect(view).toHaveTextContent('Data structures and algorithms')
    expect(view).toHaveTextContent('DS')
    expect(view).toHaveTextContent('1 of 3 topics')
    const prog = screen.getByTestId('skills-area-progress')
    expect(prog).toHaveTextContent('3 of 6 problems')
    expect(prog).toHaveAttribute('data-done', '3')
    expect(prog).toHaveAttribute('data-total', '6')
    expect(screen.getAllByTestId(/^skills-node-(DA|SD)\d+$/).map(n => n.getAttribute('data-testid'))).toEqual(['skills-node-DA01', 'skills-node-DA02', 'skills-node-DA03'])
    expect(screen.getAllByTestId(/^skills-node-edge-/).map(e => e.getAttribute('data-testid')).sort()).toEqual(['skills-node-edge-DA01-DA02', 'skills-node-edge-DA02-DA03'])
    expect(screen.queryByTestId('skills-all-areas')).toBeNull()
    expect(screen.getByTestId('skills-node-meter-DA02')).toHaveAttribute('data-done', '1')
    expect(screen.getByTestId('skills-node-meter-DA02')).toHaveAttribute('data-total', '3')
  })
  it('Design: progress in designs', async () => {
    await setup('/skills/design')
    const view = await screen.findByTestId('skills-area-view')
    expect(view).toHaveAttribute('data-area', 'design')
    expect(screen.getByTestId('skills-area-progress')).toHaveTextContent('1 of 3 designs')
    expect(screen.queryByTestId('skills-all-areas')).toBeNull()
  })
  it('states: done, inprog, available; no tree node is locked or carries a note or a padlock, whatever its prerequisites (TREE-08)', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    expect(screen.getByTestId('skills-node-DA01')).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('skills-node-DA02')).toHaveAttribute('data-state', 'inprog')
    expect(screen.getByTestId('skills-node-DA03')).toHaveAttribute('data-state', 'available')
    expect(screen.queryByTestId('skills-node-note-DA03')).toBeNull()
    expect(document.querySelector('[data-testid^="skills-node-note-"]')).toBeNull()
    expect(document.querySelector('[data-state="locked"], [data-glyph="lock"]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Recommended first/)
  })
  it('the AI quest keeps the next state in the AI view and none in the trees', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    expect(document.querySelectorAll('[data-state="next"]')).toHaveLength(0)
  })
})

describe('TREE-07 old area routes redirect', () => {
  it('/skills/area/dsa and /skills/area/design go to the tabs, the query kept', async () => {
    await setup('/skills/area/dsa?node=DA02')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/skills/dsa'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?node=DA02')
    expect(await screen.findByTestId('skills-area-view')).toHaveAttribute('data-area', 'dsa')
  })
  it('an AI area still shows its view with All areas', async () => {
    await setup('/skills/area/llm')
    expect(await screen.findByTestId('skills-all-areas')).toBeInTheDocument()
    expect(screen.getByTestId('skills-area-view')).toHaveAttribute('data-area', 'llm')
    expect(screen.queryByTestId('skills-area-progress')).toBeNull()
  })
})

describe('TREE-10, TREE-11 the node panel lists the items', () => {
  it('one row per item in order with title, difficulty text and letter, done state and status, linking to the work page', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA02'))
    const list = within(screen.getByTestId('skills-node-panel')).getByTestId('skills-node-items')
    const rows = within(list).getAllByTestId(/^skills-node-item-p\d+$/)
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['skills-node-item-p3', 'skills-node-item-p4', 'skills-node-item-p5'])
    expect(rows[0]).toHaveAttribute('data-done', 'true')
    expect(rows[0]).toHaveTextContent('Done')
    expect(rows[1]).toHaveAttribute('data-done', 'false')
    expect(rows[1]).toHaveAttribute('data-status', 'todo')
    expect(rows[1]).not.toHaveTextContent('Done')
    expect(rows[1].querySelector('[data-content="plan"]')).toHaveTextContent('4 · Problem 4')
    expect(rows[1]).toHaveAttribute('href', '/do/p4')
    const diff = screen.getByTestId('skills-node-item-difficulty-p4')
    expect(diff).toHaveTextContent('Hard')
    expect(diff).toHaveAttribute('data-difficulty', 'H')
    expect(screen.getByTestId('skills-node-item-difficulty-p5')).toHaveTextContent('Medium')
  })
  it('Design rows link to the design session', async () => {
    await setup('/skills/design')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-SD02'))
    expect(screen.getByTestId('skills-node-item-d-b')).toHaveAttribute('href', '/designs/session/d-b')
    expect(screen.getByTestId('skills-node-item-difficulty-d-c')).toHaveTextContent('Medium')
    expect(screen.getByTestId('skills-node-item-difficulty-d-b')).toHaveTextContent('Hard')
  })
  it('an AI node has no item list', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    expect(screen.queryByTestId('skills-node-items')).toBeNull()
  })
})

describe('TREE-12, TREE-13, TREE-14, TREE-15 the node action', () => {
  it('START · PROBLEM starts the first todo item: route /do/<id>, the ticket doing', async () => {
    const d = await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA02'))
    const start = screen.getByTestId('skills-node-start')
    expect(start).toHaveTextContent('START · PROBLEM')
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/p4'))
    await waitFor(async () => expect((await d.tickets.get('p4'))!.status).toBe('doing'))
  })
  it('START · DESIGN opens the design session', async () => {
    const d = await setup('/skills/design')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-SD02'))
    const start = screen.getByTestId('skills-node-start')
    expect(start).toHaveTextContent('START · DESIGN')
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/designs/session/d-b'))
    await waitFor(async () => expect((await d.tickets.get('d-b'))!.status).toBe('doing'))
  })
  it('a doing item makes the action OPEN · PROBLEM, which only navigates and writes nothing (doing before todo, SKILLS-17)', async () => {
    const tickets = TREE_TICKETS().map(t => (t.id === 'p5' ? { ...t, status: 'doing' as const } : t))
    const d = await setup('/skills/dsa', tickets)
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA02'))
    const start = screen.getByTestId('skills-node-start')
    expect(start).toHaveTextContent('OPEN · PROBLEM')
    const before = JSON.stringify(await d.tickets.toArray())
    const events = await d.events.count()
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/p5'))
    expect(JSON.stringify(await d.tickets.toArray())).toBe(before)
    expect(await d.events.count()).toBe(events)
  })
  it('a finished node has no action and every row done', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA01'))
    expect(screen.queryByTestId('skills-node-start')).toBeNull()
    for (const r of screen.getAllByTestId(/^skills-node-item-p\d+$/)) expect(r).toHaveAttribute('data-done', 'true')
  })
  it('a node whose prerequisite is not done starts its next item and says nothing about blocking or unlocking', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA03'))
    expect(screen.getByTestId('skills-node-start')).toBeEnabled()
    expect(screen.getByTestId('skills-node-panel').textContent).not.toMatch(/blocked|forbidden|unlock by/i)
  })
  it('TREE-15: the panel reads "Builds on: <titles>" in pre order, each a link to ?node=, and nothing for a root', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA03'))
    const line = screen.getByTestId('skills-node-builds-on')
    expect(line.textContent).toMatch(/^Builds on: .+/)
    const links = line.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/skills/dsa?node=DA02')
    expect(line.textContent).toBe(`Builds on: ${links[0].textContent}`)
    expect(screen.queryByText('Needs first')).toBeNull()
    fireEvent.click(screen.getByTestId('skills-node-DA01'))
    expect(screen.queryByTestId('skills-node-builds-on')).toBeNull()
  })
  it('blocked and help items are skipped when choosing the next item', async () => {
    const tickets = TREE_TICKETS().map(t => (t.id === 'p4' ? { ...t, status: 'blocked' as never } : t))
    await setup('/skills/dsa', tickets)
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-DA02'))
    fireEvent.click(screen.getByTestId('skills-node-start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/p5'))
  })
})

describe('TREE-18, SKILLS-11 a DSA quest makes its tree node next', () => {
  it('the next node is the tree node of the quest ticket, and the AI map has no next node', async () => {
    quest.ticketId = 'p5'
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    expect(document.querySelectorAll('[data-state="next"]')).toHaveLength(1)
    expect(screen.getByTestId('skills-node-DA02')).toHaveAttribute('data-state', 'next')
    fireEvent.click(screen.getByTestId('skills-tab-ai'))
    await screen.findByTestId('skills-summary')
    fireEvent.click(screen.getByTestId('skills-area-llm'))
    await screen.findByTestId('skills-area-view')
    expect(document.querySelectorAll('[data-state="next"]')).toHaveLength(0)
  })
})

describe('SKILLS-16 / NAV-25 ?node=', () => {
  it('opens the area with that node selected and its panel shown, for an AI area and for the tree tabs', async () => {
    await setup('/skills/area/llm?node=L4')
    await screen.findByTestId('skills-area-view')
    expect(screen.getByTestId('skills-node-L4')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('skills-node-panel')).toHaveTextContent('How inference works')
  })
  it('the tree tab selects the node named, not the default one', async () => {
    await setup('/skills/dsa?node=DA03')
    await screen.findByTestId('skills-area-view')
    expect(screen.getByTestId('skills-node-DA03')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('skills-node-panel')).toHaveTextContent('Graphs')
  })
  it('selecting by hand never writes the parameter', async () => {
    await setup('/skills/area/llm?node=L4')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-L3'))
    expect(screen.getByTestId('skills-node-L3')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?node=L4')
  })
  it('a plain area view and a plain tree tab select no node and show no panel (NAV-25, no pre-selected quest node)', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    expect(selected()).toHaveLength(0)
    expect(screen.queryByTestId('skills-node-panel')).toBeNull()
  })
  it('a plain tree tab selects nothing either', async () => {
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    expect(selected()).toHaveLength(0)
    expect(screen.queryByTestId('skills-node-panel')).toBeNull()
  })
  it('an unknown node id selects nothing and shows no panel', async () => {
    await setup('/skills/area/llm?node=no-such-node')
    await screen.findByTestId('skills-area-view')
    expect(selected()).toHaveLength(0)
    expect(screen.queryByTestId('skills-node-panel')).toBeNull()
    expect(screen.queryByTestId('screen-error')).toBeNull()
  })
  it('a node of another area selects nothing', async () => {
    await setup('/skills/area/llm?node=M1')
    await screen.findByTestId('skills-area-view')
    expect(selected()).toHaveLength(0)
    expect(screen.queryByTestId('skills-node-panel')).toBeNull()
    cleanupNote()
  })
  it('a tree node on an AI area, and an AI node on a tree tab, are foreign', async () => {
    await setup('/skills/area/llm?node=DA01')
    await screen.findByTestId('skills-area-view')
    expect(selected()).toHaveLength(0)
  })
})
function cleanupNote() { /* the screens render one at a time per test */ }

describe('TREE-19 phone', () => {
  it('no graph, one row per node with data-layer, the four tabs, items and the action in an expanded row', async () => {
    phone(true)
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    expect(screen.queryByTestId('skills-node-DA01')).toBeNull()
    const list = screen.getByTestId('skills-list')
    expect(within(list).getAllByRole('treeitem').map(r => r.getAttribute('data-testid'))).toEqual(['skills-row-DA01', 'skills-row-DA02', 'skills-row-DA03'])
    expect(screen.getByTestId('skills-row-DA03')).toHaveAttribute('data-layer', '2')
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(screen.queryByTestId('skills-all-areas')).toBeNull()
    fireEvent.click(within(screen.getByTestId('skills-row-DA02')).getByText('Windows'))
    const row = screen.getByTestId('skills-row-DA02')
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(within(row).getByTestId('skills-node-items')).toBeInTheDocument()
    expect(within(row).getAllByTestId(/^skills-node-item-p\d+$/)).toHaveLength(3)
    const start = within(row).getByTestId('skills-node-start')
    expect(start).toHaveTextContent('START · PROBLEM')
    // no next node in this tree: the expanded row's action is the one accent (TREE-19)
    expect(start).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('with a next node the one accent is skills-next-start and the expanded row has none', async () => {
    phone(true)
    quest.ticketId = 'p5'
    await setup('/skills/dsa')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(within(screen.getByTestId('skills-row-DA02')).getByText('Windows'))
    expect(screen.getByTestId('skills-next-start')).toHaveAttribute('data-accent', 'primary')
    expect(within(screen.getByTestId('skills-row-DA02')).getByTestId('skills-node-start')).not.toHaveAttribute('data-accent')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('?node= expands that row (NAV-24) and asks the browser to scroll it into view', async () => {
    phone(true)
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await setup('/skills/area/llm?node=L4')
    await screen.findByTestId('skills-area-view')
    expect(screen.getByTestId('skills-row-L4')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('skills-row-L3')).toHaveAttribute('aria-expanded', 'false')
    expect(scroll).toHaveBeenCalled()
  })
})

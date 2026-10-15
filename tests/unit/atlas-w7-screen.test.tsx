import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { ATOMS, ATOM_NAMES, PATTERNS, patternBySlug } from '../../src/content/atlas'
import { Atlas } from '../../src/screens/Atlas'
import { Dsa } from '../../src/screens/Dsa'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { flatPlanProse, realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const plan = realPlan()
const search = () => screen.getByTestId('location').getAttribute('data-search')

async function setupAtlas(route = '/atlas') {
  const d = await seededDb(plan, '2026-10-05')
  renderWithApp(<Atlas />, { db: d, plan, route, path: '/atlas' })
  await screen.findByTestId('atlas-summary')
  return d
}

describe('Atlas W7: the grid explained and linked (ATLAS-01 to 07)', () => {
  beforeAll(installAlgoEngines)

  it('ATLAS-01: the intro line is there with or without a row selected', async () => {
    await setupAtlas()
    const intro = 'Rows are patterns, columns are data structures; a cell shows where the pattern applies'
    expect(screen.getByTestId('atlas-intro')).toHaveTextContent(intro)
    fireEvent.click(screen.getByRole('button', { name: 'Binary search' }))
    expect(screen.getByTestId('atlas-intro')).toHaveTextContent(intro)
  })

  it('ATLAS-02, ATLAS-03: 36 rows x 16 cells, each with a title and an accessible name of its kind', async () => {
    await setupAtlas()
    expect(PATTERNS.length).toBeGreaterThanOrEqual(36)
    expect(ATOMS).toHaveLength(16)
    for (const p of PATTERNS) {
      expect(screen.getByTestId(`atlas-row-${p.slug}`)).toBeInTheDocument()
      for (const a of ATOMS) {
        const cell = screen.getByTestId(`atlas-cell-${p.slug}-${a}`)
        const kind = cell.getAttribute('data-kind')
        const text = kind === 'main' ? 'main picture' : kind === 'side' ? 'side panel' : 'not drawn'
        expect(['main', 'side', 'none']).toContain(kind)
        expect(cell.getAttribute('title')).toBe(`${p.label}: ${ATOM_NAMES[a]} ${text}`)
        expect(cell.getAttribute('aria-label')).toBe(`${p.label}: ${ATOM_NAMES[a]} ${text}`)
      }
    }
    expect(screen.getByRole('cell', { name: 'Binary search: number line main picture' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Two pointers: linked list side panel' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Two pointers: grid not drawn' })).toBeInTheDocument()
  }, 30_000)

  it('ATLAS-04: main and side cells link to the row, none cells do not; focus lands on the problem list', async () => {
    await setupAtlas()
    expect(screen.queryByTestId('atlas-cell-link-two-pointers-GRID')).toBeNull()
    for (const p of PATTERNS) for (const a of ATOMS) {
      const kind = screen.getByTestId(`atlas-cell-${p.slug}-${a}`).getAttribute('data-kind')
      expect(!!screen.queryByTestId(`atlas-cell-link-${p.slug}-${a}`), `${p.slug} ${a}`).toBe(kind !== 'none')
    }
    const link = screen.getByTestId('atlas-cell-link-shortest-path-GRAPH')
    fireEvent.click(link)
    expect(search()).toBe('?pattern=shortest-path')
    const list = await screen.findByTestId('atlas-problems')
    await waitFor(() => expect(list).toHaveFocus())
    const n = list.querySelectorAll('[data-testid^="atlas-problem-"]').length
    expect(n).toBeGreaterThan(0)
    expect(link.getAttribute('aria-label')).toBe(`Shortest path: graph main picture, ${n} ${n === 1 ? 'problem' : 'problems'}`)
    // a one-problem row says "1 problem"
    expect(screen.getByTestId('atlas-cell-link-flow-matching-GRAPH').getAttribute('aria-label')).toBe('Flow · matching: graph main picture, 1 problem')
    // a second activation on the already open row brings focus back to the list
    ;(screen.getByRole('heading', { name: 'Shortest path' }) as HTMLElement).focus()
    fireEvent.click(link)
    await waitFor(() => expect(list).toHaveFocus())
  }, 30_000)

  it('ATLAS-05, ATLAS-06, ATLAS-07: every row has a walkthrough, a problem, and a Left that agrees', async () => {
    await setupAtlas()
    for (const p of PATTERNS) {
      fireEvent.click(screen.getByRole('button', { name: p.label }))
      const detail = within(await screen.findByTestId('atlas-detail'))
      expect(detail.getByRole('heading', { name: p.label })).toBeInTheDocument()
      expect(screen.getByTestId('atlas-detail')).toHaveAttribute('aria-label', `Pattern: ${p.label}`)
      expect(detail.queryByText('No walkthrough yet'), p.slug).toBeNull()
      expect(detail.queryByText('No plan problems tagged yet.'), p.slug).toBeNull()
      const walks = within(detail.getByTestId('atlas-walks')).getAllByTestId(/^atlas-walk-\d+$/)
      expect(walks.length, p.slug).toBeGreaterThanOrEqual(1)
      expect(within(walks[0]).getByRole('button', { name: 'Play' }), p.slug).toBeEnabled()
      const problems = within(detail.getByTestId('atlas-problems')).getAllByTestId(/^atlas-problem-/)
      expect(problems.length, p.slug).toBeGreaterThanOrEqual(1)
      for (const a of problems) expect(a.getAttribute('href')).toMatch(/^\/do\/p\d+$/)
      // fresh database: nothing is done, so Left is the number of listed problems
      expect(screen.getByTestId(`atlas-left-${p.slug}`).textContent).toBe(String(problems.length))
      expect(screen.getByTestId(`atlas-row-label-${p.slug}`).textContent).toBe(p.label)
      expect(within(walks[0]).getByTestId('atlas-walk-play-1')).toBe(within(walks[0]).getByRole('button', { name: 'Play' }))
    }
  }, 60_000)

  it('ATLAS-05: the first Play button opens the player for a new walkthrough', async () => {
    await setupAtlas('/atlas?pattern=trie')
    const first = await screen.findByTestId('atlas-walk-1')
    fireEvent.click(within(first).getByRole('button', { name: 'Play' }))
    expect(await screen.findByTestId('lab-player')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ATLAS-10: reading rows, cells and links writes nothing', async () => {
    const d = await setupAtlas()
    const count = async () => (await d.sessions.count()) + (await d.tickets.count()) + (await d.atlasRuns.count())
    const before = await count()
    fireEvent.click(screen.getByRole('button', { name: 'Trie' }))
    fireEvent.click(screen.getByTestId('atlas-cell-link-trie-TREE'))
    fireEvent.click(screen.getByRole('button', { name: 'Sorting' }))
    expect(await count()).toBe(before)
  })
})

describe('Atlas W7: DSA problems show their pattern (ATLAS-08)', () => {
  it('puts a pattern chip on each problem row, linking to its Atlas row', async () => {
    const d = await seededDb(flatPlanProse)
    renderWithApp(<Dsa />, { db: d, plan: flatPlanProse, route: '/dsa?topic=1', path: '/dsa' })
    await screen.findByTestId('topic-detail')
    const chip = screen.getByTestId('dsa-pattern-p200')
    expect(within(screen.getByTestId('row-p200')).getByTestId('dsa-pattern-p200')).toBe(chip)
    expect(chip).toHaveAttribute('href', '/atlas?pattern=bfs-dfs')
    expect(chip).toHaveTextContent('BFS / DFS')
    expect(chip.textContent).toBe(patternBySlug('bfs-dfs')!.label)
    expect(screen.getByTestId('dsa-pattern-p127')).toHaveAttribute('href', '/atlas?pattern=bfs-dfs')
  })
})

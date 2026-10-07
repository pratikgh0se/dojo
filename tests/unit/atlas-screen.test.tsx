import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { recordPredict, recordSeen, setSessionApproach } from '../../src/data/atlasActions'
import { closeSession } from '../../src/data/sessionActions'
import { Atlas } from '../../src/screens/Atlas'
import { seededDb } from '../helpers/db'
import { installAlgoEngines } from '../helpers/engines'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const plan = realPlan()
type Db = Awaited<ReturnType<typeof seededDb>>
async function setup(route = '/atlas', prep?: (d: Db) => Promise<void>) {
  const d = await seededDb(plan, '2026-10-05')
  if (prep) await prep(d)
  renderWithApp(<Atlas />, { db: d, plan, route, path: '/atlas' })
  await screen.findByTestId('atlas-summary')
  return d
}
const search = () => screen.getByTestId('location').getAttribute('data-search')
const rowLabels = () => within(screen.getByRole('table', { name: 'Atlas matrix' })).getAllByRole('rowheader').map(h => h.textContent)
const detail = () => within(screen.getByTestId('atlas-detail'))

describe('Atlas screen (labs contract §5)', () => {
  beforeAll(installAlgoEngines)

  it('UAT J9: the legend explains every colour, and every column abbreviation is spelled out', async () => {
    await setup()
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(legend).toHaveTextContent('cell: main picture')
    expect(legend).toHaveTextContent('cell: side panel')
    const key = screen.getByTestId('atlas-atom-key')
    for (const [abbr, name] of [['FRAME', 'call frames'], ['INTVL', 'intervals'], ['NUMLN', 'number line'], ['TAPE', 'one-pass stream'], ['LEFT', 'problems left to solve']]) {
      expect(key).toHaveTextContent(`${abbr} ${name}`)
    }
    expect(key.querySelectorAll('b')).toHaveLength(18)
    const table = screen.getByRole('table', { name: 'Atlas matrix' })
    expect(within(table).getByRole('columnheader', { name: 'NUMLN' })).toHaveAttribute('title', 'number line')
  })

  it('shows the summary, progressbar, 36 grey rows, the atom columns and the cells (S1, S5)', async () => {
    await setup()
    expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
    expect(screen.getByTestId('atlas-summary')).toHaveTextContent('16 atoms · 36 patterns · you have predicted 0')
    expect(screen.getByRole('progressbar', { name: 'Patterns predicted' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByRole('progressbar', { name: 'Patterns predicted' })).toHaveAttribute('aria-valuemax', '36')
    const table = screen.getByRole('table', { name: 'Atlas matrix' })
    expect(within(table).getAllByRole('columnheader').map(c => c.textContent)).toEqual([
      'Pattern', 'ARRAY', 'GRID', 'GRAPH', 'TREE', 'LIST', 'STACK', 'QUEUE', 'HASH', 'FRAME', 'INTVL', 'BITS', 'FOREST', 'PLANE', 'NUMLN', 'TAPE', 'SETS', 'Left', 'Use',
    ])
    const rows = document.querySelectorAll('[data-testid^="atlas-row-"]')
    expect(rows).toHaveLength(36)
    expect([...rows].every(r => r.getAttribute('data-state') === 'none' && r.getAttribute('data-coverage') === 'none')).toBe(true)
    const kinds = [...screen.getByTestId('atlas-row-binary-search').querySelectorAll('[data-kind="main"]')].map(c => c.getAttribute('data-testid'))
    expect(kinds).toEqual(['atlas-cell-binary-search-ARRAY', 'atlas-cell-binary-search-NUMLN'])
    expect(screen.getByTestId('atlas-cell-two-pointers-LIST')).toHaveAttribute('data-kind', 'side')
    expect(screen.getByRole('button', { name: 'Binary search' })).toHaveAccessibleDescription('not seen')
  })

  it('colours rows from recorded runs and counts M (S13, S18)', async () => {
    await setup('/atlas', async d => {
      await recordSeen(d, 'topoSort', 1)
      await recordPredict(d, 'binarySearch', 4, 4, 2)
    })
    expect(screen.getByTestId('atlas-row-topo-sort')).toHaveAttribute('data-state', 'seen')
    expect(screen.getByTestId('atlas-row-binary-search')).toHaveAttribute('data-state', 'predicted')
    expect(screen.getByTestId('atlas-summary')).toHaveTextContent('you have predicted 1')
    expect(screen.getByRole('button', { name: 'Binary search' })).toHaveAccessibleDescription('predicted')
  })

  it('deep-links a row into the detail panel; unknown patterns are ignored (S3, S4)', async () => {
    await setup('/atlas?pattern=shortest-path')
    expect(screen.getByRole('complementary', { name: 'Pattern: Shortest path' })).toBeInTheDocument()
    const list = detail().getByRole('list', { name: 'Walkthroughs' })
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringContaining("Dijkstra's shortest paths"), expect.stringContaining('Bellman-Ford')])
    expect(screen.getByTestId('atlas-coverage').textContent).toMatch(/^Coverage: live/)
    expect(detail().getByRole('heading', { name: 'Shortest path' })).toHaveFocus()
  })

  it('ignores an unknown pattern', async () => {
    await setup('/atlas?pattern=nope')
    expect(screen.queryByTestId('atlas-detail')).toBeNull()
  })

  it('shows rows without a walkthrough honestly (S6)', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Flow · matching' }))
    expect(search()).toBe('?pattern=flow-matching')
    expect(detail().getByText('No walkthrough yet')).toBeInTheDocument()
    expect(screen.getByTestId('atlas-coverage')).toHaveTextContent('Coverage: gap · edge labels show one number; needs cap/flow pairs')
    expect(detail().getByRole('button', { name: 'Trace my own input' })).toBeDisabled()
    expect(detail().getByRole('button', { name: 'Trace my own input' })).toHaveAccessibleDescription('No runnable walkthrough for this pattern.')
    expect(screen.getByTestId('atlas-last-picture')).toHaveTextContent('No picture generated yet.')
  })

  it('lists plan problems as Do links (S7)', async () => {
    await setup('/atlas?pattern=topo-sort')
    expect(within(detail().getByRole('list', { name: 'Problems' })).getByRole('link', { name: '207 Course Schedule' })).toHaveAttribute('href', '/do/p207')
  })

  it('sorts by problems left and remembers it (S8)', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sort by problems left' }))
    expect(screen.getByRole('button', { name: 'Sort by problems left' })).toHaveAttribute('aria-pressed', 'true')
    const lefts = [...document.querySelectorAll('.am-left')].map(c => Number(c.textContent))
    expect(lefts).toEqual([...lefts].sort((a, b) => b - a))
    expect(localStorage.getItem('dojo-atlas-sort-left')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by problems left' }))
    expect(rowLabels()[0]).toBe('Two pointers')
    expect(rowLabels()[35]).toBe('Sieve · primes')
  })

  it('filters while typing and Enter picks the first visible row (S9, S10)', async () => {
    await setup()
    const box = screen.getByRole('searchbox', { name: 'Search patterns or problems' })
    fireEvent.change(box, { target: { value: 'dp' } })
    expect(rowLabels()).toEqual(['DP · memo', 'DP · tabulation', 'DP · bitmask'])
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'DP · memo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('complementary', { name: 'Pattern: DP · memo' })).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '' } })
    expect(rowLabels()).toHaveLength(36)
    fireEvent.change(box, { target: { value: '743' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(within(detail().getByRole('list', { name: 'Problems' })).getByRole('link', { name: '743 Network Delay Time' })).toBeInTheDocument()
  })

  it('asks classify when nothing matches locally (S11)', async () => {
    await setup()
    const box = screen.getByRole('searchbox', { name: 'Search patterns or problems' })
    fireEvent.change(box, { target: { value: 'shortest path with k stops across flights zzz' } })
    expect(screen.getByTestId('atlas-search-status')).toHaveTextContent('No local match. Press Enter to ask classify.')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('atlas-search-status')).toHaveTextContent('Matched by classify: Sliding window'))
    expect(rowLabels()).toHaveLength(36)
    expect(search()).toBe('?pattern=sliding-window')
    // UAT cu-6 P3-7: the line is about the matched row; once another row is open it is gone
    fireEvent.click(screen.getByRole('button', { name: 'Prefix sum' }))
    expect(search()).toBe('?pattern=prefix-sum')
    expect(screen.getByTestId('atlas-search-status')).toHaveTextContent(/^$/)
  })

  it('says No match. when classify fails', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'classify')
    await setup()
    const box = screen.getByRole('searchbox', { name: 'Search patterns or problems' })
    fireEvent.change(box, { target: { value: 'zzz qqq' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('atlas-search-status')).toHaveTextContent('No match.'))
    expect(search()).toBe('')
  })

  it('opens own input from a list item and traces it (S12)', async () => {
    await setup('/atlas?pattern=binary-search')
    const item = within(detail().getByRole('list', { name: 'Walkthroughs' })).getAllByRole('listitem')[0]
    fireEvent.click(within(item).getByRole('button', { name: 'Own input' }))
    const form = await screen.findByRole('form', { name: 'Own input: Binary search' })
    fireEvent.change(within(form).getByLabelText('Values'), { target: { value: '1,3,5,7,9' } })
    fireEvent.change(within(form).getByLabelText('Target'), { target: { value: '7' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Trace' }))
    await waitFor(() => expect(screen.getByTestId('lab-step-counter')).toHaveTextContent('STEP 0 / 13'))
    expect(screen.getByRole('region', { name: 'Player: Binary search' })).toBeInTheDocument()
  })

  it('two-up follows D-9: pairs, next in row, disabled on single rows (S29, S31, S34)', async () => {
    await setup('/atlas?pattern=mst')
    const item = () => within(detail().getByRole('list', { name: 'Walkthroughs' })).getAllByRole('listitem')[0]
    expect(within(item()).getByRole('button', { name: 'Two-up' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'DP · memo' }))
    fireEvent.click(within(item()).getByRole('button', { name: 'Two-up' }))
    await waitFor(() => expect(screen.getAllByRole('region', { name: /^Player: / }).map(r => r.getAttribute('aria-label'))).toEqual(['Player: Memoization · fib(5)', 'Player: Tabulation · fib(5)']))
    fireEvent.click(screen.getByRole('button', { name: 'Union-find' }))
    expect(within(item()).getByRole('button', { name: 'Own input' })).toBeDisabled()
    expect(within(item()).getByRole('button', { name: 'Own input' })).toHaveAccessibleDescription('Fixed example: no own input.')
  })

  it('rolls approach answers into the row and the panel, hollow when avoided (S43, S44)', async () => {
    await setup('/atlas?pattern=shortest-path', async d => {
      for (const [id, at] of [['p743', 1], ['p1514', 2]] as const) {
        const r = await closeSession(d, id, 'solved', { sessionStart: at, now: at + 60_000 })
        if (r.ok) await setSessionApproach(d, r.session.id, 'other')
      }
    })
    expect(screen.getByTestId('atlas-row-shortest-path')).toHaveAttribute('data-coverage', 'avoided')
    expect(within(screen.getByTestId('atlas-row-shortest-path')).getByRole('img', { name: 'Approach use' })).toHaveAccessibleDescription('avoided')
    expect(screen.getByTestId('atlas-approach-coverage')).toHaveTextContent('Reached for 0 · best answer 2')
  })

  it('Escape closes the panel and returns focus to the row button (S48)', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Greedy' }))
    expect(detail().getByRole('heading', { name: 'Greedy' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('atlas-detail')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Greedy' })).toHaveFocus())
  })
})

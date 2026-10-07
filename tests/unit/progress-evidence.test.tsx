import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Session } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { Progress } from '../../src/screens/Progress'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// smallPlan starts 2026-09-07; problems p127 and friends come from tests/fixtures/plan.small.json.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const AT = ist('2026-09-08T10:00:00')
const val = (key: string) => screen.getByTestId(`ev-${key}-value`).textContent

async function setup(seed?: (d: Awaited<ReturnType<typeof seededDb>>) => Promise<void>) {
  setNow(() => AT)
  const d = await seededDb()
  if (seed) await seed(d)
  renderWithApp(<Progress />, { db: d, plan: smallPlan, route: '/progress', path: '/progress' })
  await screen.findByTestId('progress-help-ladder')
  return d
}

describe('Progress evidence (C-INT §4)', () => {
  it('I-11 empty profile: nine zero values and three groups', async () => {
    await setup()
    const region = screen.getByRole('region', { name: 'Evidence' })
    expect(within(region).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['DSA', 'Design', 'AI'])
    expect(['dsa-solved', 'dsa-help', 'dsa-gaveup', 'dsa-redo', 'design-dives', 'design-redesign'].map(val)).toEqual(['0', '0', '0', '0 / 0', `0 / ${smallPlan.design_bank.reduce((a, t) => a + t.items.length, 0) * 4}`, '0 / 0'])
    expect(val('ai-blank')).toBe('0')
    expect(screen.getByTestId('ev-dsa-solved')).toHaveAttribute('href', '/dsa')
    expect(screen.getByTestId('ev-design-dives')).toHaveAttribute('href', '/designs')
    expect(screen.getByTestId('ev-ai-stages')).toHaveAttribute('href', '/ai')
    expect(screen.getByTestId('ev-design-radar')).toHaveAttribute('href', '/designs')
  })

  it('I-12 DSA values follow the latest Do session per problem', async () => {
    const [a, b, c] = ['p1', 'p127', 'p200'] // the three problems in tests/fixtures/plan.small.json
    await setup(async d => {
      const s = (id: string, ticketId: string, outcome: Session['outcome'], rungs?: Session['rungs']): Session =>
        ({ id, ticketId, start: AT - 3_600_000, end: AT - 3_000_000, minutes: 10, outcome, xpDelta: 0, ...(rungs ? { rungs } : {}) })
      await d.sessions.bulkAdd([s('s1', a, 'solved'), s('s2', b, 'solved_help', [1, 2]), s('s3', c, 'gave_up', [1, 5])])
      await d.tickets.update(a, { status: 'done' })
      await d.tickets.update(b, { status: 'done' })
    })
    await waitFor(() => expect(['dsa-solved', 'dsa-help', 'dsa-gaveup'].map(val)).toEqual(['1', '1', '1']))
    const table = screen.getByRole('table', { name: 'Help ladder usage data' })
    const rows = [...table.querySelectorAll('tr')].map(r => [...r.querySelectorAll('th, td')].map(x => x.textContent))
    expect(rows[0]).toEqual(['Sprint', 'Attempt only', 'Hint', 'Picture', 'Video', 'Solution'])
    expect(rows[1]).toEqual(['S1', '1', '1', '0', '0', '1'])
  })

  it('cu-final row 6: a solved card unticked on Banks / the Board leaves "Solved without help" at once', async () => {
    const d = await setup(async db => {
      await db.sessions.add({ id: 's1', ticketId: 'p1', start: AT - 3_600_000, end: AT - 3_000_000, minutes: 10, outcome: 'solved', xpDelta: 0 })
      await db.tickets.update('p1', { status: 'done' })
    })
    await waitFor(() => expect(val('dsa-solved')).toBe('1'))
    await d.tickets.update('p1', { status: 'todo' })
    await waitFor(() => expect(val('dsa-solved')).toBe('0'))
  })

  it('I-16 every number is a click into its tab', async () => {
    await setup()
    expect(screen.getByTestId('ev-dsa-solved')).toHaveAttribute('href', '/dsa')
    expect(screen.getByTestId('ev-design-dives')).toHaveAttribute('href', '/designs')
    expect(screen.getByTestId('ev-ai-stages')).toHaveAttribute('href', '/ai')
    expect(screen.getByTestId('ev-design-radar')).toHaveAttribute('href', '/designs')
  })

  it('I-17 reload survives (rerender keeps the same nine values)', async () => {
    const [a, b, c] = ['p1', 'p127', 'p200']
    await setup(async d => {
      const s = (id: string, ticketId: string, outcome: Session['outcome'], rungs?: Session['rungs']): Session =>
        ({ id, ticketId, start: AT - 3_600_000, end: AT - 3_000_000, minutes: 10, outcome, xpDelta: 0, ...(rungs ? { rungs } : {}) })
      await d.sessions.bulkAdd([s('s1', a, 'solved'), s('s2', b, 'solved_help'), s('s3', c, 'gave_up')])
      await d.tickets.update(a, { status: 'done' })
      await d.tickets.update(b, { status: 'done' })
    })
    await waitFor(() => expect(['dsa-solved', 'dsa-help', 'dsa-gaveup'].map(val)).toEqual(['1', '1', '1']))
    const before = ['dsa-solved', 'dsa-help', 'dsa-gaveup', 'dsa-redo', 'design-dives', 'design-redesign', 'ai-stages', 'ai-measured', 'ai-blank'].map(val)
    expect(before).toEqual(['1', '1', '1', '0 / 0', '0 / 8', '0 / 0', '0/12', '0/0', '0'])
  })
})

// UAT cu-3 P3-6: the DSA ring said 2/169 and the Evidence stats 0, 0, 0 for two cards ticked on the Board
describe('Progress evidence: problems marked done without a Do attempt (cu-3 P3-6)', () => {
  it('the stats keep leaving a tick out (I-12) and a line says how many problems the DSA ring counts that they do not', async () => {
    await setup(async d => {
      await d.tickets.bulkUpdate([
        { key: 'p1', changes: { status: 'done', doneAt: AT - 1000, xp: 10 } },
        { key: 'p127', changes: { status: 'done', doneAt: AT - 1000, xp: 10 } },
      ])
    })
    await waitFor(() => expect(screen.getByTestId('ring-dsa-count')).toHaveTextContent(/^2\//))
    expect(['dsa-solved', 'dsa-help', 'dsa-gaveup'].map(val)).toEqual(['0', '0', '0'])
    expect(screen.getByTestId('ev-dsa-ticked')).toHaveTextContent('2 more problems are marked done without a Do attempt, so not counted above.')
  })

  it('one tick reads "1 more problem is", and with none the line is not there', async () => {
    await setup(async d => { await d.tickets.update('p1', { status: 'done', doneAt: AT - 1000, xp: 10 }) })
    expect(await screen.findByTestId('ev-dsa-ticked')).toHaveTextContent('1 more problem is marked done without a Do attempt, so not counted above.')
  })

  it('a problem done through a Do session is in the stats, not in the line', async () => {
    await setup(async d => {
      await d.tickets.update('p1', { status: 'done', doneAt: AT - 1000, xp: 10 })
      await d.sessions.add({ id: 's1', ticketId: 'p1', start: AT - 3_600_000, end: AT - 3_000_000, minutes: 10, outcome: 'solved', xpDelta: 10 })
    })
    await waitFor(() => expect(val('dsa-solved')).toBe('1'))
    expect(screen.queryByTestId('ev-dsa-ticked')).toBeNull()
  })
})

describe('Progress: help ladder usage and redo hit rate (C-INT §5, §6)', () => {
  it('I-18 / I-22 empty honesty chart and redo hit rate', async () => {
    await setup()
    expect(screen.getByTestId('help-ladder-empty')).toHaveTextContent('No sessions yet')
    expect(screen.queryByTestId('help-ladder-table')).toBeNull()
    const region = screen.getByRole('region', { name: 'Help ladder usage' })
    expect(region).toHaveAttribute('id', 'help-ladder')
    expect(['redo-passed-value', 'redo-failed-value', 'redo-refunded-value'].map(t => screen.getByTestId(t).textContent)).toEqual(['0', '0', '+0 xp'])
  })

  it('I-19 one sprint of sessions fills the honesty chart table', async () => {
    const [a, b, c] = ['p1', 'p127', 'p200'] // the three problems in tests/fixtures/plan.small.json
    await setup(async d => {
      const s = (id: string, ticketId: string, outcome: 'solved' | 'solved_help' | 'gave_up', rungs?: number[]) =>
        ({ id, ticketId, start: AT - 3_600_000, end: AT - 3_000_000, minutes: 10, outcome, xpDelta: 0, ...(rungs ? { rungs } : {}) })
      await d.sessions.bulkAdd([s('s1', a, 'solved'), s('s2', b, 'solved_help', [1, 2]), s('s3', c, 'gave_up', [1, 5])] as never)
    })
    const table = await screen.findByRole('table', { name: 'Help ladder usage data' })
    const rows = [...table.querySelectorAll('tr')].map(r => [...r.querySelectorAll('th, td')].map(x => x.textContent))
    expect(rows[0]).toEqual(['Sprint', 'Attempt only', 'Hint', 'Picture', 'Video', 'Solution'])
    expect(rows[1]).toEqual(['S1', '1', '1', '0', '0', '1'])
  })

  it('I-23 redo hit rate from redo events', async () => {
    await setup(async d => {
      await d.events.bulkAdd([
        { t: 'redo_pass', id: 'p127', at: AT, stage: 0, refund: 5 },
        { t: 'redo_fail', id: 'p127', at: AT + 1, stage: 1, refund: 0 },
      ] as never)
    })
    await waitFor(() => expect(screen.getByTestId('redo-refunded-value')).toHaveTextContent('+5 xp'))
    expect(screen.getByTestId('redo-passed-value')).toHaveTextContent('1')
    expect(screen.getByTestId('redo-failed-value')).toHaveTextContent('1')
  })
})

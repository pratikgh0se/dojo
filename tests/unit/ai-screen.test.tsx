import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { ensureSeedArtifacts } from '../../src/data/projectActions'
import type { PlanJson } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { Ai } from '../../src/screens/Ai'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { stagePlan } from '../helpers/stagePlan'

// Start 2026-09-07: S1 = Sep 7–20, S2 = Sep 21–Oct 4, S3 = Oct 5–18.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const S1 = ist('2026-09-08T10:00:00')

async function setup(at = S1, route = '/ai', plan: PlanJson = stagePlan()) {
  setNow(() => at)
  const d = await seededDb(plan)
  await ensureSeedArtifacts(d, at)
  renderWithApp(<Ai />, { db: d, plan, route, path: '/ai' })
  await screen.findByRole('heading', { name: /AI · capstone/i })
  return d
}

describe('AI screen', () => {
  it('lists stage bands from plan data with range, count, state, and the checkpoint after the last band ≤ S38', async () => {
    await setup()
    expect(screen.getByTestId('stage-5')).toHaveTextContent('Stage 05 · Alpha')
    expect(screen.getByTestId('stage-5')).toHaveTextContent('S1–S2')
    expect(screen.getByTestId('stage-count-5')).toHaveTextContent('0/8')
    expect(screen.getByTestId('stage-state-5')).toHaveTextContent('Now')
    expect(screen.getByTestId('stage-state-6')).toHaveTextContent('Upcoming')
    const items = within(screen.getByTestId('stage-ladder')).getAllByRole('listitem').map(li => li.textContent ?? '')
    expect(items[items.length - 1]).toBe('Checkpoint · S38')
    expect(screen.getByTestId('stage-5')).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects a band into the URL and shows its sprint rows', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('stage-6'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?stage=6')
    expect(within(screen.getByTestId('stage-detail')).getByRole('heading', { name: 'Stage 06 · Beta' })).toBeInTheDocument()
    expect(screen.getByTestId('stage-row-3')).toBeInTheDocument()
    expect(screen.queryByTestId('stage-row-1')).toBeNull()
  })

  it('shows a single-sprint stage as "S3", not "S3–S3", in the ladder and the stage panel', async () => {
    await setup()
    expect(screen.getByTestId('stage-6')).toHaveTextContent('S3')
    expect(screen.getByTestId('stage-6')).not.toHaveTextContent('S3–S3')
    fireEvent.click(screen.getByTestId('stage-6'))
    expect(screen.getByTestId('stage-detail')).toHaveTextContent('S3 · 0/4 done')
  })

  it('ticks a watch cube: XP toast, band count and session balance move', async () => {
    const d = await setup()
    fireEvent.click(screen.getByTestId('cube-st5-s1-watch'))
    expect(await screen.findByText('+10 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('stage-count-5')).toHaveTextContent('1/8'))
    expect(screen.getByTestId('balance-watch')).toHaveTextContent('1/3')
    expect(screen.getByTestId('balance-rebuild')).toHaveTextContent('0/3')
    expect((await d.events.toArray()).map(e => [e.t, 'id' in e ? e.id : undefined])).toEqual([['tick', 'st5-s1-watch']])
  })

  it('opens a sprint row with ticket text, links, Do ▸ and the sprint proof', async () => {
    await setup(S1, '/ai?stage=5&sprint=2')
    const box = screen.getByTestId('sprint-tickets')
    expect(within(box).getAllByTestId(/^row-st5-s2-/)).toHaveLength(4)
    expect(box).toHaveTextContent('Stage 5 watch, sprint 2')
    expect(within(box).getAllByRole('link', { name: 'Ref 5 ↗' })[0]).toHaveAttribute('href', 'https://example.com/ref5')
    expect(screen.getByTestId('do-st5-s2-watch')).toHaveAttribute('href', '/do/st5-s2-watch')
    expect(screen.getByTestId('sprint-proof')).toHaveTextContent('Repo alpha')
    fireEvent.click(screen.getByTestId('stage-row-1'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?stage=5&sprint=1')
    expect(screen.queryByTestId('sprint-proof')).toBeNull()
  })

  it('reflects a tick made elsewhere', async () => {
    const d = await setup()
    await moveTicket(d, 'st5-s1-rebuild', 'done', S1)
    await waitFor(() => expect(screen.getByTestId('cube-st5-s1-rebuild')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('before the start date every band is upcoming and the first is selected (Review Focus #5)', async () => {
    await setup(ist('2026-09-01T10:00:00'))
    expect(screen.getByTestId('stage-state-5')).toHaveTextContent('Upcoming')
    expect(screen.getByTestId('stage-5')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the optional shelf collapsed, grouped by skill label', async () => {
    await setup()
    const shelf = screen.getByTestId('shelf')
    expect(shelf.tagName).toBe('DETAILS')
    expect(shelf).not.toHaveAttribute('open')
    expect(within(shelf).getByText('Optional shelf · 2')).toBeInTheDocument()
    expect(within(shelf).getByRole('heading', { name: 'Neural nets' })).toBeInTheDocument()
    expect(within(shelf).getByRole('heading', { name: 'papers' })).toBeInTheDocument()
  })

  it('shows Working with AI prose', async () => {
    await setup()
    expect(screen.getByRole('heading', { name: "The rule: type what teaches, generate what doesn't" })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tutor prompts, copy and use' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^GPU budget/ })).toBeInTheDocument()
  })

  it('legacy plan: "This plan has no capstone stages", no shelf', async () => {
    await setup(S1, '/ai', smallPlan)
    expect(screen.getByTestId('ai-empty')).toHaveTextContent('This plan has no capstone stages')
    expect(screen.queryByTestId('shelf')).toBeNull()
  })

  it('names session cubes "<Session> · S<n>" with aria-pressed (C-PROJECTS §2.7)', async () => {
    await setup(S1, '/ai?stage=5')
    const watch = screen.getByRole('button', { name: 'Watch · S1' })
    expect(watch).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Rebuild · S2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build · S1' })).toHaveAttribute('data-testid', 'cube-st5-s1-build')
    expect(screen.getByRole('button', { name: 'Teachback · S2' })).toBeInTheDocument()
    expect(within(screen.getByTestId('stage-detail')).getAllByText('Teach-back').length).toBeGreaterThan(0)
    fireEvent.click(watch)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Watch · S1' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('shows a rung cube per band, full only when the seeded stage artifact is measured (C-PROJECTS §2.7)', async () => {
    const d = await setup()
    const rung = screen.getByTestId('ai-rung-05')
    expect(rung).toHaveAttribute('data-state', 'empty')
    expect(rung).toHaveAccessibleName('Stage 05 artifact not measured')
    expect(screen.getByTestId('ai-rung-06')).toHaveAttribute('data-state', 'empty')
    expect(screen.getByTestId('stage-5')).not.toContainElement(rung)
    await d.artifacts.update('art-stage-05', { status: 'measured' })
    await waitFor(() => expect(screen.getByTestId('ai-rung-05')).toHaveAttribute('data-state', 'full'))
    expect(screen.getByRole('img', { name: 'Stage 05 artifact measured' })).toBe(screen.getByTestId('ai-rung-05'))
  })
})

// R1 W6: the Design and AI tabs of /banks in jsdom (BANK-01, BANK-08 to BANK-10, BANK-26, BANK-27).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { Banks } from '../../src/screens/Banks'
import { seededDb } from '../helpers/db'
import { realPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const readOnly = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/data/writer')>()
  return { ...real, isReadOnly: () => readOnly.on }
})

const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime()
type Q = { id: string; area: string; question: string; answer: string; checklist: string[] }

async function setup(route: string) {
  setNow(() => NOW)
  const plan = realPlan() as unknown as { qbank: Q[] }
  const d = await seededDb(realPlan(), '2026-10-05')
  renderWithApp(<Banks />, { db: d, plan: realPlan(), planV2: realPlan(), route, path: '/banks' })
  return { d, qbank: plan.qbank }
}
afterEach(() => { readOnly.on = false })

describe('/banks tabs', () => {
  it('has DSA, Design and AI in order; no area parameter is DSA and shows the old screen only', async () => {
    await setup('/banks')
    await screen.findByTestId('banks-page')
    expect(within(screen.getByTestId('banks-areas')).getAllByRole('tab').map(t => t.textContent)).toEqual(['DSA', 'Design', 'AI'])
    expect(screen.getByTestId('banks-area-dsa')).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-testid^="banks-q-"]')).toBeNull()
  })

  it('?area=design and ?area=ai select their tab and show banks-q-page, not banks-page', async () => {
    await setup('/banks?area=design')
    expect(await screen.findByTestId('banks-q-page')).toHaveAttribute('data-area', 'design')
    expect(screen.getByTestId('banks-area-design')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('banks-page')).toBeNull()
    fireEvent.click(screen.getByTestId('banks-area-ai'))
    await waitFor(() => expect(screen.getByTestId('banks-q-page')).toHaveAttribute('data-area', 'ai'))
    expect(screen.getByTestId('location').getAttribute('data-search')).toBe('?area=ai')
  })
})

describe('the node filter follows the tab (BANK-25)', () => {
  const nodeOptions = () => within(screen.getByTestId('banks-q-filter-node')).getAllByRole('option').map(o => o.textContent)
  it('lists AI nodes on the AI tab and design nodes on Design, and switching back and forth refreshes the options', async () => {
    await setup('/banks?area=design')
    await screen.findByTestId('banks-q-page')
    expect(nodeOptions()).toContain('The design method')
    expect(nodeOptions()).not.toContain('Neural network basics')
    fireEvent.click(screen.getByTestId('banks-area-ai'))
    expect(nodeOptions()).toContain('Neural network basics')
    expect(nodeOptions()).not.toContain('The design method')
    fireEvent.click(screen.getByTestId('banks-area-design'))
    expect(nodeOptions()).toContain('The design method')
    expect(nodeOptions()).not.toContain('Neural network basics')
  })
  it('drops the other tab\'s node filter when the tab changes', async () => {
    await setup('/banks?area=design&node=SD01')
    await screen.findByTestId('banks-q-page')
    expect(screen.getByTestId('banks-q-filter-node')).toHaveValue('SD01')
    fireEvent.click(screen.getByTestId('banks-area-ai'))
    expect(screen.getByTestId('banks-q-filter-node')).toHaveValue('')
    expect(screen.getByTestId('banks-q-more')).toBeDisabled()
  })
})

describe('answer first', () => {
  it('shows nothing of the model answer before reveal, and reveal needs a non-space character', async () => {
    const { qbank } = await setup('/banks?area=design')
    const q = qbank.find(x => x.area === 'design')!
    fireEvent.click(await screen.findByTestId(`banks-q-row-${q.id}`))
    const reveal = screen.getByTestId('banks-q-reveal')
    expect(screen.getByTestId('banks-q-answer')).toHaveValue('')
    expect(reveal).toBeDisabled()
    expect(reveal).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(document.body.textContent).not.toContain(q.checklist[0])
    expect(screen.queryByTestId('banks-q-grade-hard')).toBeNull()
    fireEvent.change(screen.getByTestId('banks-q-answer'), { target: { value: '   ' } })
    expect(reveal).toBeDisabled()
    fireEvent.change(screen.getByTestId('banks-q-answer'), { target: { value: 'x' } })
    expect(reveal).toBeEnabled()
    expect(reveal).toHaveTextContent('REVEAL · ANSWER')
    fireEvent.click(reveal)
    expect(screen.getByTestId('banks-q-model')).toHaveTextContent(q.answer.slice(0, 30))
    expect(screen.getByTestId('banks-q-checklist').querySelectorAll('input[type="checkbox"]')).toHaveLength(q.checklist.length)
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
    for (const g of ['again', 'hard', 'good', 'easy']) expect(screen.getByTestId(`banks-q-grade-${g}`)).toBeEnabled()
  })
})

describe('read-only browser (BANK-26)', () => {
  it('browses, types and reveals, but grading, Add to Review, More questions and Delete are disabled', async () => {
    readOnly.on = true
    const { qbank } = await setup('/banks?area=design')
    const q = qbank.find(x => x.area === 'design')!
    expect(await screen.findByTestId('banks-q-more')).toBeDisabled()
    fireEvent.click(screen.getByTestId(`banks-q-row-${q.id}`))
    fireEvent.change(screen.getByTestId('banks-q-answer'), { target: { value: 'my answer' } })
    fireEvent.click(screen.getByTestId('banks-q-reveal'))
    expect(screen.getByTestId('banks-q-model')).toBeVisible()
    for (const g of ['again', 'hard', 'good', 'easy']) expect(screen.getByTestId(`banks-q-grade-${g}`)).toBeDisabled()
    expect(screen.queryByTestId('banks-q-add-review')).toBeNull()
  })

  it('writes nothing while a question is opened, answered and revealed (BANK-25)', async () => {
    const { d, qbank } = await setup('/banks?area=ai')
    const q = qbank.find(x => x.area === 'ai')!
    const count = async () => (await d.bankGrades.count()) + (await d.bankExtra.count()) + (await d.redos.count()) + (await d.aiLog.count())
    const before = await count()
    fireEvent.click(await screen.findByTestId(`banks-q-row-${q.id}`))
    fireEvent.change(screen.getByTestId('banks-q-answer'), { target: { value: 'something' } })
    fireEvent.click(screen.getByTestId('banks-q-reveal'))
    fireEvent.click(screen.getByTestId('banks-q-check-1'))
    expect(await count()).toBe(before)
  })
})

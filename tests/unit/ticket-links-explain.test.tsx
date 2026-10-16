import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearStudy } from '../../src/lib/studyStore'
import { Do } from '../../src/screens/Do'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

vi.mock('../../src/data/labActions', () => ({ fetchLabInfo: vi.fn(async () => null), setupLab: vi.fn(), runChecks: vi.fn(), getHint: vi.fn(), requestReview: vi.fn() }))
afterEach(() => { cleanup(); clearStudy() })

const plans = appPlans()
async function open(t: ReturnType<typeof mkTicket>) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.put(t)
  renderWithApp(<Do />, { db: d, ...plans, route: `/do/${t.id}`, path: '/do/:ticketId' })
  return d
}
const build = mkTicket({
  id: 'bq', kind: 'build', lane: 'path', title: 'Build: roofline', estMin: 40, text: 'Write the function.', lab: { id: 'x', gpu: 'none' },
  links: [{ label: 'Roofline paper', url: 'https://example.com/roofline' }, { label: 'Notes', url: '#bank' }, { label: 'Bad', url: 'javascript:alert(1)' }],
  explain: ['Why is decode memory-bound?'], explainAnswers: ['Each token reads all the weights.'],
})

describe('build ticket: links and explain questions', () => {
  it('lists its links 1-based in plan order, the label as the text, web links in a new tab with noopener', async () => {
    await open(build)
    const list = await screen.findByTestId('ticket-links')
    const first = screen.getByTestId('ticket-link-1')
    expect(list).toContainElement(first)
    expect(first).toHaveAttribute('href', 'https://example.com/roofline')
    expect(first).toHaveAttribute('target', '_blank')
    expect(first.getAttribute('rel')).toContain('noopener')
    expect(first.textContent).toBe('Roofline paper')
    expect(screen.getByTestId('ticket-link-2')).toHaveAttribute('href', '/dsa')
    expect(screen.getByTestId('ticket-link-2')).not.toHaveAttribute('target')
    expect(screen.queryByTestId('ticket-link-3')).toBeNull() // a javascript: link is never shown
  })
  it('puts the GPU chip before the links and the links before the lab block', async () => {
    await open({ ...build, lab: { id: 'x', gpu: 'none' } })
    const chip = await screen.findByTestId('ticket-lab')
    const links = screen.getByTestId('ticket-links')
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(chip, links)).toBe(true)
    expect(follows(links, await screen.findByTestId('ticket-lab-block'))).toBe(true)
    expect(screen.getByTestId('ticket-notes')).toBeInTheDocument()
  })
  it('shows the explain question, keeps the reference hidden until answered, then reveals it', async () => {
    await open(build)
    expect(await screen.findByTestId('ticket-explain-q-1')).toHaveTextContent('Why is decode memory-bound?')
    expect(screen.getByTestId('ticket-reveal')).toBeDisabled()
    expect(document.body.textContent).not.toContain('Each token reads all the weights.')
    fireEvent.change(screen.getByTestId('ticket-explain-answer-1'), { target: { value: 'Because of weights.' } })
    fireEvent.click(screen.getByTestId('ticket-reveal'))
    expect(await screen.findByTestId('ticket-reference-1')).toHaveTextContent('Each token reads all the weights.')
  })
  it('a build with no links and no questions shows neither', async () => {
    await open({ ...build, id: 'bn', links: [], explain: undefined, explainAnswers: undefined })
    await screen.findByTestId('do-title')
    expect(screen.queryByTestId('ticket-links')).toBeNull()
    expect(screen.queryByTestId('ticket-explain')).toBeNull()
    expect(screen.queryByTestId('ticket-reveal')).toBeNull()
  })
})

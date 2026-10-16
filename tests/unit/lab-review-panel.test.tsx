import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabReviewRow } from '../../src/data/types'
import { resetLabInfoCache } from '../../src/data/labHooks'
import { clearStudy } from '../../src/lib/studyStore'
import { Do } from '../../src/screens/Do'
import { freshDb } from '../helpers/db'
import { INFO } from '../helpers/labServer'
import { mkLabRow, mkReview, mkRun } from '../helpers/labRows'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const act = vi.hoisted(() => ({ fetchLabInfo: vi.fn(), setupLab: vi.fn(), runChecks: vi.fn(), getHint: vi.fn(), requestReview: vi.fn() }))
vi.mock('../../src/data/labActions', () => act)
beforeEach(() => { resetLabInfoCache(); for (const f of Object.values(act)) f.mockReset(); act.fetchLabInfo.mockResolvedValue(INFO) })
afterEach(() => { cleanup(); clearStudy() })

const plans = appPlans()
const ALL = [mkRun('t-lab', 5, { c1: 'pass', c2: 'pass', c3: 'pass' })]
const item = (id: string, score: 0 | 1 | 2 | 3, over: Partial<LabReviewRow['items'][number]> = {}) =>
  ({ id, score, evidence: score >= 2 ? [{ quote: 'the quote', file: 'WRITEUP.md', line: 4 }] : [], stronger: `Stronger ${id}.`, ...over })
const review = (at: number, passed: boolean, scores: (0 | 1 | 2 | 3)[], over: Partial<LabReviewRow> = {}) =>
  mkReview('t-lab', at, passed, { percent: passed ? 83 : 25, summary: passed ? 'Solid work.' : 'Getting there.', items: scores.map((s, i) => item(`r${i + 1}`, s)), ...over })

async function open(id: string, seed: (d: ReturnType<typeof freshDb>) => Promise<void>) {
  clearStudy()
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.put(mkTicket({ id, kind: 'build', lane: 'path', title: id, lab: { id: 't-lab', gpu: 'none' } }))
  await d.labs.put(mkLabRow('t-lab'))
  await seed(d)
  renderWithApp(<Do />, { db: d, ...plans, route: `/do/${id}`, path: '/do/:ticketId' })
  return d
}
const done = async (d: ReturnType<typeof freshDb>) => { await d.labRuns.bulkPut(ALL) }

describe('review panel in the lab block', () => {
  it('is on every ticket of the lab, inside the block, enabled when every milestone passed whichever ticket is open and whether or not any ticket is done', async () => {
    for (const id of ['tlab.build.1', 'tlab.build.2', 'tlab.build.3']) {
      await open(id, done)
      const block = await screen.findByTestId('ticket-lab-block')
      expect(within(block).getByTestId('ticket-reviewer')).toHaveAttribute('data-lab-id', 't-lab')
      expect(screen.getByTestId('ticket-review-request')).toBeEnabled()
      expect(screen.getByTestId('ticket-review-request')).toHaveTextContent('Request review')
      expect(screen.getByTestId('ticket-review-request')).not.toHaveAttribute('data-accent')
      expect(screen.queryByTestId('ticket-review-note')).toBeNull()
      cleanup()
    }
  })
  it('is locked, with the note, while a milestone is open', async () => {
    await open('tlab.build.1', async d => { await d.labRuns.put(mkRun('t-lab', 5, { c1: 'pass', c2: 'pass', c3: 'fail' })) })
    expect(await screen.findByTestId('ticket-review-request')).toBeDisabled()
    expect(screen.getByTestId('ticket-review-note')).toHaveTextContent('Available once every milestone is passed.')
  })
  it('is absent on a ticket with no lab', async () => {
    clearStudy()
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put(mkTicket({ id: 'plain', kind: 'build', lane: 'path' }))
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/plain', path: '/do/:ticketId' })
    await screen.findByTestId('do-title')
    expect(screen.queryByTestId('ticket-reviewer')).toBeNull()
  })

  it('requests the review, shows it busy, and shows the stored result', async () => {
    let finish: () => void = () => {}
    act.requestReview.mockImplementation(async (d, labId) => {
      await new Promise<void>(r => { finish = r })
      await d.labReviews.put(review(9, true, [3, 2, 3, 2]))
      return { ok: true }
    })
    await open('tlab.build.1', done)
    fireEvent.click(await screen.findByTestId('ticket-review-request'))
    expect(await screen.findByTestId('ticket-review-running')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-reviewer')).toHaveAttribute('data-running', 'true')
    expect(screen.getByTestId('ticket-review-request')).toBeDisabled()
    finish()
    const badge = await screen.findByTestId('ticket-review-badge')
    expect(badge).toHaveTextContent('Proven')
    expect(badge).toHaveAttribute('data-state', 'proven')
    expect(screen.getByTestId('ticket-review-percent')).toHaveTextContent('83%')
    expect(screen.getByTestId('ticket-review-summary')).toHaveTextContent('Solid work.')
    expect(screen.getByTestId('ticket-review-item-r1')).toHaveAttribute('data-score', '3')
    expect(screen.getByTestId('ticket-review-item-text-r1')).toHaveTextContent('States the problem.')
    expect(screen.getByTestId('ticket-review-score-r1')).toHaveTextContent('3 of 3')
    expect(screen.getByTestId('ticket-review-score-r2')).toHaveTextContent('2 of 3')
    const ev = screen.getByTestId('ticket-review-evidence-r1-1')
    expect(ev.textContent).toMatch(/^WRITEUP\.md:4/)
    expect(ev).toHaveTextContent('the quote')
    expect(screen.getByTestId('ticket-review-stronger-r1')).toHaveTextContent('What a stronger version does Stronger r1.')
    expect(screen.getByTestId('ticket-review-request')).toBeEnabled() // a Proven lab can be reviewed again
    expect(screen.queryByTestId('ticket-review-running')).toBeNull()
  })
  it('Not yet is the badge, with the points to work on and a way to ask again; never the word fail', async () => {
    await open('tlab.build.1', async d => { await done(d); await d.labReviews.put(review(9, false, [1, 0, 1, 1])) })
    const badge = await screen.findByTestId('ticket-review-badge')
    expect(badge).toHaveTextContent('Not yet')
    expect(badge).toHaveAttribute('data-state', 'notyet')
    const weak = screen.getByTestId('ticket-review-weak')
    expect(within(weak).getByText('To work on')).toBeInTheDocument()
    for (const id of ['r1', 'r2', 'r3', 'r4']) expect(within(weak).getByTestId(`ticket-review-weak-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId('ticket-review-weak-r3')).toHaveTextContent('Explains the approach.')
    expect(screen.getByTestId('ticket-review-request')).toBeEnabled()
    expect(screen.getByTestId('ticket-reviewer').textContent).not.toMatch(/\bfail|\bwrong\b|\bbad\b/i)
  })
  it('a Proven review can still list weak points', async () => {
    await open('tlab.build.1', async d => { await done(d); await d.labReviews.put(review(9, true, [3, 3, 3, 1])) })
    expect(await screen.findByTestId('ticket-review-badge')).toHaveTextContent('Proven')
    expect(screen.getByTestId('ticket-review-weak-r4')).toBeInTheDocument()
    expect(screen.queryByTestId('ticket-review-weak-r1')).toBeNull()
  })
  it('the newest review counts', async () => {
    await open('tlab.build.1', async d => { await done(d); await d.labReviews.bulkPut([review(9, true, [3, 3, 3, 3]), review(10, false, [1, 1, 1, 1], { percent: 33 })]) })
    expect(await screen.findByTestId('ticket-review-badge')).toHaveTextContent('Not yet')
    expect(screen.getByTestId('ticket-review-percent')).toHaveTextContent('33%')
  })
  it('a dirty lab keeps the request button and says to commit first; no Retry', async () => {
    act.requestReview.mockResolvedValue({ ok: false, code: 'lab_dirty', message: 'x' })
    await open('tlab.build.1', done)
    fireEvent.click(await screen.findByTestId('ticket-review-request'))
    expect(await screen.findByTestId('ticket-review-error')).toHaveTextContent('Commit your work in the lab folder first, then request the review.')
    expect(screen.getByTestId('ticket-review-request')).toBeEnabled()
    expect(screen.queryByTestId('ticket-review-retry')).toBeNull()
  })
  it('a deleted lab folder says so, keeps the button, and the block returns to not-set-up', async () => {
    act.requestReview.mockResolvedValue({ ok: false, code: 'not_set_up', message: 'x' })
    await open('tlab.build.1', done)
    fireEvent.click(await screen.findByTestId('ticket-review-request'))
    expect(await screen.findByTestId('ticket-review-error')).toHaveTextContent('The lab folder was not found. Set up the lab again to create it.')
    expect(screen.getByTestId('ticket-review-request')).toBeEnabled()
    expect(screen.getByTestId('ticket-lab-block')).toHaveAttribute('data-state', 'not-set-up')
    expect(screen.getByTestId('ticket-reviewer')).toBeInTheDocument()
  })
  it('an unusable reply shows its line with Retry, and Retry asks again; there is no way to score it yourself', async () => {
    act.requestReview.mockResolvedValueOnce({ ok: false, code: 'invalid_output', message: 'x' })
    await open('tlab.build.1', done)
    fireEvent.click(await screen.findByTestId('ticket-review-request'))
    expect(await screen.findByTestId('ticket-review-error')).toHaveTextContent('The review did not come through in a form Dojo can read. Nothing is lost: Retry asks again.')
    expect(screen.queryByTestId('ticket-review-request')).toBeNull()
    act.requestReview.mockResolvedValueOnce({ ok: false, code: 'invalid_output', message: 'again' })
    fireEvent.click(screen.getByTestId('ticket-review-retry'))
    await waitFor(() => expect(act.requestReview).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/score it yourself|self-score/i)).toBeNull()
  })
  it('model-written text avoids the banned word; code quotes are learner content', async () => {
    await open('tlab.build.1', async d => { await done(d); await d.labReviews.put(review(9, true, [3, 2, 3, 2], { summary: 'Strong interview-ready lab.' })) })
    expect(await screen.findByTestId('ticket-review-summary')).toHaveTextContent('Strong session-ready lab.')
    expect(screen.getByTestId('ticket-review-evidence-r1-1').querySelector('[data-content="learner"]')).not.toBeNull()
  })
})

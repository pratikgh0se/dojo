import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DayMix, NextAction } from '../../src/rules/dayMix'
import { paceLine } from '../../src/rules/pace'
import type { Ticket } from '../../src/data/types'
import { clearStudy, saveStudy } from '../../src/lib/studyStore'
import { startStudy } from '../../src/rules/studySession'
import { Today } from '../../src/screens/Today'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const m = vi.hoisted(() => ({ model: null as unknown }))
const ro = vi.hoisted(() => ({ on: false }))
const PACE = 'at this pace the plan ends about March 2028'
vi.mock('../../src/data/flatHooks', () => ({
  useTodayModel: () => m.model,
  usePace: () => ({ projection: {}, line: PACE, budgets: [90, 60, 60, 60, 30, 30, 150] }),
}))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

const watch = mkTicket({ id: 'w1', kind: 'watch', title: 'Watch: Karpathy deep dive', estMin: 45, phase: 1, explain: ['Q1', 'Q2'], links: [{ label: 'Video', url: 'https://youtu.be/x' }] })
const dsa = mkTicket({ id: 'd1', kind: 'problem', lane: 'dsa', title: '1 · Two Sum', estMin: 30 })
const mix = (items: Ticket[], over: Partial<DayMix> = {}): DayMix => ({ budget: 60, items, floor: false, waitsForLongerDay: [], lanesDone: [], ...over })
const pickOf = (all: Ticket[]) => ({
  doing: all.filter(t => t.status === 'doing'),
  lanes: (['path', 'dsa', 'design'] as const).map(lane => {
    const open = all.filter(t => (t.lane ?? 'path') === lane && t.status === 'todo')
    return { lane, items: open.slice(0, 10), more: Math.max(0, open.length - 10), total: open.length }
  }),
})
const model = (next: NextAction, items: Ticket[], over: Record<string, unknown> = {}, all: Ticket[] = items) =>
  ({ next, mix: mix(items), pathNote: null, budgets: [90, 60, 60, 60, 30, 30, 150], careerLane: false, dueReviews: 6, pick: pickOf(all), ...over })
const plans = appPlans()
const done = (t: Ticket, id = 'x') => ({ ...t, status: 'done' as const, id })
afterEach(() => { clearStudy(); m.model = null; ro.on = false; localStorage.clear() })

async function setup(tickets: Ticket[], mdl: unknown, route = '/') {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.bulkPut(tickets)
  m.model = mdl
  renderWithApp(<Today />, { db: d, ...plans, route })
  await screen.findByTestId('today-quest')
  return d
}

describe('Today', () => {
  it('shows one quest card with title, kind, estimate, link, a one-line reason and the one accent button', async () => {
    await setup([watch, dsa], model({ kind: 'start', ticket: watch, reason: 'next in your queue, about 45 min' }, [watch, dsa]))
    const quest = screen.getByTestId('today-quest')
    expect(quest).toHaveAttribute('data-action', 'start')
    expect(quest).toHaveAttribute('data-ticket-id', 'w1')
    expect(screen.getAllByTestId('today-quest')).toHaveLength(1)
    expect(screen.getByTestId('today-title')).toHaveTextContent('Watch: Karpathy deep dive')
    expect(screen.getByTestId('today-kind')).toHaveTextContent('Watch')
    expect(screen.getByTestId('today-est')).toHaveTextContent('45 min')
    const link = screen.getByTestId('today-link')
    expect(link).toHaveAttribute('href', 'https://youtu.be/x')
    expect(link).toHaveAttribute('data-content', 'plan')
    expect(screen.getByTestId('open-link')).toContainElement(link)
    const reason = screen.getByTestId('today-reason').textContent!
    expect(reason).toMatch(/next in your queue, about 45 min/i)
    expect(reason.length).toBeLessThanOrEqual(120)
    expect(reason).not.toMatch(/\n/)
    const start = screen.getByTestId('start-button')
    expect(start).toHaveAttribute('data-accent', 'primary')
    expect(start).toHaveTextContent('START · WATCH')
    expect(start.textContent).toMatch(/^[A-Za-z]+ · .+$/)
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    const pick = screen.getByTestId('today-pick-else')
    expect(pick).toHaveTextContent('Pick something else')
    expect(pick).not.toHaveAttribute('data-accent')
    expect(pick.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pick.parentElement).toBe(start.parentElement)
  })

  it('shows a problem title verbatim, number included', async () => {
    await setup([dsa], model({ kind: 'start', ticket: dsa, reason: 'next in your queue, about 30 min' }, [dsa]))
    expect(screen.getByTestId('today-title').textContent).toBe('1 · Two Sum')
    expect(screen.getByTestId('start-button')).toHaveTextContent('START · PROBLEM')
  })

  it('has no data-ticket-id on a review or wait quest, and data-action is one of the four values', async () => {
    await setup([watch], model({ kind: 'review', count: 11, reason: '11 reviews are due' }, [watch], { dueReviews: 11 }))
    expect(screen.getByTestId('today-quest')).toHaveAttribute('data-action', 'review')
    expect(screen.getByTestId('today-quest')).not.toHaveAttribute('data-ticket-id')
  })
  it('has no data-ticket-id on a wait quest even when S2 hands it a ticket', async () => {
    await setup([watch], model({ kind: 'wait', ticket: watch, reason: 'nothing is open yet' }, []))
    expect(screen.getByTestId('today-quest')).toHaveAttribute('data-action', 'wait')
    expect(screen.getByTestId('today-quest')).not.toHaveAttribute('data-ticket-id')
  })

  it('resumes with the time left when the session runs on that ticket, else with the kind', async () => {
    saveStudy(startStudy({ id: 's', ticketId: 'w1', goal: '', cardIds: ['w1'], focusMin: 25, breakMin: 5, chime: false, now: Date.now(), single: true }))
    await setup([watch], model({ kind: 'resume', ticket: watch, reason: 'you started this' }, [watch]))
    expect(screen.getByTestId('today-quest')).toHaveAttribute('data-action', 'resume')
    expect(screen.getByTestId('today-quest')).toHaveAttribute('data-ticket-id', 'w1')
    expect(screen.getByTestId('start-button').textContent).toMatch(/^RESUME · \d\d:\d\d$/)
    expect(screen.getByTestId('today-reason').textContent).toMatch(/you started this/i)
  })
  it('resumes with the kind when the session timer ran out (over)', async () => {
    const s = startStudy({ id: 's', ticketId: 'w1', goal: '', cardIds: ['w1'], focusMin: 25, breakMin: 5, chime: false, now: Date.now(), single: true })
    saveStudy({ ...s, over: true })
    await setup([watch], model({ kind: 'resume', ticket: watch, reason: 'you started this' }, [watch]))
    expect(screen.getByTestId('start-button')).toHaveTextContent('RESUME · WATCH')
  })
  it('resumes with the kind when the session is on another ticket', async () => {
    saveStudy(startStudy({ id: 's', ticketId: 'other', goal: '', cardIds: ['other'], focusMin: 25, breakMin: 5, chime: false, now: Date.now(), single: true }))
    await setup([watch], model({ kind: 'resume', ticket: watch, reason: 'you started this' }, [watch]))
    expect(screen.getByTestId('start-button')).toHaveTextContent('RESUME · WATCH')
  })

  it('offers START · REVIEW and leads to Review when reviews come first', async () => {
    await setup([watch], model({ kind: 'review', count: 11, reason: '11 reviews are due' }, [watch], { dueReviews: 11 }))
    expect(screen.getByTestId('start-button')).toHaveTextContent('START · REVIEW')
    expect(screen.getByTestId('today-reason').textContent).toMatch(/11/)
    fireEvent.click(screen.getByTestId('start-button'))
    expect(screen.getByTestId('location')).toHaveTextContent('/review')
  })

  it('has no orange button when nothing can start, and names the wait (TODAY-21)', async () => {
    await setup([], model({ kind: 'wait', ticket: null, reason: 'nothing is open yet' }, [], { dueReviews: 0 }))
    expect(screen.getByTestId('today-quest')).toHaveAttribute('data-action', 'wait')
    expect(screen.getByTestId('today-title').textContent!.length).toBeGreaterThan(0)
    expect(screen.getByTestId('today-reason')).toHaveTextContent(/nothing is open yet/i)
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
    expect(screen.getByTestId('today-pick-else')).toBeInTheDocument()
  })
  it('says the phase sentence once on the empty screen', async () => {
    await setup([], model({ kind: 'wait', ticket: null, reason: 'Phase 2 tickets are being written' }, [], { dueReviews: 0, pathNote: 'Phase 2 tickets are being written' }))
    expect(screen.getByTestId('today-reason')).toHaveTextContent('Phase 2 tickets are being written')
    expect(screen.queryByTestId('today-phase-note')).toBeNull()
  })

  it('names a long ticket that waits for a longer day, with the title as plan content', async () => {
    const build = mkTicket({ id: 'b1', kind: 'build', estMin: 75, title: 'Build: tokensim step 2' })
    await setup([build, dsa], { ...model({ kind: 'start', ticket: dsa, reason: 'next in your queue, about 30 min' }, [dsa]), mix: mix([dsa], { waitsForLongerDay: [build] }) })
    const waits = screen.getByTestId('today-waits')
    expect(waits).toHaveTextContent('"Build: tokensim step 2" waits for a longer day.')
    expect(waits.querySelector('[data-content="plan"]')).toHaveTextContent('Build: tokensim step 2')
  })
  it('names every other first-open ticket that waits, each as plan content (TODAY-14)', async () => {
    const b1 = mkTicket({ id: 'b1', kind: 'build', estMin: 90, title: 'Write Kahn algorithm' })
    const b2 = mkTicket({ id: 'b2', kind: 'build', estMin: 120, title: 'Design a feed' })
    await setup([b1, b2, dsa], { ...model({ kind: 'start', ticket: dsa, reason: 'next in your queue, about 30 min' }, [dsa]), mix: mix([dsa], { waitsForLongerDay: [b1, b2] }) })
    const waits = screen.getByTestId('today-waits')
    expect(waits).toHaveTextContent('"Write Kahn algorithm" waits for a longer day.')
    expect(waits).toHaveTextContent('"Design a feed" waits for a longer day.')
    expect(waits.querySelectorAll('[data-content="plan"]')).toHaveLength(2)
  })
  it('shows no waits line when nothing waits', async () => {
    await setup([watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch]))
    expect(screen.queryByTestId('today-waits')).toBeNull()
  })

  it('shows the phase note S2 supplies and still shows another lane (Review Focus 1)', async () => {
    await setup([dsa], model({ kind: 'start', ticket: dsa, reason: 'next in your queue, about 30 min' }, [dsa], { pathNote: 'Phase 2 tickets are being written' }))
    expect(screen.getByTestId('today-phase-note')).toHaveTextContent('Phase 2 tickets are being written')
    expect(screen.getByTestId('today-title')).toHaveTextContent('Two Sum')
    expect(document.body.textContent).not.toMatch(/error|undefined|Cannot/i)
  })

  it('opens the pick list per lane, changes nothing, closes on Esc and opens a chosen ticket', async () => {
    const lane = (l: 'path' | 'dsa' | 'design', n: number) => Array.from({ length: n }, (_, i) => mkTicket({ id: `${l}${i}`, lane: l, order: 100 + i, kind: l === 'dsa' ? 'problem' : 'watch' }))
    const all = [watch, ...lane('path', 12), ...lane('dsa', 3), ...lane('design', 2)]
    const d = await setup(all, model({ kind: 'start', ticket: watch, reason: 'x' }, [watch], {}, all))
    const before = JSON.stringify(await d.tickets.toArray())
    fireEvent.click(screen.getByTestId('today-pick-else'))
    const list = screen.getByTestId('today-pick-list')
    expect(screen.getByTestId('today-pick-else')).toHaveAttribute('aria-expanded', 'true')
    expect(list.querySelectorAll('[data-lane="path"]')).toHaveLength(10)
    expect(list.querySelectorAll('[data-lane="dsa"]')).toHaveLength(3)
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(screen.queryByTestId('today-pick-list')).toBeNull()
    expect(screen.getByTestId('today-pick-else')).toHaveFocus()
    expect(JSON.stringify(await d.tickets.toArray())).toBe(before)
    fireEvent.click(screen.getByTestId('today-pick-else'))
    fireEvent.click(screen.getByTestId('today-pick-item-dsa1'))
    expect(screen.getByTestId('location')).toHaveTextContent('/do/dsa1')
  })
  it('reads the lane tag as its own word after the title (TODAY-16)', async () => {
    await setup([watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch], {}, [watch, dsa]))
    fireEvent.click(screen.getByTestId('today-pick-else'))
    const text = screen.getByTestId(`today-pick-item-${dsa.id}`).textContent ?? ''
    expect(text).toMatch(/\bDSA\b/) // not run into the title
  })
  it('closes the pick list on Esc even when every lane is empty', async () => {
    await setup([watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch], {}, [watch]))
    fireEvent.click(screen.getByTestId('today-pick-else'))
    expect(screen.getByTestId('today-pick-list').querySelectorAll('[data-empty="true"]').length).toBeGreaterThan(0)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('today-pick-list')).toBeNull()
  })

  it('lists the other started tickets in the pick list (TODAY-04)', async () => {
    const doing = mkTicket({ id: 'dg', kind: 'build', status: 'doing', title: 'Build: gateway' })
    await setup([watch, doing], model({ kind: 'resume', ticket: watch, reason: 'you started this' }, [watch], {}, [watch, doing]))
    fireEvent.click(screen.getByTestId('today-pick-else'))
    expect(screen.getByTestId('today-pick-item-dg')).toBeInTheDocument()
  })

  it('shows a quiet second tile with an Open link, never a second start, and not on day zero', async () => {
    await setup([done(watch), watch, dsa], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch, dsa]))
    expect(screen.getByTestId('today-second-title')).toHaveTextContent('1 · Two Sum')
    const tile = screen.getByTestId('today-second')
    expect(tile).not.toHaveAttribute('data-accent')
    expect(tile.querySelector('button')).toBeNull()
    expect(tile.querySelector('a')).toHaveAttribute('href', '/do/d1')
    expect(screen.getAllByRole('button', { name: /^start/i })).toHaveLength(1)
  })
  it('skips started tickets and tickets of the quest lane for the second tile', async () => {
    const doing = mkTicket({ id: 'dg', kind: 'build', status: 'doing', lane: 'dsa', title: 'Started thing' })
    const sameLane = mkTicket({ id: 'p2', kind: 'watch', lane: 'path', title: 'Same lane' })
    await setup([done(watch), watch, doing, sameLane], model({ kind: 'start', ticket: watch, reason: 'x' }, [doing, watch, sameLane]))
    expect(screen.queryByTestId('today-second')).toBeNull()
  })
  it('shows only the first ticket on day zero', async () => {
    await setup([watch, dsa], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch, dsa]))
    expect(screen.queryByTestId('today-second')).toBeNull()
    expect(screen.queryByTestId('today-review-chip')).toBeNull()
    expect(screen.getByTestId('today-quest').closest('.qc-page')!.textContent).not.toMatch(/streak|debt|\d+\s*due/i)
  })

  it('shows the review chip with the count', async () => {
    await setup([done(watch), watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch], { dueReviews: 6 }))
    const chip = screen.getByTestId('today-review-chip')
    expect(chip.textContent).toBe('Review: 6 due')
    expect(chip).toHaveAttribute('data-count', '6')
    expect(chip).toHaveAttribute('href', '/review')
  })
  it('has no review chip when no review is due', async () => {
    await setup([done(watch), watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch], { dueReviews: 0 }))
    expect(screen.queryByTestId('today-review-chip')).toBeNull()
  })

  it('keeps the stats drawer collapsed, then shows level, XP and S2\'s pace line unchanged, without blame', async () => {
    await setup([watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch]))
    const toggle = screen.getByTestId('today-stats-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('today-stats')).toBeNull()
    fireEvent.click(toggle)
    const stats = screen.getByTestId('today-stats')
    expect(stats).toHaveTextContent(/LV \d+/)
    expect(stats).toHaveTextContent(/\d+ XP/)
    expect(screen.getByTestId('today-stats-pace').textContent).toBe(PACE)
    expect(stats.textContent).not.toMatch(/behind|late|missed/i)
    // the header chips own these two ids (the Pom card holds its own `level`, outside the drawer)
    expect(within(stats).queryByTestId('level')).toBeNull()
    expect(screen.queryByTestId('xp-total')).toBeNull()
  })
  it('prints the real S2 pace line in lower case', () => {
    expect(PACE).toBe(paceLine({ remainingMin: 600, unwrittenMin: 0, weeklyMin: 300, weeks: 2, endMs: 0, label: 'March 2028' }))
  })

  it('starts the ticket on Enter on the page body, not from a text field or another button', async () => {
    const d = await setup([watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch]))
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('location')).not.toHaveTextContent('/do/')
    input.remove()
    fireEvent.keyDown(screen.getByTestId('today-pick-else'), { key: 'Enter' })
    expect(screen.getByTestId('location')).not.toHaveTextContent('/do/')
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/w1'))
    await waitFor(async () => expect((await d.tickets.get('w1'))!.status).toBe('doing'))
    expect((await d.tickets.get('w1'))!.order).toBe(watch.order)
  })
  it('does not start behind an open dialog', async () => {
    await setup([watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch]))
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog')
    document.body.appendChild(dlg)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(screen.getByTestId('location')).not.toHaveTextContent('/do/')
    dlg.remove()
  })

  it('lists no old vocabulary and stays inside the control and word budgets, with a ritual card open', async () => {
    const ritual = mkTicket({ id: 'r1', kind: 'ritual', lane: 'ritual', title: 'Try a new model', estMin: 30 })
    await setup([done(watch), watch, dsa, ritual], model({ kind: 'start', ticket: watch, reason: 'next in your queue, about 45 min' }, [watch, dsa]))
    await screen.findByTestId('today-pulse') // the ritual column (TODAY-27/28 count it)
    const root = screen.getByTestId('today-quest').closest('.qc-page')!
    const text = root.textContent ?? ''
    expect(text).not.toMatch(/sprint|slid|rolled|rebalance|load check|carrot|spar|retreat|dig in|streak|debt/i)
    expect(root.querySelector('input[type="checkbox"], [role="checkbox"]')).toBeNull()
    expect(root.querySelectorAll('a[href], button, input, select, textarea, [role="button"]').length).toBeLessThanOrEqual(16)
    expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(200)
  })

  it('offers a skip on a ritual card, never an accent', async () => {
    const ritual = mkTicket({ id: 'r1', kind: 'ritual', lane: 'ritual', title: 'Try a new model', estMin: 30 })
    await setup([done(watch), ritual], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch]))
    const card = screen.getByTestId('today-ritual-r1')
    expect(card).not.toHaveAttribute('data-accent')
    expect(card.querySelector('[data-accent]')).toBeNull()
    fireEvent.click(screen.getByTestId('today-ritual-skip-r1'))
    expect(screen.queryByTestId('today-ritual-r1')).toBeNull()
  })
  it('draws no generic ritual card on day zero (the pulse and weekly panels are allowed, tested in today-ritual)', async () => {
    const ritual = mkTicket({ id: 'r1', kind: 'ritual', lane: 'ritual', title: 'Try a new model', estMin: 30 })
    await setup([watch, ritual], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch]))
    expect(screen.queryByTestId('today-ritual-r1')).toBeNull()
  })
  it('does not draw the quest ritual twice', async () => {
    const ritual = mkTicket({ id: 'r1', kind: 'ritual', lane: 'ritual', title: 'Try a new model', estMin: 30 })
    await setup([done(watch), ritual], model({ kind: 'start', ticket: ritual, reason: 'x' }, [ritual]))
    expect(screen.queryByTestId('today-ritual-r1')).toBeNull()
  })
})

describe('a read-only browser (Review Focus 4)', () => {
  it('disables Start, ignores Enter and writes nothing', async () => {
    ro.on = true
    const d = await setup([watch], model({ kind: 'start', ticket: watch, reason: 'x' }, [watch]))
    const before = JSON.stringify(await d.tickets.toArray())
    const start = screen.getByTestId('start-button')
    expect(start).toBeDisabled()
    fireEvent.click(start)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('location')).not.toHaveTextContent('/do/')
    expect(JSON.stringify(await d.tickets.toArray())).toBe(before)
    expect(await d.sessions.count()).toBe(0)
  })
})

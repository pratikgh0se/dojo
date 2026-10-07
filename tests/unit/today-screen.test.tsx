import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Today } from '../../src/screens/Today'
import { patchSettings } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { TIMER_KEY } from '../../src/lib/timer'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

async function renderAt(when: string) {
  setNow(() => ist(when))
  const d = await seededDb()
  renderWithApp(<Today />, { db: d, plan: smallPlan, path: '/' })
  return d
}

describe('Today · NOW tile', () => {
  it('Monday: eyebrow, time, verb, sentence, Spar, Start and Open', async () => {
    await renderAt('2026-09-07T21:10:00')
    expect(await screen.findByTestId('now-eyebrow')).toHaveTextContent('SPRINT 1 · DAY 1 OF 14 · AI · watch')
    expect(screen.getByTestId('now-time')).toHaveTextContent('21:00 – 21:50')
    expect(screen.getByTestId('now-headline')).toHaveTextContent('Watch · 50 min')
    expect(screen.getByRole('region', { name: 'Now' })).toHaveAttribute('data-tone', 'ai')
    expect(screen.getByTestId('now-text')).toHaveTextContent('Watch and type along: Rung 1, the API call')
    expect(screen.getByTestId('spar-50')).toHaveTextContent('Spar · 50')
    expect(screen.getByTestId('spar-25')).toHaveTextContent('Spar · 25')
    const start = screen.getByTestId('start-button')
    expect(start).toHaveAttribute('href', '/do/m1w1t1')
    expect(start).toHaveTextContent('Start ▸')
    const open = screen.getByTestId('open-link')
    expect(open).toHaveAttribute('href', 'https://example.com/academy')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveTextContent('Open · Anthropic Academy ↗')
    // Ruling Q1 (spec D4): Start ▸ sits in the prototype's accent slot at the right end.
    const order = [...start.parentElement!.children].map(e => e.getAttribute('data-testid'))
    expect(order).toEqual(['spar-50', 'spar-25', 'open-link', 'start-button'])
  })

  it('Enter on the page opens the Do screen for the lead ticket', async () => {
    await renderAt('2026-09-07T21:10:00')
    await screen.findByTestId('start-button')
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(screen.getByTestId('location')).toHaveTextContent('/do/m1w1t1')
  })

  it('Spar · 25 swaps the buttons for draining blocks, readout and Retreat', async () => {
    await renderAt('2026-09-07T21:10:00')
    fireEvent.click(await screen.findByTestId('spar-25'))
    // Spar's start() now awaits startDoing (N3) before starting the timer.
    expect(await screen.findByTestId('now-readout')).toHaveTextContent('25:00')
    expect(screen.getByTestId('now-timer-sub')).toHaveTextContent('of 25 min · ends 21:35')
    expect(screen.getByTestId('now-blocks').querySelectorAll('[data-state]')).toHaveLength(5)
    expect(screen.queryByTestId('spar-50')).toBeNull()
    expect(screen.getByTestId('open-link')).toBeInTheDocument()
    // UAT r3 J3: the design's "Retreat" says what it does in its name and tooltip
    const retreat = screen.getByRole('button', { name: 'Retreat: stop the timer' })
    expect(retreat).toHaveTextContent(/^Retreat$/)
    expect(retreat).not.toHaveAttribute('title') // one tooltip only: the bubble (cu-final)
    expect(retreat).toHaveAttribute('data-tip', 'Stop the timer')
    fireEvent.click(retreat)
    expect(screen.getByTestId('spar-50')).toBeInTheDocument()
  })

  it('Start ▸ is always the accent primary; Open is a control-bevel secondary, hidden without a web link (ruling Q1)', async () => {
    const d = await renderAt('2026-09-07T21:10:00')
    expect(await screen.findByTestId('start-button')).toHaveClass('sr-btn-accent')
    expect(screen.getByTestId('open-link')).toHaveClass('sr-btn')
    expect(screen.getByTestId('open-link')).not.toHaveClass('sr-btn-accent')
    await d.tickets.update('m1w1t1', { links: [] })
    await waitFor(() => expect(screen.queryByTestId('open-link')).toBeNull())
    expect(screen.getByTestId('start-button')).toHaveClass('sr-btn-accent')
  })

  it('a timer already running on another ticket shows here, hides Spar, keeps Start ▸ (Review Focus #4)', async () => {
    localStorage.setItem(TIMER_KEY, JSON.stringify({
      ticketId: 'p200', sessionStart: ist('2026-09-07T21:00:00'), start: ist('2026-09-07T21:00:00'),
      end: ist('2026-09-07T21:25:00'), min: 25, running: true, notified: false,
    }))
    await renderAt('2026-09-07T21:10:00')
    expect(await screen.findByTestId('now-readout')).toHaveTextContent('15:00')
    expect(screen.queryByTestId('spar-50')).toBeNull()
    expect(screen.getByTestId('start-button')).toHaveAttribute('href', '/do/m1w1t1')
    expect(JSON.parse(localStorage.getItem(TIMER_KEY)!)).toMatchObject({ ticketId: 'p200', running: true })
  })
})

describe('Today edge dates render the command center (Review Focus #5)', () => {
  it('before the start date previews Sprint 1 day 1', async () => {
    await renderAt('2026-09-01T09:00:00')
    expect(await screen.findByTestId('now-eyebrow')).toHaveTextContent('PLAN STARTS 2026-09-07 · SPRINT 1 · DAY 1 OF 14 · AI · watch')
    expect(screen.getByTestId('now-time')).toHaveTextContent('in 6 days · 21:00 – 21:50')
    expect(screen.getByTestId('now-headline')).toHaveTextContent('Watch · 50 min')
    expect(screen.getByTestId('start-button')).toHaveAttribute('href', '/do/m1w1t1')
  })
  it('on a Friday: Rest · off, no Spar, no Start', async () => {
    await renderAt('2026-09-11T21:00:00')
    expect(await screen.findByTestId('now-headline')).toHaveTextContent('Rest · off')
    expect(screen.getByTestId('now-text')).toHaveTextContent('Rest, exercise, nothing else.')
    expect(screen.getByRole('region', { name: 'Now' })).toHaveAttribute('data-tone', 'off')
    expect(screen.queryByTestId('spar-50')).toBeNull()
    expect(screen.queryByTestId('start-button')).toBeNull()
  })
  it('after sprint 72', async () => {
    await renderAt('2029-06-11T09:00:00')
    expect(await screen.findByTestId('now-headline')).toHaveTextContent('Plan complete')
    expect(screen.getByTestId('now-text')).toHaveTextContent('All 72 sprints are behind you')
  })
})

describe('Today · Vitals row', () => {
  it('zero state: Pom idle, sprint clock, full Carrot HP, badges off, 0 logged', async () => {
    await renderAt('2026-09-07T21:10:00')
    expect(await screen.findByTestId('level')).toHaveTextContent('LV 0')
    expect(document.querySelector('pom-stage')).toHaveAttribute('pose', 'idle')
    expect(screen.getByTestId('sprint-dates')).toHaveTextContent('Sep 7 – Sep 20')
    const cells = [...screen.getByTestId('day-strip').querySelectorAll('[data-state]')].map(c => c.getAttribute('data-state'))
    expect(cells).toEqual(['today', ...Array(13).fill('future')])
    expect(screen.getByTestId('carrot-hp')).toHaveTextContent('2/2')
    expect(JSON.parse(screen.getByTestId('carrot-hp-bar').getAttribute('data')!)).toEqual({ max: 2, value: 2 })
    for (const g of ['1', 'G', 'H', 'D', 'B', '½']) expect(screen.getByTestId(`badge-${g}`)).toHaveAttribute('data-on', 'false')
    expect(screen.getByTestId('cal-total')).toHaveTextContent('0 logged')
  })

  it('a done task: XP, LV, pose training, HP 1/2, badge 1, calendar +1', async () => {
    const d = await renderAt('2026-09-07T21:10:00')
    await screen.findByTestId('level')
    await d.tickets.update('m1w1i1', { status: 'done', xp: 10, doneAt: ist('2026-09-07T10:00:00') })
    await waitFor(() => expect(screen.getByTestId('xp-total')).toHaveTextContent('10 XP'))
    expect(screen.getByTestId('level')).toHaveTextContent('LV 1')
    expect(document.querySelector('pom-stage')).toHaveAttribute('pose', 'training')
    expect(screen.getByTestId('carrot-hp')).toHaveTextContent('1/2')
    expect(screen.getByTestId('badge-1')).toHaveAttribute('data-on', 'true')
    expect(JSON.parse(screen.getByTestId('consistency-cal').getAttribute('data')!).weeks[7][1]).toBe(1)
    expect(screen.getByTestId('cal-total')).toHaveTextContent('1 logged')
  })
})

describe('Today · Sprint health', () => {
  it('day 1 of sprint 1: NOW column, stats, Fits', async () => {
    await renderAt('2026-09-07T21:10:00')
    const data = JSON.parse((await screen.findByTestId('health-chart')).getAttribute('data')!)
    expect(data.labels).toEqual(['NOW', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'])
    expect(data.series).toEqual([[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [2, 2, 1, 0, 0, 0, 0, 0]])
    expect(screen.getAllByTestId('health-stat').map(s => s.textContent)).toEqual(['Last sprint—', 'This sprint0/2', 'Left behind0'])
    expect(screen.getByTestId('load-verdict')).toHaveTextContent('Fits')
    expect(screen.getByTestId('load-text')).toHaveTextContent('2 tasks due this sprint. Your pace appears here after the first sprint ends.')
    expect(screen.getAllByTestId('load-row').map(r => r.textContent)).toEqual(['Now · 14d left2', 'Sprint 22', 'Planned pace2'])
  })
  it('sprint 2 with sprint 1 untouched: Heavy', async () => {
    await renderAt('2026-09-21T21:10:00')
    expect(await screen.findByTestId('load-verdict')).toHaveTextContent('Heavy')
    expect(screen.getByTestId('load-text')).toHaveTextContent(
      "4 tasks due before sprint 3 against a pace of about 2 per sprint. Pick the 2 least important and let them slide one sprint; the plan's rule is slide, never restart.",
    )
  })
  it('before the start date the current column is labelled S1, not NOW', async () => {
    await renderAt('2026-09-01T09:00:00')
    expect(JSON.parse((await screen.findByTestId('health-chart')).getAttribute('data')!).labels[0]).toBe('S1')
  })
})

describe('Today · Dig in drawers', () => {
  it('This sprint opens and closes; ticking a row toasts +10 xp · Saved', async () => {
    await renderAt('2026-09-07T21:10:00')
    const head = await screen.findByRole('button', { name: /This sprint · 2 tasks/ })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('dig-row-m1w1t1')).toBeNull()
    fireEvent.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('dig-row-m1w1t1')).toHaveTextContent('Rung 1, the API call')
    fireEvent.click(screen.getByTestId('dig-tick-m1w1t1'))
    expect(await screen.findByText('+10 xp · Saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('dig-tick-m1w1t1')).toHaveAttribute('aria-checked', 'true'))
    fireEvent.click(head)
    expect(screen.queryByTestId('dig-row-m1w1t1')).toBeNull()
  })
  it('Addendum 5 / rule 11: every task row exposes do-<ticketId>, named "Do: <title>"', async () => {
    const d = await renderAt('2026-09-07T21:10:00')
    fireEvent.click(await screen.findByRole('button', { name: /This sprint · 2 tasks/ }))
    const t = (await d.tickets.get('m1w1t1'))!
    // The workload panel's "Suggested" list also links the card (briefs Addendum 1 Q15), so the drawer row is found inside its drawer.
    const drawer = within(screen.getByTestId('drawer-tasks'))
    const link = drawer.getByTestId('do-m1w1t1')
    expect(link).toHaveAttribute('href', '/do/m1w1t1')
    expect(drawer.getByRole('link', { name: `Do: ${t.title}` })).toBe(link)
  })
  it('a tick undone elsewhere shows as unticked (the optimistic value does not linger)', async () => {
    const d = await renderAt('2026-09-07T21:10:00')
    fireEvent.click(await screen.findByRole('button', { name: /This sprint · 2 tasks/ }))
    fireEvent.click(screen.getByTestId('dig-tick-m1w1t1'))
    await waitFor(() => expect(screen.getByTestId('dig-tick-m1w1t1')).toHaveAttribute('aria-checked', 'true'))
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))?.status).toBe('done'))
    await d.tickets.update('m1w1t1', { status: 'todo' }) // e.g. another window unticked it
    await waitFor(() => expect(screen.getByTestId('dig-tick-m1w1t1')).toHaveAttribute('aria-checked', 'false'))
  })
  it('Addendum 9: each task row is a listitem (in a list) inside drawer-tasks', async () => {
    await renderAt('2026-09-07T21:10:00')
    fireEvent.click(await screen.findByRole('button', { name: /This sprint · 2 tasks/ }))
    const drawer = screen.getByTestId('drawer-tasks')
    const items = within(drawer).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    for (const li of items) {
      expect(within(li).getByRole('checkbox', { name: /^Done: / })).toBeInTheDocument()
      expect(li.parentElement?.closest('[role="list"]')).not.toBeNull()
    }
  })
  it('Left behind shows only when overdue tasks exist', async () => {
    await renderAt('2026-09-07T21:10:00')
    await screen.findByTestId('drawer-tasks')
    expect(screen.queryByTestId('drawer-carry')).toBeNull()
  })
  it('in sprint 2: Left behind · 2 with sprint tags, and the Thursday design drawer', async () => {
    await renderAt('2026-09-21T21:10:00')
    fireEvent.click(await screen.findByRole('button', { name: /Left behind · 2/ }))
    expect(screen.getByTestId('dig-row-m1w1t1')).toHaveTextContent('from sprint 1 · AI')
    fireEvent.click(screen.getByRole('button', { name: /Thursday design/ }))
    expect(screen.getByTestId('drawer-design')).toHaveTextContent('Must answer · 45 min, recorded')
    expect(screen.getByTestId('drawer-design')).toHaveTextContent('Requirements')
  })
  it('DSA drawer lists every problem with a LeetCode link, NeetCode link and difficulty', async () => {
    await renderAt('2026-09-07T21:10:00')
    fireEvent.click(await screen.findByRole('button', { name: /DSA · Graphs/ }))
    expect(screen.getAllByRole('link', { name: 'NeetCode ↗' })).toHaveLength(3)
    expect(screen.getByTestId('dig-row-p127')).toHaveTextContent('Hard')
  })
})

describe('Today · focus minutes (ux spec: a health signal, never XP)', () => {
  it('focus-today reads "<n> min" and sums only today, and xp-total does not move', async () => {
    const d = await renderAt('2026-09-08T10:00:00')
    expect(await screen.findByTestId('focus-today')).toHaveTextContent(/^0 min$/)
    const xp = screen.getByTestId('xp-total').textContent
    await d.events.add({ t: 'focus', id: 'm1w1t1', at: ist('2026-09-08T09:00:00'), minutes: 25 })
    await d.events.add({ t: 'focus', id: 'm1w1t1', at: ist('2026-09-08T09:30:00'), minutes: 25 })
    await d.events.add({ t: 'focus', id: 'm1w1t1', at: ist('2026-09-07T09:30:00'), minutes: 50 })
    await waitFor(() => expect(screen.getByTestId('focus-today')).toHaveTextContent(/^50 min$/))
    expect(screen.getByTestId('xp-total').textContent).toBe(xp)
  })

  it('the load check shows real focus minutes for the last 7 days (and, once a week of focus is logged, its pace uses them)', async () => {
    const d = await renderAt('2026-09-08T10:00:00')
    await screen.findByTestId('load-text')
    await d.events.add({ t: 'focus', id: 'm1w1t1', at: ist('2026-09-07T09:00:00'), minutes: 25 })
    // ruling 24 S2: the first logged focus is older than a week, so the pace stands on data
    await d.events.add({ t: 'focus', id: 'm1w1t1', at: ist('2026-08-20T09:00:00'), minutes: 25 })
    await waitFor(() => expect(screen.getByTestId('load-focus')).toHaveTextContent('25 min of real focus in the last 7 days'))
    // 25 min in 7 days is 50 a sprint: about one task, so the pace row is now "Your pace"
    await waitFor(() => expect(screen.getAllByTestId('load-row')[2]).toHaveTextContent('Your pace'))
  })
})

describe('Today · Load check in the first sprint (ruling 24 S2, cu-2 P2-2)', () => {
  it('one finished minute of focus is no pace: still Fits, the first-sprint sentence, no Ask what to slide', async () => {
    const d = await renderAt('2026-09-08T10:00:00')
    await screen.findByTestId('load-text')
    await d.events.add({ t: 'focus', id: 'm1w1t1', at: ist('2026-09-08T09:00:00'), minutes: 1 })
    await waitFor(() => expect(screen.getByTestId('load-focus')).toHaveTextContent('1 min of real focus in the last 7 days'))
    expect(screen.getByTestId('load-verdict')).toHaveTextContent('Fits')
    expect(screen.getByTestId('load-text')).toHaveTextContent('2 tasks due this sprint. Your pace appears here after the first sprint ends.')
    expect(screen.getAllByTestId('load-row')[2]).toHaveTextContent('Planned pace')
    expect(screen.queryByTestId('ai-slide-ask')).toBeNull()
  })

  it('a sprint planned over its core-minutes budget is Heavy by plan: Ask what to slide, and still no pace', async () => {
    const d = await renderAt('2026-09-08T10:00:00')
    await screen.findByTestId('load-text')
    await patchSettings(d, { coreMinutes: 30 }) // the two sprint-1 cards plan far more than 30 minutes
    await waitFor(() => expect(screen.getByTestId('load-verdict')).toHaveTextContent('Heavy'))
    expect(screen.getByTestId('load-text')).toHaveTextContent('core-minutes budget')
    expect(screen.getByTestId('load-text')).toHaveTextContent('Your pace appears here after the first sprint ends.')
    expect(screen.getByTestId('load-text')).not.toHaveTextContent('pace of about')
    expect(screen.getAllByTestId('load-row')[2]).toHaveTextContent('Planned pace')
    expect(screen.getByTestId('ai-slide-ask')).toBeInTheDocument()
  })
})

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetNow, setNow } from '../../src/lib/clock'
import { Journal } from '../../src/screens/Journal'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const lab = vi.hoisted(() => ({ infos: {} as Record<string, { title: string; closingTicket: string }> }))
vi.mock('../../src/data/labClient', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/data/labClient')>()),
  labInfoCall: async (id: string) => (lab.infos[id] ? { ok: true, ...lab.infos[id] } : { ok: false, code: 'unknown_lab', message: 'no' }),
}))

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const SUN = at(2026, 11, 8, 14) // 2026-W45
afterEach(() => { resetNow(); lab.infos = {} })

async function setup(o: { route?: string; now?: number; passedReview?: boolean } = {}) {
  setNow(() => o.now ?? SUN)
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-10-05', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.bulkPut([
    { ...mkTicket({ id: 'a', title: 'Watch attention' }), status: 'done' as const, doneAt: at(2026, 11, 3, 10) },
    { ...mkTicket({ id: 'old', title: 'Last week one' }), status: 'done' as const, doneAt: at(2026, 10, 28, 10) },
    { ...mkTicket({ id: 'lab-last', title: 'Lab last step', lab: { id: 't-lab', gpu: 'none' as const } }), status: 'done' as const, doneAt: at(2026, 11, 6, 16) },
  ])
  await d.sessions.put({ id: 's1', ticketId: 'a', start: at(2026, 11, 3, 9), end: at(2026, 11, 3, 15), minutes: 370, outcome: 'solved', xpDelta: 0 })
  await d.weeklyReviews.put({ id: 'wr-2026-W44', week: '2026-W44', worked: 'Outline', change: 'Earlier', focus: 'Roofline', at: at(2026, 11, 1, 14) })
  if (o.passedReview) await d.labReviews.put({ id: 'rev-t-lab-1', labId: 't-lab', at: at(2026, 11, 7, 12), items: [], percent: 80, passed: true, summary: '' })
  renderWithApp(<Journal />, { db: d, ...appPlans({ rituals: [] }), route: o.route ?? '/journal?view=week' })
  await screen.findByTestId('journal-week-heading')
  return d
}

describe('the Journal Week view', () => {
  it('shows the current week: data-week, ISO dates, tickets done, the time against the budget, no percentage; loading writes nothing', async () => {
    const d = await setup()
    expect(screen.getByTestId('journal-week')).toHaveAttribute('data-week', '2026-W45')
    const h = screen.getByTestId('journal-week-heading')
    expect(h).toHaveTextContent('2026-W45')
    expect(h).toHaveTextContent('2026-11-02')
    expect(h).toHaveTextContent('2026-11-08')
    const t = screen.getByTestId('journal-week-tickets')
    expect(t).toHaveAttribute('data-count', '2')
    expect(t.textContent).toMatch(/^2 tickets done/)
    expect(screen.getByTestId('journal-week-ticket-a')).toHaveTextContent('Watch attention')
    expect(screen.queryByTestId('journal-week-ticket-old')).toBeNull()
    const min = screen.getByTestId('journal-week-minutes')
    expect(min).toHaveTextContent(/^6 h 10 min of 8 h$/)
    expect(min).toHaveAttribute('data-minutes', '370')
    expect(min).toHaveAttribute('data-budget', '480')
    expect(min.textContent).not.toMatch(/%/)
    expect(screen.getByTestId('journal-week-next')).toBeDisabled()
    expect(screen.getByTestId('journal-week-prev')).not.toBeDisabled()
    expect(await d.weeklyReviews.count()).toBe(1)
  })
  it('the heading follows the clock: Monday 2026-11-09 is week 2026-W46', async () => {
    await setup({ now: at(2026, 11, 9, 0, 10) })
    expect(screen.getByTestId('journal-week')).toHaveAttribute('data-week', '2026-W46')
    expect(screen.getByTestId('journal-week-heading')).toHaveTextContent('2026-11-09')
    expect(screen.getByTestId('journal-week-heading')).toHaveTextContent('2026-11-15')
  })
  it('empty parts read one plain sentence each, and the three sections always exist', async () => {
    await setup({ route: '/journal?view=week&week=2026-W40' })
    expect(screen.getByTestId('journal-week-tickets-empty')).toHaveTextContent(/^No tickets finished this week\.$/)
    expect(screen.getByTestId('journal-week-labs-empty')).toHaveTextContent(/^No labs this week\.$/)
    expect(screen.getByTestId('journal-week-hard-empty')).toHaveTextContent(/^Nothing came up hard this week\.$/)
    expect(screen.getByTestId('journal-week-minutes')).toHaveTextContent(/^0 min of 8 h$/)
    for (const id of ['journal-week-tickets', 'journal-week-labs', 'journal-week-hard']) expect(screen.getByTestId(id)).toBeInTheDocument()
  })
  it('a lab whose closing ticket was done in the week is Done', async () => {
    lab.infos = { 't-lab': { title: 'Test lab', closingTicket: 'lab-last' } }
    await setup()
    await waitFor(() => expect(screen.getByTestId('journal-week-lab-t-lab')).toHaveAttribute('data-state', 'done'))
  })
  it('Proven wins over Done', async () => {
    lab.infos = { 't-lab': { title: 'Test lab', closingTicket: 'lab-last' } }
    await setup({ passedReview: true })
    await waitFor(() => expect(screen.getByTestId('journal-week-lab-t-lab')).toHaveAttribute('data-state', 'proven'))
  })
  it('a lab done but not yet proven (no passing review) is Done, never Proven', async () => {
    lab.infos = { 't-lab': { title: 'Test lab', closingTicket: 'lab-last' } }
    await setup({ passedReview: false })
    await waitFor(() => expect(screen.getByTestId('journal-week-lab-t-lab')).toBeInTheDocument())
    expect(screen.getByTestId('journal-week-lab-t-lab')).toHaveAttribute('data-state', 'done')
  })
  it('Earlier week shows the previous week with its stored review in the prompts; Later week returns; nothing counts weeks', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('journal-week-prev'))
    await waitFor(() => expect(screen.getByTestId('journal-week')).toHaveAttribute('data-week', '2026-W44'))
    expect((screen.getByTestId('journal-week-worked') as HTMLTextAreaElement).value).toBe('Outline')
    expect((screen.getByTestId('journal-week-focus') as HTMLInputElement).value).toBe('Roofline')
    expect(screen.getByTestId('journal-week-saved')).toBeInTheDocument()
    expect(screen.getByTestId('journal-week-save')).toBeDisabled()
    expect(screen.getByTestId('location').getAttribute('data-search')).toContain('week=2026-W44')
    expect(document.body.textContent).not.toMatch(/streak|miss|skip|\blate\b|in a row|behind/i)
    fireEvent.click(screen.getByTestId('journal-week-next'))
    await waitFor(() => expect(screen.getByTestId('journal-week')).toHaveAttribute('data-week', '2026-W45'))
  })
  it('the prompts: limits, and Save is disabled until some field has text', async () => {
    await setup()
    const save = screen.getByTestId('journal-week-save')
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('data-accent', 'primary')
    expect(save).toHaveTextContent('SAVE · REVIEW')
    expect(screen.getByTestId('journal-week-worked')).toHaveAttribute('maxlength', '1000')
    expect(screen.getByTestId('journal-week-change')).toHaveAttribute('maxlength', '1000')
    expect(screen.getByTestId('journal-week-focus')).toHaveAttribute('maxlength', '200')
    fireEvent.change(screen.getByTestId('journal-week-worked'), { target: { value: 'w'.repeat(1200) } })
    expect((screen.getByTestId('journal-week-worked') as HTMLTextAreaElement).value).toHaveLength(1000)
    fireEvent.change(screen.getByTestId('journal-week-focus'), { target: { value: 'f'.repeat(250) } })
    expect((screen.getByTestId('journal-week-focus') as HTMLInputElement).value).toHaveLength(200)
    fireEvent.change(screen.getByTestId('journal-week-worked'), { target: { value: '   ' } })
    fireEvent.change(screen.getByTestId('journal-week-focus'), { target: { value: '' } })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByTestId('journal-week-worked'), { target: { value: 'x' } })
    expect(save).not.toBeDisabled()
  })
  it('on a stored review Save is enabled once any field differs, including a cleared one', async () => {
    await setup({ route: '/journal?view=week&week=2026-W44' })
    expect(screen.getByTestId('journal-week-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('journal-week-change'), { target: { value: '' } })
    expect(screen.getByTestId('journal-week-save')).not.toBeDisabled()
  })
  it('Save writes wr-<week>; with the Open card pressed it completes the ritual ticket once (5 xp, one session), and a second save changes none of that', async () => {
    const d = await setup()
    await d.tickets.put(mkTicket({ id: 'ritual-weekly-review-2026-W45', origin: 'ritual:weekly-review:2026-W45', kind: 'ritual', lane: 'ritual', title: 'Weekly review', estMin: 60 }))
    fireEvent.change(screen.getByTestId('journal-week-worked'), { target: { value: '  Finished the lab outline  ' } })
    fireEvent.change(screen.getByTestId('journal-week-focus'), { target: { value: 'Roofline function and its test' } })
    fireEvent.click(screen.getByTestId('journal-week-save'))
    await screen.findByTestId('journal-week-saved')
    expect(await d.weeklyReviews.get('wr-2026-W45')).toMatchObject({ worked: 'Finished the lab outline', change: '', focus: 'Roofline function and its test' })
    await waitFor(async () => expect(await d.tickets.get('ritual-weekly-review-2026-W45')).toMatchObject({ status: 'done', xp: 5 }))
    const sessions = (await d.sessions.toArray()).filter(s => s.ticketId === 'ritual-weekly-review-2026-W45')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toMatch(/^s-done-ritual-weekly-review-2026-W45-\d+$/)
    fireEvent.change(screen.getByTestId('journal-week-change'), { target: { value: 'Start earlier in the day' } })
    fireEvent.click(screen.getByTestId('journal-week-save'))
    await waitFor(async () => expect((await d.weeklyReviews.get('wr-2026-W45'))!.change).toBe('Start earlier in the day'))
    expect(await d.weeklyReviews.count()).toBe(2)
    expect((await d.tickets.get('ritual-weekly-review-2026-W45'))!.xp).toBe(5)
    expect((await d.sessions.toArray()).filter(s => s.ticketId === 'ritual-weekly-review-2026-W45')).toHaveLength(1)
  })
  it('with no weekly review ticket a save creates no ticket, session or XP', async () => {
    const d = await setup()
    const before = await d.tickets.count()
    fireEvent.change(screen.getByTestId('journal-week-worked'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('journal-week-save'))
    await screen.findByTestId('journal-week-saved')
    expect(await d.tickets.count()).toBe(before)
    expect(await d.sessions.count()).toBe(1)
  })
  it('a past week writes only its own row, even with this week\'s ticket open', async () => {
    const d = await setup({ route: '/journal?view=week&week=2026-W44' })
    await d.tickets.put(mkTicket({ id: 'ritual-weekly-review-2026-W45', origin: 'ritual:weekly-review:2026-W45', kind: 'ritual', lane: 'ritual', title: 'Weekly review' }))
    fireEvent.change(screen.getByTestId('journal-week-focus'), { target: { value: 'New focus' } })
    fireEvent.click(screen.getByTestId('journal-week-save'))
    await waitFor(async () => expect((await d.weeklyReviews.get('wr-2026-W44'))!.focus).toBe('New focus'))
    expect((await d.tickets.get('ritual-weekly-review-2026-W45'))!.status).toBe('todo')
    expect(await d.sessions.count()).toBe(1)
  })
  it('a future or invalid week falls back to the current one', async () => {
    await setup({ route: '/journal?view=week&week=2026-W50' })
    expect(screen.getByTestId('journal-week')).toHaveAttribute('data-week', '2026-W45')
  })
  it('the day view is the default and keeps its address; the Day and Week links switch; no Week hook leaks into it', async () => {
    setNow(() => SUN)
    renderWithApp(<Journal />, { db: freshDb(), ...appPlans(), route: '/journal' })
    await screen.findByTestId('journal-strip')
    expect(screen.queryByTestId('journal-week')).toBeNull()
    expect(screen.getByTestId('journal-view-day')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('journal-view-week')).toHaveAttribute('href', '/journal?view=week')
    for (const id of ['journal-date', 'journal-items', 'journal-save', 'journal-hard', 'journal-mode-none']) expect(screen.queryByTestId(id)).not.toBeNull()
  })
  it('in the Week view none of the day-entry hooks is present', async () => {
    await setup()
    for (const id of ['journal-date', 'journal-items', 'journal-save', 'journal-strip', 'journal-hard', 'journal-mode-none']) expect(screen.queryByTestId(id), id).toBeNull()
    expect(screen.getByTestId('journal-view-week')).toHaveAttribute('aria-current', 'page')
  })
})

// W5 (JOURNAL-30, JOURNAL-31): the Floor line on the day
describe('the Floor line on the Journal day', () => {
  async function dayWithFloor(route = '/journal') {
    setNow(() => at(2026, 11, 4, 18))
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-10-05', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.journal.bulkPut([
      { id: 'journal-2026-11-04', day: '2026-11-04', at: 1, mode: 'studied', items: [], hardest: 'Little\'s law', next: 'Sweep', line: 'Short one', floor: true },
      { id: 'journal-2026-11-03', day: '2026-11-03', at: 1, mode: 'studied', items: [], hardest: 'x' },
    ])
    renderWithApp(<Journal />, { db: d, ...appPlans(), route })
    await screen.findByTestId('journal-strip')
    return d
  }
  it('shows the line read-only with its label, between the pulse and the items; absent on a day without a floor row', async () => {
    await dayWithFloor()
    const box = screen.getByTestId('journal-floor')
    expect(box).toHaveTextContent('Floor session')
    expect(screen.getByTestId('journal-floor-text')).toHaveTextContent(/^Short one$/)
    expect(box.querySelector('input, button, textarea')).toBeNull()
    expect(box.compareDocumentPosition(screen.getByTestId('journal-items')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('journal-saved')).toBeInTheDocument()
    expect((screen.getByTestId('journal-hardest') as HTMLTextAreaElement).value).toBe('Little\'s law')
  })
  it('does not put "No study today" directly under the Floor line: on a Floor day the button comes after the entry fields (UAT A J7.5)', async () => {
    await dayWithFloor()
    const floor = screen.getByTestId('journal-floor')
    const mode = screen.getByTestId('journal-mode-none')
    expect(mode).toHaveAttribute('aria-pressed', 'false')
    expect(floor.nextElementSibling?.contains(mode)).toBe(false)
    expect(screen.getByTestId('journal-notes').compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('is absent on a day with no floor flag', async () => {
    await dayWithFloor('/journal?day=2026-11-03')
    expect(screen.queryByTestId('journal-floor')).toBeNull()
  })
  it('saving the entry keeps the line; a no-study save drops it', async () => {
    const d = await dayWithFloor()
    fireEvent.change(screen.getByTestId('journal-notes'), { target: { value: 'Added later' } })
    fireEvent.click(screen.getByTestId('journal-save'))
    await waitFor(async () => expect(await d.journal.get('journal-2026-11-04')).toMatchObject({ notes: 'Added later', line: 'Short one', floor: true }))
    expect(screen.getByTestId('journal-floor-text')).toHaveTextContent('Short one')
    fireEvent.click(screen.getByTestId('journal-mode-none'))
    fireEvent.click(screen.getByTestId('journal-obstacle-time'))
    fireEvent.change(screen.getByTestId('journal-line'), { target: { value: 'Out of time' } })
    fireEvent.click(screen.getByTestId('journal-save'))
    await waitFor(async () => expect(await d.journal.get('journal-2026-11-04')).toMatchObject({ mode: 'none', obstacle: 'time', line: 'Out of time', items: [] }))
    expect(await d.journal.get('journal-2026-11-04')).not.toHaveProperty('floor')
    expect(screen.queryByTestId('journal-floor')).toBeNull()
  })
})

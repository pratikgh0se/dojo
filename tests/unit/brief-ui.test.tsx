import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftBrief } from '../../src/data/briefActions'
import { patchSettings } from '../../src/data/db'
import { reloadDraftJob } from '../../src/data/draftJob'
import { setNow } from '../../src/lib/clock'
import { Board } from '../../src/screens/Board'
import { CardBrief } from '../../src/screens/brief/CardBrief'
import { Today } from '../../src/screens/Today'
import { Reviews } from '../../src/screens/progress/Reviews'
import { Settings } from '../../src/screens/Settings'
import { freshDb, seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00') // Tuesday of sprint 1 (start 2026-09-07)
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

async function cardFor(over: Parameters<typeof mkTicket>[0]) {
  setNow(() => NOW)
  const d = freshDb()
  await d.tickets.put(mkTicket(over))
  await draftBrief(d, over.id, NOW)
  const t = (await d.tickets.get(over.id))!
  return { d, t }
}
const show = async (over: Parameters<typeof mkTicket>[0]) => {
  const { d, t } = await cardFor(over)
  const Live = () => <CardBrief ticket={t} />
  renderWithApp(<Live />, { db: d, plan: smallPlan })
  return d
}

describe('CardBrief', () => {
  it('renders nothing until a brief exists', async () => {
    setNow(() => NOW)
    const d = freshDb()
    renderWithApp(<CardBrief ticket={mkTicket({ id: 'a' })} />, { db: d, plan: smallPlan })
    expect(screen.queryByTestId('card-brief')).toBeNull()
  })

  it('shows the goal, numbered steps with the link inside the step, minutes, learning, outcome and deliverable', async () => {
    await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    const card = screen.getByTestId('card-brief')
    expect(within(card).getByTestId('brief-goal')).toHaveTextContent('Understand Hash maps')
    const steps = card.querySelectorAll('ol > li')
    expect(steps).toHaveLength(2)
    expect(steps[0].querySelector('a')).toHaveAttribute('href', 'https://example.com/hash-maps')
    expect(card).toHaveTextContent('60 min')
    expect(card).toHaveTextContent("What you'll learn")
    expect(card).toHaveTextContent('Key idea of Hash maps')
    expect(card).toHaveTextContent('You can explain Hash maps in your own words')
    expect(within(card).getByTestId('brief-deliverable')).toHaveTextContent('Answer the questions')
    expect(within(card).getByTestId('brief-status')).toHaveTextContent('Draft')
  })

  it('UAT r4: forge/… paths and *.md names in AI-drafted brief text are file chips, as in statements', async () => {
    const { d, t } = await cardFor({ id: 'r1', kind: 'stage', track: 'ai', title: 'Rebuild' })
    const b = t.brief!
    const brief = {
      ...b,
      goal: 'Rebuild the setup from forge/stages/00-setup/redo.md.',
      steps: [{ text: 'Open forge/stages/00-setup/redo.md and read it; log questions in QUESTIONS.md' }, ...b.steps.slice(1)],
      learn: ['How rubric.md grades you'],
      outcome: 'Tests in forge/stages/00-setup/tests/core pass.',
      deliverable: { ...b.deliverable, prompt: 'Paste notes.md, typed by hand' },
    }
    renderWithApp(<CardBrief ticket={{ ...t, brief }} />, { db: d, plan: smallPlan })
    const card = screen.getByTestId('card-brief')
    expect([...card.querySelectorAll('code.file-ref')].map(c => c.textContent)).toEqual([
      'forge/stages/00-setup/redo.md', 'forge/stages/00-setup/redo.md', 'QUESTIONS.md', 'rubric.md', 'forge/stages/00-setup/tests/core', 'notes.md',
    ])
    expect(within(card).getByTestId('brief-goal')).toHaveTextContent('Rebuild the setup from forge/stages/00-setup/redo.md.')
  })

  it('link check results show as link-ok and link-broken inside their steps', async () => {
    const { d, t } = await cardFor({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    const b = t.brief!
    const withLinks = { ...t, brief: { ...b, steps: [{ text: 'a', url: 'https://ok.test/' }, { text: 'b', url: 'https://gone.test/' }, { text: 'c' }], linkCheck: [{ url: 'https://ok.test/', ok: true, status: 200 }, { url: 'https://gone.test/', ok: false, status: 404 }] } }
    renderWithApp(<CardBrief ticket={withLinks} />, { db: d, plan: smallPlan })
    const li = screen.getByTestId('card-brief').querySelectorAll('ol > li')
    expect(within(li[0] as HTMLElement).getByTestId('link-ok')).toBeInTheDocument()
    expect(within(li[1] as HTMLElement).getByTestId('link-broken')).toHaveTextContent('404')
    expect(within(li[2] as HTMLElement).queryByTestId(/link-/)).toBeNull()
  })

  it('a 403, 401 or 429 from a host that is up reads "can\'t verify", not "broken link" (UAT cu-4 P3-4)', async () => {
    const { d, t } = await cardFor({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    const b = t.brief!
    const steps = ['https://lc.test/', 'https://auth.test/', 'https://busy.test/', 'https://gone.test/', 'https://down.test/', 'https://nobody.test/'].map((url, i) => ({ text: `s${i}`, url }))
    const linkCheck = [
      { url: 'https://lc.test/', ok: false, status: 403 }, { url: 'https://auth.test/', ok: false, status: 401 }, { url: 'https://busy.test/', ok: false, status: 429 },
      { url: 'https://gone.test/', ok: false, status: 404 }, { url: 'https://down.test/', ok: false, status: 503 }, { url: 'https://nobody.test/', ok: false, status: 0 },
    ]
    renderWithApp(<CardBrief ticket={{ ...t, brief: { ...b, steps, linkCheck } }} />, { db: d, plan: smallPlan })
    const li = [...screen.getByTestId('card-brief').querySelectorAll('ol > li')] as HTMLElement[]
    expect(within(li[0]).getByTestId('link-unverified')).toHaveTextContent("can't verify (403)")
    expect(within(li[0]).queryByTestId('link-broken')).toBeNull()
    expect(within(li[0]).getByTestId('link-unverified')).toHaveAttribute('title', expect.stringMatching(/not confirmed broken/))
    expect(within(li[1]).getByTestId('link-unverified')).toHaveTextContent('401')
    expect(within(li[2]).getByTestId('link-unverified')).toHaveTextContent('429')
    for (const i of [3, 4, 5]) expect(within(li[i]).getByTestId('link-broken')).toBeInTheDocument() // gone, down and unreachable stay broken
    expect(within(li[5]).getByTestId('link-broken')).toHaveTextContent('broken link')
  })

  it('Approve makes it approved; a learning card opens the check on Mark done, a build card the deliverable', async () => {
    const d = await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(async () => expect((await d.tickets.get('w1'))!.brief!.status).toBe('approved'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    expect(within(dialog).getByRole('textbox', { name: 'Explain Hash maps in your own words' })).toBeInTheDocument()
    const group = within(dialog).getByRole('radiogroup', { name: 'Which is Hash maps?' })
    expect(within(group).getAllByRole('radio').map(r => r.parentElement?.textContent)).toEqual(['Hash maps', 'Not Hash maps'])
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('the check dialog needs every answer, then passes and finishes the card', async () => {
    const d = await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Answer every question first')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Explain Hash maps in your own words' }), { target: { value: 'hash maps map keys to buckets' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(await within(dialog).findByText('Passed', {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(async () => expect((await d.tickets.get('w1'))!.status).toBe('done'))
    expect(within(dialog).queryByRole('button', { name: 'Check answers' })).toBeNull()
  })

  it('"Answer every question first" goes as soon as an answer is typed or chosen, not at the next submit (cu-2 P3-10)', async () => {
    await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Answer every question first')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Explain Hash maps in your own words' }), { target: { value: 'a' } })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Answer every question first')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('a failed check shows Not yet with the correction and keeps the form open for another try', async () => {
    const d = await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Explain Hash maps in your own words' }), { target: { value: 'nope' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(await within(dialog).findByText('Not yet', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Mention Hash maps')
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
    expect(within(dialog).getByRole('button', { name: 'Check answers' })).toBeEnabled()
    expect(await d.redos.count()).toBe(1)
  })

  it('an AI failure in the check shows the AI error line with Retry and stores nothing', async () => {
    const d = await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    localStorage.setItem('dojo-ai-fake-fail', 'check')
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Explain Hash maps in your own words' }), { target: { value: 'x' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(await within(dialog).findByTestId('ai-error', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(within(dialog).getByTestId('ai-retry')).toBeInTheDocument()
    expect(await d.checkAttempts.count()).toBe(0)
  })

  it('UAT cu-5 P3-7: once an answer is changed, its old correction reads as the earlier note, not a verdict on the new answer', async () => {
    await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    const open = within(dialog).getByRole('textbox', { name: 'Explain Hash maps in your own words' })
    fireEvent.change(open, { target: { value: 'no idea' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Not Hash maps' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    await within(dialog).findByTestId('check-verdict', {}, { timeout: 5000 })
    const fixes = () => within(dialog).getAllByTestId('check-correction')
    expect(fixes()).toHaveLength(2)
    expect(fixes().every(f => f.dataset.stale === undefined)).toBe(true)
    expect(fixes()[0]).toHaveTextContent('Mention Hash maps')
    // fixing the first answer: its note is now the earlier one, the other question's is untouched
    fireEvent.change(open, { target: { value: 'I can explain hash maps now' } })
    expect(fixes()[0]).toHaveAttribute('data-stale', 'true')
    expect(fixes()[0]).toHaveTextContent('Earlier: Mention Hash maps')
    expect(fixes()[1].dataset.stale).toBeUndefined()
    expect(fixes()[1].textContent).not.toMatch(/^Earlier/)
    // checking again says everything afresh
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    await waitFor(() => expect(within(dialog).getByTestId('check-verdict')).toHaveTextContent('Passed'), { timeout: 5000 })
    expect(within(dialog).queryAllByTestId('check-correction')).toHaveLength(0)
  })

  it('a build card asks for the deliverable, refuses an empty one, and Get feedback never finishes the card', async () => {
    const d = await show({ id: 'c1', kind: 'problem', track: 'interview', title: 'Two Sum', difficulty: 'E' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deliverable' })
    expect(dialog).toHaveTextContent('Paste your code, typed by hand')
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Hand something in first')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'def f(): pass' } })
    expect(within(dialog).getByTestId('deliverable-error')).toBeEmptyDOMElement() // typing clears it (UAT cu-2p P3-5)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get feedback' }))
    expect(await within(dialog).findByTestId('deliverable-feedback', {}, { timeout: 5000 })).toHaveTextContent('[fake:grade] c1')
    expect((await d.tickets.get('c1'))!.status).toBe('todo')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await d.tickets.get('c1'))!.status).toBe('done'))
    expect((await d.tickets.get('c1'))!.deliverable).toMatchObject({ text: 'def f(): pass', feedback: ['[fake:grade] c1 runs, is hand-written, and is measured.'] })
  })

  it('UAT cu-5 P2-2: a teach-back card asks to Explain it in your own words, and Get feedback grades the prose, not code', async () => {
    const d = await show({ id: 'tb1', kind: 'stage', track: 'ai', session: 'teachback', stage: 0, title: 'Stage 00 · teach-back' })
    expect(screen.getByTestId('brief-deliverable')).toHaveTextContent('Explain it in your own words')
    expect(screen.getByTestId('brief-deliverable')).not.toHaveTextContent('code')
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deliverable' })
    expect(dialog).toHaveTextContent('Explain it in your own words')
    expect(within(dialog).getByRole('textbox')).toHaveAttribute('placeholder', 'Write it in your own words, or describe your sketch')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'A forward pass multiplies, adds and squashes; the backward pass walks it in reverse.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get feedback' }))
    const fb = await within(dialog).findByTestId('deliverable-feedback', {}, { timeout: 5000 })
    expect(fb).toHaveTextContent('the explanation names the mechanism')
    expect(fb).not.toHaveTextContent('runs, is hand-written')
    expect((await d.tickets.get('tb1'))!.status).toBe('todo')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await d.tickets.get('tb1'))!.status).toBe('done'))
    expect((await d.tickets.get('tb1'))!.deliverable).toMatchObject({ kind: 'explanation', feedback: [expect.stringContaining('the explanation names the mechanism')] })
  })

  it('UAT cu-5 P2-2: a teach-back drafted before the explanation kind (a forge code deliverable) reads and grades as an explanation', async () => {
    const { d, t } = await cardFor({ id: 'tb2', kind: 'stage', track: 'ai', session: 'teachback', stage: 1, title: 'micrograd teach-back' })
    const old = { ...t, brief: { ...t.brief!, deliverable: { kind: 'code' as const, prompt: 'Paste your code, typed by hand' } } }
    await d.tickets.put(old)
    renderWithApp(<CardBrief ticket={old} />, { db: d, plan: smallPlan })
    expect(screen.getByTestId('brief-deliverable')).toHaveTextContent('Explain it in your own words')
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deliverable' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'It is reverse-mode autodiff over a graph of scalars.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get feedback' }))
    expect(await within(dialog).findByTestId('deliverable-feedback', {}, { timeout: 5000 })).toHaveTextContent('the explanation names the mechanism')
  })

  it('Edit brief saves goal, link and day type; Save is refused without a goal', async () => {
    const d = await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit brief' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit brief' })
    const goal = within(dialog).getByRole('textbox', { name: 'Goal' })
    fireEvent.change(goal, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('A brief needs a goal')
    fireEvent.change(goal, { target: { value: 'New goal' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Step 2 link' }), { target: { value: 'https://x.test/two' } })
    fireEvent.change(within(dialog).getByLabelText('Day type'), { target: { value: 'light' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const b = (await d.tickets.get('w1'))!.brief!
    expect(b).toMatchObject({ goal: 'New goal', dayType: 'light', source: 'edited', status: 'draft' })
    expect(b.steps[1].url).toBe('https://x.test/two')
  })

  it('a learning card that needs a check but has no questions says so and offers Edit brief; saving without a question is refused', async () => {
    const { d, t } = await cardFor({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    const bare = { ...t, brief: { ...t.brief!, questions: [], deliverable: { kind: 'code' as const, prompt: 'p' } } }
    renderWithApp(<CardBrief ticket={bare} />, { db: d, plan: smallPlan })
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    expect(within(dialog).getByTestId('check-no-questions')).toHaveTextContent('This brief has no questions yet — Edit brief to add one.')
    expect(within(dialog).queryByRole('button', { name: 'Check answers' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit brief' }))
    const editor = await screen.findByRole('dialog', { name: 'Edit brief' })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(await within(editor).findByRole('alert')).toHaveTextContent('A learning card needs at least one question')
    expect((await d.tickets.get('w1'))!.brief!.questions.length).toBeGreaterThan(0) // nothing was saved
  })

  it('the editor will not save a learning card without a question', async () => {
    await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit brief' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit brief' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove question 2' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove question 1' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('A learning card needs at least one question')
  })

  it('Check links marks results from the server, or says the server is needed', async () => {
    const d = await show({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    fireEvent.click(screen.getByRole('button', { name: 'Check links' }))
    expect(await screen.findByText(/needs the Dojo server/)).toBeInTheDocument()
    expect((await d.tickets.get('w1'))!.brief!.linkCheck).toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, results: [{ url: 'https://example.com/hash-maps', ok: false, status: 404 }] }), { status: 200 })))
    fireEvent.click(screen.getByRole('button', { name: 'Check links' }))
    await waitFor(async () => expect((await d.tickets.get('w1'))!.brief!.linkCheck).toEqual([{ url: 'https://example.com/hash-maps', ok: false, status: 404 }]))
  })
})

describe('Board: draft, tools, rebalance', () => {
  async function board() {
    setNow(() => NOW)
    const d = await seededDb()
    renderWithApp(<Board />, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    await screen.findByTestId('card-p127')
    return d
  }

  it('Draft briefs for Sprint N runs to Done and drafts each card once', async () => {
    const d = await board()
    fireEvent.click(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' }))
    await waitFor(() => expect(screen.getByTestId('brief-progress')).toHaveTextContent(/^Done$/))
    expect((await d.tickets.toArray()).filter(t => t.sprint === 1).every(t => t.brief)).toBe(true)
    expect(screen.queryByTestId('ai-error')).toBeNull()
  })

  // UAT cu-3 P3-1: with every card already briefed the run is a no-op; it said "Done" and offered a stray "×"
  it('Draft briefs with every card already briefed says so, asks the AI nothing and has no Dismiss', async () => {
    const d = await board()
    fireEvent.click(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' }))
    await waitFor(() => expect(screen.getByTestId('brief-progress')).toHaveTextContent(/^Done$/))
    const calls = await d.aiLog.where('job').equals('brief').count()
    expect(calls).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId('brief-dismiss'))
    fireEvent.click(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' }))
    await waitFor(() => expect(screen.getByTestId('brief-progress')).toHaveTextContent(/^Every card in Sprint 1 already has a brief$/))
    expect(screen.queryByTestId('brief-dismiss')).toBeNull()
    expect(screen.queryByTestId('brief-failed')).toBeNull()
    expect(await d.aiLog.where('job').equals('brief').count()).toBe(calls)
    expect(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' })).toBeEnabled()
    // the note is not a result: it is not kept across a reload, and leaving the Board clears it
    cleanup()
    reloadDraftJob()
    await board()
    expect(screen.queryByTestId('brief-progress')).toBeNull()
  })

  it('a failing ticket shows the AI error, drafts the rest and can be retried', async () => {
    const d = await board()
    localStorage.setItem('dojo-ai-fake-fail', 'brief@p127')
    fireEvent.click(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' }))
    await waitFor(() => expect(screen.getByTestId('brief-progress')).toHaveTextContent(/^Done$/))
    expect(await screen.findByTestId('ai-error-detail')).toHaveTextContent('claude_failed: fake brief unavailable')
    expect(screen.getByTestId('brief-failed')).toHaveTextContent(/^\d+ of \d+ drafted; 1 couldn't be\.$/)
    expect((await d.tickets.get('p127'))!.brief).toBeUndefined()
    expect((await d.tickets.get('p1'))!.brief).toBeDefined()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(screen.getByTestId('ai-retry'))
    await waitFor(async () => expect((await d.tickets.get('p127'))!.brief).toBeDefined())
  })

  // UAT r3 P2: 16 of 16 failed read "Done" and "16 cards could not be drafted; the others were.", with no way out
  it('a run that drafts nothing is Failed, says none could be drafted and why (signed out), and Dismiss clears it', async () => {
    await board()
    localStorage.setItem('dojo-ai-fake-fail', 'brief:claude_signed_out')
    fireEvent.click(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' }))
    await waitFor(() => expect(screen.getByTestId('brief-progress')).toHaveTextContent(/^Failed$/))
    expect(screen.getByTestId('brief-failed')).toHaveTextContent(/^None of the \d+ cards could be drafted\.$/)
    const err = screen.getByTestId('ai-error')
    expect(err).toHaveTextContent("Claude Code isn't signed in. Open Terminal, run claude, sign in, then try again.")
    expect(within(err).getByText('claude', { selector: 'code' })).toBeInTheDocument()
    expect(screen.getByTestId('ai-error-detail')).toHaveTextContent('claude_signed_out: fake brief unavailable')
    expect(screen.getByTestId('ai-retry')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('brief-dismiss'))
    expect(screen.queryByTestId('brief-progress')).toBeNull()
    expect(screen.queryByTestId('brief-failed')).toBeNull()
    expect(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' })).toBeEnabled()
  })

  it('the outcome stays on the Board after leaving it and coming back (and after a reload)', async () => {
    await board()
    localStorage.setItem('dojo-ai-fake-fail', 'brief@p127')
    fireEvent.click(screen.getByRole('button', { name: 'Draft briefs for Sprint 1' }))
    await waitFor(() => expect(screen.getByTestId('brief-progress')).toHaveTextContent(/^Done$/))
    const line = screen.getByTestId('brief-failed').textContent
    cleanup()
    reloadDraftJob()
    await board()
    expect(screen.getByTestId('brief-progress')).toHaveTextContent(/^Done$/)
    expect(screen.getByTestId('brief-failed')).toHaveTextContent(line!)
    expect(screen.getByTestId('ai-error')).toBeInTheDocument()
  })

  it('Pin toggles and Move to sprint… lists sprints and moves the card', async () => {
    const d = await board()
    const card = screen.getByTestId('card-p127')
    // UAT cu-3 P3-2: the "Pinned" chip's place is kept when unpinned (an invisible stand-in), so pinning moves nothing
    expect(card.querySelector('.card-chips .pin-ghost')).not.toBeNull()
    expect(within(card).queryByText('Pinned')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Pin' }))
    await waitFor(async () => expect((await d.tickets.get('p127'))!.pinned).toBe(true))
    expect(await within(card).findByText('Pinned')).toBeInTheDocument()
    expect(card.querySelector('.card-chips .pin-ghost')).toBeNull()
    expect(await within(card).findByRole('button', { name: 'Unpin' })).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Move to sprint…' }))
    const menu = within(card).getByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Sprint 1' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sprint 3' }))
    await waitFor(async () => expect((await d.tickets.get('p127'))!.sprint).toBe(3))
    await waitFor(() => expect(screen.queryByTestId('card-p127')).toBeNull())
  })

  it('an over-budget sprint offers Rebalance?, lists the moves, and Accept moves exactly the checked ones', async () => {
    const d = await board()
    await patchSettings(d, { coreMinutes: 90 })
    for (const t of await d.tickets.toArray()) if (t.sprint === 1) await d.tickets.put({ ...t, estMin: 60 })
    expect(await screen.findByTestId('bd-rebalance')).toHaveTextContent(/Sprint 1: \d+(\.\d)? h planned, budget 1\.5 h\./)
    fireEvent.click(screen.getByRole('button', { name: 'Rebalance?' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rebalance?' })
    const boxes = within(dialog).getAllByRole('checkbox')
    expect(boxes.length).toBeGreaterThan(0)
    boxes.forEach(b => expect(b).toBeChecked())
    const first = boxes[0].getAttribute('data-testid')!.replace('rebalance-move-', '')
    fireEvent.click(boxes[0])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const after = await d.tickets.toArray()
    expect(after.find(t => t.id === first)!.sprint).toBe(1)
    expect(after.filter(t => t.sprint === 2 && ['p1', 'p127', 'p200', 'm1w1i1', 'm1w1t1'].includes(t.id))).toHaveLength(boxes.length - 1)
  })
})

describe('Settings: Core minutes per sprint', () => {
  it('shows 1440 by default and saves a valid change straight away', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    renderWithApp(<Settings />, { db: d, plan: smallPlan, route: '/settings', path: '/settings' })
    const input = await screen.findByRole('spinbutton', { name: 'Core minutes per sprint' })
    expect(input).toHaveValue(1440)
    fireEvent.change(input, { target: { value: '120' } })
    await waitFor(async () => expect((await d.settings.get('main'))!.coreMinutes).toBe(120))
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)
    expect(await screen.findByRole('alert')).toHaveTextContent('Core minutes must be a whole number from 30 to 20160')
    expect((await d.settings.get('main'))!.coreMinutes).toBe(120)
  })
})

describe('Today: workload', () => {
  async function today(at: string) {
    setNow(() => ist(at))
    const d = await seededDb()
    renderWithApp(<Today />, { db: d, plan: smallPlan })
    await screen.findByTestId('load-minutes')
    return d
  }
  it('shows planned minutes against the budget, and suggestions that fit the day', async () => {
    await today('2026-09-08T10:00:00')
    expect(screen.getByTestId('load-minutes')).toHaveTextContent('3.2 h / 24 h')
    const links = within(screen.getByTestId('suggested')).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].getAttribute('data-testid')).toMatch(/^do-/)
  })
  it('on a Thursday only light cards are suggested when any exist', async () => {
    setNow(() => ist('2026-09-10T10:00:00'))
    const d = await seededDb()
    const t = (await d.tickets.get('p127'))!
    await d.tickets.put({ ...t, brief: { goal: 'g', steps: [{ text: 's' }], minutes: 30, dayType: 'light', learn: [], outcome: 'o', deliverable: { kind: 'note', prompt: 'p' }, questions: [], status: 'draft', source: 'ai' } })
    renderWithApp(<Today />, { db: d, plan: smallPlan })
    await screen.findByTestId('load-minutes')
    const links = within(screen.getByTestId('suggested')).getAllByRole('link')
    expect(links.map(l => l.getAttribute('data-testid'))).toEqual(['do-p127'])
  })
  it('notes cards that rolled over from an ended sprint', async () => {
    setNow(() => ist('2026-09-22T10:00:00')) // sprint 2
    const d = await seededDb()
    for (const id of ['p127', 'p1']) await d.tickets.update(id, { sprint: 2, rolledFrom: [1] })
    renderWithApp(<Today />, { db: d, plan: smallPlan })
    expect(await screen.findByTestId('rolled-note')).toHaveTextContent('2 cards rolled from Sprint 1')
  })
})

describe('Progress: Reviews', () => {
  it('Build review shows the numbers and the fake prose, and lists it afterwards', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    await d.tickets.update('p1', { status: 'done', xp: 5, doneAt: NOW })
    await d.events.add({ t: 'tick', id: 'p1', at: NOW, xp: 5 })
    renderWithApp(<Reviews />, { db: d, plan: smallPlan })
    const region = await screen.findByRole('region', { name: 'Reviews' })
    expect(await within(region).findByTestId('no-reviews')).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: 'Build review' }))
    expect(await within(region).findByTestId('rv-done', {}, { timeout: 5000 })).toHaveTextContent(/^1$/)
    expect(within(region).getByTestId('rv-days')).toHaveTextContent('1 day')
    expect(within(region).getByTestId('rv-slipped')).toHaveTextContent(/^0$/)
    expect(region).toHaveTextContent('Review for Sprint 1: 1/5 cards done.')
    expect(await d.reviews.count()).toBe(1)
    // ruling 8 S4: the fake review has items, so "Do better next sprint" renders as an ol
    const list = within(region).getByRole('list', { name: 'Do better next sprint' })
    expect(list.tagName).toBe('OL')
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2)
    expect(within(region).getByRole('heading', { name: 'Do better next sprint' })).toBeInTheDocument()
  })
  it('a review without items shows no "Do better next sprint" list', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    const stats = { sprint: 1, planned: 5, done: 1, focusDays: [], longestStreak: 0, gaps: [], slipped: [], redoPassRate: null, checkPassRate: null }
    await d.reviews.add({ id: 'rv1', sprint: 1, at: NOW, stats, prose: 'Old prose only.', provider: 'fake', kind: 'manual' })
    renderWithApp(<Reviews />, { db: d, plan: smallPlan })
    expect(await screen.findByText('Old prose only.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Do better next sprint' })).toBeNull()
    expect(screen.queryByText('Do better next sprint')).toBeNull()
  })
  it('UAT cu-3p P3-10: two reviews of one sprint on one day are told apart by the time; a lone one has none', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    const stats = { sprint: 1, planned: 5, done: 1, focusDays: [], longestStreak: 0, gaps: [], slipped: [], redoPassRate: null, checkPassRate: null }
    await d.reviews.add({ id: 'rv1', sprint: 1, at: NOW, stats, prose: 'First.', provider: 'fake', kind: 'manual' })
    renderWithApp(<Reviews />, { db: d, plan: smallPlan })
    const heading = async () => (await screen.findAllByRole('heading', { level: 3 })).map(h => h.textContent ?? '').filter(t => t.startsWith('Sprint 1 ·'))
    const [lone] = await heading()
    expect(lone).toMatch(/^Sprint 1 · \d{1,2} [A-Z][a-z]{2} \d{4}$/)
    await d.reviews.add({ id: 'rv2', sprint: 1, at: NOW + 120_000, stats, prose: 'Second.', provider: 'fake', kind: 'manual' })
    await waitFor(async () => expect((await heading()).length).toBe(2))
    const [newer, older] = await heading()
    expect(newer).toMatch(/ · \d\d:\d\d$/)
    expect(older).toMatch(/ · \d\d:\d\d$/)
    expect(newer).not.toBe(older)
  })
  it('M7: while the review builds the button reads "Building…" and is disabled', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    localStorage.setItem('dojo-ai-fake-delay-ms', '400')
    renderWithApp(<Reviews />, { db: d, plan: smallPlan })
    fireEvent.click(await screen.findByRole('button', { name: 'Build review' }))
    const busy = await screen.findByRole('button', { name: 'Building…' })
    expect(busy).toBeDisabled()
    expect(await screen.findByRole('button', { name: 'Build review' }, { timeout: 5000 })).toBeEnabled()
  })
  it('an AI failure shows the error line and keeps the list empty', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    localStorage.setItem('dojo-ai-fake-fail', 'review_sprint')
    renderWithApp(<Reviews />, { db: d, plan: smallPlan })
    fireEvent.click(await screen.findByRole('button', { name: 'Build review' }))
    expect(await screen.findByTestId('ai-error', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(await d.reviews.count()).toBe(0)
  })
})

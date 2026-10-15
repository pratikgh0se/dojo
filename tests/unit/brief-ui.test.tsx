import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedBrief } from '../helpers/briefs'
import { setNow } from '../../src/lib/clock'
import { CardBrief } from '../../src/screens/brief/CardBrief'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00') // Tuesday of sprint 1 (start 2026-09-07)
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

async function cardFor(over: Parameters<typeof mkTicket>[0], briefOver: Parameters<typeof seedBrief>[2] = {}) {
  setNow(() => NOW)
  const d = freshDb()
  await d.tickets.put(mkTicket(over))
  await seedBrief(d, over.id, briefOver)
  const t = (await d.tickets.get(over.id))!
  return { d, t }
}
const show = async (over: Parameters<typeof mkTicket>[0], briefOver: Parameters<typeof seedBrief>[2] = {}) => {
  const { d, t } = await cardFor(over, briefOver)
  const Live = () => <CardBrief ticket={t} />
  renderWithApp(<Live />, { db: d, plan: flatPlanV2 })
  return d
}

describe('CardBrief', () => {
  it('renders nothing until a brief exists', async () => {
    setNow(() => NOW)
    const d = freshDb()
    renderWithApp(<CardBrief ticket={mkTicket({ id: 'a' })} />, { db: d, plan: flatPlanV2 })
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
    renderWithApp(<CardBrief ticket={{ ...t, brief }} />, { db: d, plan: flatPlanV2 })
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
    renderWithApp(<CardBrief ticket={withLinks} />, { db: d, plan: flatPlanV2 })
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
    renderWithApp(<CardBrief ticket={{ ...t, brief: { ...b, steps, linkCheck } }} />, { db: d, plan: flatPlanV2 })
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
    const d = await show({ id: 'tb1', kind: 'stage', track: 'ai', session: 'teachback', stage: 0, title: 'Stage 00 · teach-back' }, { deliverable: { kind: 'explanation', prompt: 'Explain it in your own words' } })
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
    renderWithApp(<CardBrief ticket={bare} />, { db: d, plan: flatPlanV2 })
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

import { screen, within } from '@testing-library/react'
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

  it('has no action control: a stored brief is read-only (TICKET-25)', async () => {
    await show({ id: 'ro1', kind: 'problem' })
    const card = screen.getByTestId('card-brief')
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    for (const name of ['Edit brief', 'Approve', 'Check links', 'Mark done']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})

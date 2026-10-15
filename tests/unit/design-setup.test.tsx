import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanProse } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
async function setup(id = 'd-method') {
  setNow(() => T)
  const d = await seededDb(flatPlanProse)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: `/designs/session/${id}`, path: '/designs/session/:designId' })
  await screen.findByTestId('session-setup')
  return d
}
const tid = (id: string) => screen.getByTestId(id)
const stored = async (d: Awaited<ReturnType<typeof seededDb>>) => (await d.designSessions.toArray())[0]
const summary = () => tid('session-setup-summary')

describe('setup (DESIGN-01 to 05)', () => {
  it('shows the prompt, two mode cards, the Skip checkbox, a 45 min summary and one accent Start', async () => {
    await setup()
    expect(tid('session-prompt')).toHaveTextContent('The method, on a whiteboard, in 45 minutes')
    expect(tid('design-mode-ai-partner')).toHaveTextContent('Solo · AI partner')
    expect(tid('design-mode-with-someone')).toHaveTextContent('With someone')
    expect(tid('design-mode-skip-ai')).toHaveAccessibleName('Skip the AI partner')
    expect(summary()).toHaveTextContent('45 min')
    const start = tid('session-start')
    expect(start).toHaveAttribute('data-accent', 'primary')
    expect(start).toHaveTextContent(/^START · DESIGN$/)
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('has no prompt picker, Pick for me or Pause', async () => {
    await setup()
    expect(screen.queryByText(/pick for me/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
  it('defaults to the AI partner with Skip unchecked and enabled', async () => {
    await setup()
    expect(tid('design-mode-ai-partner')).toHaveAttribute('aria-checked', 'true')
    expect(tid('design-mode-with-someone')).toHaveAttribute('aria-checked', 'false')
    expect(tid('design-mode-skip-ai')).not.toBeChecked()
    expect(tid('design-mode-skip-ai')).toBeEnabled()
  })
  it('Skip is unavailable and unchecked under With someone, and comes back on switching back', async () => {
    await setup()
    fireEvent.click(tid('design-mode-skip-ai'))
    fireEvent.click(tid('design-mode-with-someone'))
    expect(tid('design-mode-skip-ai')).toBeDisabled()
    expect(tid('design-mode-skip-ai')).not.toBeChecked()
    fireEvent.click(tid('design-mode-ai-partner'))
    expect(tid('design-mode-skip-ai')).toBeEnabled()
  })
  it('the summary Partner line follows the choice: AI partner, With someone, Solo (DESIGN-01/03)', async () => {
    await setup()
    const partner = () => summary().querySelector('dt + dd') as HTMLElement
    expect(summary().querySelector('dt')).toHaveTextContent('Partner')
    expect(partner()).toHaveTextContent(/^Solo · AI partner$/)
    fireEvent.click(tid('design-mode-with-someone'))
    expect(partner()).toHaveTextContent(/^With someone$/)
    fireEvent.click(tid('design-mode-ai-partner'))
    fireEvent.click(tid('design-mode-skip-ai'))
    expect(partner()).toHaveTextContent(/^Solo$/)
    fireEvent.click(tid('design-mode-skip-ai'))
    expect(partner()).toHaveTextContent(/^Solo · AI partner$/)
    const dds = Array.from(summary().querySelectorAll('dd')).map(e => e.textContent)
    expect(dds[1]).toBe('45 min')
  })
  it('the Start button is the last control in its row', async () => {
    await setup()
    const row = tid('session-start').parentElement as HTMLElement
    expect(row.lastElementChild).toBe(tid('session-start'))
  })
  it.each([
    ['default', async () => {}, 'ai-partner'],
    ['with someone', async () => { fireEvent.click(tid('design-mode-with-someone')) }, 'human-partner'],
    ['skip', async () => { fireEvent.click(tid('design-mode-skip-ai')) }, 'solo'],
  ])('start records the mode (%s)', async (_n, act, mode) => {
    const d = await setup()
    await act()
    fireEvent.click(tid('session-start'))
    await waitFor(async () => expect((await stored(d))?.mode).toBe(mode))
    expect(await stored(d)).toMatchObject({ phase: 'drawing', designId: 'd-method' })
  })
  it('starts three sessions in a row, discarding between, with the three modes (DESIGN-04)', async () => {
    const d = await setup()
    const modes: string[] = []
    const acts = [async () => {}, async () => { fireEvent.click(tid('design-mode-with-someone')) }, async () => { fireEvent.click(tid('design-mode-skip-ai')) }]
    for (const act of acts) {
      await screen.findByTestId('session-setup')
      await act()
      fireEvent.click(tid('session-start'))
      await waitFor(async () => expect(await d.designSessions.count()).toBe(1))
      modes.push((await stored(d)).mode as string)
      fireEvent.click(await screen.findByTestId('session-discard'))
      fireEvent.click(await screen.findByTestId('session-discard-confirm'))
      await waitFor(async () => expect(await d.designSessions.count()).toBe(0))
    }
    expect(modes).toEqual(['ai-partner', 'human-partner', 'solo'])
  })
  it('names no banned word in the copy this screen owns', async () => {
    await setup()
    // Plan content (deep dives, reference labels such as "Hello Interview free guides" in the S1-owned
    // fixture and public/data-private/plan.json) is S1's, not S8's: it carries data-content="plan" and is
    // excluded here. Gap for S1: the plan still names the banned word in its reference label.
    const copy = document.body.cloneNode(true) as HTMLElement
    copy.querySelectorAll('[data-content="plan"]').forEach(e => e.remove())
    expect(copy.textContent ?? '').not.toMatch(/interview/i)
    expect(copy.textContent ?? '').toContain('Skip the AI partner')
  })
})

describe('the brief is shown once (D14/D15 visual pass)', () => {
  it('draws the deep dives as one numbered list; a text that is only those bullets stays in the data, hidden from sight and assistive tech', async () => {
    await setup()
    const first = (await import('../helpers/plan')).flatPlanProse.design_bank.flatMap(t => t.items).find(i => i.id === 'd-method')!.deep_dives[0]
    expect(screen.getAllByText(first, { exact: true })).toHaveLength(1)
    expect(tid('session-dive-1')).toHaveTextContent(first)
    const raw = tid('session-prompt').querySelector('.vh[aria-hidden="true"]')
    expect(raw?.textContent ?? '').toContain('•')
    expect(tid('session-prompt').querySelector('.ds-brief')).toBeNull()
  })
  it('keeps the lines of a brief that is not the deep dives, one under another', async () => {
    setNow(() => T)
    const d = await seededDb(flatPlanProse)
    await d.tickets.put({ id: 'ai.p1.writeup', title: 'Write up the gateway', kind: 'writeup', status: 'todo', text: '• one\n• two', links: [] } as never)
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/ai.p1.writeup', path: '/designs/session/:designId' })
    const p = (await screen.findByTestId('session-prompt')).querySelector('.ds-brief')!
    expect(p.textContent).toBe('• one\n• two')
  })
  it('lists what is graded as separate lines, not one run-on', async () => {
    await setup()
    expect(summary().querySelectorAll('.ds-graded-i').length).toBeGreaterThanOrEqual(5)
  })
})

describe('write-up tickets (the route serves design and write-up ids, F9)', () => {
  it('opens setup for a write-up ticket that is not in the design bank', async () => {
    setNow(() => T)
    const d = await seededDb(flatPlanProse)
    await d.tickets.put({ id: 'ai.p1.writeup', title: 'Write up the gateway', kind: 'writeup', status: 'todo', text: 'One page: the trade-offs you made.', links: [] } as never)
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/ai.p1.writeup', path: '/designs/session/:designId' })
    expect(await screen.findByTestId('session-prompt')).toHaveTextContent('Write up the gateway')
    expect(tid('session-prompt')).toHaveTextContent('One page: the trade-offs you made.')
  })
  it('starts a session on a write-up ticket with designId equal to the ticket id', async () => {
    setNow(() => T)
    const d = await seededDb(flatPlanProse)
    await d.tickets.put({ id: 'ai.p1.writeup', title: 'Write up the gateway', kind: 'writeup', status: 'todo', text: 'One page.', links: [] } as never)
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/ai.p1.writeup', path: '/designs/session/:designId' })
    fireEvent.click(await screen.findByTestId('session-start'))
    await waitFor(async () => expect(await stored(d)).toMatchObject({ designId: 'ai.p1.writeup', phase: 'drawing', mode: 'ai-partner' }))
  })
  it('still says Design not found for an unknown id', async () => {
    setNow(() => T)
    const d = await seededDb(flatPlanProse)
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/nope', path: '/designs/session/:designId' })
    expect(await screen.findByRole('heading', { name: 'Design not found' })).toBeInTheDocument()
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { resetNow, setNow } from '../../src/lib/clock'
import { clearStudy, loadStudy, saveStudy } from '../../src/lib/studyStore'
import { Do } from '../../src/screens/Do'
import { useLegendKeys } from '../../src/app/legend'
import { seedBrief } from '../helpers/briefs'
import { seededDb } from '../helpers/db'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))
afterEach(() => { cleanup(); clearStudy(); ro.on = false; resetNow() })

vi.mock('../../src/runner/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => <textarea aria-label="Code" value={value} onChange={e => onChange(e.target.value)} />,
}))

const plans = appPlans()
const watch = mkTicket({
  id: 'w1', kind: 'watch', lane: 'path', node: 'L3', title: 'Watch: Karpathy deep dive', estMin: 62, links: [{ label: 'Video', url: 'https://youtu.be/abc' }],
  explain: ['What is a weight?', 'What does training change?'], explainAnswers: ['One adjustable number.', 'The weights.'],
})
const build = mkTicket({ id: 'b1', kind: 'build', lane: 'path', title: 'Build: tokensim step 2', estMin: 90, lab: { id: 'tokensim', gpu: 'none' }, text: 'Replace the fixed batch.' })

async function open(t: Ticket, extra: Ticket[] = []) {
  clearStudy()
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.bulkPut([t, ...extra])
  renderWithApp(<Do />, { db: d, ...plans, route: `/do/${t.id}`, path: '/do/:ticketId' })
  return d
}
const CONTROLS = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [tabindex]:not([tabindex="-1"])'
const accents = () => document.querySelectorAll('[data-accent="primary"]')

describe('ticket view: watch', () => {
  it('shows the header facts, the link, notes and the explain section, and nothing from the ladder', async () => {
    await open(watch)
    expect(await screen.findByTestId('do-title')).toHaveTextContent('Karpathy deep dive')
    expect(screen.getByTestId('ticket-kind')).toHaveTextContent('Watch')
    expect(screen.getByTestId('ticket-lane')).toHaveTextContent('AI')
    expect(screen.getByTestId('ticket-est')).toHaveTextContent('62 min')
    expect(screen.getByTestId('do-ticket-xp')).toHaveTextContent('10 xp')
    expect(screen.getByTestId('do-back')).toBeInTheDocument()
    const link = screen.getByTestId('ticket-link')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.querySelector('[data-content="plan"]')).not.toBeNull() // the address; the "Open the video" label is the app's
    expect(link).toHaveAttribute('href', 'https://youtu.be/abc')
    expect(screen.getByTestId('ticket-notes')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-explain-q-1')).toHaveTextContent('What is a weight?')
    expect(screen.getByTestId('ticket-explain-answer-2')).toBeInTheDocument()
    for (const hook of ['ladder', 'do-outcome-solved', 'do-outcome-help', 'do-outcome-giveup', 'no-brief']) expect(screen.queryByTestId(hook)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Solved with help|Give up/)
  })

  it('has one start control, it is the accent, and exactly one timer reading', async () => {
    await open(watch)
    const start = await screen.findByTestId('ticket-start')
    expect(start).toHaveAttribute('data-accent', 'primary')
    expect(start).toHaveTextContent(/^START · WATCH$/i)
    expect(accents()).toHaveLength(1)
    expect(screen.getAllByTestId('timer-readout')).toHaveLength(1)
    expect(screen.queryByTestId('ticket-done')).toBeNull()
    expect([...document.querySelectorAll('button, a')].filter(e => /^start/i.test(e.textContent ?? ''))).toHaveLength(1)
    for (const gone of ['do-timer-preset-25', 'do-timer-preset-50', 'do-custom-minutes', 'spar-25', 'spar-50', 'plan-start']) expect(screen.queryByTestId(gone)).toBeNull()
    expect(document.body.textContent).not.toMatch(/START 25|START 50|CUSTOM|Spar|Plan this session/i)
  })

  it('review N4: before the start the one START is in the header card under the title, not at the foot of the notes; Done then sits in the body', async () => {
    await open(watch)
    const start = await screen.findByTestId('ticket-start')
    const card = screen.getByTestId('do-title').closest('section') as HTMLElement
    expect(card).toContainElement(start)
    expect(card).toContainElement(screen.getByTestId('do-back'))
    expect(screen.getAllByTestId('ticket-start')).toHaveLength(1)
    // not in the notes box or the explain section any more
    expect(screen.getByTestId('ticket-notes').closest('section')).not.toContainElement(start)
    expect(screen.getByTestId('ticket-explain')).not.toContainElement(start)
    fireEvent.click(start)
    const done = await screen.findByTestId('ticket-done')
    expect(card).not.toContainElement(done)
    expect(screen.getByTestId('ticket-explain')).toContainElement(done)
  })

  it('review N4: a build ticket also starts from the header card, and its notes box has no empty action row', async () => {
    await open(build)
    const start = await screen.findByTestId('ticket-start')
    expect((screen.getByTestId('do-title').closest('section') as HTMLElement)).toContainElement(start)
    expect(screen.getByTestId('ticket-notes').closest('section')!.querySelector('.dk-actions')).toBeNull()
  })

  it('starts one timer at the remembered length, marks the ticket doing and swaps Start for Done', async () => {
    const d = await open(watch)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await waitFor(async () => expect((await d.tickets.get('w1'))!.status).toBe('doing'))
    await waitFor(() => expect(screen.getByTestId('timer-readout').textContent).toMatch(/^2[45]:\d\d$/))
    expect(screen.getByTestId('timer-state')).toHaveTextContent('running')
    expect(screen.queryByTestId('ticket-start')).toBeNull()
    const done = screen.getByTestId('ticket-done')
    expect(done).toHaveAttribute('data-accent', 'primary')
    expect(done).toHaveTextContent(/^DONE · WATCH$/i)
    expect(accents()).toHaveLength(1)
    expect((await d.tickets.get('w1'))!.order).toBe(watch.order)
  })

  it('pauses and resumes, and says plainly when time is up', async () => {
    await open(watch)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await screen.findByTestId('timer-pause')
    fireEvent.click(screen.getByTestId('timer-pause'))
    expect(screen.getByTestId('timer-state')).toHaveTextContent('paused')
    fireEvent.click(screen.getByTestId('timer-resume'))
    expect(screen.getByTestId('timer-state')).toHaveTextContent('running')
    saveStudy({ ...loadStudy()!, over: true, blocks: 1 })
    expect(await screen.findByTestId('ticket-time-up')).toHaveTextContent('Time is up. Keep going or finish.')
    expect(screen.getByTestId('timer-readout')).toHaveTextContent('00:00')
    expect(screen.getByTestId('timer-state')).toHaveTextContent('over')
    expect(screen.getByTestId('ticket-done')).toBeInTheDocument()
    expect(screen.queryByTestId('timer-pause')).toBeNull()
  })

  it('finishes once: done, XP by kind, one session row, no accent left', async () => {
    const d = await open(watch)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    expect(await screen.findByTestId('ticket-done-state')).toHaveTextContent('Done.')
    const t = (await d.tickets.get('w1'))!
    expect(t.status).toBe('done')
    expect(t.xp).toBe(10)
    expect(t.doneAt).toBeDefined()
    expect(t.order).toBe(watch.order)
    expect((await d.sessions.toArray()).filter(s => s.ticketId === 'w1')).toHaveLength(1)
    expect(accents()).toHaveLength(0)
    expect(screen.getByTestId('do-back')).toBeInTheDocument()
  })

  it('does not wait for the explain questions', async () => {
    const d = await open(watch)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    await waitFor(async () => expect((await d.tickets.get('w1'))!.status).toBe('done'))
  })

  it('keeps the reference answers hidden until every answer holds a character (answer first)', async () => {
    await open(watch)
    const reveal = await screen.findByTestId('ticket-reveal')
    expect(reveal).toBeDisabled()
    expect(document.body.textContent).not.toContain('One adjustable number.')
    fireEvent.change(screen.getByTestId('ticket-explain-answer-1'), { target: { value: 'a weight' } })
    expect(reveal).toBeDisabled()
    fireEvent.change(screen.getByTestId('ticket-explain-answer-2'), { target: { value: '  ' } })
    expect(reveal).toBeDisabled()
    fireEvent.change(screen.getByTestId('ticket-explain-answer-2'), { target: { value: 'it nudges them' } })
    expect(reveal).toBeEnabled()
    fireEvent.click(reveal)
    // TICKET-15: the hooked element holds exactly the reference answer; its "Reference" label sits outside it
    expect(screen.getByTestId('ticket-reference-1').textContent).toBe('One adjustable number.')
    expect(screen.getByTestId('ticket-reference-2').textContent).toBe('The weights.')
    expect(screen.getAllByText('Reference')).toHaveLength(2)
  })

  it('saves notes and explain answers on the ticket and shows them after a reload', async () => {
    const d = await open(watch)
    fireEvent.change(await screen.findByTestId('ticket-notes'), { target: { value: 'layers and weights' } })
    fireEvent.change(screen.getByTestId('ticket-explain-answer-2'), { target: { value: 'it nudges them' } })
    expect(screen.getByTestId('ticket-notes')).toHaveValue('layers and weights')
    await waitFor(async () => expect(await d.tickets.get('w1')).toMatchObject({ learnerNotes: 'layers and weights', explainResponses: ['', 'it nudges them'] }), { timeout: 3000 })
    cleanup()
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/w1', path: '/do/:ticketId' })
    expect(await screen.findByTestId('ticket-notes')).toHaveValue('layers and weights')
    expect(screen.getByTestId('ticket-explain-answer-2')).toHaveValue('it nudges them')
    expect(screen.queryByTestId('ticket-reference-1')).toBeNull()
  })

  it('saves a draft that has not autosaved yet when Done is pressed', async () => {
    const d = await open(watch)
    fireEvent.change(await screen.findByTestId('ticket-notes'), { target: { value: 'late note' } })
    fireEvent.click(screen.getByTestId('ticket-start'))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    await waitFor(async () => expect(await d.tickets.get('w1')).toMatchObject({ status: 'done', learnerNotes: 'late note' }))
  })

  it('shows no explain section or reveal when the ticket has no questions', async () => {
    await open({ ...watch, id: 'w2', explain: undefined, explainAnswers: undefined })
    await screen.findByTestId('do-title')
    expect(screen.queryByTestId('ticket-explain')).toBeNull()
    expect(screen.queryByTestId('ticket-reveal')).toBeNull()
  })

  it('explains why the ticket matters and what it unlocks', async () => {
    await open(watch)
    expect(await screen.findByTestId('ticket-why')).toHaveTextContent('How an LLM is made')
    expect(screen.getByTestId('ticket-why')).toHaveTextContent('Why How an LLM is made matters.')
    expect(screen.getByTestId('ticket-unlocks')).toHaveTextContent('How inference works')
  })

  it('stays under 15 controls once started', async () => {
    await open(watch)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await screen.findByTestId('ticket-done')
    const root = screen.getByTestId('do-screen')
    expect(root.querySelectorAll(CONTROLS).length).toBeLessThanOrEqual(15)
  })

  it('opens focus mode on F outside a text field, and F typed in notes only types', async () => {
    await open(watch)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await screen.findByTestId('ticket-done')
    fireEvent.keyDown(screen.getByTestId('ticket-notes'), { key: 'f' })
    expect(screen.queryByTestId('focus-screen')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'F' })
    expect(await screen.findByTestId('focus-screen')).toBeInTheDocument()
    expect(within(screen.getByTestId('focus-screen')).getByTestId('focus-timer').textContent).toMatch(/^\d\d:\d\d$/)
    fireEvent.click(screen.getByTestId('focus-exit'))
    expect(screen.queryByTestId('focus-screen')).toBeNull()
  })

  it('refuses to start in a read-only browser (Review Focus 4) and disables notes and answers', async () => {
    ro.on = true
    await open(watch)
    expect(await screen.findByTestId('ticket-start')).toBeDisabled()
    expect(screen.getByTestId('ticket-notes')).toBeDisabled()
    expect(screen.getByTestId('ticket-explain-answer-1')).toBeDisabled()
  })
})

describe('ticket view: saving never fails silently', () => {
  it('limits the notes and answer boxes to what the data layer stores', async () => {
    await open(watch)
    expect(await screen.findByTestId('ticket-notes')).toHaveAttribute('maxlength', '20000')
    expect(screen.getByTestId('ticket-explain-answer-1')).toHaveAttribute('maxlength', '4000')
    expect(screen.getByTestId('ticket-explain-answer-2')).toHaveAttribute('maxlength', '4000')
  })

  it('says so when a note is too long to store, and Done still finishes the ticket', async () => {
    const d = await open(watch)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await screen.findByTestId('ticket-done')
    fireEvent.change(screen.getByTestId('ticket-notes'), { target: { value: 'x'.repeat(20_001) } })
    fireEvent.click(screen.getByTestId('ticket-done'))
    expect(await screen.findByText('Notes can be at most 20000 characters')).toBeInTheDocument()
    await waitFor(async () => expect((await d.tickets.get('w1'))!.status).toBe('done'))
    expect((await d.tickets.get('w1'))!.learnerNotes).toBeUndefined()
  })

  it('says so when an answer is too long to store', async () => {
    await open(watch)
    fireEvent.change(await screen.findByTestId('ticket-explain-answer-1'), { target: { value: 'y'.repeat(4_001) } })
    fireEvent.blur(screen.getByTestId('ticket-explain-answer-1'))
    expect(await screen.findByText('An answer can be at most 4000 characters')).toBeInTheDocument()
  })

  it('shows an in-app plan link as a link to that screen, not as a dropped link', async () => {
    await open({ ...watch, id: 'w5', links: [{ label: 'Open the bank', url: '#bank' }, { label: 'Paper', url: 'https://example.org/p' }] })
    const link = await screen.findByTestId('ticket-link')
    expect(link).toHaveAttribute('href', '/dsa')
    expect(link).not.toHaveAttribute('target')
    expect(link.querySelector('[data-content="plan"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: /Paper/ })).toHaveAttribute('target', '_blank')
  })
})

describe('ticket view: build, ritual, task, design', () => {
  it('shows the lab marker, four steps with commands and copy buttons, and an honest self-mark that never blocks Done', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const d = await open(build)
    expect(await screen.findByTestId('ticket-lab')).toHaveTextContent('No GPU')
    for (const s of ['up', 'run', 'check', 'down']) {
      const row = screen.getByTestId(`ticket-lab-step-${s}`)
      expect(within(row).getByTestId(`ticket-lab-command-${s}`).textContent!.length).toBeGreaterThan(5)
      expect(row).toHaveTextContent(s[0].toUpperCase() + s.slice(1))
      expect(screen.getByTestId(`ticket-lab-copy-${s}`)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByTestId('ticket-lab-copy-run'))
    expect(writeText).toHaveBeenCalledWith(screen.getByTestId('ticket-lab-command-run').textContent)
    expect(await screen.findByTestId('toast')).toHaveTextContent('Copied')
    const mark = screen.getByTestId('ticket-selfmark')
    expect(mark).not.toBeChecked()
    expect(document.querySelector('label')!.textContent).toBeTruthy()
    fireEvent.click(screen.getByTestId('ticket-start'))
    expect(await screen.findByTestId('ticket-done')).toBeEnabled()
    fireEvent.click(screen.getByTestId('ticket-selfmark'))
    expect(screen.getByTestId('ticket-selfmark')).toBeChecked()
    await waitFor(async () => expect((await d.tickets.get('b1'))!.selfMark).toBe('done'), { timeout: 3000 })
    expect(screen.queryByText(/pass|fail|reviewer/i)).toBeNull()
  })

  it('shows the cost of a rented GPU', async () => {
    await open({ ...build, id: 'b2', lab: { id: 'fleet', gpu: 'rented', costUsd: 12 } })
    expect(await screen.findByTestId('ticket-lab')).toHaveTextContent(/Rented GPU.*\$12/)
  })

  it('shows a ritual as its title, minutes and Done only', async () => {
    await open(mkTicket({ id: 'r1', kind: 'ritual', lane: 'ritual', title: 'Try a new model', estMin: 30 }))
    await screen.findByTestId('do-title')
    for (const hook of ['ticket-explain', 'ticket-lab-steps', 'ladder']) expect(screen.queryByTestId(hook)).toBeNull()
    expect(screen.getByTestId('ticket-est')).toHaveTextContent('30 min')
    // R7: not started offers Start (the accent) and a plain Done; exactly one control begins with Start
    expect(screen.getByTestId('ticket-start')).toHaveAttribute('data-accent', 'primary')
    expect(screen.getByTestId('ticket-done')).not.toHaveAttribute('data-accent')
    expect(screen.getByTestId('ticket-done')).toHaveTextContent(/^DONE · RITUAL$/i)
    expect(accents()).toHaveLength(1)
    expect([...document.querySelectorAll('button, a')].filter(e => /^start/i.test(e.textContent ?? ''))).toHaveLength(1)
    fireEvent.click(screen.getByTestId('ticket-start'))
    await waitFor(() => expect(screen.queryByTestId('ticket-start')).toBeNull())
    expect(screen.getByTestId('ticket-done')).toHaveAttribute('data-accent', 'primary')
    expect(accents()).toHaveLength(1)
  })

  it('finishes an unstarted ritual with Done: one session row', async () => {
    const d = await open(mkTicket({ id: 'r2', kind: 'ritual', lane: 'ritual', title: 'Try a new model', estMin: 30 }))
    fireEvent.click(await screen.findByTestId('ticket-done'))
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    expect((await d.tickets.get('r2'))!.status).toBe('done')
    expect((await d.sessions.toArray()).filter(s => s.ticketId === 'r2')).toHaveLength(1)
    expect(accents()).toHaveLength(0)
  })

  it('shows a task with its text and no brief message', async () => {
    await open(mkTicket({ id: 'k1', kind: 'task', lane: 'career', title: 'Draft the story', text: 'Write three paragraphs.' }))
    expect(await screen.findByText('Write three paragraphs.')).toBeInTheDocument()
    expect(screen.queryByTestId('no-brief')).toBeNull()
    expect(screen.queryByTestId('ladder')).toBeNull()
  })

  it('offers only OPEN · DESIGN on a design or write-up ticket, leading to the session', async () => {
    await open(mkTicket({ id: 'dz', kind: 'writeup', lane: 'path', title: 'Write up the gateway' }))
    const open1 = await screen.findByTestId('ticket-open-session')
    expect(open1).toHaveTextContent(/^OPEN · DESIGN$/i)
    expect(open1).toHaveAttribute('href', '/designs/session/dz')
    expect(screen.queryByTestId('ticket-start')).toBeNull()
    expect(screen.queryByTestId('ticket-done')).toBeNull()
    expect(screen.queryByTestId('timer-readout')).toBeNull()
    expect(document.querySelector('[data-testid="do-screen"]')!.querySelectorAll(CONTROLS).length).toBeLessThanOrEqual(3)
  })

  it('leaves a finished ticket with no start control', async () => {
    await open({ ...watch, id: 'w9', status: 'done', xp: 10, doneAt: 5 })
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    expect(screen.queryByTestId('ticket-start')).toBeNull()
    expect(accents()).toHaveLength(0)
  })

  it('says a missing or archived ticket is not on the path, with one action', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put({ ...watch, id: 'old', archived: true })
    for (const id of ['nope', 'old']) {
      cleanup()
      renderWithApp(<Do />, { db: d, ...plans, route: `/do/${id}`, path: '/do/:ticketId' })
      expect(await screen.findByText('That ticket is not on your path.')).toBeInTheDocument()
      expect(screen.getByTestId('ticket-missing-action')).toHaveAttribute('href', '/path')
    }
  })
})

describe('ticket view: every non-problem kind', () => {
  const kinds = [
    mkTicket({ id: 'rd', kind: 'read', lane: 'path', title: 'Read: the paper', links: [{ label: 'Paper', url: 'https://example.org/p' }], explain: ['Why?'], explainAnswers: ['Because.'] }),
    build, mkTicket({ id: 'rt', kind: 'ritual', lane: 'ritual', title: 'Try a new model', estMin: 30 }),
    mkTicket({ id: 'tk', kind: 'task', lane: 'career', title: 'Draft the story', text: 'Write three paragraphs.' }),
  ]
  for (const t of kinds) {
    it(`${t.kind}: one timer, at most 15 controls, one accent started, none done, no removed words`, async () => {
      const d = await open(t)
      expect(await screen.findByTestId('do-title')).toHaveTextContent(t.title)
      expect(screen.getAllByTestId('timer-readout')).toHaveLength(1)
      fireEvent.click(screen.getByTestId('ticket-start'))
      await waitFor(() => expect(screen.queryByTestId('ticket-start')).toBeNull())
      fireEvent.click(screen.getByTestId('ticket-done'))
      await waitFor(async () => expect((await d.tickets.get(t.id))!.status).toBe('done'))
      expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
      await waitFor(() => expect(loadStudy()).toBeNull())
      expect(accents()).toHaveLength(0)
      expect(document.body.textContent).not.toMatch(/Plan this session|Load check|Dig in|Spar|CUSTOM|no brief|Solved|Give up/i)
    })
    it(`${t.kind}: stays within the control budget once started`, async () => {
      await open(t)
      fireEvent.click(await screen.findByTestId('ticket-start'))
      await waitFor(() => expect(screen.queryByTestId('ticket-start')).toBeNull())
      expect(screen.getByTestId('ticket-done')).toHaveAttribute('data-accent', 'primary')
      expect(screen.getByTestId('do-screen').querySelectorAll(CONTROLS).length).toBeLessThanOrEqual(15)
      expect(accents()).toHaveLength(1)
      for (const hook of ['ticket-check-results', 'ticket-reviewer']) expect(screen.queryByTestId(hook)).toBeNull()
    })
  }

  it('keeps the self-mark and clears it again (null in the data)', async () => {
    const d = await open(build)
    fireEvent.click(await screen.findByTestId('ticket-selfmark'))
    await waitFor(async () => expect((await d.tickets.get('b1'))!.selfMark).toBe('done'))
    fireEvent.click(screen.getByTestId('ticket-selfmark'))
    await waitFor(async () => expect((await d.tickets.get('b1'))!.selfMark).toBeUndefined())
  })

  it('marks plan text and links so the shipped plan words do not trip the vocabulary rule', async () => {
    await open({ ...watch, id: 'w3', links: [{ label: 'Interview guide', url: 'https://a.example/x' }, { label: 'Second: interviewing', url: 'https://b.example/y' }] })
    await screen.findByTestId('ticket-link')
    for (const a of document.querySelectorAll('a[target="_blank"]')) expect(a.hasAttribute('data-content') || a.querySelector('[data-content="plan"]') !== null, a.outerHTML.slice(0, 80)).toBe(true)
    const clone = document.body.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[data-content]').forEach(e => e.remove())
    expect(clone.textContent).not.toMatch(/\binterview/i)
  })

  it('describes an unfinished ticket honestly when it was left doing without a timer', async () => {
    await open({ ...watch, id: 'w4', status: 'doing' })
    expect(await screen.findByTestId('ticket-start')).toBeInTheDocument()
    expect(screen.getByTestId('timer-state')).toHaveTextContent('ready')
  })
})

describe('ticket view: problem keeps its ladder', () => {
  it('has the ladder and outcomes, one Start, one accent, and none of the old timer controls', async () => {
    setNow(() => new Date('2026-09-08T21:10:00+05:30').getTime())
    const d = await seededDb()
    renderWithApp(<Do />, { db: d, plan: (await import('../helpers/plan')).flatPlanV2, route: '/do/p127', path: '/do/:ticketId' })
    expect(await screen.findByTestId('ticket-start')).toHaveTextContent(/^START · PROBLEM$/i)
    expect(screen.getByTestId('ladder')).toBeInTheDocument()
    expect(screen.getByTestId('do-outcome-solved')).toBeInTheDocument()
    expect(screen.getAllByTestId('timer-readout')).toHaveLength(1)
    expect(accents()).toHaveLength(1)
    for (const gone of ['do-timer-preset-25', 'do-timer-preset-50', 'do-custom-minutes', 'start-session']) expect(screen.queryByTestId(gone)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Retreat|Plan this session|START 25|Spar/i)
  })
})

describe('ticket view: a problem in the contract (TICKET-08, 25, 30, 31, 32)', () => {
  const PACK = {
    id: 'p91', title: 'Decode Ways', fn: 'numDecodings', signature: 'func numDecodings(s string) int', starter: 'package main\n', examples: 1,
    cases: [{ id: 1, call: 'numDecodings("12")', expected: 2 }],
  }
  const problem = mkTicket({
    id: 'p91', kind: 'problem', lane: 'bank', track: 'interview', title: '91 · Decode Ways', difficulty: 'M', estMin: 30,
    links: [{ label: 'LeetCode', url: 'https://leetcode.com/problems/decode-ways/' }],
  })
  async function openProblem(t: Ticket = problem) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/tools/packs/') ? new Response(JSON.stringify(PACK), { status: 200 }) : new Response('{}', { status: 404 }))))
    const d = await open(t)
    await screen.findByTestId('ladder')
    return d
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows the header facts of every kind and no sprint badge', async () => {
    await openProblem()
    expect(screen.getByTestId('ticket-kind')).toHaveTextContent('Problem')
    expect(screen.getByTestId('ticket-lane')).toHaveTextContent('DSA')
    expect(screen.getByTestId('ticket-est')).toHaveTextContent('30 min')
    expect(screen.getByTestId('do-title')).toHaveTextContent('91 · Decode Ways')
    expect(document.querySelector('.do-rail-sprint')).toBeNull()
    expect(screen.getByTestId('timer-readout')).toHaveTextContent('25:00')
  })

  it('carries one accent before the start (Start) and none once running: Solved, Submit and the rest are plain (TICKET-32)', async () => {
    await openProblem()
    await screen.findByRole('button', { name: 'Submit' })
    expect(accents()).toHaveLength(1)
    expect(screen.getByTestId('ticket-start')).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('.sr-btn-accent')).toHaveLength(1)
    expect(screen.getByTestId('do-outcome-solved')).not.toHaveAttribute('data-accent')
    expect(screen.getByTestId('do-outcome-solved')).not.toHaveClass('sr-btn-accent')
    fireEvent.click(screen.getByTestId('ticket-start'))
    await waitFor(() => expect(screen.queryByTestId('ticket-start')).toBeNull())
    expect(accents()).toHaveLength(0)
    expect(document.querySelectorAll('.sr-btn-accent')).toHaveLength(0)
    // the solved label is a plain verb, not an accent label that GLOBAL-03 would read as VERB · OBJECT
    expect(screen.getByTestId('do-outcome-solved')).toHaveTextContent(/^Solved$/)
  })

  it('renders accent-styled tool buttons inside the problem screen as plain controls (scoped rule in do.css)', () => {
    const css = readFileSync(resolve(__dirname, '../../src/screens/do.css'), 'utf8')
    expect(css).toMatch(/\.do \.sr-btn-accent:not\(\[data-accent\]\)\s*\{[^}]*background:\s*transparent/)
  })

  it('started: one timer reading, one End, one Pause, no pill and no second completion control', async () => {
    await openProblem()
    await screen.findByRole('button', { name: 'Submit' })
    fireEvent.click(screen.getByTestId('ticket-start'))
    await screen.findByTestId('session-panel')
    expect(screen.getAllByTestId('timer-readout')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /End session/ })).toHaveLength(1)
    expect(screen.getAllByTestId('timer-pause')).toHaveLength(1)
    for (const gone of ['session-dock', 'session-pill', 'ticket-done', 'start-session', 'do-timer-preset-25', 'plan-dialog']) expect(screen.queryByTestId(gone)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Soft chime|Retreat|Plan this session|START 25|Spar|Mark done/i)
  })

  /** TICKET-31 in the default desktop state: every focusable thing a person could tab to, but nothing inside a closed disclosure. */
  const ALL_CONTROLS = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex], [contenteditable=true]'
  function controlsInDo(): Element[] {
    return [...screen.getByTestId('do-screen').querySelectorAll(ALL_CONTROLS)].filter(e => {
      if (e.matches('[tabindex]') && !e.matches('button, a[href], input, select, textarea, summary, [role=button], [contenteditable=true]') && Number(e.getAttribute('tabindex')) < 0) return false
      const closed = e.closest('details:not([open])')
      return !(closed && e.closest('summary') === null)
    })
  }
  async function startedProblem(t: Ticket) {
    await openProblem(t)
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await screen.findByTestId('session-panel')
    await screen.findByTestId('ladder')
  }
  const budgetNote = (els: Element[]) => els.map(e => `${e.tagName.toLowerCase()}[${e.getAttribute('data-testid') ?? e.getAttribute('aria-label') ?? e.textContent?.slice(0, 20)}]`).join(', ')

  it('a plain started problem stays within 15 controls with the ladder collapsed (TICKET-31)', async () => {
    await startedProblem({ ...problem, id: 'x1', title: 'A plain problem', track: 'interview' })
    const els = controlsInDo()
    expect(els.length, budgetNote(els)).toBeLessThanOrEqual(15)
    expect(document.querySelector('[data-testid="ladder"] details')).not.toHaveAttribute('open')
  })

  it('p91 (code panel and Approaches strip) stays within 15 controls started, ladder collapsed, reveal not pressed', async () => {
    await startedProblem(problem)
    expect(screen.getByTestId('code-panel')).toBeInTheDocument()
    expect(screen.getByTestId('dsa-approaches')).toBeInTheDocument()
    const els = controlsInDo()
    expect(els.length, budgetNote(els)).toBeLessThanOrEqual(15)
  })

  it('p200 (Approaches strip) stays within 15 controls started', async () => {
    await startedProblem({ ...problem, id: 'p200', title: '200 · Number of Islands' })
    expect(screen.getByTestId('dsa-approaches')).toBeInTheDocument()
    const els = controlsInDo()
    expect(els.length, budgetNote(els)).toBeLessThanOrEqual(15)
  })

  it('keeps every ladder, outcome, approaches and code-panel hook in the page with the disclosures closed', async () => {
    await startedProblem(problem)
    for (const hook of ['ladder', 'ladder-spent', 'ladder-rung-attempt', 'ladder-open-hint', 'ladder-open-solution', 'dsa-approaches', 'code-panel', 'do-outcome-solved', 'do-outcome-help', 'do-outcome-giveup', 'session-end']) {
      expect(screen.getByTestId(hook), hook).toBeInTheDocument()
    }
  })

  it('opening the ladder disclosure puts the five rungs in reach again', async () => {
    await startedProblem({ ...problem, id: 'x1', title: 'A plain problem', track: 'interview' })
    const ladder = screen.getByTestId('ladder')
    const before = controlsInDo().length
    fireEvent.click(within(ladder).getByText(/Show the five rungs|rungs/i))
    expect(controlsInDo().length).toBe(before + 5)
  })

  it('Open links are plain buttons, carry the plan marker, and starting is only ever the Start button', async () => {
    const d = await openProblem()
    const link = await screen.findByRole('link', { name: /LeetCode/ })
    expect(link).not.toHaveClass('sr-btn-accent')
    fireEvent.click(link)
    expect(loadStudy()).toBeNull()
    expect((await d.tickets.get('p91'))!.status).toBe('todo')
  })

  it('says nothing about boards or sprints when there is no brief', async () => {
    await openProblem()
    const note = screen.getByTestId('no-brief')
    expect(note).toHaveTextContent('No brief for this ticket yet.')
    expect(note.textContent).not.toMatch(/Board|sprint/i)
  })

  it('keeps the redo banner on a redo', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put(problem)
    await d.redos.put({ id: 'r1', ticketId: 'p91', source: 'gave_up', createdAt: Date.now() - 3 * 86_400_000, stage: 0, due: Date.now() - 60_000, passed: [], helpCost: 5, refunded: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/p91', path: '/do/:ticketId' })
    expect(await screen.findByTestId('redo-banner')).toBeInTheDocument()
  })

  it('refuses to start in a read-only browser, leaves nothing written, and disables every control that would write (SHELL-23)', async () => {
    ro.on = true
    const d = await openProblem()
    expect(await screen.findByTestId('ticket-start')).toBeDisabled()
    for (const id of ['do-outcome-solved', 'do-outcome-help', 'do-outcome-giveup', 'do-attempt-log']) expect(screen.getByTestId(id), id).toBeDisabled()
    const rungs = [...document.querySelectorAll('[data-testid^="ladder-open-"]')]
    expect(rungs).toHaveLength(5)
    for (const r of rungs) expect(r).toBeDisabled()
    fireEvent.keyDown(document.body, { key: 'd' })
    fireEvent.keyDown(document.body, { key: ' ' })
    await new Promise(r => setTimeout(r, 30))
    expect(loadStudy()).toBeNull()
    expect((await d.tickets.get('p91'))!.status).toBe('todo')
    expect(await d.sessions.count()).toBe(0)
  })

  it('a finished problem with no redo due shows ticket-done-state, no Start, no accent and no live outcome (TICKET-05)', async () => {
    await openProblem({ ...problem, status: 'done', xp: 10 })
    expect(await screen.findByTestId('ticket-done-state')).toHaveTextContent('Done.')
    expect(screen.queryByTestId('ticket-start')).toBeNull()
    expect(accents()).toHaveLength(0)
    expect(document.querySelectorAll('.sr-btn-accent')).toHaveLength(0)
    expect(screen.queryByTestId('ticket-done')).toBeNull()
    for (const id of ['do-outcome-solved', 'do-outcome-help', 'do-outcome-giveup']) expect(screen.getByTestId(id), id).toBeDisabled()
  })

  it('Space on a finished problem with no redo due starts nothing and keeps the done state (TICKET-05)', async () => {
    const d = await openProblem({ ...problem, status: 'done', xp: 10 })
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: ' ' })
    await new Promise(r => setTimeout(r, 30))
    expect(loadStudy()).toBeNull()
    expect(screen.getByTestId('ticket-done-state')).toBeInTheDocument()
    expect(screen.queryByTestId('ticket-start')).toBeNull()
    expect(await d.sessions.count()).toBe(0)
    expect((await d.tickets.get('p91'))!.status).toBe('done')
  })

  it('Space on a finished problem with a redo due still starts it (REVIEW-14)', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put({ ...problem, status: 'done', xp: 10 })
    await d.redos.put({ id: 'r1', ticketId: 'p91', source: 'gave_up', createdAt: Date.now() - 3 * 86_400_000, stage: 0, due: Date.now() - 60_000, passed: [], helpCost: 5, refunded: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/p91', path: '/do/:ticketId' })
    expect(await screen.findByTestId('ticket-start')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(loadStudy()).not.toBeNull())
    expect(screen.queryByTestId('ticket-start')).toBeNull()
  })

  it('a finished problem with a redo due shows Start (the one accent) and no done state', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put({ ...problem, status: 'done', xp: 10 })
    await d.redos.put({ id: 'r1', ticketId: 'p91', source: 'gave_up', createdAt: Date.now() - 3 * 86_400_000, stage: 0, due: Date.now() - 60_000, passed: [], helpCost: 5, refunded: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/p91', path: '/do/:ticketId' })
    expect(await screen.findByTestId('ticket-start')).toHaveAttribute('data-accent', 'primary')
    expect(screen.queryByTestId('ticket-done-state')).toBeNull()
    expect(accents()).toHaveLength(1)
  })

  it('has no second completion control: the brief card on Do offers no Mark done, Edit brief or Approve', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put(problem)
    await seedBrief(d, 'p91')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    renderWithApp(<Do />, { db: d, ...plans, route: '/do/p91', path: '/do/:ticketId' })
    expect(await screen.findByTestId('card-brief')).toBeInTheDocument()
    for (const name of [/Mark done/i, /Edit brief/i, /^Approve$/i, /Check links/i]) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(accents()).toHaveLength(1)
  })

  it('marks the plan text in the header (title, rail title, statement, pattern and source chips) as plan content', async () => {
    await openProblem({ ...problem, pattern: 'Interview patterns', text: 'Count the ways to decode.' })
    await screen.findByTestId('do-title')
    expect(screen.getByTestId('do-title')).toHaveAttribute('data-content', 'plan')
    expect(document.querySelector('.do-rail-title')).toHaveAttribute('data-content', 'plan')
    expect(document.querySelector('.st-text')).toHaveAttribute('data-content', 'plan')
    expect(screen.getByText('Interview patterns')).toHaveAttribute('data-content', 'plan')
    for (const c of document.querySelectorAll('.chip-src')) expect(c).toHaveAttribute('data-content', 'plan')
    expect(document.querySelectorAll('.chip-src').length).toBeGreaterThan(0)
  })

  it('lists its own keys (F, D, Space) for the key legend, as the other kinds list F', async () => {
    const Legend = () => <span data-testid="legend-probe">{useLegendKeys().join(' | ')}</span>
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.put(problem)
    renderWithApp(<><Do /><Legend /></>, { db: d, ...plans, route: '/do/p91', path: '/do/:ticketId' })
    await screen.findByTestId('do-screen')
    await waitFor(() => expect(screen.getByTestId('legend-probe')).toHaveTextContent('F focus mode | D mark solved | Space start or pause'))
  })

  it('has no slide key and no sprint vocabulary', async () => {
    await openProblem()
    fireEvent.keyDown(document.body, { key: 's' })
    await new Promise(r => setTimeout(r, 30))
    expect(document.body.textContent).not.toMatch(/Slid|Sprint/)
  })

  it('ends on a plain screen for a missing or archived ticket, with the one action to Path', async () => {
    await open({ ...problem, id: 'p92', archived: true })
    expect(await screen.findByText('That ticket is not on your path.')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-missing-action')).toHaveAttribute('href', '/path')
    expect(screen.queryByTestId('ladder')).toBeNull()
  })
})


import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetLabInfoCache } from '../../src/data/labHooks'
import { clearStudy } from '../../src/lib/studyStore'
import { Do } from '../../src/screens/Do'
import { freshDb } from '../helpers/db'
import { INFO } from '../helpers/labServer'
import { mkLabRow, mkRun } from '../helpers/labRows'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const act = vi.hoisted(() => ({ fetchLabInfo: vi.fn(), setupLab: vi.fn(), runChecks: vi.fn(), getHint: vi.fn(), requestReview: vi.fn() }))
vi.mock('../../src/data/labActions', () => act)
const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

beforeEach(() => { resetLabInfoCache(); for (const f of Object.values(act)) f.mockReset(); act.fetchLabInfo.mockResolvedValue(INFO) })
afterEach(() => { cleanup(); clearStudy(); ro.on = false })

const plans = appPlans()
const T1 = 'tlab.build.1'
const mk = (id: string) => mkTicket({ id, kind: 'build', lane: 'path', title: `Lab step ${id}`, estMin: 45, lab: { id: 't-lab', gpu: 'none' }, text: 'Make the checks pass.' })
async function open(id = T1, seed?: (d: ReturnType<typeof freshDb>) => Promise<void>, over: Partial<ReturnType<typeof mk>> = {}) {
  clearStudy()
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  const t = { ...mk(id), ...over }
  await d.tickets.put(t)
  if (seed) await seed(d)
  renderWithApp(<Do />, { db: d, ...plans, route: `/do/${t.id}`, path: '/do/:ticketId' })
  return d
}
const setUp = async (d: ReturnType<typeof freshDb>) => { await d.labs.put(mkLabRow('t-lab')) }
const start = async () => { fireEvent.click(await screen.findByTestId('ticket-start')); await screen.findByTestId('ticket-done') }

describe('lab block: not set up', () => {
  it('offers Set up lab and nothing of the set-up block; the review is there but locked', async () => {
    await open()
    const block = await screen.findByTestId('ticket-lab-block')
    expect(block).toHaveAttribute('data-state', 'not-set-up')
    expect(block).toHaveAttribute('data-lab-id', 't-lab')
    expect(screen.getByTestId('ticket-lab-setup')).toHaveTextContent('Set up lab')
    expect(screen.getByTestId('ticket-lab-setup')).not.toHaveAttribute('data-accent')
    for (const gone of ['ticket-lab-run', 'ticket-check-results', 'ticket-hint-1', 'ticket-lab-path', 'ticket-selfmark', 'ticket-lab-steps']) expect(screen.queryByTestId(gone)).toBeNull()
    expect(within(block).getByTestId('ticket-reviewer')).toHaveAttribute('data-lab-id', 't-lab')
    expect(screen.getByTestId('ticket-review-request')).toBeDisabled()
    expect(screen.getByTestId('ticket-review-note')).toHaveTextContent('Available once every milestone is passed.')
    expect(screen.getByTestId('ticket-lab')).toHaveTextContent('No GPU')
  })
  it('Set up lab calls setupLab, then shows the absolute path with Copy and Run checks', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    act.setupLab.mockImplementation(async (d, labId) => { await d.labs.put(mkLabRow(labId, { root: '/Users/t/labs' })); return { ok: true } })
    await open()
    fireEvent.click(await screen.findByTestId('ticket-lab-setup'))
    expect(await screen.findByTestId('ticket-lab-path')).toHaveTextContent('/Users/t/labs/ai-platform-lab/labs/t-lab')
    expect(act.setupLab).toHaveBeenCalledWith(expect.anything(), 't-lab', expect.any(Number))
    expect(screen.getByTestId('ticket-lab-block')).toHaveAttribute('data-state', 'set-up')
    expect(screen.getByTestId('ticket-lab-run')).toHaveTextContent('Run checks')
    expect(screen.queryByTestId('ticket-lab-setup')).toBeNull()
    expect(screen.getAllByTestId(/^ticket-hint-[123]$/)).toHaveLength(3)
    fireEvent.click(screen.getByTestId('ticket-lab-path-copy'))
    expect(writeText).toHaveBeenCalledWith('/Users/t/labs/ai-platform-lab/labs/t-lab')
    expect(await screen.findByTestId('toast')).toHaveTextContent('Copied')
  })
  it('a bad labs folder is one plain line and the button comes back', async () => {
    act.setupLab.mockResolvedValue({ ok: false, code: 'bad_root', message: 'x' })
    await open()
    fireEvent.click(await screen.findByTestId('ticket-lab-setup'))
    expect(await screen.findByTestId('ticket-lab-error')).toHaveTextContent('The labs folder must be inside your home folder, and not the home folder itself.')
    expect(screen.getByTestId('ticket-lab-setup')).toBeEnabled()
  })
  it('is disabled in a read-only browser', async () => {
    ro.on = true
    await open()
    expect(await screen.findByTestId('ticket-lab-setup')).toBeDisabled()
  })
})

describe('lab block: a lab the server does not know', () => {
  it('shows the missing line and no controls; Done is not gated', async () => {
    act.fetchLabInfo.mockResolvedValue(null)
    await open()
    const block = await screen.findByTestId('ticket-lab-block')
    expect(block).toHaveAttribute('data-state', 'missing')
    expect(screen.getByTestId('ticket-lab-missing')).toHaveTextContent('This lab is not available in this copy of Dojo.')
    for (const gone of ['ticket-lab-setup', 'ticket-lab-run', 'ticket-hint-1', 'ticket-reviewer', 'ticket-lab-milestone']) expect(screen.queryByTestId(gone)).toBeNull()
    expect(screen.getByTestId('ticket-lab')).toBeInTheDocument()
    await start()
    expect(screen.getByTestId('ticket-done')).toBeEnabled()
  })
})

describe('lab block: run checks and results', () => {
  it('shows "No checks run yet." before the first run', async () => {
    await open(T1, setUp)
    expect(await screen.findByTestId('ticket-check-results')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-check-none')).toHaveTextContent('No checks run yet.')
  })
  it('Run checks is busy while it runs; own checks come first, the rest sit under Later milestones; statuses are words', async () => {
    let finish: () => void = () => {}
    act.runChecks.mockImplementation(async (d, labId) => {
      await new Promise<void>(r => { finish = r })
      await d.labRuns.put(mkRun(labId, 5, { c1: 'fail', c2: 'pass', c3: 'skip' }, { results: { checks: [
        { id: 'c1', name: 'Step one answer', status: 'fail', detail: 'check/c1.txt is missing' }, { id: 'c2', name: 'Step two answer', status: 'pass', detail: 'ok' },
        { id: 'c3', name: 'Step three answer', status: 'skip', detail: '' }], summary: { pass: 1, fail: 1, skip: 1 } } }))
      return { ok: true }
    })
    await open(T1, setUp)
    fireEvent.click(await screen.findByTestId('ticket-lab-run'))
    await waitFor(() => expect(screen.getByTestId('ticket-lab-block')).toHaveAttribute('data-running', 'true'))
    expect(screen.getByTestId('ticket-lab-run')).toBeDisabled()
    finish()
    expect(await screen.findByTestId('ticket-check-summary')).toHaveTextContent('1 passed, 1 failed, 1 skipped')
    expect(screen.getByTestId('ticket-lab-block')).not.toHaveAttribute('data-running')
    const c1 = screen.getByTestId('ticket-check-c1')
    expect(c1).toHaveAttribute('data-status', 'fail')
    expect(c1).toHaveTextContent('Fail')
    // LAB-10/11/20: the status word is a word of its own in the row's text ("Fail Step one answer"), not glued to the name
    expect(c1.textContent).toMatch(/\bFail\b/)
    expect(within(screen.getByTestId('ticket-check-later')).getByTestId('ticket-check-c2').textContent).toMatch(/\bPass\b/)
    expect(screen.getByTestId('ticket-check-name-c1')).toHaveTextContent('Step one answer')
    expect(screen.getByTestId('ticket-check-detail-c1')).toHaveTextContent('check/c1.txt is missing')
    const later = screen.getByTestId('ticket-check-later')
    expect(within(later).getByText('Later milestones')).toBeInTheDocument()
    expect(within(later).getByTestId('ticket-check-c2')).toHaveAttribute('data-status', 'pass')
    expect(within(later).getByTestId('ticket-check-c3')).toHaveTextContent('Skip')
    expect(within(later).queryByTestId('ticket-check-c1')).toBeNull()
    expect(screen.getByTestId('ticket-lab-run')).toBeEnabled()
  })
  it('a stopped run says so with the lab timeout and shows the output', async () => {
    await open(T1, async d => { await setUp(d); await d.labRuns.put(mkRun('t-lab', 5, {}, { timedOut: true, results: null, tail: 'last lines of output' })) })
    expect(await screen.findByTestId('ticket-lab-error')).toHaveTextContent('Checks took longer than 3 seconds and were stopped.')
    expect(screen.getByTestId('ticket-check-tail')).toHaveTextContent('last lines of output')
    expect(screen.queryByTestId('ticket-check-summary')).toBeNull()
  })
  it('no results and unreadable results each have their line and show the output', async () => {
    await open(T1, async d => { await setUp(d); await d.labRuns.put(mkRun('t-lab', 5, {}, { error: 'no_results', results: null, tail: 'crash requested' })) })
    expect(await screen.findByTestId('ticket-lab-error')).toHaveTextContent('The checks did not write a results file. Here is what they printed.')
    expect(screen.getByTestId('ticket-check-tail')).toHaveTextContent('crash requested')
    cleanup()
    await open(T1, async d => { await setUp(d); await d.labRuns.put(mkRun('t-lab', 5, {}, { error: 'bad_results', results: null, tail: 'oops' })) })
    expect(await screen.findByTestId('ticket-lab-error')).toHaveTextContent('The results file could not be read. Here is what the checks printed.')
  })
  it('shows the output of a normal run on request', async () => {
    await open(T1, async d => { await setUp(d); await d.labRuns.put(mkRun('t-lab', 5, { c1: 'pass' }, { tail: 'ok output END' })) })
    expect(await screen.findByTestId('ticket-check-summary')).toHaveTextContent('1 passed, 0 failed, 0 skipped')
    expect(screen.queryByTestId('ticket-check-tail')).toBeNull()
    fireEvent.click(screen.getByTestId('ticket-check-tail-toggle'))
    expect(screen.getByTestId('ticket-check-tail')).toHaveTextContent('ok output END')
    expect(screen.getByTestId('ticket-check-tail-toggle')).toHaveTextContent('Hide output')
  })
  it('make missing and busy are plain lines; a thrown action too', async () => {
    act.runChecks.mockResolvedValueOnce({ ok: false, code: 'make_missing', message: 'x' }).mockResolvedValueOnce({ ok: false, code: 'busy', message: 'x' }).mockRejectedValueOnce(new Error('boom'))
    await open(T1, setUp)
    fireEvent.click(await screen.findByTestId('ticket-lab-run'))
    expect(await screen.findByTestId('ticket-lab-error')).toHaveTextContent('make was not found. Install the Xcode command line tools with xcode-select --install, then try again.')
    expect(screen.getByTestId('ticket-lab-run')).toBeEnabled()
    fireEvent.click(screen.getByTestId('ticket-lab-run'))
    await waitFor(() => expect(screen.getByTestId('ticket-lab-error')).toHaveTextContent('The checks are already running. Wait for them to finish.'))
    fireEvent.click(screen.getByTestId('ticket-lab-run'))
    await waitFor(() => expect(screen.getByTestId('ticket-lab-error')).toHaveTextContent('That did not work. Try again.'))
  })
  it('a lab folder deleted outside Dojo shows the line and the block goes back to not-set-up; the labs row is kept', async () => {
    act.runChecks.mockResolvedValue({ ok: false, code: 'not_set_up', message: 'x' })
    const d = await open(T1, setUp)
    fireEvent.click(await screen.findByTestId('ticket-lab-run'))
    expect(await screen.findByTestId('ticket-lab-error')).toHaveTextContent('The lab folder was not found. Set up the lab again to create it.')
    expect(screen.getByTestId('ticket-lab-block')).toHaveAttribute('data-state', 'not-set-up')
    expect(screen.getByTestId('ticket-lab-setup')).toBeEnabled()
    expect(screen.queryByTestId('ticket-lab-run')).toBeNull()
    expect(await d.labs.count()).toBe(1)
  })
})

describe('milestone and the Done gate', () => {
  it('Done waits for the milestone; Mark done without checks sits before it; one accent', async () => {
    await open(T1, async d => { await setUp(d); await d.labRuns.put(mkRun('t-lab', 5, { c1: 'fail' })) })
    await start()
    expect(screen.getByTestId('ticket-lab-milestone')).toHaveTextContent('Milestone not passed yet')
    expect(screen.getByTestId('ticket-lab-milestone')).toHaveAttribute('data-passed', 'false')
    expect(screen.getByTestId('ticket-done')).toBeDisabled()
    expect(screen.getByTestId('ticket-done')).toHaveTextContent(/^DONE · BUILD$/i)
    const skip = screen.getByTestId('ticket-lab-skip-checks')
    expect(skip).toHaveTextContent('Mark done without checks')
    expect(skip).toBeEnabled()
    expect(skip).not.toHaveAttribute('data-accent')
    const buttons = [...screen.getByTestId('ticket-done').parentElement!.querySelectorAll('button')]
    expect(buttons.indexOf(skip as HTMLButtonElement)).toBeLessThan(buttons.indexOf(screen.getByTestId('ticket-done') as HTMLButtonElement))
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('a passed milestone enables Done, stays passed after a later failing run, and Done finishes the ticket', async () => {
    const d = await open(T1, async d2 => { await setUp(d2); await d2.labRuns.bulkPut([mkRun('t-lab', 5, { c1: 'pass' }), mkRun('t-lab', 9, { c1: 'fail' })]) })
    await start()
    await waitFor(() => expect(screen.getByTestId('ticket-done')).toBeEnabled())
    expect(screen.getByTestId('ticket-lab-milestone')).toHaveAttribute('data-passed', 'true')
    expect(screen.queryByTestId('ticket-lab-skip-checks')).toBeNull()
    fireEvent.click(screen.getByTestId('ticket-done'))
    await waitFor(async () => expect((await d.tickets.get(T1))!.status).toBe('done'))
    expect(await d.labRuns.count()).toBe(2)
  })
  it('each ticket has its own milestone', async () => {
    await open('tlab.build.2', async d => { await setUp(d); await d.labRuns.put(mkRun('t-lab', 5, { c1: 'pass', c2: 'fail' })) })
    await start()
    expect(screen.getByTestId('ticket-done')).toBeDisabled()
    expect(screen.getByTestId('ticket-lab-milestone')).toHaveAttribute('data-passed', 'false')
  })
  it('Mark done without checks finishes the ticket, stores no run and passes no milestone', async () => {
    const d = await open(T1, setUp)
    await start()
    fireEvent.click(screen.getByTestId('ticket-lab-skip-checks'))
    await waitFor(async () => expect((await d.tickets.get(T1))!.status).toBe('done'))
    expect(await d.labRuns.count()).toBe(0)
    expect(await screen.findByTestId('ticket-done-state')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-lab-milestone')).toHaveAttribute('data-passed', 'false')
  })
  it('the lab block, the review panel and a not-set-up lab work the same on a ticket that has no milestone of its own', async () => {
    await open('tlab.other', setUp)
    expect(await screen.findByTestId('ticket-reviewer')).toBeInTheDocument()
    expect(screen.queryByTestId('ticket-lab-milestone')).toBeNull()
    await start()
    expect(screen.getByTestId('ticket-done')).toBeEnabled()
  })
})

describe('read-only browser', () => {
  it('keeps the lab controls visible and disabled, from the stored row', async () => {
    ro.on = true
    act.fetchLabInfo.mockResolvedValue(null)
    await open(T1, setUp)
    expect(await screen.findByTestId('ticket-lab-run')).toBeDisabled()
    expect(screen.getByTestId('ticket-hint-1')).toBeDisabled()
    expect(screen.getByTestId('ticket-review-request')).toBeDisabled()
    expect(screen.getByTestId('ticket-lab-block')).toHaveAttribute('data-state', 'set-up')
  })
})

describe('build ticket without a lab', () => {
  it('keeps the self-mark and shows no lab block', async () => {
    await open('plain', undefined, { lab: undefined })
    expect(await screen.findByTestId('ticket-selfmark')).not.toBeChecked()
    for (const gone of ['ticket-lab-block', 'ticket-lab', 'ticket-hint-1', 'ticket-reviewer']) expect(screen.queryByTestId(gone)).toBeNull()
  })
})

describe('hint ladder', () => {
  const hintReply = (rung: number) => rung === 3
    ? { ok: true, text: 'HINT-T1-R3 loop to n minus one.', ref: { file: 'check/c1.txt', from: 1, to: 1, code: 'ok' } }
    : { ok: true, text: `HINT-T1-R${rung} text` }
  function wire() {
    act.getHint.mockImplementation(async (d, labId, ticketId, rung) => {
      const row = (await d.labs.get(labId))!
      if (!row.hints.some((h: { ticketId: string; rung: number }) => h.ticketId === ticketId && h.rung === rung)) await d.labs.put({ ...row, hints: [...row.hints, { ticketId, rung, at: 1 }] })
      return hintReply(rung)
    })
  }

  it('starts at rung 1; only the next rung is enabled; shown hints stay', async () => {
    wire()
    await open(T1, setUp)
    expect(await screen.findByTestId('ticket-hint-1')).toHaveTextContent('Hint 1 of 3')
    expect(screen.getByTestId('ticket-hint-1')).toBeEnabled()
    expect(screen.getByTestId('ticket-hint-2')).toBeDisabled()
    expect(screen.getByTestId('ticket-hint-3')).toBeDisabled()
    expect(screen.queryByTestId('ticket-lab-help')).toBeNull()
    fireEvent.click(screen.getByTestId('ticket-hint-1'))
    expect(await screen.findByTestId('ticket-hint-text-1')).toHaveTextContent('HINT-T1-R1')
    expect(act.getHint).toHaveBeenCalledWith(expect.anything(), 't-lab', T1, 1, expect.any(Number))
    await waitFor(() => expect(screen.getByTestId('ticket-hint-2')).toBeEnabled())
    fireEvent.click(screen.getByTestId('ticket-hint-2'))
    expect(await screen.findByTestId('ticket-hint-text-2')).toHaveTextContent('HINT-T1-R2')
    expect(screen.getByTestId('ticket-hint-text-1')).toBeInTheDocument()
    expect(screen.queryByTestId('ticket-lab-help')).toBeNull()
  })
  it('rung 3 asks first; Not now changes nothing; Show hint shows the excerpt and marks the lab "With help"', async () => {
    wire()
    await open(T1, async d => { await d.labs.put(mkLabRow('t-lab', { hints: [{ ticketId: T1, rung: 1, at: 1 }, { ticketId: T1, rung: 2, at: 2 }] })) })
    await screen.findByTestId('ticket-hint-text-2') // the stored rungs show again on mount
    act.getHint.mockClear()
    fireEvent.click(screen.getByTestId('ticket-hint-3'))
    expect(await screen.findByTestId('ticket-hint-confirm')).toHaveTextContent('Hint 3 shows part of the reference solution. Show it?')
    expect(act.getHint).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('ticket-hint-confirm-no'))
    expect(screen.queryByTestId('ticket-hint-confirm')).toBeNull()
    expect(screen.queryByTestId('ticket-hint-text-3')).toBeNull()
    fireEvent.click(screen.getByTestId('ticket-hint-3'))
    fireEvent.click(await screen.findByTestId('ticket-hint-confirm-yes'))
    expect(await screen.findByTestId('ticket-hint-text-3')).toHaveTextContent('HINT-T1-R3')
    const ref = screen.getByTestId('ticket-hint-ref')
    expect(ref).toHaveAttribute('data-file', 'check/c1.txt')
    expect(screen.getByTestId('ticket-hint-ref-file')).toHaveTextContent('check/c1.txt lines 1 to 1')
    expect(screen.getByTestId('ticket-hint-ref-code')).toHaveTextContent('ok')
    expect(await screen.findByTestId('ticket-lab-help')).toHaveTextContent('With help')
  })
  it('stored rungs are shown again on mount, with no confirm, and nothing new is stored', async () => {
    wire()
    const d = await open(T1, async d2 => { await d2.labs.put(mkLabRow('t-lab', { hints: [1, 2, 3].map(r => ({ ticketId: T1, rung: r as 1 | 2 | 3, at: r })) })) })
    for (const n of [1, 2, 3]) expect(await screen.findByTestId(`ticket-hint-text-${n}`)).toBeInTheDocument()
    expect(screen.getByTestId('ticket-hint-ref-code')).toHaveTextContent('ok')
    expect(screen.queryByTestId('ticket-hint-confirm')).toBeNull()
    expect(screen.getByTestId('ticket-lab-help')).toBeInTheDocument()
    expect((await d.labs.get('t-lab'))!.hints).toHaveLength(3)
  })
  it('rung 3 used on another ticket marks the lab with help but unlocks nothing here', async () => {
    await open(T1, async d => { await d.labs.put(mkLabRow('t-lab', { hints: [{ ticketId: 'tlab.build.2', rung: 3, at: 1 }] })) })
    expect(await screen.findByTestId('ticket-lab-help')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-hint-1')).toBeEnabled()
    expect(screen.getByTestId('ticket-hint-2')).toBeDisabled()
  })
  it('a failed hint is one plain line; hint text is plan content', async () => {
    act.getHint.mockResolvedValueOnce({ ok: false, code: 'unknown_lab', message: 'x' })
    await open(T1, setUp)
    fireEvent.click(await screen.findByTestId('ticket-hint-1'))
    expect(await screen.findByTestId('ticket-hint-error')).toHaveTextContent('This lab is not available in this copy of Dojo.')
    wire()
    fireEvent.click(screen.getByTestId('ticket-hint-1'))
    expect((await screen.findByTestId('ticket-hint-text-1')).getAttribute('data-content')).toBe('plan')
  })
})

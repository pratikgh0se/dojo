import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { Middleware } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import legacy from '../fixtures/design-session.legacy-interviewer.json'
import { createDb, syncGate, type DojoDB } from '../../src/data/db'
import type { DesignSession } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { EMPTY_CLOSE } from '../../src/rules/designSession'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { patchSettings } from '../../src/data/db'
import { runReconcile } from '../../src/data/seed'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// Review Focus 1: an old interviewer session opens, loads as ai-partner, can be finished and graded, and opening it changes nothing.
const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const clone = <V,>(v: V): V => JSON.parse(JSON.stringify(v))
const tid = (id: string) => screen.getByTestId(id)
const DONE: DesignSession = { ...clone(legacy as unknown as DesignSession), designId: 'd-method' }
/** S_OLD_LIVE: the fixture's canvas without `zones`/`flows`/`notes` keys (FX-LEGACY), blank close, nothing scored, the earlier chat kept. */
const LIVE: DesignSession = (() => {
  const canvas = clone(DONE.canvas) as unknown as Record<string, unknown>
  delete canvas.zones
  delete canvas.flows
  return {
    ...clone(DONE), id: 'ds-legacy-live', phase: 'drawing', at: T - 5 * MIN, endedAt: undefined, lockedAt: undefined, minutes: 0,
    rubric: null, rubricBy: undefined, tradeoffs: [], lenses: {}, canvas,
    close: clone(EMPTY_CLOSE), deepDives: DONE.deepDives.map(d => ({ q: d.q, answered: null })),
    interview: { messages: clone(DONE.interview!.messages) },
  } as unknown as DesignSession
})()

const path = '/designs/session/:designId'
/** Every write path of every table (put, add, update, bulk*, delete, modify, clear...) goes through the DBCore mutate.
 * Dexie only applies a middleware added before the database opens, so this builds the db (as seededDb does) with the spy first. */
type Seen = { type: string; table: string }[]
async function seededWatched(): Promise<{ d: DojoDB; writes: Seen }> {
  const d = freshDb()
  const writes = watchWrites(d)
  await runReconcile(d, flatPlanV2)
  await patchSettings(d, { startDate: '2026-09-07' })
  return { d, writes }
}
function watchWrites(d: DojoDB): Seen {
  const seen: Seen = []
  const mw: Middleware<import('dexie').DBCore> = {
    stack: 'dbcore', name: 'legacy-write-spy',
    create: down => ({
      ...down,
      table(name: string) {
        const t = down.table(name)
        return { ...t, mutate: req => { seen.push({ type: req.type, table: name }); return t.mutate(req) } }
      },
    }),
  }
  d.use(mw)
  return seen
}
async function snapshot(d: DojoDB) {
  const out: Record<string, unknown[]> = {}
  for (const t of d.tables) out[t.name] = await t.toArray()
  return out
}
async function seededWith(row: DesignSession) {
  setNow(() => T)
  const { d, writes } = await seededWatched()
  await d.designSessions.put(clone(row))
  writes.length = 0 // the fixture's own put is not under test
  return { d, writes }
}
const open = (d: DojoDB, route = '/designs/session/d-method') =>
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route, path })

afterEach(() => { cleanup(); localStorage.clear(); syncGate.readOnly = false })

describe('an old finished session (DESIGN-75)', () => {
  it('reads as Solo · AI partner, shows the stored conversation, and its stored canvas is untouched', async () => {
    const { d } = await seededWith(DONE)
    open(d, `/designs/session/d-method?session=${DONE.id}`)
    expect(await screen.findByTestId('session-summary')).toHaveTextContent('Solo · AI partner')
    expect(screen.getAllByTestId('session-msg')).toHaveLength(DONE.interview!.messages.length)
    expect(screen.getAllByTestId('session-msg').map(m => m.dataset.from)).toEqual(['ai', 'you', 'ai', 'you'])
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('12 of 20')
    const row = (await d.designSessions.get(DONE.id))!
    expect(row.mode).toBe('interviewer')
    expect(row.canvas).toEqual(DONE.canvas)
  })

  it('opening it never rewrites the mode, canvas, transcript or score; the only write is the reference it did not have (aiLog + reference)', async () => {
    const { d, writes } = await seededWith(DONE)
    open(d, `/designs/session/d-method?session=${DONE.id}`)
    await screen.findByTestId('session-summary')
    // a legacy finished row stores no reference, so the done view draws one once (as it does for any finished AI-partner session)
    await waitFor(async () => expect((await d.designSessions.get(DONE.id))?.reference).toBeTruthy())
    const row = (await d.designSessions.get(DONE.id))!
    const { reference, ...rest } = row
    expect(reference).toBeTruthy()
    expect(rest).toEqual(DONE) // every stored field of the finished row, 'interviewer' mode included, is as it was
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['diagram'])
    // exactly those two writes, nothing else, in no other table
    expect(writes.map(w => `${w.table}:${w.type}`).sort()).toEqual(['aiLog:add', 'designSessions:put'].sort())
    expect(await d.designSessions.count()).toBe(1)
  })

  it('a second open draws no second reference and writes nothing', async () => {
    const { d, writes } = await seededWith({ ...DONE, reference: { nodes: [], links: [] } as never })
    const before = await snapshot(d)
    open(d, `/designs/session/d-method?session=${DONE.id}`)
    await screen.findByTestId('session-summary')
    await new Promise(r => setTimeout(r, 300))
    expect(writes).toEqual([])
    expect(await snapshot(d)).toEqual(before)
  })
})

describe('an old finished session in a read-only browser (DESIGN-79)', () => {
  it('shows Solo · AI partner while the stored mode stays interviewer, and tries to write nothing', async () => {
    const gate = { bypass: true, readOnly: true }
    const d = createDb(`ro-legacy-${Math.random().toString(36).slice(2)}`, gate)
    const writes = watchWrites(d)
    setNow(() => T)
    await d.designSessions.put(clone(DONE))
    writes.length = 0
    gate.bypass = false
    syncGate.readOnly = true
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      open(d, `/designs/session/d-method?session=${DONE.id}`)
      expect(await screen.findByTestId('session-summary')).toHaveTextContent('Solo · AI partner')
      expect(screen.getAllByTestId('session-msg')).toHaveLength(4)
      await new Promise(r => setTimeout(r, 300))
      expect(screen.queryByTestId('session-reference-loading')).toBeNull() // no spinner that never ends
      expect(screen.queryByTestId('session-ai-error')).toBeNull()
      expect(tid('session-reference-readonly')).toHaveTextContent('Open Dojo from the Dojo app to draw the reference')
      expect(unhandled).toEqual([])
      expect(writes).toEqual([])
      expect((await d.designSessions.get(DONE.id))!.mode).toBe('interviewer')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('an old session in progress (DESIGN-76, 78)', () => {
  it('loads as ai-partner with the earlier chat, the same node count, six empty sections', async () => {
    const { d } = await seededWith(LIVE)
    open(d)
    await screen.findByTestId('session-tabs')
    expect(tid('kit-count')).toHaveTextContent('3 nodes · 2 links')
    expect(document.querySelectorAll('[data-testid^="notes-section-"]:not([data-testid$="-title"]):not([data-testid$="-toggle"]):not([data-testid$="-count"])')).toHaveLength(6)
    for (const f of ['req-fn', 'req-nfr', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']) expect(tid(`notes-field-${f}`)).toHaveValue('')
    fireEvent.click(tid('session-tab-partner'))
    // hidden panels count: the stored transcript is as long as the rendered log
    expect(screen.getAllByTestId('session-msg')).toHaveLength(LIVE.interview!.messages.length)
    expect(await screen.findByTestId('session-interviewer')).toBeInTheDocument()
  })

  it('opening it and leaving it for 5 seconds writes nothing: no write on any path, stored row and canvas keys unchanged', async () => {
    const { d, writes } = await seededWith(LIVE)
    const before = await snapshot(d)
    open(d)
    await screen.findByTestId('session-tabs')
    fireEvent.click(tid('session-tab-partner'))
    await new Promise(r => setTimeout(r, 5000))
    expect(writes).toEqual([])
    expect(await snapshot(d)).toEqual(before)
    const row = (await d.designSessions.get(LIVE.id))!
    expect(Object.keys(row.canvas).sort()).toEqual(Object.keys(LIVE.canvas).sort())
    expect(row.canvas).not.toHaveProperty('notes')
    expect(row.canvas).not.toHaveProperty('zones')
    expect(row).not.toHaveProperty('notes')
    expect(row.mode).toBe('interviewer')
    expect(await d.aiLog.count()).toBe(0)
  }, 15_000)

  it('a sticky, a frame and a schema table can be added to it', async () => {
    const { d } = await seededWith(LIVE)
    open(d)
    await screen.findByTestId('session-tabs')
    fireEvent.click(tid('kit-add-note'))
    fireEvent.click(tid('kit-add-frame'))
    fireEvent.click(tid('kit-add-table'))
    await waitFor(async () => {
      const row = (await d.designSessions.get(LIVE.id))!
      const canvas = row.canvas as unknown as { notes?: unknown[]; zones?: unknown[] }
      expect(canvas.notes).toHaveLength(1)
      expect(canvas.zones).toHaveLength(1)
      expect(row.notes!.schema).toHaveLength(1)
    })
    expect((await d.designSessions.get(LIVE.id))!.mode).toBe('interviewer')
  })
})

describe('an old session can finish and be graded (DESIGN-77)', () => {
  it('end drawing, answer the close, grade with the fake, complete: phase done, rubric 0..20, rubricBy model, no error', async () => {
    const { d } = await seededWith(LIVE)
    open(d)
    fireEvent.click(await screen.findByTestId('session-close-design'))
    const close = await screen.findByTestId('session-close')
    expect((await d.designSessions.get(LIVE.id))!.phase).toBe('close')
    fireEvent.change(within(close).getByRole('textbox', { name: 'Chose' }), { target: { value: 'a' } })
    fireEvent.change(within(close).getByRole('textbox', { name: 'Over' }), { target: { value: 'b' } })
    fireEvent.change(within(close).getByRole('textbox', { name: 'Because' }), { target: { value: 'c' } })
    fireEvent.change(tid('session-close-answer-2'), { target: { value: 'x' } })
    fireEvent.change(tid('session-close-answer-3'), { target: { value: 'y' } })
    fireEvent.change(tid('session-close-answer-5'), { target: { value: 'DDIA' } })
    fireEvent.click(tid('session-close-q4-none'))
    fireEvent.click(tid('session-close-next'))
    await screen.findByTestId('session-score')
    // the fake grade arrives and prefills dives, lenses and the rubric
    await waitFor(() => expect(screen.getByTestId('session-grade')).toBeInTheDocument(), { timeout: 4000 })
    await waitFor(async () => expect((await d.designSessions.get(LIVE.id))!.rubricBy).toBe('model'))
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
    const row2 = tid('session-tradeoff-row-2')
    fireEvent.change(within(row2).getByRole('textbox', { name: 'Chose' }), { target: { value: 'fail open' } })
    fireEvent.change(within(row2).getByRole('textbox', { name: 'Over' }), { target: { value: 'fail closed' } })
    fireEvent.change(within(row2).getByRole('textbox', { name: 'Because' }), { target: { value: 'uptime' } })
    await waitFor(() => expect(tid('session-complete')).toBeEnabled())
    fireEvent.click(tid('session-complete'))
    await waitFor(() => expect(tid('session-phase')).toHaveTextContent('Done'), { timeout: 4000 })
    const row = (await d.designSessions.get(LIVE.id))!
    expect(row.phase).toBe('done')
    expect(typeof row.rubric).toBe('number')
    expect(row.rubric).toBeGreaterThanOrEqual(0)
    expect(row.rubric).toBeLessThanOrEqual(20)
    expect(['model', 'self']).toContain(row.rubricBy)
    expect(row.mode).toBe('interviewer')
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
    expect(await d.aiLog.where('job').equals('grade').count()).toBe(1)
  }, 20_000)
})

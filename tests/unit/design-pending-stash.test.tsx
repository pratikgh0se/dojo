import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { DBCore, Middleware } from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncGate, patchSettings, type DojoDB } from '../../src/data/db'
import {
  applyPending, blockPending, partHash, readPending, stashPending, sweepPending,
} from '../../src/data/designPending'
import { lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { runReconcile } from '../../src/data/seed'
import { QUOTA_MESSAGE } from '../../src/data/safeWrite'
import type { DesignSession } from '../../src/data/types'
import { READ_ONLY_MESSAGE } from '../../src/data/writer'
import { setNow } from '../../src/lib/clock'
import { emptyCanvas } from '../../src/rules/designCanvas'
import { emptyNotes } from '../../src/rules/designNotes'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// The pagehide stash (DESIGN-16) must stay out of the way of an untouched session (DESIGN-78), of a newer row written by another
// window, of a read-only browser, and of sessions that are over.
const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const KEY = (id: string) => `dojo-design-pending:${id}`

type Gate = { writes: string[]; fail: Error | null; hold: Promise<void> | null }
function watch(d: DojoDB): Gate {
  const g: Gate = { writes: [], fail: null, hold: null }
  const mw: Middleware<DBCore> = {
    stack: 'dbcore', name: 'pending-stash-spy',
    create: down => ({
      ...down,
      table(name: string) {
        const t = down.table(name)
        if (name !== 'designSessions') return t
        return {
          ...t,
          mutate: async req => {
            g.writes.push(req.type)
            if (g.hold) await g.hold
            if (g.fail) throw g.fail
            return t.mutate(req)
          },
        }
      },
    }),
  }
  d.use(mw)
  return g
}

async function setup(patch?: (s: DesignSession) => DesignSession) {
  setNow(() => T)
  const d = freshDb()
  const g = watch(d)
  await runReconcile(d, flatPlanV2)
  await patchSettings(d, { startDate: '2026-09-07' })
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 10 * MIN })
  const row = patch ? patch(s) : s
  if (row !== s) await d.designSessions.put(row)
  g.writes.length = 0
  return { d, g, id: s.id, row }
}
const mount = (d: DojoDB) =>
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method', path: '/designs/session/:designId' })
const hide = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
}
const pagehide = () => fireEvent(window, new Event('pagehide'))
const stashKeys = () => Object.keys(localStorage).filter(k => k.startsWith('dojo-design-pending:'))
const type = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } })
const stored = async (d: DojoDB, id: string) => (await d.designSessions.get(id))!
const dlg = () => screen.getByRole('dialog', { name: 'Discard this session?' })

/** A legacy-looking drawing: no notes at all, a frame that lists a node which is not there. */
const legacyRow = (s: DesignSession): DesignSession => ({
  ...s, notes: undefined,
  canvas: { layout: 'manual', nodes: [{ id: 'n1', kind: 'service', label: 'api', x: 2, y: 2 }], links: [], zones: [{ id: 'frame-1', label: 'edge', kind: 'edge', nodes: ['n1', 'ghost'] }], notes: [], flows: [] },
} as unknown as DesignSession)

afterEach(() => {
  cleanup(); localStorage.clear(); syncGate.readOnly = false; vi.restoreAllMocks()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

describe('an untouched session leaves no stash and a reload writes nothing (DESIGN-78)', () => {
  it('pagehide / hidden on a legacy drawing opened and left alone: no stash, no write, also after remounting twice', async () => {
    const { d, g, id, row } = await setup(legacyRow)
    for (let i = 0; i < 2; i++) {
      const view = mount(d)
      await screen.findByTestId('notes-field-open')
      pagehide(); hide()
      expect(stashKeys()).toEqual([])
      view.unmount()
    }
    expect(g.writes).toEqual([])
    expect(await stored(d, id)).toEqual(row)
  })

  it('only the parts that were edited are stashed, with the stored values they started from; a landed write needs no stash', async () => {
    const { d, g, id } = await setup()
    let release!: () => void
    g.hold = new Promise<void>(r => { release = r })
    mount(d)
    await screen.findByTestId('notes-field-open')
    const startNotes = (await stored(d, id)).notes
    type('notes-field-open', 'unsaved words')
    pagehide()
    const p = readPending(id)!
    expect(p.notes?.open).toBe('unsaved words')
    expect(p.canvas).toBeUndefined()
    expect(p.view).toBeUndefined()
    expect(p.known.notes).toContain(partHash(startNotes))
    release(); g.hold = null
    // the queue drains: the stash goes, and with nothing unsaved a later hide stashes nothing
    await waitFor(() => expect(stashKeys()).toEqual([]))
    await waitFor(async () => expect((await stored(d, id)).notes?.open).toBe('unsaved words'))
    pagehide(); hide()
    expect(stashKeys()).toEqual([])
  })
})

describe('a stash does not outlive the writes that made it unnecessary (ABA)', () => {
  it('edited again after the stash, once everything has landed the stash is gone, so a part typed back to its mount value is not overwritten by it', async () => {
    const { d, g, id } = await setup()
    mount(d)
    await screen.findByTestId('notes-field-open')
    let release!: () => void
    g.hold = new Promise<void>(r => { release = r })
    type('notes-field-open', 'A')
    pagehide() // stashes 'A'; the page survives, the queue is still held
    expect(readPending(id)?.notes?.open).toBe('A')
    type('notes-field-open', 'AB') // a newer edit lands after the stash's own flush bookkeeping started
    release(); g.hold = null
    await waitFor(async () => expect((await stored(d, id)).notes?.open).toBe('AB'))
    await waitFor(() => expect(stashKeys()).toEqual([]))
    // back to the mount value: that write also lands, and a reload finds nothing to re-apply
    type('notes-field-open', '')
    await waitFor(async () => expect((await stored(d, id)).notes?.open ?? '').toBe(''))
    expect(readPending(id)).toBeNull()
  })

  it('a stash made by the very last pagehide stays while an edit is unsaved and goes once it lands', async () => {
    const { d, g, id } = await setup()
    mount(d)
    await screen.findByTestId('notes-field-open')
    let release!: () => void
    g.hold = new Promise<void>(r => { release = r })
    type('notes-field-open', 'late words')
    pagehide()
    expect(readPending(id)?.notes?.open).toBe('late words')
    release(); g.hold = null
    await waitFor(() => expect(stashKeys()).toEqual([]))
    await waitFor(async () => expect((await stored(d, id)).notes?.open).toBe('late words'))
  })
})

describe('a stash is applied only when the stored row is still what it was made from', () => {
  it('a row changed by another window since the base: the stash is dropped, the row and the boxes keep the newer data', async () => {
    const { d, g, id } = await setup()
    const base = (await stored(d, id)).notes
    const newer = { ...emptyNotes(), open: 'written by the other window' }
    await d.designSessions.update(id, { notes: newer })
    stashPending(id, { notes: { ...emptyNotes(), open: 'stale idle text' }, known: { notes: [partHash(base)] } })
    g.writes.length = 0
    mount(d)
    expect(await screen.findByTestId('notes-field-open')).toHaveValue('written by the other window')
    await waitFor(() => expect(stashKeys()).toEqual([]))
    expect(g.writes).toEqual([])
    expect((await stored(d, id)).notes).toEqual(newer)
  })

  it('a row that is still the base, or one of the snapshots the window itself wrote, takes the stash', async () => {
    const { d, id } = await setup()
    const base = (await stored(d, id)).notes
    const mid = { ...emptyNotes(), open: 'half a sent' }
    await d.designSessions.update(id, { notes: mid }) // the in-flight write that did land before the reload
    stashPending(id, { notes: { ...emptyNotes(), open: 'half a sentence, finished' }, known: { notes: [partHash(base), partHash(mid)] } })
    mount(d)
    expect(await screen.findByTestId('notes-field-open')).toHaveValue('half a sentence, finished')
    await waitFor(async () => expect((await stored(d, id)).notes?.open).toBe('half a sentence, finished'))
    expect(stashKeys()).toEqual([])
  })

  it('a stash that equals the stored row writes nothing', async () => {
    const { d, g, id } = await setup()
    const notes = (await stored(d, id)).notes
    stashPending(id, { notes, known: { notes: [] } })
    mount(d)
    await screen.findByTestId('notes-field-open')
    await waitFor(() => expect(stashKeys()).toEqual([]))
    expect(g.writes).toEqual([])
  })
})

describe('a read-only browser neither stashes nor applies', () => {
  it('no stash on pagehide; an old stash is left alone, nothing is written and no read-only toast appears', async () => {
    syncGate.readOnly = true
    const { d, g, id } = await setup()
    stashPending(id, { notes: { ...emptyNotes(), open: 'from before' }, known: { notes: [partHash((await stored(d, id)).notes)] } })
    const before = readPending(id)
    mount(d)
    const box = await screen.findByTestId('notes-field-open')
    expect(box).toHaveValue('')
    await new Promise(r => setTimeout(r, 50))
    expect(g.writes).toEqual([])
    expect(screen.queryByText(READ_ONLY_MESSAGE)).toBeNull()
    expect(readPending(id)).toEqual(before)
    localStorage.clear()
    type('notes-field-open', 'tried to type')
    pagehide(); hide()
    expect(stashKeys()).toEqual([])
    expect(screen.queryByText(READ_ONLY_MESSAGE)).toBeNull()
  })
})

describe('a stash that cannot be applied stays', () => {
  const stashFor = async (d: DojoDB, id: string) =>
    stashPending(id, { notes: { ...emptyNotes(), open: 'keep me' }, known: { notes: [partHash((await stored(d, id)).notes)] } })

  it('a failed write keeps it for the next load, without an unhandled rejection', async () => {
    const { d, g, id } = await setup()
    await stashFor(d, id)
    g.fail = new Error('boom')
    mount(d)
    await screen.findByTestId('notes-field-open')
    await waitFor(() => expect(g.writes.length).toBeGreaterThan(0))
    expect(readPending(id)?.notes?.open).toBe('keep me')
    // the next load, with the database working, applies it
    cleanup(); g.fail = null
    mount(d)
    await waitFor(async () => expect((await stored(d, id)).notes?.open).toBe('keep me'))
    expect(stashKeys()).toEqual([])
  })

  it('a full disk (quota) keeps it and says so', async () => {
    const { d, g, id } = await setup()
    await stashFor(d, id)
    g.fail = Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    mount(d)
    expect(await screen.findByText(QUOTA_MESSAGE)).toBeTruthy()
    expect(readPending(id)?.notes?.open).toBe('keep me')
  })

  it('applyPending rejects on failure and leaves the stash; it resolves (and clears) when the phase has moved on', async () => {
    const { d, g, id } = await setup()
    await stashFor(d, id)
    g.fail = new Error('boom')
    await expect(applyPending(d, id, readPending(id)!)).rejects.toThrow('boom')
    expect(readPending(id)).not.toBeNull()
    g.fail = null
    await lockDesignSession(d, id, T)
    expect(await applyPending(d, id, readPending(id)!)).toEqual({})
    expect(readPending(id)).toBeNull()
  })
})

describe('a corrupt or oversized stash is ignored or cut down', () => {
  it('corrupt JSON, wrong shapes and a stash with no part are ignored and removed; the session opens normally', async () => {
    const { d, g, id } = await setup()
    for (const raw of ['{not json', JSON.stringify({ nonce: 'n', notes: 'text', known: {} }), JSON.stringify({ nonce: 'n', known: {} }),
      JSON.stringify({ nonce: 'n', view: 'sideways', known: {} }), JSON.stringify({ notes: emptyNotes(), known: {} }), JSON.stringify(['x'])]) {
      localStorage.setItem(KEY(id), raw)
      expect(readPending(id)).toBeNull()
      expect(localStorage.getItem(KEY(id))).toBeNull()
    }
    localStorage.setItem(KEY(id), '{not json')
    mount(d)
    expect(await screen.findByTestId('notes-field-open')).toHaveValue('')
    expect(g.writes).toEqual([])
    expect(stashKeys()).toEqual([])
  })

  it('a stash far over the size cap is ignored', async () => {
    const { d, g, id } = await setup()
    localStorage.setItem(KEY(id), JSON.stringify({ nonce: 'n', notes: { ...emptyNotes(), open: 'x'.repeat(900_000) }, known: {} }))
    expect(readPending(id)).toBeNull()
    mount(d)
    await screen.findByTestId('notes-field-open')
    expect(g.writes).toEqual([])
  })

  it('text and schema over the caps are cut to the caps before they are written', async () => {
    const { d, id } = await setup()
    const base = (await stored(d, id)).notes
    const cols = Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, type: 't'.repeat(100) }))
    const big = {
      ...emptyNotes(), open: 'y'.repeat(10_000),
      schema: Array.from({ length: 30 }, (_, i) => ({ id: `s${i + 1}`, name: `t${i}`, cols })),
    }
    stashPending(id, { notes: big, canvas: { ...emptyCanvas(), nodes: 'nope' } as never, known: { notes: [partHash(base)], canvas: [partHash((await stored(d, id)).canvas)] } })
    mount(d)
    await waitFor(async () => expect((await stored(d, id)).notes?.open?.length).toBe(2000))
    const row = await stored(d, id)
    expect(row.notes!.schema).toHaveLength(12)
    expect(row.notes!.schema.every(t => t.cols.length === 16 && t.cols.every(c => c.type.length === 30))).toBe(true)
    expect(row.canvas.nodes).toEqual([])
  })
})

describe('stashes of sessions that are over are swept', () => {
  it('a stash for a done, locked, discarded or missing session is removed on opening the screen and never changes the row', async () => {
    const { d, g, id, row } = await setup()
    const mk = (sid: string, phase: DesignSession['phase']) => ({ ...row, id: sid, phase, at: T - 60 * MIN }) as DesignSession
    await d.designSessions.bulkPut([mk('ds-done', 'done'), mk('ds-close', 'close'), mk('ds-score', 'score')])
    const slot = { notes: { ...emptyNotes(), open: 'must not come back' }, known: { notes: [partHash(row.notes)] } }
    for (const sid of ['ds-done', 'ds-close', 'ds-score', 'ds-gone']) stashPending(sid, slot)
    stashPending('ds-gone-too', slot)
    g.writes.length = 0
    mount(d)
    await screen.findByTestId('notes-field-open')
    await waitFor(() => expect(stashKeys()).toEqual([]))
    expect(g.writes).toEqual([])
    for (const sid of ['ds-done', 'ds-close', 'ds-score']) expect((await stored(d, sid)).notes).toEqual(row.notes)
    expect((await stored(d, id)).notes).toEqual(row.notes)
  })

  it('a stash of the session being drawn is not swept', async () => {
    const { d, id } = await setup()
    await sweepPending(d)
    stashPending(id, { notes: { ...emptyNotes(), open: 'mine' }, known: { notes: [] } })
    await sweepPending(d)
    expect(readPending(id)?.notes?.open).toBe('mine')
  })
})

describe('storage that cannot be written is harmless', () => {
  it('setItem throwing on pagehide does not break the page, and the write still lands through the queue', async () => {
    const { d, id } = await setup()
    mount(d)
    await screen.findByTestId('notes-field-open')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    type('notes-field-open', 'typed anyway')
    expect(() => { pagehide(); hide() }).not.toThrow()
    await waitFor(async () => expect((await stored(d, id)).notes?.open).toBe('typed anyway'))
    expect(screen.getByTestId('notes-field-open')).toHaveValue('typed anyway')
  })
})

describe('discarding a session ends its stash for good', () => {
  it('a hidden event after the Discard click does not stash again', async () => {
    const { d, g, id } = await setup()
    mount(d)
    await screen.findByTestId('notes-field-open')
    let release!: () => void
    g.hold = new Promise<void>(r => { release = r })
    type('notes-field-open', 'about to be thrown away')
    fireEvent.click(screen.getByTestId('session-discard'))
    fireEvent.click(within(dlg()).getByTestId('session-discard-confirm'))
    hide(); pagehide()
    expect(stashKeys()).toEqual([])
    release(); g.hold = null
    await waitFor(async () => expect(await d.designSessions.get(id)).toBeUndefined())
    expect(stashKeys()).toEqual([])
  })

  it('blockPending clears the slot and refuses later stashes of that id only', () => {
    expect(stashPending('ds-a', { notes: emptyNotes(), known: {} })).toBeTruthy()
    blockPending('ds-a')
    expect(readPending('ds-a')).toBeNull()
    expect(stashPending('ds-a', { notes: emptyNotes(), known: {} })).toBeNull()
    expect(readPending('ds-a')).toBeNull()
    expect(stashPending('ds-b', { notes: emptyNotes(), known: {} })).toBeTruthy()
  })
})

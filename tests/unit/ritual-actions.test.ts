// F1: the writes. A pulse is one row per local day; the week's ticket is created only when asked for.
import { describe, expect, it } from 'vitest'
import { logPulse, openWeekTicket } from '../../src/data/ritualActions'
import { weekTicketId } from '../../src/rules/ritual'
import { freshDb } from '../helpers/db'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const OPTS = { minutes: 30, dueWeekday: 6 }

describe('logPulse', () => {
  it('writes pulse-<local day> with the trimmed text and the time', async () => {
    const d = freshDb()
    const r = await logPulse(d, '  Asked Claude to explain attention without maths ', at(2026, 10, 12, 9, 10))
    expect(r).toEqual({ ok: true })
    expect(await d.pulses.toArray()).toEqual([
      { id: 'pulse-2026-10-12', day: '2026-10-12', at: at(2026, 10, 12, 9, 10), text: 'Asked Claude to explain attention without maths' },
    ])
  })
  it('a second log on the same day overwrites the same row with the new text and the time of this save', async () => {
    const d = freshDb()
    await logPulse(d, 'first', at(2026, 10, 12, 9, 10))
    await logPulse(d, 'second', at(2026, 10, 12, 18, 0))
    const rows = await d.pulses.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'pulse-2026-10-12', text: 'second', at: at(2026, 10, 12, 18, 0) })
  })
  it('another day is another row', async () => {
    const d = freshDb()
    await logPulse(d, 'one', at(2026, 10, 12))
    await logPulse(d, 'two', at(2026, 10, 13))
    expect((await d.pulses.orderBy('day').toArray()).map(p => p.day)).toEqual(['2026-10-12', '2026-10-13'])
  })
  it('refuses blank text and more than 140 characters, and writes nothing', async () => {
    const d = freshDb()
    expect((await logPulse(d, '   ', at(2026, 10, 12))).ok).toBe(false)
    expect((await logPulse(d, 'a'.repeat(141), at(2026, 10, 12))).ok).toBe(false)
    expect(await d.pulses.count()).toBe(0)
  })
  it('writes nothing to tickets, sessions or events (no XP, no streak)', async () => {
    const d = freshDb()
    await logPulse(d, 'x', at(2026, 10, 12))
    expect((await d.tickets.count()) + (await d.sessions.count()) + (await d.events.count())).toBe(0)
  })
})

describe('openWeekTicket', () => {
  it('creates the week ticket when it is missing and returns its id', async () => {
    const d = freshDb()
    const id = await openWeekTicket(d, at(2026, 10, 14), OPTS)
    expect(id).toBe('ritual-try-new-model-2026-W42')
    expect(await d.tickets.get(id)).toMatchObject({ kind: 'ritual', lane: 'ritual', status: 'todo', estMin: 30, origin: 'ritual:try-new-model:2026-W42' })
  })
  it('is idempotent: a second Open keeps the ticket as the learner left it', async () => {
    const d = freshDb()
    const id = await openWeekTicket(d, at(2026, 10, 14), OPTS)
    await d.tickets.update(id, { status: 'doing', learnerNotes: 'llama 3.2 1B, 40 tok/s' })
    expect(await openWeekTicket(d, at(2026, 10, 15), OPTS)).toBe(id)
    expect(await d.tickets.count()).toBe(1)
    expect(await d.tickets.get(id)).toMatchObject({ status: 'doing', learnerNotes: 'llama 3.2 1B, 40 tok/s' })
  })
  it('a new ISO week mints a new ticket and leaves the earlier one as it is', async () => {
    const d = freshDb()
    const a = await openWeekTicket(d, at(2026, 10, 14), OPTS)
    const b = await openWeekTicket(d, at(2026, 10, 20), OPTS)
    expect(a).not.toBe(b)
    expect(b).toBe(weekTicketId(at(2026, 10, 20)))
    expect((await d.tickets.get(a))?.status).toBe('todo')
  })
})

import { openRitualTicket } from '../../src/data/ritualActions'
import type { RitualEntry } from '../../src/rules/ritualPeriod'

describe('openRitualTicket', () => {
  const WR: RitualEntry = { id: 'weekly-review', title: 'Weekly review', cadence: 'weekly', minutes: 60, dueWeekday: 0, dueHour: 12 }
  const SWAP: RitualEntry = { id: 'model-swap-drill', title: 'Model swap drill', cadence: 'monthly', minutes: 180, dueWeekday: 6, body: 'Swap a model.' }
  it('creates the period ticket when the window is open, returns its id, and writes nothing else', async () => {
    const d = freshDb()
    const id = await openRitualTicket(d, WR, at(2026, 11, 8, 14))
    expect(id).toBe('ritual-weekly-review-2026-W45')
    expect(await d.tickets.get(id!)).toMatchObject({
      kind: 'ritual', lane: 'ritual', origin: 'ritual:weekly-review:2026-W45', title: 'Weekly review', estMin: 60, status: 'todo', xp: 0,
      text: 'Look back at your week, then write three short lines: what worked, what to change, and a focus for next week.',
    })
    expect((await d.sessions.count()) + (await d.events.count()) + (await d.redos.count())).toBe(0)
  })
  it('is idempotent: an existing ticket (started, done or archived) is returned untouched', async () => {
    const d = freshDb()
    const id = (await openRitualTicket(d, SWAP, at(2026, 11, 7, 9)))!
    expect(id).toBe('ritual-model-swap-drill-2026-11')
    await d.tickets.update(id, { status: 'doing', xp: 3 })
    expect(await openRitualTicket(d, SWAP, at(2026, 11, 20, 9))).toBe(id)
    expect(await d.tickets.count()).toBe(1)
    expect(await d.tickets.get(id)).toMatchObject({ status: 'doing', xp: 3 })
  })
  it('returns null and creates nothing outside the window', async () => {
    const d = freshDb()
    expect(await openRitualTicket(d, WR, at(2026, 11, 8, 11, 59))).toBeNull()
    expect(await d.tickets.count()).toBe(0)
  })
})

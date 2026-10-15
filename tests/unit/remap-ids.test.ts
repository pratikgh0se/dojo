import { describe, expect, it } from 'vitest'
import { idMapOfPairs, remapEvent, remapGrade, remapRows, remapSession, remapTicketRefs } from '../../src/rules/remapIds'
import type { CodeRow, GradeRow, PictureRow, Session, StoredEvent } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const m = idMapOfPairs([{ from: 'a~1', to: 'a' }, { from: 'a~2', to: 'a' }, { from: 'same', to: 'same' }])
const sess = (ticketId: string): Session => ({ id: `s-${ticketId}`, ticketId, start: 1, end: 2, minutes: 1, outcome: 'solved', xpDelta: 1 })

describe('per-row mappers', () => {
  it('map the reference and keep identity when nothing changes', () => {
    const s = sess('a~1')
    expect(remapSession(s, m)).toEqual({ ...s, ticketId: 'a' })
    const other = sess('zzz')
    expect(remapSession(other, m)).toBe(other)
    expect(m.has('same')).toBe(false)
  })
  it('remaps the card ids of a session too', () => {
    const s: Session = { ...sess('zzz'), cards: ['a~1', 'k', 'a~2'] }
    expect(remapSession(s, m)).toEqual({ ...s, cards: ['a', 'k', 'a'] })
    const untouched: Session = { ...sess('zzz'), cards: ['k'] }
    expect(remapSession(untouched, m)).toBe(untouched)
  })
  it('refuses chained or cyclic pairs', () => {
    expect(() => idMapOfPairs([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])).toThrow(/chain/i)
    expect(() => idMapOfPairs([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toThrow(/chain/i)
    expect(() => idMapOfPairs([{ from: 'a~1', to: 'a' }, { from: 'a~2', to: 'a' }, { from: 'x', to: 'x' }])).not.toThrow()
  })
  it('remap a grade only when it grades a ticket', () => {
    const g = (targetKind: GradeRow['targetKind']): GradeRow => ({ id: 'g', targetKind, targetId: 'a~1', at: 1, score: 1, max: 1, passed: true, feedback: [], missing: [], provider: 'fake' })
    expect(remapGrade(g('ticket'), m).targetId).toBe('a')
    expect(remapGrade(g('artifact'), m).targetId).toBe('a~1')
  })
  it('remap every id-bearing field of an event: id, ids[], parts[] and the keys of a "to" map', () => {
    const e = { t: 'shift_plan', at: 1, fromSprint: 1, ids: ['a~1', 'x'], to: { 'a~1': 2, x: 3 }, id: 'a~2', parts: ['a~1', 'a~2'] } as unknown as StoredEvent
    expect(remapEvent(e, m)).toEqual({ t: 'shift_plan', at: 1, fromSprint: 1, ids: ['a', 'x'], to: { a: 2, x: 3 }, id: 'a', parts: ['a', 'a'] })
    const moved = { t: 'moved', id: 'x', at: 1, from: 1, to: 2, why: 'manual' } as unknown as StoredEvent
    expect(remapEvent(moved, m)).toBe(moved)
  })
  it('remap a ticket\'s own links to other tickets', () => {
    const t = mkTicket({ id: 'q', origin: 'a~1' }) as ReturnType<typeof mkTicket> & { childOf?: string; children?: string[] }
    t.childOf = 'a~2'; t.children = ['a~1', 'k']
    expect(remapTicketRefs(t, m)).toMatchObject({ origin: 'a', childOf: 'a', children: ['a', 'k'] })
    const plain = mkTicket({ id: 'plain' })
    expect(remapTicketRefs(plain, m)).toBe(plain)
  })
})

describe('remapRows', () => {
  it('merges colliding code rows (newest source, then the older one commented out) and keeps the newest picture, counting the collisions', () => {
    const code = (ticketId: string, updatedAt: number): CodeRow => ({ ticketId, lang: 'py', source: `s${updatedAt}`, updatedAt })
    const pic = (key: string, createdAt: number): PictureRow => ({ key, json: {} as never, source: 'library', createdAt })
    const r = remapRows({ code: [code('a~1', 5), code('a~2', 9), code('b', 1)], pictures: [pic('a~1', 9), pic('a', 2)] }, m)
    expect(r.rows.code).toEqual([{ ...code('a', 9), source: 's9\n\n# earlier code kept by the R1 migration\n# s5' }, code('b', 1)])
    expect(r.rows.pictures).toEqual([pic('a', 9)])
    expect(r.collisions).toEqual({ code: 1, pictures: 1 })
  })
  it('only touches the tables it is given', () => {
    const r = remapRows({ sessions: [sess('a~1')] }, m)
    expect(Object.keys(r.rows)).toEqual(['sessions'])
  })
})

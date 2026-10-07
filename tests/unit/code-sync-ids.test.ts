// C-PYTHON §4 on disk: a `code` row's disk id is `<ticketId>:<lang>`; 4a's docs (id = ticketId) still hydrate.
import { describe, expect, it } from 'vitest'
import { fromDiskDocs } from '../../src/data/sync/diskIds'
import { idToKey, keyToId } from '../../src/data/sync/keys'
import { freshDb } from '../helpers/db'

describe('disk ids of the code table', () => {
  it('joins a compound key with ":" and splits it back', () => {
    expect(keyToId(['p91', 'py'])).toBe('p91:py')
    expect(keyToId('p91')).toBe('p91')
    expect(keyToId(7)).toBe('7')
    expect(idToKey('code', 'p91:go')).toEqual(['p91', 'go'])
    expect(idToKey('code', 'p91')).toEqual(['p91', '']) // a 4a id names no row now
    expect(idToKey('tickets', 'p91')).toBe('p91')
  })

  it('a write queues the row under <ticketId>:<lang>', async () => {
    const { createDb } = await import('../../src/data/db')
    const d = createDb(`ids-${Math.random().toString(36).slice(2)}`, { bypass: false, readOnly: false })
    await d.code.put({ ticketId: 'p322', lang: 'py', source: 'x', updatedAt: 1 })
    expect((await d._outbox.toArray()).map(o => [o.tbl, o.op, o.id])).toEqual([['code', 'put', 'p322:py']])
    await d.code.delete(['p322', 'py'])
    expect((await d._outbox.toArray()).map(o => [o.op, o.id])).toEqual([['put', 'p322:py'], ['delete', 'p322:py']])
    d.close()
  })
})

describe('hydrating code rows', () => {
  const go = { ticketId: 'p91', lang: 'go', source: 'old', updatedAt: 1 }
  it('keeps the newest of a 4a doc and its 4b replacement, and drops docs without a key', () => {
    const docs = [
      { ticketId: 'p91', lang: 'go', source: 'new', updatedAt: 9 },
      go,
      { source: 'orphan' },
      { ticketId: 'p62', lang: 'rust', source: 'x', updatedAt: 1 },
      { ticketId: 'p62', lang: 'py', source: 'ok', updatedAt: 3 },
    ]
    const out = fromDiskDocs('code', docs) as typeof docs
    expect(out.map(d => d.source)).toEqual(['old', 'ok', 'new'])
  })

  it('PY-15: a 4a doc with no lang (and no lastLang) hydrates as a Go row with its source intact', () => {
    const legacy = { ticketId: 'p91', source: 'package main // 4a', updatedAt: 7 }
    expect(fromDiskDocs('code', [legacy])).toEqual([{ ticketId: 'p91', lang: 'go', source: 'package main // 4a', updatedAt: 7 }])
    // and loses to a newer <ticketId>:go doc of the same ticket
    const out = fromDiskDocs('code', [{ ticketId: 'p91', lang: 'go', source: 'newer', updatedAt: 9 }, legacy]) as { source: string }[]
    expect(out.map(d => d.source)).toEqual(['package main // 4a', 'newer'])
  })

  it('bulkPut of those rows leaves one row per (ticket, lang)', async () => {
    const d = freshDb()
    await d.code.bulkPut(fromDiskDocs('code', [{ ticketId: 'p91', lang: 'go', source: 'new', updatedAt: 9 }, go, { ticketId: 'p91', lang: 'py', source: 'p', updatedAt: 2 }]) as never)
    expect((await d.code.toArray()).map(r => [r.lang, r.source]).sort()).toEqual([['go', 'new'], ['py', 'p']])
  })
})

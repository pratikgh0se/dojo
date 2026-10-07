import { describe, expect, it } from 'vitest'
import { chooseLang, codeRows, lastLang, loadCode, saveCode } from '../../src/data/codeActions'
import { freshDb } from '../helpers/db'

describe('the code table (C-RUNNER §4 saving, C-PYTHON §4 per language)', () => {
  it('keeps one row per (ticket, language): { ticketId, lang, source, updatedAt, lastLang }', async () => {
    const d = freshDb()
    expect(await loadCode(d, 'p70', 'go')).toBeNull()
    await saveCode(d, 'p70', 'package main\n', 1000)
    await saveCode(d, 'p70', 'package main\n// v2\n', 2000)
    await saveCode(d, 'p198', 'x', 3000)
    expect((await d.code.toArray()).sort((a, b) => a.ticketId.localeCompare(b.ticketId))).toEqual([
      { ticketId: 'p198', lang: 'go', source: 'x', updatedAt: 3000, lastLang: true },
      { ticketId: 'p70', lang: 'go', source: 'package main\n// v2\n', updatedAt: 2000, lastLang: true },
    ])
    expect(await loadCode(d, 'p70', 'go')).toMatchObject({ ticketId: 'p70', lang: 'go', source: 'package main\n// v2\n', updatedAt: 2000 })
  })

  it('skips a save that changes nothing', async () => {
    const d = freshDb()
    await saveCode(d, 'p70', 'a', 1)
    expect(await saveCode(d, 'p70', 'a', 2)).toBe(false)
    expect((await loadCode(d, 'p70', 'go'))?.updatedAt).toBe(1)
  })

  it('keeps each language\'s own source, and the latest write holds lastLang', async () => {
    const d = freshDb()
    await saveCode(d, 'p91', 'package main // go', 1, 'go')
    await saveCode(d, 'p91', 'def numDecodings(s): ...', 2, 'py')
    expect((await codeRows(d, 'p91')).map(r => [r.lang, r.source, !!r.lastLang])).toEqual([['go', 'package main // go', false], ['py', 'def numDecodings(s): ...', true]])
    await saveCode(d, 'p91', 'package main // go 2', 3, 'go')
    expect((await codeRows(d, 'p91')).map(r => [r.lang, !!r.lastLang])).toEqual([['go', true], ['py', false]])
    expect(lastLang(await codeRows(d, 'p91'))).toBe('go')
    expect(await loadCode(d, 'p91', 'py')).toMatchObject({ source: 'def numDecodings(s): ...', updatedAt: 2 }) // the other row's text and time are untouched
    expect(await codeRows(d, 'p62')).toEqual([])
  })

  it('choosing a language makes it the last one, creating its row from the starter without touching a typed one', async () => {
    const d = freshDb()
    await saveCode(d, 'p91', 'package main', 1, 'go')
    await chooseLang(d, 'p91', 'py', 'def numDecodings(s: str) -> int:\n    pass\n', 5)
    expect(await loadCode(d, 'p91', 'py')).toEqual({ ticketId: 'p91', lang: 'py', source: 'def numDecodings(s: str) -> int:\n    pass\n', updatedAt: 5, lastLang: true })
    expect(lastLang(await codeRows(d, 'p91'))).toBe('py')
    await saveCode(d, 'p91', 'typed py', 6, 'py')
    await chooseLang(d, 'p91', 'go', 'STARTER', 7) // the Go row exists: kept as typed
    const rows = await codeRows(d, 'p91')
    expect(rows.map(r => [r.lang, r.source, !!r.lastLang])).toEqual([['go', 'package main', true], ['py', 'typed py', false]])
    expect(await chooseLang(d, 'p91', 'go', 'STARTER', 8)).toBe(false) // already last: no write
  })

  it('lastLang defaults to Go for a legacy 4a row or no row', async () => {
    expect(lastLang([])).toBe('go')
    expect(lastLang([{ ticketId: 'p1', lang: 'go', source: 'x', updatedAt: 1 }])).toBe('go')
    expect(lastLang([{ ticketId: 'p1', lang: 'py', source: 'x', updatedAt: 1 }])).toBe('go') // no row says it is the last: Go
  })
})

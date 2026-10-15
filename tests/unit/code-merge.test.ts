import { describe, expect, it } from 'vitest'
import { CODE_MERGE_MARKER as MK, commentToken, idMapOfPairs, mergeCodeGroup, remapRows } from '../../src/rules/remapIds'
import type { CodeRow } from '../../src/data/types'

type Lang = CodeRow['lang']
const row = (ticketId: string, source: string, updatedAt: number, lang: Lang = 'py', extra: Partial<CodeRow> = {}): CodeRow => ({ ticketId, lang, source, updatedAt, ...extra })
const merge2 = (top: string, older: string, lang: Lang = 'py') =>
  mergeCodeGroup([{ orig: 'a~1', row: row('a', top, 9, lang) }, { orig: 'a~2', row: row('a', older, 1, lang) }]).source

/** The inverse of the merge: un-comment every comment line of the tail (what follows the newest source); the blank separators and marker lines drop out. */
function olderLinesOf(merged: string, top: string, tok: string): string[] {
  expect(merged.startsWith(top)).toBe(true)
  return merged.slice(top.length).split('\n')
    .filter(l => l !== '')
    .map(l => (l === tok ? '' : (expect(l.startsWith(`${tok} `)).toBe(true), l.slice(tok.length + 1))))
    .filter(l => l !== MK)
}

describe('commentToken', () => {
  it('is # for py, rb, sh, yaml', () => {
    for (const l of ['py', 'rb', 'sh', 'yaml', 'PY', 'python', 'ruby', 'bash']) expect(commentToken(l)).toBe('#')
  })
  it('is -- for sql and hs', () => {
    for (const l of ['sql', 'hs', 'SQL', 'haskell']) expect(commentToken(l)).toBe('--')
  })
  it('is // for go and for an unknown language', () => {
    for (const l of ['go', 'rust', 'zzz', '']) expect(commentToken(l)).toBe('//')
  })
})

describe('mergeCodeGroup edge cases (MIG-08)', () => {
  it('one row is returned as is', () => {
    const r = row('a', 'x', 1)
    expect(mergeCodeGroup([{ orig: 'a', row: r }])).toBe(r)
  })
  it('an older source ending in a newline keeps its final empty line as a bare token', () => {
    expect(merge2('new', 'x\ny\n')).toBe(`new\n\n# ${MK}\n# x\n# y\n#`)
  })
  it('a newest source ending in a newline gets exactly one blank line before the marker', () => {
    expect(merge2('new\n', 'old')).toBe(`new\n\n# ${MK}\n# old`)
  })
  it('a CRLF source keeps its carriage returns', () => {
    const out = merge2('new\r\n', 'a\r\n\r\nb\r\n')
    expect(out).toBe(`new\r\n\n# ${MK}\n# a\r\n# \r\n# b\r\n#`)
    expect(olderLinesOf(out, 'new\r\n', '#')).toEqual('a\r\n\r\nb\r\n'.split('\n'))
  })
  it('an empty older source becomes the bare token', () => {
    expect(merge2('new', '')).toBe(`new\n\n# ${MK}\n#`)
  })
  it('a whitespace-only older source keeps its spaces', () => {
    const out = merge2('new', '   \n\t')
    expect(out).toBe(`new\n\n# ${MK}\n#    \n# \t`)
    expect(olderLinesOf(out, 'new', '#')).toEqual(['   ', '\t'])
  })
  it('an empty newest source still gets the older one below it', () => {
    expect(merge2('', 'old')).toBe(`\n\n# ${MK}\n# old`)
  })
  it('re-merging a row that already holds the marker loses nothing and does not crash', () => {
    const once = merge2('new', 'old')
    // as the older source: commented out whole, marker line included
    const asOlder = merge2('newer', once)
    expect(olderLinesOf(asOlder, 'newer', '#')).toEqual(once.split('\n'))
    // as the newest source: kept as is, the next older one appended
    const asTop = merge2(once, 'older still')
    expect(asTop.startsWith(once)).toBe(true)
    expect(asTop.endsWith('# older still')).toBe(true)
    expect(asTop.split(MK).length - 1).toBe(2)
  })
  it('uses the language comment token', () => {
    expect(merge2('n', 'o', 'go')).toBe(`n\n\n// ${MK}\n// o`)
  })
})

describe('mergeCodeGroup lastLang (MIG-08)', () => {
  const group = (rows: CodeRow[]) => rows.map((r, i) => ({ orig: `a~${i + 1}`, row: r }))
  it('is kept when the older row had it and the newest did not, in either input order', () => {
    const rows = [row('a', 'old', 1, 'py', { lastLang: true }), row('a', 'new', 2)]
    expect(mergeCodeGroup(group(rows)).lastLang).toBe(true)
    expect(mergeCodeGroup(group([...rows].reverse())).lastLang).toBe(true)
  })
  it('is kept when the newest row had it', () => {
    const rows = [row('a', 'old', 1), row('a', 'new', 2, 'py', { lastLang: true })]
    expect(mergeCodeGroup(group(rows)).lastLang).toBe(true)
    expect(mergeCodeGroup(group([...rows].reverse())).lastLang).toBe(true)
  })
  it('wins over an explicit false on the newest row', () => {
    const m = mergeCodeGroup(group([row('a', 'old', 1, 'py', { lastLang: true }), row('a', 'new', 2, 'py', { lastLang: false })]))
    expect(m.lastLang).toBe(true)
  })
  it('adds no key when no row had it, and keeps the newest row\'s explicit false', () => {
    const none = mergeCodeGroup(group([row('a', 'old', 1), row('a', 'new', 2)]))
    expect('lastLang' in none).toBe(false)
    const falsy = mergeCodeGroup(group([row('a', 'old', 1), row('a', 'new', 2, 'py', { lastLang: false })]))
    expect(falsy.lastLang).toBe(false)
  })
  it('through remapRows: the other language row is untouched and the flagged language still wins the panel', () => {
    const m = idMapOfPairs([{ from: 'a~1', to: 'a' }, { from: 'a~2', to: 'a' }])
    const r = remapRows({ code: [row('a~1', 'old', 1, 'py', { lastLang: true }), row('a~2', 'new', 2, 'py'), row('a~2', 'g', 3, 'go')] }, m)
    expect(r.rows.code.find(c => c.lang === 'py')?.lastLang).toBe(true)
    expect(r.rows.code.find(c => c.lang === 'go')).toEqual(row('a', 'g', 3, 'go'))
  })
})

describe('remapRows code merge is deterministic (MIG-08)', () => {
  const permutations = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p])))
  const m = idMapOfPairs([{ from: 'a~1', to: 'a' }, { from: 'a~2', to: 'a' }, { from: 'a~3', to: 'a' }])

  it('a three-way tie on updatedAt (container row + two parts) gives one output for every input order: container, then ~1, then ~2', () => {
    const rows = [row('a', 'base', 5), row('a~1', 'one', 5), row('a~2', 'two', 5)]
    const outs = permutations(rows).map(p => remapRows({ code: p }, m).rows.code)
    for (const o of outs) expect(o).toEqual(outs[0])
    expect(outs[0]).toEqual([row('a', `base\n\n# ${MK}\n# one\n\n# ${MK}\n# two`, 5)])
  })
  it('a tie plus a newer and an older row also gives one output for every input order', () => {
    const rows = [row('a', 'base', 5), row('a~1', 'one', 5), row('a~2', 'two', 5), row('a~3', 'new', 9)]
    const outs = permutations(rows).map(p => remapRows({ code: p }, m).rows.code)
    for (const o of outs) expect(o).toEqual(outs[0])
    expect(outs[0][0].source).toBe(`new\n\n# ${MK}\n# base\n\n# ${MK}\n# one\n\n# ${MK}\n# two`)
  })
  it('counts every folded row as a collision', () => {
    const rows = [row('a', 'base', 5), row('a~1', 'one', 5), row('a~2', 'two', 5)]
    expect(remapRows({ code: rows }, m).collisions.code).toBe(2)
  })
})

describe('the merge is lossless (inverse property)', () => {
  const sources = ['', '\n', 'x', 'x\n', 'a\r\nb\r\n', '   ', '  \n\t\n', 'print(1)\n\nprint(2)', '# already a comment\n// and another', `# ${MK}\n# older`, 'tail ', ' lead', '\n\nx\n\n']
  it('un-commenting every comment line of the tail recovers every older source line, in order, for each language', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (const lang of ['py', 'go', 'sql', 'hs', 'rb', 'sh', 'yaml', 'zz'] as unknown as Lang[]) {
      for (let trial = 0; trial < 25; trial++) {
        const n = 2 + rnd(3)
        const rows = Array.from({ length: n }, (_, i) => row(`a~${i + 1}`, sources[rnd(sources.length)], 100 - i * 10, lang))
        const merged = mergeCodeGroup(rows.map(r => ({ orig: r.ticketId, row: r })))
        const [top, ...older] = rows
        const tok = commentToken(lang)
        expect(olderLinesOf(merged.source, top.source, tok)).toEqual(older.flatMap(o => o.source.split('\n')))
      }
    }
  })
})

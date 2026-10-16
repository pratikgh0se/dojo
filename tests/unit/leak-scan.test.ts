// @vitest-environment node
// scanTree and looksLikeSecret against the rules of portfolio.md ("Leak scan rules"). Public tree: no personal term here.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatHit, looksLikeSecret, scanTree } from '../../scripts/leak-scan.mjs'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tree = (files: Record<string, string | Buffer>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'leak-'))
  dirs.push(dir)
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body) }
  return dir
}
const rulesOf = (d: string, o?: Parameters<typeof scanTree>[1]) => scanTree(d, o).map(h => h.rule)
const line = (text: string) => tree({ 'a.txt': `${text}\n` })

describe('scanTree: the generic rules', () => {
  it('home-path: /Users/<name> and /home/<name>; the text shows the whole line', () => {
    expect(scanTree(line('Data is in /Users/someone/project/data.csv'))).toEqual([{ file: 'a.txt', line: 1, rule: 'home-path', text: 'Data is in /Users/someone/project/data.csv' }])
    expect(rulesOf(line('Data is in /home/someone/project/data.csv'))).toEqual(['home-path'])
    expect(rulesOf(line('open "/home/jane.doe-2/x"'))).toEqual(['home-path'])
    expect(rulesOf(line('the /Users folder and /home alone'))).toEqual([])
  })
  it('email: local@domain.tld with a final label of two or more letters', () => {
    expect(scanTree(line('Contact someone@example.org for details.'))).toMatchObject([{ rule: 'email', text: 'Contact someone@example.org for details.' }])
    expect(rulesOf(line('a@b. and x = a@b and @pytest.mark.slow and pip install numpy@2.1'))).toEqual([])
  })
  it('a very long line with no @ is scanned in linear time (a minified file must not stall an export)', () => {
    const t0 = Date.now()
    expect(scanTree(line('x'.repeat(300_000)))).toEqual([])
    expect(scanTree(line(`${'x'.repeat(300_000)}@example.org`)).map(h => h.rule)).toEqual(['email'])
    expect(Date.now() - t0).toBeLessThan(1000)
  })
  it('token: ghp_, github_pat_, sk-, AKIA and BEGIN; the text holds the secret', () => {
    const planted = ['ghp_0123456789abcdefghijABCDEFGHIJ012345', 'github_pat_0123456789abcdefghijABCDEFGHIJ', 'sk-0123456789abcdefghijABCDEFGHIJ0123456789', 'AKIAIOSFODNN7EXAMPLE', '-----BEGIN RSA PRIVATE KEY-----']
    for (const t of planted) {
      const hits = scanTree(line(`Token ${t}`))
      expect(hits, t).toHaveLength(1)
      expect(hits[0].rule).toBe('token')
      expect(hits[0].text).toContain(t.startsWith('-----BEGIN') ? '-----BEGIN' : t)
    }
  })
  it('host: private host names and private IPv4 addresses (PORT-53); localhost and 127.0.0.1 are not hits', () => {
    expect(scanTree(line('Deployed on build01.internal.corp today.'))).toEqual([{ file: 'a.txt', line: 1, rule: 'host', text: 'Deployed on build01.internal.corp today.' }])
    expect(scanTree(line('Proxy at 10.20.30.40 for tests.'))).toMatchObject([{ rule: 'host', text: 'Proxy at 10.20.30.40 for tests.' }])
    for (const t of ['db.internal', 'nas.LOCAL.', 'router.lan', 'x.y.intra', '192.168.0.12', '172.16.0.1', '172.31.255.254', '10.0.0.1:8080']) expect(rulesOf(line(`see ${t} now`)), t).toEqual(['host'])
    for (const t of ['localhost', 'http://localhost:3000', '127.0.0.1', '0.0.0.0', '172.15.0.1', '172.32.0.1', '8.8.8.8', 'ver 1.10.0.1', '3.10.1.2.5', '10.256.1.1', 'x.internals', 'a.local.example', 'self.local_x', 'example.com', 'the local network', 'internal use only'])
      expect(rulesOf(line(t)), t).toEqual([])
  })
  it('ordinary text is no hit (PORT-29)', () => {
    expect(scanTree(line('Run /usr/local/bin/python from ~/labs, ask-me-anything, task-list-sk-1, ghp_short, a@b.'))).toEqual([])
  })
  it('a long line is cut around the match, never to more than about 200 characters', () => {
    const [h] = scanTree(line(`${'x'.repeat(500)} someone@example.org ${'y'.repeat(500)}`))
    expect(h.text).toContain('someone@example.org')
    expect(h.text.length).toBeLessThanOrEqual(204)
  })
  it('generic: false turns the four rules off', () => {
    expect(scanTree(line('someone@example.org /Users/jane ghp_0123456789abcdefghijABCDEFGHIJ012345 build01.internal.corp'), { generic: false })).toEqual([])
  })
})

describe('scanTree: what is scanned and in what order', () => {
  it('hits come back ordered by file (code point), then line; one per rule per line', () => {
    const d = tree({ 'z.md': 'someone@example.org\n', 'a.md': 'x\nsomeone@example.org\nsomeone@example.org /Users/jane\n' })
    expect(scanTree(d).map(h => `${h.file}:${h.line}:${h.rule}`)).toEqual(['a.md:2:email', 'a.md:3:home-path', 'a.md:3:email', 'z.md:1:email'])
  })
  it('files limits the scan; binary files, symlinks, node_modules and .git are skipped', () => {
    const d = tree({ 'a.md': 'a@example.org\n', 'b.py': 'a@example.org\n', 'bin.dat': Buffer.from([0, 1, 2, ...Buffer.from('a@example.org')]), 'node_modules/x/i.js': 'a@example.org\n', '.git/config': 'a@example.org\n' })
    expect(scanTree(d, { files: /\.md$/ }).map(h => h.file)).toEqual(['a.md'])
    expect(scanTree(d).map(h => h.file)).toEqual(['a.md', 'b.py'])
    const outside = mkdtempSync(join(tmpdir(), 'leak-out-'))
    try {
      writeFileSync(join(outside, 'o.md'), 'a@example.org\n')
      symlinkSync(outside, join(d, 'link'))
      symlinkSync(join(outside, 'o.md'), join(d, 'file-link.md'))
      expect(scanTree(d).map(h => h.file)).toEqual(['a.md', 'b.py'])
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })
  it('extraTerms: case-insensitive substrings with rule "term"; allow patterns apply to terms only', () => {
    const d = tree({ 'a.md': 'Here is ZZ-Leak-Term-Fixture today\n', 'b.md': 'see https://example.com/me/x and zz-leak\n' })
    expect(scanTree(d, { extraTerms: ['zz-leak-term-fixture'] })).toEqual([{ file: 'a.md', line: 1, rule: 'term', text: 'Here is ZZ-Leak-Term-Fixture today' }])
    expect(scanTree(d, { extraTerms: [' zz-leak ', ''] }).map(h => h.file)).toEqual(['a.md', 'b.md'])
    const allow = [/https:\/\/example\.com\/me\/\S*/g]
    expect(scanTree(tree({ 'c.md': 'https://example.com/me/zz-leak and a@example.org\n' }), { extraTerms: ['zz-leak'], allow }).map(h => h.rule)).toEqual(['email'])
  })
  it('formatHit is file:line [rule] text', () => {
    expect(formatHit({ file: 'a.md', line: 2, rule: 'email', text: 'x' })).toBe('a.md:2 [email] x')
  })
})

describe('looksLikeSecret (W2 review bundle)', () => {
  it('is true for a token shape and false for plain text', () => {
    expect(looksLikeSecret(`key = sk-${'z'.repeat(30)}`)).toBe(true)
    expect(looksLikeSecret('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true)
    expect(looksLikeSecret('nothing to see here')).toBe(false)
  })
})

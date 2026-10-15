// R1 W6: every Banks hook in the "Required hooks" table of trees-and-banks.md is written in the source (the foundation check script
// does not read this contract yet). The blind tests check that each one works.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []))
const src = walk(join(ROOT, 'src/screens')).map(f => readFileSync(f, 'utf8')).join('\n')

const CONTRACT = join(ROOT, 'docs/contracts/trees-and-banks.md')
const have = existsSync(CONTRACT)
const md = have ? readFileSync(CONTRACT, 'utf8') : ''
const table = md.slice(md.indexOf('## Required hooks'))
const names = [...table.matchAll(/`((?:banks-area|banks-q)[^`]*)`/g)].map(m => m[1].replace(/\s*\(.*$/, '')).filter(n => /^banks-/.test(n))

describe.skipIf(!have)('Banks hooks of trees-and-banks.md', () => {
  it('finds the hooks of the table', () => {
    expect(names.length).toBeGreaterThan(25)
  })
  it.each([...new Set(names)])('%s is written in the source', name => {
    const prefix = name.split('<')[0]
    // ids built from a variable (`banks-area-${id}`, `banks-q-grade-${g}`) are found by their prefix up to the last dash
    const stem = prefix.slice(0, prefix.lastIndexOf('-') + 1)
    expect(src.includes(prefix) || src.includes(`${stem}$`), name).toBe(true)
  })
})

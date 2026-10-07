// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bareClasses, collisions } from '../../scripts/css-collisions.mjs'

const SRC = join(process.cwd(), 'src')
function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(n) ? [p] : []
  })
}
const css = Object.fromEntries(walk(SRC, /\.css$/).map(f => [relative(SRC, f), readFileSync(f, 'utf8')]))
const code = walk(SRC, /\.(ts|tsx)$/).map(f => readFileSync(f, 'utf8')).join('\n')

describe('CSS hygiene', () => {
  it('finds bare single-class rules only', () => {
    expect([...bareClasses('.a{} .b .c{} .d,.e{} @media (x){.f{}} /* .g{} */ .h:hover{}')].sort()).toEqual(['a', 'd', 'e', 'f'])
  })
  it('no bare class is defined in two CSS files (chains merged without collisions)', () => {
    expect(collisions(css)).toEqual([])
  })
  it('one visually-hidden class: .vh in styles/app.css, nothing else hides that way', () => {
    const hiders = Object.entries(css).filter(([, t]) => /clip:\s*rect\(0,? 0,? 0,? 0\)|clip-path:\s*inset\(50%\)/.test(t)).map(([f]) => f)
    expect(hiders).toEqual(['styles/app.css'])
    expect(code).not.toMatch(/\b(p-sr-only|today-sr)\b/)
  })
})

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const files = walk(SRC).filter(f => /\.(css|ts|tsx)$/.test(f) && !f.endsWith(join('styles', 'tokens.css')))

describe('Still Room token audit', () => {
  it('uses no hex colour literals outside tokens.css', () => {
    const offenders = files.flatMap(f =>
      [...readFileSync(f, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => `${relative(SRC, f)}: ${m[0]}`),
    )
    expect(offenders).toEqual([])
  })

  it('keeps radius 0, stepped motion only, and no blur', () => {
    const bad = files
      .filter(f => f.endsWith('.css'))
      .flatMap(f => {
        const text = readFileSync(f, 'utf8')
        const out: string[] = []
        if (/border-radius\s*:\s*(?!0[;\s}])/.test(text)) out.push(`${relative(SRC, f)}: border-radius`)
        if (/(transition|animation)(-timing-function)?\s*:[^;]*\b(ease|ease-in|ease-out|ease-in-out|linear|cubic-bezier)\b/.test(text))
          out.push(`${relative(SRC, f)}: easing`)
        if (/blur\(/.test(text)) out.push(`${relative(SRC, f)}: blur`)
        return out
      })
    expect(bad).toEqual([])
  })
})

describe('dark only (ux spec section 2)', () => {
  const tokens = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8')
  it('declares color-scheme dark and carries no light theme', () => {
    expect(tokens).toMatch(/color-scheme:\s*dark/)
    expect(tokens).not.toMatch(/prefers-color-scheme:\s*light/)
    expect(tokens).not.toMatch(/data-theme/)
  })
  it('no stylesheet or source keys off data-theme', () => {
    const offenders = [...files, join(SRC, 'styles', 'tokens.css')]
      .filter(f => /data-theme/.test(readFileSync(f, 'utf8')))
      .map(f => relative(SRC, f))
    expect(offenders).toEqual([])
  })
})

// ux spec section 1: the type scale is tokens. Silkscreen only at 16/24/32/48 px for headings and big
// numbers; nothing smaller than 14 px anywhere; no ad-hoc font sizes.
describe('type scale audit (ux spec section 1)', () => {
  const cssFiles = files.filter(f => f.endsWith('.css'))
  const tokens = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8')
  const rules = (text: string): Array<{ sel: string; body: string }> =>
    [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }))
  const DISPLAY = ['--type-display-s', '--type-display-m', '--type-display-l', '--type-display-xl']
  const TEXT_TOKENS = ['--type-body', '--type-small', '--type-meta']
  const PIXEL = /font-family:\s*var\(--sr-font-pixel\)/

  it('defines the scale in tokens.css', () => {
    const px = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(tokens)?.[1])
    expect([16, 24, 32, 48]).toEqual(DISPLAY.map(px))
    expect(px('--type-body')).toBe(17)
    expect(px('--type-small')).toBe(15)
    expect(px('--type-meta')).toBeGreaterThanOrEqual(14)
  })

  it('has no font-size literal below 14px (or any px literal at all: sizes come from tokens)', () => {
    const bad = cssFiles.flatMap(f =>
      [...readFileSync(f, 'utf8').matchAll(/font-size:\s*([^;}]+)/g)]
        .filter(m => !/^var\(--type-[a-z-]+\)(\s*!important)?$/.test(m[1].trim()) && !/^(inherit|1em)$/.test(m[1].trim()))
        .map(m => `${relative(SRC, f)}: font-size: ${m[1].trim()}`),
    )
    expect(bad).toEqual([])
  })

  it('has no font shorthand carrying a px size (only `font: inherit`), and no px in line-height-free shorthands', () => {
    const bad = cssFiles.flatMap(f =>
      [...readFileSync(f, 'utf8').matchAll(/(?<![-\w])font:\s*([^;}]+)/g)]
        .filter(m => !/^inherit$/.test(m[1].trim()))
        .map(m => `${relative(SRC, f)}: font: ${m[1].trim()}`),
    )
    expect(bad).toEqual([])
  })

  it('uses Silkscreen only with a display-size token, and never on prose, table cells, labels or buttons', () => {
    const bad: string[] = []
    for (const f of cssFiles) {
      for (const { sel, body } of rules(readFileSync(f, 'utf8'))) {
        if (!PIXEL.test(body)) continue
        const size = /font-size:\s*var\((--type-[a-z-]+)\)/.exec(body)?.[1]
        if (!size || !DISPLAY.includes(size)) bad.push(`${relative(SRC, f)}: ${sel} pixel font without a display token`)
        if (!/-webkit-font-smoothing:\s*none/.test(body) || !/font-smooth:\s*never/.test(body) || !/text-rendering:\s*optimizeSpeed/.test(body))
          bad.push(`${relative(SRC, f)}: ${sel} pixel font without the no-smoothing declarations`)
        if (/(^|[\s,>])(p|td|th|label|button|textarea|input|\.sr-btn|\.tab|\.more-item)(?=$|[\s,.:>[])/.test(sel)) bad.push(`${relative(SRC, f)}: ${sel} pixel font on prose/label/button`)
      }
    }
    expect(bad).toEqual([])
  })

  it('never sets a display token on a non-pixel rule, or a text token on a pixel rule', () => {
    const bad: string[] = []
    for (const f of cssFiles) {
      for (const { sel, body } of rules(readFileSync(f, 'utf8'))) {
        const size = /font-size:\s*var\((--type-[a-z-]+)\)/.exec(body)?.[1]
        if (!size) continue
        if (DISPLAY.includes(size) && /font-family:\s*var\(--sr-font-(body|mono)\)/.test(body)) bad.push(`${relative(SRC, f)}: ${sel} display size on a text font`)
        if (TEXT_TOKENS.includes(size) && PIXEL.test(body)) bad.push(`${relative(SRC, f)}: ${sel} text size on Silkscreen`)
      }
    }
    expect(bad).toEqual([])
  })
})

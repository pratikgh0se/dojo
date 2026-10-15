import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import allowed from '../../src/styles/allowed-hex.json'

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const hexes = [...new Set([...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0].toLowerCase()))]
const ok = new Set<string>([...allowed.library, ...Object.keys(allowed.dojo)])

const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const val = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? ''

describe('allowed colours (Still Room rules.json plus Dojo)', () => {
  it('every hex in tokens.css is a library colour or a documented Dojo one', () => {
    expect(hexes.filter(h => !ok.has(h))).toEqual([])
  })
  it('no Dojo allowance is stale', () => {
    expect(Object.keys(allowed.dojo).filter(h => !hexes.includes(h))).toEqual([])
  })
  it('is generated from library v0.2.2 with the three deviations', () => {
    expect(css).toMatch(/--sr-version: "0\.2\.2"/)
    expect(allowed.libraryVersion).toBe('0.2.2')
    expect(val('--sr-label-danger')).toBe('#ff7070')
    expect(val('--sr-signal-arcane-label')).toBe('#a391fb')
    expect(val('--sr-text-secondary')).toBe('#b4bad0')
    expect(val('--sr-energy-accent')).toBe('#ff8a2a')
    expect(val('--sr-label-ok')).toBe('#3ddc84')
  })
  it('has ten area hues, each readable as text on a panel and on a well', () => {
    for (let i = 1; i <= 10; i++) {
      const hue = val(`--sr-area-${i}`)
      expect(hue).not.toBe('')
      expect(ratio(hue, val('--sr-surface-panel'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(hue, val('--sr-surface-well'))).toBeGreaterThanOrEqual(4.5)
      expect(val(`--sr-area-${i}-glow`)).not.toBe('')
      expect(val(`--sr-area-${i}-shade`)).not.toBe('')
    }
  })
})

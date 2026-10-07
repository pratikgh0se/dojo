import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles/tokens.css', 'utf8')
const block = (selector: string): string => {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`missing ${selector}`)
  const open = css.indexOf('{', i)
  return css.slice(open + 1, css.indexOf('}', open))
}
const vars = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]))

const dark = vars(block(':root{'))

const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT: Array<[string, string]> = [
  ['sr-text-primary', 'sr-surface-panel'],
  ['sr-text-secondary', 'sr-surface-panel'],
  ['sr-text-primary', 'sr-surface-tile'],
  ['sr-text-secondary-ontile', 'sr-surface-tile'],
  ['sr-text-primary', 'sr-surface-well'],
  ['sr-text-onaccent', 'sr-energy-accent'],
  ['sr-text-secondary', 'sr-surface-tile'],
  ['sr-label-danger', 'sr-surface-panel'],
  ['sr-label-accent', 'sr-surface-tile'],
]
/** Primary reading text must reach 7:1 (ux spec, Readability > Contrast); secondary 4.5:1 (TEXT above). */
const PRIMARY: Array<[string, string]> = [
  ['sr-text-primary', 'sr-surface-panel'],
  ['sr-text-primary', 'sr-surface-tile'],
  ['sr-text-primary', 'sr-surface-well'],
]
const LABELS: Array<[string, string]> = [
  ['sr-label-accent', 'sr-surface-panel'],
  ['sr-label-danger', 'sr-surface-panel'],
]

describe('token contrast (WCAG)', () => {
  for (const [name, theme] of [['Console', dark]] as const) {
    for (const [fg, bg] of TEXT) {
      it(`${name}: ${fg} on ${bg} ≥ 4.5`, () => expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5))
    }
    for (const [fg, bg] of PRIMARY) {
      it(`${name}: ${fg} on ${bg} ≥ 7`, () => expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(7))
    }
    for (const [fg, bg] of LABELS) {
      it(`${name}: ${fg} on ${bg} ≥ 3 (large pixel labels)`, () => expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(3))
    }
  }
})

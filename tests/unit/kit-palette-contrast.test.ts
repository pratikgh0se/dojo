import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KIT_FAMILIES } from '../../src/content/diagramKit'

/**
 * D-59 (axe color-contrast): the kit palette gives every family a per-family tint on its label
 * (`.kit-family-name`), matching the prototype's diagram engine FAM map. Some of those saturated
 * colours don't hit WCAG's 4.5:1 text minimum against the palette's background
 * (`--sr-surface-panel`, #2a2f45 in the Console/dark theme the axe scan ran in) — e.g.
 * `--sr-signal-arcane` (#8c75fa) on 'ai' was 3.79:1. This test computes the ratio for every
 * family's actual label colour (resolving CSS var() or literal hex) so a future tint change can't
 * silently regress one below 4.5, the way f05d632 did for 'ai'.
 */

const tokensCss = readFileSync('src/styles/tokens.css', 'utf8')
const kitCss = readFileSync('src/screens/designSession/kit/kit.css', 'utf8')

const block = (css: string, selector: string): string => {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`missing ${selector}`)
  const open = css.indexOf('{', i)
  return css.slice(open + 1, css.indexOf('}', open))
}
const tokens = Object.fromEntries(
  [...block(tokensCss, ':root{').matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]),
)

const PALETTE_BG = tokens['sr-surface-panel']

/** WCAG relative luminance + contrast ratio, same formula as tests/unit/contrast.test.ts. */
const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The label colour actually applied to `.kit-family[data-family='<family>'] .kit-family-name`. */
const labelColorFor = (family: string): string => {
  const rule = block(kitCss, `.kit-family[data-family='${family}'] .kit-family-name`)
  const decl = rule.match(/color:\s*([^;]+);/)
  if (!decl) throw new Error(`no .kit-family-name color rule for family '${family}'`)
  const value = decl[1].trim()
  const varMatch = value.match(/^var\(--([a-z0-9-]+)\)$/)
  if (varMatch) {
    const resolved = tokens[varMatch[1]]
    if (!resolved) throw new Error(`token --${varMatch[1]} not found in :root`)
    return resolved
  }
  const hexMatch = value.match(/^(#[0-9a-fA-F]{6})$/)
  if (!hexMatch) throw new Error(`unresolvable .kit-family-name color for family '${family}': ${value}`)
  return hexMatch[1]
}

describe('kit palette family label contrast (WCAG, D-59)', () => {
  it('resolved the palette background token', () => {
    expect(PALETTE_BG).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  for (const { family } of KIT_FAMILIES) {
    it(`${family}: label colour on --sr-surface-panel (${PALETTE_BG}) ≥ 4.5`, () => {
      const fg = labelColorFor(family)
      expect(ratio(fg, PALETTE_BG)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

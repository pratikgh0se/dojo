import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * D-59 (axe color-contrast, `.sr-btn-control` / "Add trade-off" in the score form): the black-box
 * scan intermittently flagged fg #828081 on bg #25293f (3.64:1). Neither colour is a token - both
 * are `.sr-panel`'s entrance animation (`srin`, opacity 0 -> 1 over `--sr-motion-base` steps(4))
 * caught mid-fade. An element under opacity < 1 is composited as a group over whatever sits behind
 * it (`--sr-surface-well` #0f111c in the Console/dark theme), so at the animation's 50% step
 * `--sr-text-primary` (#f4efe6) on `--sr-surface-tile` (#3a4162) - a steady-state 11.7:1, see
 * contrast.test.ts - blends down to exactly #828081 on #25293f:
 *   fg: 0.5*0xf4efe6 + 0.5*0x0f111c = #828081
 *   bg: 0.5*0x3a4162 + 0.5*0x0f111c = #25293f
 * This wasn't a disabled look (no real `disabled` attribute, so axe wasn't exempting anything) and
 * wasn't hover/focus (`.sr-btn` has no hover/focus rule) - it was a transient animation frame. The
 * fix drops `opacity` from the shared `srin` keyframes (kept only the `translateY` slide), so no
 * `.sr-panel`/`.sr-toast`/`.more-menu`/entrance-animated content - including every `.sr-btn-control`
 * inside one - ever renders below full contrast, at any point in the animation.
 */

const appCss = readFileSync('src/styles/app.css', 'utf8')
const tokensCss = readFileSync('src/styles/tokens.css', 'utf8')

const block = (css: string, selector: string): string => {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`missing ${selector}`)
  const open = css.indexOf('{', i)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, j)
    }
  }
  throw new Error(`unterminated block for ${selector}`)
}

const darkTokens = Object.fromEntries(
  [...block(tokensCss, ':root{').matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]),
)
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
/** Composite `fg` over `bg` at `alpha`, the way a browser renders an opacity-reduced element. */
const blend = (fg: string, bg: string, alpha: number): string => {
  const comp = (i: number) => {
    const f = parseInt(fg.slice(i, i + 2), 16)
    const b = parseInt(bg.slice(i, i + 2), 16)
    return Math.round(alpha * f + (1 - alpha) * b)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${comp(1)}${comp(3)}${comp(5)}`
}

describe('control button contrast (WCAG, D-59)', () => {
  it('the shared entrance animation (srin) never animates opacity', () => {
    const keyframes = block(appCss, '@keyframes srin')
    expect(keyframes).not.toMatch(/opacity/)
  })

  it('reproduces the reported #828081 on #25293f as the pre-fix 50%-opacity mid-fade frame', () => {
    const fg = blend(darkTokens['sr-text-primary'], darkTokens['sr-surface-well'], 0.5)
    const bg = blend(darkTokens['sr-surface-tile'], darkTokens['sr-surface-well'], 0.5)
    expect(fg).toBe('#828081')
    expect(bg).toBe('#25293f')
    expect(ratio(fg, bg)).toBeLessThan(4.5) // documents why the old animation was a real bug
  })

  for (const [name, tokens] of [['Console', darkTokens]] as const) {
    it(`${name}: .sr-btn (control) text on its own background ≥ 4.5 at every opacity the animation now reaches`, () => {
      const fg = tokens['sr-text-primary']
      const bg = tokens['sr-surface-tile']
      // Full opacity (steady state, matches contrast.test.ts) plus every alpha the un-opacitied
      // `srin` animation can produce today (always 1, since opacity is no longer in its keyframes).
      for (const alpha of [1]) {
        const blendedFg = blend(fg, tokens['sr-surface-well'], alpha)
        const blendedBg = blend(bg, tokens['sr-surface-well'], alpha)
        expect(ratio(blendedFg, blendedBg)).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${name}: .sr-btn-accent text on its background ≥ 4.5`, () => {
      expect(ratio(tokens['sr-text-onaccent'], tokens['sr-energy-accent'])).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('.sr-btn:disabled is a real `disabled` attribute everywhere it is used (axe exempts it; opacity is safe there)', () => {
    // Every Button-rendered disabled state in the app sets the boolean `disabled` prop, which React
    // reflects as a real HTML `disabled` attribute - never a fake "disabled look" via a class/style
    // that axe would still scan. This just pins that the only opacity rule keyed off button state
    // (`.sr-btn:disabled { opacity: 0.5 }`) stays tied to the real attribute, not e.g. aria-disabled.
    const rule = block(appCss, '.sr-btn:disabled')
    expect(rule).toMatch(/opacity/)
    expect(appCss).not.toMatch(/\[aria-disabled[^\]]*\]\s*\.sr-btn|\.sr-btn\[aria-disabled/)
  })
})

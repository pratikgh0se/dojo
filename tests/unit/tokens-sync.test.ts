import { describe, expect, it } from 'vitest'
import { AREA_HUES, buildTokensCss, DEVIATIONS } from '../../scripts/sync-tokens.mjs'

const LIB = `/* STILL ROOM tokens — generated from assets/tokens.json v9.9.9. */
:root{
  --sr-version: "9.9.9";
  --sr-label-danger: #ff4d4d;
  --sr-text-secondary: #9aa0b8;
  --sr-chart-label: #9aa0b8;
  --sr-surface-panel: #2a2f45;
}
@media (prefers-color-scheme: light){ :root:not([data-theme="dark"]){ --sr-surface-panel:#efe8d9; } }
[data-theme="light"]{
  --sr-surface-panel: #efe8d9;
}
/* bevel recipes */
.sr-bevel-control{border:2px solid var(--sr-edge-dark)}
:focus-visible{outline:2px solid var(--sr-focus)}
`

describe('buildTokensCss', () => {
  const out = buildTokensCss(LIB)
  it('keeps the library version and values, drops the light theme, keeps the shared recipes', () => {
    expect(out).toContain('--sr-version: "9.9.9";')
    expect(out).toContain('--sr-surface-panel: #2a2f45;')
    expect(out).not.toMatch(/prefers-color-scheme|data-theme/)
    expect(out).toContain('color-scheme: dark;')
    expect(out).toContain('.sr-bevel-control{')
    expect(out).toContain(':focus-visible{')
  })
  it('applies Dojo\'s deviations', () => {
    for (const [name, value] of Object.entries(DEVIATIONS)) expect(out).toContain(`${name}: ${value};`)
    expect(out).not.toContain('#ff4d4d')
    expect(out).not.toContain('#9aa0b8')
  })
  it('adds the arcane label, the type scale and ten area hues with glow and shade', () => {
    expect(out).toContain('--sr-signal-arcane-label: #a391fb;')
    expect(out).toContain('--type-display-s: 16px;')
    expect(AREA_HUES).toHaveLength(10)
    for (let i = 1; i <= 10; i++) for (const s of ['', '-glow', '-shade']) expect(out).toMatch(new RegExp(`--sr-area-${i}${s}: #[0-9a-f]{6};`))
    expect(out).toContain('--sr-lane-dsa: var(--sr-area-5);')
  })
  it('refuses a library file that lacks a deviated token or has an unknown shape', () => {
    expect(() => buildTokensCss(LIB.replace('--sr-label-danger: #ff4d4d;\n', ''))).toThrow(/--sr-label-danger/)
    expect(() => buildTokensCss('nothing here')).toThrow(/unexpected/)
  })
})

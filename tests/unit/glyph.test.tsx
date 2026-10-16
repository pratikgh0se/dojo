import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildGlyphData } from '../../scripts/sync-glyphs.mjs'
import { GLYPHS } from '../../src/ui/glyphData'
import { MemoryRouter } from 'react-router-dom'
import { Glyph, glyphPath } from '../../src/ui/Glyph'
import { ExtLink } from '../../src/ui/Prose'

describe('glyphPath', () => {
  it('draws runs of lit cells as one rectangle each', () => {
    expect(glyphPath(['.......', '.##....', '.......', '.......', '.......', '.......', '#.....#'])).toBe('M1 1h2v1h-2zM0 6h1v1h-1zM6 6h1v1h-1z')
  })
})

describe('Glyph', () => {
  it('is decorative unless it has a label', () => {
    const { container, rerender } = render(<Glyph name="check" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 7 7')
    expect(svg).toHaveAttribute('width', '14')
    rerender(<Glyph name="lock" size={3} label="Locked" />)
    const labelled = container.querySelector('svg')!
    expect(labelled).toHaveAttribute('role', 'img')
    expect(labelled).toHaveAttribute('aria-label', 'Locked')
    expect(labelled).toHaveAttribute('width', '21')
  })
  it('carries data-glyph: the glyph name, or the `mark` when one is given (SKILLS-09)', () => {
    const { container, rerender } = render(<Glyph name="check" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-glyph', 'check')
    rerender(<Glyph name="loading" mark="progress" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-glyph', 'progress')
  })
  it('ships the glyphs the screens use, all 7 x 7', () => {
    for (const n of ['check', 'lock', 'play', 'home', 'queue', 'branch', 'question', 'build', 'search', 'chevronR', 'chevronL', 'chevronD', 'error', 'loading', 'external', 'copy', 'flag', 'doc', 'code', 'terminal', 'edit', 'calendar', 'block', 'info', 'next']) expect(Object.keys(GLYPHS)).toContain(n)
    expect(Object.keys(GLYPHS)).toHaveLength(90)
    for (const rows of Object.values(GLYPHS)) { expect(rows).toHaveLength(7); for (const r of rows) expect(r).toMatch(/^[.#]{7}$/) }
  })
  it('refuses a library file that is not 7 x 7', () => {
    expect(() => buildGlyphData({ size: 9, glyphs: {} })).toThrow(/7 x 7/)
    expect(() => buildGlyphData({ size: 7, glyphs: { bad: { rows: ['#'] } } })).toThrow(/bad/)
  })
})

describe('plan link anchors are plan text (README Hook rules, GLOBAL-01/02)', () => {
  it('ExtLink marks the external anchor and the in-app link data-content="plan"', () => {
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ExtLink link={{ label: 'Transformers, the tech behind LLMs', url: 'https://example.com/t' }} />
        <ExtLink link={{ label: 'Bank', url: '#bank' }} />
      </MemoryRouter>,
    )
    const anchors = [...container.querySelectorAll('a')]
    expect(anchors).toHaveLength(2)
    for (const a of anchors) expect(a).toHaveAttribute('data-content', 'plan')
    expect(anchors[0].querySelector('svg.glyph')).toHaveAttribute('data-glyph', 'external')
  })
})

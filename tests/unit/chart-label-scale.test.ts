import { describe, expect, it } from 'vitest'
import { CHART_LABEL_PX, edgeSafeLabel, fitLabel, labelFontSize, thinnedIndices } from '../../src/ui/charts/labelScale'

describe('labelFontSize', () => {
  it('renders at a fixed CSS pixel size regardless of how much the SVG is scaled up', () => {
    // scale = rendered px per user unit. A wide panel stretching a small viewBox
    // gives a large scale; the user-unit font-size must shrink to compensate.
    expect(labelFontSize(1)).toBe(CHART_LABEL_PX)
    expect(labelFontSize(2)).toBe(CHART_LABEL_PX / 2)
    expect(labelFontSize(10)).toBeCloseTo(CHART_LABEL_PX / 10, 5)
  })
  it('honours a custom target size', () => {
    expect(labelFontSize(2, 20)).toBe(10)
  })
  it('falls back to the target size (no compensation) when scale is unknown', () => {
    expect(labelFontSize(0)).toBe(CHART_LABEL_PX)
    expect(labelFontSize(-1)).toBe(CHART_LABEL_PX)
    expect(labelFontSize(NaN)).toBe(CHART_LABEL_PX)
  })
})

describe('fitLabel', () => {
  it('returns the label unchanged when it fits', () => {
    expect(fitLabel('S1', 200)).toBe('S1')
  })
  it('truncates with an ellipsis when the label would overflow its slot', () => {
    const long = fitLabel('BUILDTEACH-BACKWARD', 30) // ~30px at 11px target ≈ 4 chars
    expect(long.length).toBeLessThan('BUILDTEACH-BACKWARD'.length)
    expect(long.endsWith('…')).toBe(true)
  })
  it('never returns an empty string, even with almost no room', () => {
    expect(fitLabel('Teach-back', 1)).toBe('…')
  })
  it('passes through unchanged when available width is not known', () => {
    expect(fitLabel('Teach-back', 0)).toBe('Teach-back')
    expect(fitLabel('Teach-back', NaN)).toBe('Teach-back')
  })
})

describe('thinnedIndices', () => {
  it('always keeps the first and last index', () => {
    expect(thinnedIndices(8, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(thinnedIndices(10, 3)).toEqual([0, 3, 6, 9])
    expect(thinnedIndices(9, 4)).toEqual([0, 4, 8])
  })
  it('handles an empty or single-column chart', () => {
    expect(thinnedIndices(0, 1)).toEqual([])
    expect(thinnedIndices(1, 1)).toEqual([0])
  })
})

describe('edgeSafeLabel', () => {
  const width = 100
  it('left-anchors the first shown label at the chart’s left edge', () => {
    expect(edgeSafeLabel(0, [0, 4, 9], 12, width)).toEqual({ x: 0, anchor: 'start' })
  })
  it('right-anchors the last shown label at the chart’s right edge', () => {
    expect(edgeSafeLabel(9, [0, 4, 9], 88, width)).toEqual({ x: width, anchor: 'end' })
  })
  it('centers every label in between on its own column', () => {
    expect(edgeSafeLabel(4, [0, 4, 9], 44, width)).toEqual({ x: 44, anchor: 'middle' })
  })
  it('keeps a lone label centered rather than pinning it to an edge', () => {
    expect(edgeSafeLabel(0, [0], 50, width)).toEqual({ x: 50, anchor: 'middle' })
  })
})

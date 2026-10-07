import { describe, expect, it } from 'vitest'
import { FIT_MIN_SCALE, fitScale, REFERENCE_MIN_SCALE } from '../../src/ui/engines/FitDiagram'

describe('fitScale (UAT cu-r3 A9)', () => {
  const wide = { w: 1400, h: 330 }
  it('never past 1:1 and natural size before layout', () => {
    expect(fitScale({ w: 400, h: 100 }, 800, 0, 'width')).toBe(1)
    expect(fitScale(wide, 0, 0, 'width')).toBe(1)
  })
  it('a wide drawing in a narrow well bottoms out at its minimum, then the well scrolls', () => {
    expect(fitScale(wide, 500, 0, 'width')).toBe(FIT_MIN_SCALE)
    expect(fitScale(wide, 500, 0, 'width', REFERENCE_MIN_SCALE)).toBe(REFERENCE_MIN_SCALE)
    expect(REFERENCE_MIN_SCALE).toBeGreaterThan(FIT_MIN_SCALE)
  })
  it('a drawing that fits above the minimum scales to the well', () => {
    expect(fitScale(wide, 1120, 0, 'width', REFERENCE_MIN_SCALE)).toBe(0.8)
  })
  it('box mode (thumbnails) fits the whole drawing with no minimum', () => {
    expect(fitScale(wide, 300, 100, 'box', REFERENCE_MIN_SCALE)).toBe(0.214)
  })
})

import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// P1 fix (chart-label scaling): a chart's SVG viewBox is stretched to fill its panel
// (width: 100% in charts.css), which used to scale the label text right along with the
// bars — huge, clipped, overlapping labels on Week/AI/DSA at 1280px. Text now draws at
// a font-size compensated for the measured scale (labelScale.ts / useChartScale.ts) so
// it renders at a fixed, small CSS pixel size and never escapes its chart's own bbox.
const ROUTES: Array<[string, string]> = [
  ['/week', 'Minutes per week, last 8 weeks'],
  ['/ai', 'Stage sessions done vs total'],
  ['/dsa', 'Solved vs total by difficulty'],
]

async function assertChartLabelsWellFormed(page: Page, chartName: string) {
  const chart = page.getByRole('img', { name: chartName })
  await expect(chart).toBeVisible()
  const chartBox = await chart.boundingBox()
  expect(chartBox).not.toBeNull()
  if (!chartBox) return

  const labels = chart.locator('text.chart-label, text.chart-value, text.ring-pct')
  const count = await labels.count()
  expect(count).toBeGreaterThan(0)
  let visibleCount = 0
  for (let i = 0; i < count; i++) {
    const label = labels.nth(i)
    // At narrow widths some labels are deliberately hidden (chart-label-alt, the
    // thinning rule in charts.css) to avoid crowding — skip those, not a bug.
    if (!(await label.isVisible())) continue
    visibleCount++
    const fontSizePx = await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(fontSizePx, `label ${i} of "${chartName}" font-size`).toBeLessThanOrEqual(14)
    const box = await label.boundingBox()
    expect(box, `label ${i} of "${chartName}" has a box`).not.toBeNull()
    if (!box) continue
    // No label may render outside its own chart's bounding box (no clipping at the
    // edges, no overlap spilling past the chart's own panel). Allow 1px of rounding.
    expect(box.x, `label ${i} of "${chartName}" left edge`).toBeGreaterThanOrEqual(chartBox.x - 1)
    expect(box.x + box.width, `label ${i} of "${chartName}" right edge`).toBeLessThanOrEqual(chartBox.x + chartBox.width + 1)
  }
  expect(visibleCount, `"${chartName}" has at least one visible label`).toBeGreaterThan(0)
}

for (const width of [1280, 560]) {
  test(`chart labels stay small and inside their chart at ${width}px (Week, AI, DSA)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(IST('2026-10-20T21:10:00'))
    await onboard(page, '2026-10-05')

    for (const [path, chartName] of ROUTES) {
      await page.goto(path)
      await assertChartLabelsWellFormed(page, chartName)
    }
  })
}

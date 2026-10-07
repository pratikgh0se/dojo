import { expect, test, type Locator } from '@playwright/test'
import { IST, onboard } from './helpers'

// Controller ruling 3 (6): on phone every interactive element has a hit area of at least 44 x 44,
// here the sprint strip cells (an invisible ::before behind each cell) and the Atlas row buttons (44 px row pitch).
const hitBox = (l: Locator) => l.evaluate(el => {
  const b = getComputedStyle(el, '::before')
  const r = el.getBoundingClientRect()
  return { visW: r.width, visH: r.height, hitW: parseFloat(b.width) || 0, hitH: parseFloat(b.height) || 0, content: b.content }
})

for (const width of [393, 375]) {
  test.describe(`touch hit areas at ${width}`, () => {
    test.use({ viewport: { width, height: 852 } })
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-07T10:00:00'))
      await onboard(page, '2026-10-05')
    })

    test('sprint strip: 7 cells a row, each visible cell owns a real 44 x 44 target with no overlap; taps pick that exact sprint', async ({ page }) => {
      await page.goto('/board')
      const nav = page.getByRole('navigation', { name: 'Sprints' })
      await expect(nav.getByRole('button', { name: 'Sprint 72', exact: true })).toBeVisible()
      const boxes = await nav.getByRole('button').evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()))
      expect(new Set(boxes.slice(0, 14).map(b => Math.round(b.top))).size).toBe(2) // 7 per row
      for (const b of boxes) { expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44) }
      for (let i = 1; i < boxes.length; i++) { // neighbours never overlap
        const a = boxes[i - 1], b = boxes[i]
        if (Math.round(a.top) === Math.round(b.top)) expect(b.left).toBeGreaterThanOrEqual(a.right - 0.5)
        else expect(b.top).toBeGreaterThanOrEqual(a.bottom - 0.5)
      }
      // probe the centre and four inset corners of several cells: each resolves to that cell
      for (const n of [1, 3, 7, 8, 40, 72]) {
        const hits = await nav.getByRole('button', { name: `Sprint ${n}`, exact: true }).evaluate(el => {
          const r = el.getBoundingClientRect()
          const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 1, r.top + 1], [r.right - 1, r.top + 1], [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1]]
          el.scrollIntoView({ block: 'center' })
          const r2 = el.getBoundingClientRect(), dx = r2.left - r.left, dy = r2.top - r.top
          return pts.map(([x, y]) => (document.elementFromPoint(x + dx, y + dy) as HTMLElement | null)?.closest('button')?.getAttribute('aria-label') ?? null)
        })
        expect(hits).toEqual(Array(5).fill(`Sprint ${n}`))
      }
      await nav.getByRole('button', { name: 'Sprint 3', exact: true }).click({ position: { x: 2, y: 2 } })
      await expect(page.getByTestId('board-sprint')).toHaveText('S3')
      await nav.getByRole('button', { name: 'Sprint 10', exact: true }).click({ position: { x: 3, y: 40 } })
      await expect(page.getByTestId('board-sprint')).toHaveText('S10')
    })

    test('DSA heat cells: each button is a 44+ px tap box (gap 2) with the 20 x 20 cell drawn inside; no clipped premium glyph', async ({ page }) => {
      // settings-progress-ref final rerun / K1 / ruling 3.6
      await page.goto('/dsa')
      await expect(page.getByTestId('screen-dsa')).toHaveAttribute('data-ready', 'true')
      const cells = page.locator('button.heat-cell:not([disabled])')
      expect(await cells.count()).toBeGreaterThan(5)
      const bad = await cells.evaluateAll(els => els.slice(0, 12).flatMap(el => {
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const drawn = getComputedStyle(el, '::before')
        const ok = r.width >= 44 && r.height >= 44 && drawn.width === '20px' && drawn.height === '20px'
        const miss = [[cx - 22, cy], [cx + 22, cy], [cx, cy - 22], [cx, cy + 22]].filter(([x, y]) => document.elementFromPoint(x, y) !== el).length
        return ok && miss === 0 ? [] : [`${(el as HTMLElement).dataset.testid} ${Math.round(r.width)}x${Math.round(r.height)} drawn ${drawn.width} miss ${miss}`]
      }))
      expect(bad).toEqual([])
      expect(await page.locator('.heat-cells').first().evaluate(e => getComputedStyle(e).columnGap)).toBe('2px')
      expect(await page.locator('button.heat-cell').evaluateAll(els => els.filter(e => e.textContent!.trim()).length)).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
    })

    test('Atlas row buttons: 44 px hit areas, and a tap selects the row', async ({ page }) => {
      await page.goto('/atlas')
      await expect(page.getByTestId('screen-atlas')).toHaveAttribute('data-ready', 'true')
      const rows = page.getByTestId('atlas-matrix').locator('th[scope="row"] button')
      expect(await rows.count()).toBeGreaterThan(10)
      for (const i of [0, 5, 20]) {
        // on phone the row pitch is 44 (invisible padding between rows), so the button box itself is the hit area
        const b = await hitBox(rows.nth(i))
        expect(b.visW).toBeGreaterThanOrEqual(44)
        expect(b.visH).toBeGreaterThanOrEqual(44)
      }
      // a tap 20 px above the centre (inside the 44 px box) still lands on that row, not a neighbour
      const r = (await rows.nth(2).boundingBox())!
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2 - 20)
      await expect(rows.nth(2)).toHaveAttribute('aria-pressed', 'true')
    })
  })
}

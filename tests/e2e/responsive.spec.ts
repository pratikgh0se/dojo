import { expect, test, type Locator, type Page } from '@playwright/test'
import { onboard, serveLegacyPlan } from './helpers'

// The learner keeps Dojo side by side with a code editor, often 600-700px wide.
// At that width the layout must not scroll horizontally, and the parts of the
// Do screen a learner needs mid-attempt (statement, timer, outcome buttons)
// must remain reachable (vertical scroll is fine; clipped off the right edge is not).
test.use({ viewport: { width: 640, height: 900 } })

async function assertNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
}

async function assertNotClippedHorizontally(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  const viewportWidth = locator.page().viewportSize()?.width ?? 0
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1) // +1: rounding
}

test('responsive: no horizontal page scroll at 640x900 on Today, Board, Do, Settings', async ({ page }) => {
  await serveLegacyPlan(page)
  await onboard(page)
  await assertNoHorizontalOverflow(page)

  await page.goto('/board')
  await expect(page.getByTestId('strip')).toBeVisible()
  await assertNoHorizontalOverflow(page)

  await page.goto('/do/m1w1t1')
  await expect(page.locator('.statement')).toBeVisible()
  await expect(page.locator('.timer')).toBeVisible()
  await expect(page.locator('.outcomes')).toBeVisible()
  await assertNotClippedHorizontally(page.locator('.statement'))
  await assertNotClippedHorizontally(page.locator('.timer'))
  await assertNotClippedHorizontally(page.locator('.outcomes'))
  await assertNoHorizontalOverflow(page)

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Plan start' })).toBeVisible()
  await assertNoHorizontalOverflow(page)
})

import { expect, test } from '@playwright/test'
import { IST, onboard } from './helpers'

// Controller finding #1: the page background used to stop mid-window because body's
// height was only as tall as its content. html/body now fill the viewport so the grid
// background covers the whole window at any content height, on every screen.
test.use({ viewport: { width: 1280, height: 900 } })

async function assertBodyFillsViewport(page: import('@playwright/test').Page) {
  const { bodyHeight, innerHeight } = await page.evaluate(() => ({
    bodyHeight: document.body.getBoundingClientRect().height,
    innerHeight: window.innerHeight,
  }))
  expect(bodyHeight).toBeGreaterThanOrEqual(innerHeight)
}

test('desktop 1280x900: body fills the viewport on Today and Board', async ({ page }) => {
  await onboard(page)
  await assertBodyFillsViewport(page)

  await page.goto('/board')
  await expect(page.getByTestId('strip')).toBeVisible()
  await assertBodyFillsViewport(page)
})

test('before start, Today is the full command center previewing Sprint 1 (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-09-28T09:00:00'))
  await onboard(page, '2026-10-05')

  await expect(page.getByTestId('now-eyebrow')).toContainText('PLAN STARTS 2026-10-05 · SPRINT 1 · DAY 1 OF 14 · AI · watch')
  await expect(page.getByTestId('now-time')).toHaveText('in 7 days · 21:00 – 21:50')
  await expect(page.getByTestId('now-headline')).toHaveText('Watch · 50 min')
  await expect(page.getByTestId('start-button')).toHaveAttribute('href', '/do/stage-00-setup-w1-watch')
  await expect(page.getByTestId('carrot-hp')).toHaveText('6/6')
  await expect(page.getByRole('button', { name: /This sprint · 6 tasks/ })).toBeVisible()
  await expect(page.getByTestId('upcoming-list')).toHaveCount(0)
})

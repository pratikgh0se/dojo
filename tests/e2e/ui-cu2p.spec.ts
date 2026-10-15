import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// Findings of the computer-use UAT re-run cu-2p (the maintainer's UAT report cu-2p). In R1 the Consistency grid, the Pom
// panel, the drawers, Board and the Spar buttons are retired (README "Retired hooks"), so P3-1 (the Retreat tooltip, whose mechanism
// ui-tip-real covers on the Banks chips) and A24/A27 (counts of the retired Today panels and Board columns) are gone; P3-6 stays, as the
// session's Pause and Resume on the ticket's own page (TICKET-07), the one timer (TICKET-08) of the R1 ticket view.
const T0 = IST('2026-10-06T10:00:00')

async function start(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.clock.install({ time: T0 })
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
}

test('P3-6 the session\'s Pause and Resume are on the ticket\'s own page, and fit a phone', async ({ page }) => {
  await start(page)
  await page.getByTestId('start-button').click()
  await expect(page.getByTestId('screen-do')).toBeVisible()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await page.getByTestId('timer-pause').click()
  await expect(page.getByTestId('timer-state')).toHaveText('paused')
  await expect(page.getByTestId('session-phase')).toHaveAttribute('data-paused', 'true')
  await page.getByTestId('timer-resume').click()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('timer-readout')).toHaveCount(1) // one timer on the page (TICKET-08)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  await page.setViewportSize({ width: 375, height: 800 })
  for (const id of ['timer-readout', 'timer-pause', 'timer-end']) {
    const b = (await page.getByTestId(id).boundingBox())!
    expect(b.x, id).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width, id).toBeLessThanOrEqual(375)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

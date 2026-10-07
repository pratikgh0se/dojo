import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// Findings of the computer-use UAT re-run cu-2p (dojo-acceptance/reports/uat/cu-2p.md, c5c1b49). The Consistency grid has its own
// spec in ui-cu2 (P3-2); the Progress minutes, the Notes box and the Deliverable error are vitest (progress, do-study, brief-ui).
const T0 = IST('2026-10-06T10:00:00')

async function start(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.clock.install({ time: T0 })
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
}

test('P3-1 Retreat shows its tooltip on hover, on Today and on Do', async ({ page }) => {
  await start(page)
  await page.getByTestId('spar-25').click()
  await page.getByRole('button', { name: 'Retreat: stop the timer' }).hover()
  await expect(page.getByTestId('tip')).toHaveText('Stop the timer', { timeout: 3000 })
  await page.getByRole('button', { name: 'Retreat: stop the timer' }).click()
  await page.getByTestId('start-button').click()
  await expect(page.getByTestId('screen-do')).toHaveAttribute('data-ready', 'true')
  await page.getByTestId('do-timer-preset-25').click()
  await page.getByRole('button', { name: 'Retreat: stop the timer' }).hover()
  await expect(page.getByTestId('tip')).toHaveText('Stop the timer', { timeout: 3000 })
})

test('P3-6 the session pill, with Pause and Resume, is on the session card\'s own Do page', async ({ page }) => {
  await start(page)
  await page.getByTestId('start-button').click()
  await expect(page.getByTestId('screen-do')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  await dlg.getByLabel('This session I will').fill('trace the queue')
  await dlg.getByRole('button', { name: 'Start' }).click()
  const pill = page.getByTestId('session-dock').getByTestId('session-pill')
  await expect(pill).toBeVisible()
  await expect(pill.getByTestId('session-pill-title')).not.toHaveText('')
  await pill.getByTestId('session-pill-pause').click()
  await expect(pill).toContainText('paused')
  await pill.getByTestId('session-pill-resume').click()
  await expect(pill).not.toContainText('paused')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  await page.setViewportSize({ width: 375, height: 800 })
  await expect(pill).toBeVisible()
  expect((await pill.boundingBox())!.x + (await pill.boundingBox())!.width).toBeLessThanOrEqual(375)
})

test('cu-r1 A24/A27: each count and each Do timer says what it measures', async ({ page }) => {
  await start(page)
  await expect(page.getByTestId('carrot-hp')).toHaveAttribute('data-tip', /plan tasks left this sprint/)
  await expect(page.getByTestId('drawer-tasks').locator('.drawer-count')).toHaveAttribute('data-tip', /done: This sprint/)
  await page.getByRole('link', { name: 'Board' }).first().click()
  await expect(page.getByTestId('head-todo')).toHaveAttribute('data-tip', /cards in .*Sprint \d+/)
  await page.getByRole('link', { name: 'Today' }).first().click()
  await page.getByTestId('start-button').click()
  await expect(page.getByTestId('screen-do')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.timer-row')).toHaveAttribute('data-tip', /Block timer/)
  await expect(page.getByTestId('do-timer-elapsed')).toHaveAttribute('data-tip', /This attempt/)
})

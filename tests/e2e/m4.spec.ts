import { expect, test } from '@playwright/test'
import { IST, idbPatch, onboard, serveLegacyPlan } from './helpers'

const bodyBg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test('M4: dark only: no theme control, and a stored light theme changes nothing', async ({ page }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(IST('2026-09-21T09:00:00'))
  await onboard(page)
  await expect.poll(() => bodyBg(page)).toBe('rgb(15, 17, 28)')
  await expect(page.getByRole('button', { name: /workshop|console|theme/i })).toHaveCount(0)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')

  await page.evaluate(() => localStorage.setItem('theme', 'light'))
  await idbPatch(page, 'settings', ['main'], { theme: 'light' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await expect(page.getByRole('link', { name: 'Today' })).toBeVisible()
  await expect.poll(() => bodyBg(page)).toBe('rgb(15, 17, 28)')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
})

// The header's only progress chips are `level` and `xp-total` (SHELL-07/25), so the threshold crossed here is the level chip going from
// 29 to 30 (and XP from 295 to 305) through the keyboard. Pom's form card has its own `level` (TODAY-50), so the header's is read by scope.
test('M4: cross a level threshold in a keyboard-only Today → Do → Done → destinations session', async ({ page }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(IST('2026-09-21T21:10:00'))
  await onboard(page)

  await idbPatch(page, 'tickets', ['m1w2t1'], { status: 'done', xp: 295, doneAt: IST('2026-09-10T21:00:00').getTime(), doneAtApprox: false })
  await page.reload()
  await expect(page.getByTestId('xp-total')).toHaveAttribute('data-value', '295')
  await expect(page.getByTestId('shell-header').getByTestId('level')).toHaveAttribute('data-value', '29')

  await expect(page.getByTestId('start-button')).toBeVisible() // the quest is on screen before the key goes down
  // keyboard only from here (TODAY-23: Enter on the page body starts the quest)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/do\/m1w1t1$/)
  await expect(page.getByTestId('timer-state')).toHaveText('running') // starting from Today runs the one timer (TICKET-04)
  await expect(page.getByTestId('timer-readout')).toHaveText('25:00')

  let onDone = false
  for (let i = 0; i < 40 && !onDone; i++) {
    await page.keyboard.press('Tab')
    onDone = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'ticket-done')
  }
  expect(onDone).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await expect(page.getByTestId('xp-total')).toHaveAttribute('data-value', '305')
  await expect(page.getByTestId('shell-header').getByTestId('level')).toHaveAttribute('data-value', '30')

  // keys 1 to 4 walk the destinations from the focused button (SHELL-02, SHELL-26); the gear menu reaches Settings from the keyboard
  await page.keyboard.press('1')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('xp-total')).toHaveAttribute('data-value', '305')
  for (const [key, path] of [['2', '/path'], ['5', '/skills'], ['6', '/review']] as const) {
    await page.keyboard.press(key)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
  }
  await page.getByTestId('shell-gear').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('shell-gear-menu')).toBeVisible()
  await page.getByTestId('shell-menu-settings').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings$/)
  await page.getByTestId('screen-settings').waitFor()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('1')
  await expect(page).toHaveURL(/\/$/)
})

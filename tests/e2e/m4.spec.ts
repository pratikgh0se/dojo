import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { IST, idbPatch, onboard, serveLegacyPlan } from './helpers'

const LEGACY_PLAN_PATH = new URL('../fixtures/plan.legacy-2026-09-05.json', import.meta.url)

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

test('M4: cross a form threshold in a keyboard-only Today → Do → Solved → Board session', async ({ page }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(IST('2026-09-21T21:10:00'))
  await onboard(page)

  const plan = JSON.parse(readFileSync(LEGACY_PLAN_PATH, 'utf8')) as {
    sprints: Array<{ ai: Array<{ id: string }> }>
  }
  const earlier = plan.sprints.slice(2).flatMap(s => s.ai.map(t => t.id)).slice(0, 30)
  await idbPatch(page, 'tickets', earlier, { status: 'done', xp: 10, doneAt: IST('2026-09-10T21:00:00').getTime(), doneAtApprox: false })
  await page.reload()
  await expect(page.getByTestId('xp-total')).toHaveText('300 XP')
  await expect(page.getByTestId('form-name')).toHaveText('Pom · BASE')
  await expect(page.getByTestId('form-next')).toContainText('to KINDLE')
  await expect(page.getByTestId('form-next')).toContainText('1 xp')

  // keyboard only from here
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/do\/m1w2t1$/)
  await expect(page.getByTestId('timer-state')).toHaveText('idle') // wait for the Do screen to mount before pressing keys
  await page.keyboard.press('Space')
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('timer-readout')).toHaveText('25:00')

  let onSolved = false
  for (let i = 0; i < 40 && !onSolved; i++) {
    await page.keyboard.press('Tab')
    onSolved = await page.evaluate(() => document.activeElement?.textContent === 'Solved ✓')
  }
  expect(onSolved).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/board$/)
  await expect(page.getByTestId('count-done')).toHaveText('1')

  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('xp-total')).toHaveText('310 XP')
  await expect(page.getByTestId('form-name')).toHaveText('Pom · KINDLE')
  // shell-today-board M8: the Pom canvas is aria-hidden; its label still names the form
  await expect(page.locator('pom-stage[aria-label="Pom, form KINDLE"]')).toBeVisible()

  await page.keyboard.press('2')
  await expect(page).toHaveURL(/\/board$/)
  await page.keyboard.press('0')
  await expect(page).toHaveURL(/\/settings$/)
  await page.keyboard.press('1')
  await expect(page).toHaveURL(/\/$/)
})

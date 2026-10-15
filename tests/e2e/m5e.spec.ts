import { expect, test } from '@playwright/test'
import { IST, onboard } from './helpers'

// M5e smoke (review N6): the legacy screens that sit behind the lazy routes, /dsa /designs /atlas /banks, load without a console error.
// GLOBAL-07 covers only the contract walks, and these routes are reachable from the palette only.
test('M5e: /dsa, /designs, /atlas and /banks each load and log no console error or page error', async ({ page }) => {
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(`${m.location().url} ${m.text()}`) })
  page.on('pageerror', e => errors.push(`pageerror ${e.message}`))
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  for (const route of ['/dsa', '/designs', '/atlas', '/banks']) {
    await page.goto(route)
    await expect(page, route).toHaveURL(new RegExp(`${route}$`)) // none of them is the catch-all redirect
    await page.locator('main h1, main h2').first().waitFor()
    await page.waitForTimeout(300)
    expect(errors, route).toEqual([])
  }
})

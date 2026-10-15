import { expect, test } from '@playwright/test'
import { CLOCK, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the code-blind Electron UAT run 7 (dojo-acceptance/reports/uat/dojo-electron-r7.md, 52c72b0), to
// controller ruling 22 (ui-foundation.md): the Week's second pass (D2) and the mid-week onboarding note (D3).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

test('r7 P3 #1 (R1 polish): on a Tuesday the default start is today with no weekday note or warning, and the start lands on Today with the picked date saved', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(CLOCK.sprint1)) // Tue 2026-10-06
  await page.goto(`/#writer=${srv.token()}`)
  const date = page.getByRole('textbox', { name: 'Start date' })
  await expect(date).toHaveValue('2026-10-06')
  // weekday roles are gone (TODAY-08): no mid-week note, no Monday warning, on the default or on any picked date
  await expect(page.getByTestId('start-date-note')).toHaveCount(0)
  await expect(page.getByTestId('start-date-warn')).toHaveCount(0)
  await expect(page.getByTestId('screen-onboarding')).not.toContainText(/Board|Sprint|AI watch day/)
  await date.fill('2026-10-05')
  await expect(page.getByTestId('start-date-note')).toHaveCount(0)
  await expect(page.getByTestId('start-date-warn')).toHaveCount(0)
  await page.getByRole('button', { name: 'START · PLAN' }).click()
  await expect(date).toBeHidden()
  // the NOW tile's "SPRINT 1 · DAY 2 OF 14" eyebrow is retired (README Retired "Old Today panels"); the start lands on Today and on the disk (SHELL-27)
  await expect(page.getByTestId('screen-today')).toBeVisible()
  await expect.poll(async () => (await rows(srv, 'settings')).find(r => r.id === 'main')?.startDate).toBe('2026-10-05')
  await ctx.close()
})

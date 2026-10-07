import { expect, test } from '@playwright/test'
import { openApp } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-r3 (dojo-acceptance/reports/uat/cu-r3.md), on the real server.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

test('A24: Settings > Backups Restore is full width and at least 44 tall at 393 and 375', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [393, 375]) {
    await page.setViewportSize({ width: w, height: 800 })
    await page.goto('/settings')
    const list = page.getByTestId('backup-list')
    await expect(list.getByRole('button', { name: 'Restore' }).first()).toBeVisible()
    const m = await list.evaluate(ul => {
      const li = ul.querySelector('li')!.getBoundingClientRect()
      const b = ul.querySelector('li button')!.getBoundingClientRect()
      return { h: b.height, bw: b.width, lw: li.width }
    })
    expect(m.h, `height at ${w}`).toBeGreaterThanOrEqual(48) // cu-final row 24: a screenshot reads it ~5% short, so 44 on any reading
    expect(m.bw, `width at ${w}`).toBeGreaterThanOrEqual(m.lw - 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w)
  }
  await ctx.close()
})

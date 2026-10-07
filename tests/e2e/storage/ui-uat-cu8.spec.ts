import { expect, test } from '@playwright/test'
import { openApp } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-8 (dojo-acceptance/reports/uat/cu-8.md, e0a9362: Settings and backups, the menu, persistence).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

test('cu-8 P3-2 / P3-3 / P3-4: Back up now and a restore say so; the pre-restore row reads "Before restore" with the local time on one line; phone Restore buttons are 44 tall', async ({ browser }) => {
  const { page } = await openApp(browser, srv)
  await page.goto('/settings')
  const region = page.getByRole('region', { name: 'Backups' })
  await region.getByRole('button', { name: 'Back up now' }).click()
  await expect(page.getByTestId('toast').filter({ hasText: 'Backup saved' })).toBeVisible()
  await expect(region.getByRole('listitem')).toHaveCount(2)
  const manual = (await (await page.request.get(`${srv.url}/db/backups`)).json() as { backups: { file: string }[] }).backups.find(x => /-\d{6}\.db$/.test(x.file))!
  await region.getByRole('listitem').filter({ hasText: manual.file }).getByRole('button', { name: 'Restore' }).click()
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('dialog', { name: 'Restore this backup?' }).getByRole('button', { name: 'Restore' }).click(),
  ])
  // the page that comes back says what happened
  await expect(page.getByTestId('toast').filter({ hasText: /^Restored dojo-.*Before restore/ })).toBeVisible()
  const pre = region.getByRole('listitem').filter({ hasText: 'Before restore' })
  await expect(pre).toHaveCount(1)
  await expect(pre).not.toContainText('pre-restore-')
  await expect(pre).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  // 1280: name, size and Restore share a line
  const name = (await pre.locator('.bk-name').boundingBox())!
  const btn = (await pre.getByRole('button', { name: 'Restore' }).boundingBox())!
  expect(btn.y, 'Restore stays on the row').toBeLessThan(name.y + name.height)
  // 393: every Restore is a 44 px target and nothing breaks the page width
  await page.setViewportSize({ width: 393, height: 852 })
  await page.reload()
  await expect(region.getByRole('button', { name: 'Restore' }).first()).toBeVisible()
  const heights = await region.getByRole('button', { name: 'Restore' }).evaluateAll(els => els.map(e => e.getBoundingClientRect().height))
  expect(heights.length).toBeGreaterThanOrEqual(2)
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44)
  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > 394).map(e => `${e.tagName}.${(e as HTMLElement).className}:${Math.round(e.getBoundingClientRect().right)}`).slice(0, 8))
  expect(wide).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393)
})

test('cu-8 P3-5: a failed Draft briefs run says it once, in the failure line; the status stays for assistive tech', async ({ browser }) => {
  const { page } = await openApp(browser, srv, undefined, c => c.addInitScript(() => { localStorage.setItem('dojo-ai-fake-fail', 'brief:claude_signed_out') }))
  await page.goto('/board')
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-failed')).toBeVisible()
  const tag = page.getByTestId('brief-progress')
  await expect(tag).toHaveText('Failed')
  const b = (await tag.boundingBox())!
  expect(b.width * b.height, 'the Failed tag is not drawn').toBeLessThanOrEqual(4)
})

import { expect, test } from '@playwright/test'
import { dirname } from 'node:path'
import { openApp } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-1 (dojo-acceptance/reports/uat/cu-1.md, 96c58d5), to controller ruling 23
// (ui-foundation.md), the ones that need the real dojo-server: K5 home-relative paths in Settings.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

test('K5: Settings shows the data file home-relative ("~/…/dojo.db"), never an absolute /Users path', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  // The test home is a temp dir, not the real home: have the server's own report say that the user's home is its parent,
  // so the data file sits inside it as ~/Dojo/dojo.db does for the real app.
  const parent = dirname(srv.home)
  const name = srv.home.slice(parent.length + 1)
  await page.route('**/db/health', async route => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, userHome: parent } })
  })
  await page.goto('/settings')
  await expect(page.getByTestId('storage-status')).toHaveText(`Storage · ~/${name}/dojo.db`)
  await expect(page.getByTestId('data-home')).toContainText(`Your progress lives in ~/${name}/dojo.db.`)
  const text = await page.locator('main').innerText()
  expect(text).not.toContain(srv.home)
  expect(text).not.toContain(parent + '/')
  await ctx.close()
})

test('K5: the real server reports the user\'s home on /db/health, and a data directory outside it stays absolute', async ({ browser }) => {
  const h = await (await fetch(`${srv.url}/db/health`)).json() as { userHome: string; home: string }
  expect(h.userHome).toBe((await import('node:os')).homedir())
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/settings')
  await expect(page.getByTestId('storage-status')).toHaveText(`Storage · ${srv.home}/dojo.db`) // a temp dir is outside the home
  await ctx.close()
})

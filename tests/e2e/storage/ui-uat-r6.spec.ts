import { expect, test, type Page } from '@playwright/test'
import { draftSprint1, openApp, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the code-blind Electron UAT run 6 (dojo-acceptance/reports/uat/dojo-electron-r6.md, 00bf9e7), to
// controller ruling 21 (ui-foundation.md): the split parent's Do screen has no help ladder (r6 P3 #1).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

const PAID = /^Open (Hint|Picture|Video|Solution)/

/** Clicks an Open ▸ link with the app's own click handling, but keeps the new tab from loading the site (as r6 did). */
async function clickOpenLink(page: Page) {
  await page.evaluate(() => document.addEventListener('click', e => e.preventDefault(), { once: true }))
  await page.locator('.open-row .open-link').first().click()
}

test('r6 P3 #1 / ruling 21: a split card\'s Do screen has no help ladder, and Open ▸ on it unlocks nothing', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  await ed.getByRole('spinbutton', { name: 'Minutes' }).fill('35')
  await ed.getByRole('button', { name: 'Save' }).click()
  await expect(ed).toBeHidden()
  await expect(page.getByTestId('ladder')).toBeVisible() // before the split, the card has its ladder

  // split on this screen, as r6 did on p417
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).children?.length).toBe(3)
  await expect(page.getByTestId('split-sessions')).toBeVisible()
  await expect(page.getByTestId('ladder')).toHaveCount(0)
  await expect(page.getByRole('button', { name: PAID })).toHaveCount(0)

  await clickOpenLink(page)
  await page.waitForTimeout(300)
  await expect(page.getByTestId('ladder')).toHaveCount(0)
  await expect(page.getByRole('button', { name: PAID })).toHaveCount(0)
  await expect(page.getByTestId('timer-readout')).toHaveText('--:--')

  // a fresh visit: still no ladder, and Open ▸ still unlocks nothing
  await page.goto('/do/p200')
  await expect(page.getByTestId('split-sessions')).toBeVisible()
  await expect(page.getByTestId('ladder')).toHaveCount(0)
  await clickOpenLink(page)
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: PAID })).toHaveCount(0)
  await expect(page.getByTestId('timer-readout')).toHaveText('--:--')
  expect((await rows(srv, 'rungUses')).filter(u => u.ticketId === 'p200')).toEqual([])
  expect((await ticket(srv, 'p200')).status).toBe('todo')

  // help is spent on the parts: each keeps its own ladder
  await page.getByTestId('split-sessions').getByTestId('do-p200~1').click()
  await page.waitForURL(/\/do\/p200~1$/)
  await expect(page.getByTestId('ladder')).toBeVisible()
  await expect(page.getByTestId('ladder-rung-hint')).toHaveAttribute('data-state', 'locked')
  await ctx.close()
})

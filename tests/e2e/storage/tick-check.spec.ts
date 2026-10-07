import { expect, test, type BrowserContext } from '@playwright/test'
import { ServerHarness } from './harness'

// The black-box storage suite ticks Today's tasks with locator.check(), which reads the checkbox
// state right after the click. Served by dojo-server (disk sync on, the Dock launcher's path), the
// state used to flip only when the IndexedDB write's live query re-rendered, a few ms too late.
let srv: ServerHarness
let ctx: BrowserContext | null = null
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await ctx?.close(); ctx = null; await srv.dispose() })

test('Today ticks work with check()/uncheck() on a fresh database (black-box steps)', async ({ browser }) => {
  ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date('2026-10-14T10:00:00+05:30'))
  await page.goto(`/#writer=${srv.token()}`) // the launcher's URL (Addendum 3)
  await expect(page).toHaveURL(srv.url + '/') // the token is taken out of the address bar
  const date = page.getByRole('textbox', { name: 'Start date' })
  await date.fill('2026-10-05')
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await date.waitFor({ state: 'hidden' })
  const drawer = page.getByTestId('drawer-tasks')
  const toggle = drawer.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  for (let i = 0; i < 3; i++) {
    const box = drawer.getByRole('checkbox', { name: /^Done: /, checked: false }).first()
    const name = (await box.getAttribute('aria-label'))!
    await box.check()
    const same = drawer.getByRole('checkbox', { name, exact: true })
    await expect(same).toBeChecked()
    await expect(page.getByTestId('save-status')).toHaveText('Saved')
    if (i === 0) {
      await same.uncheck()
      await expect(same).not.toBeChecked()
      await expect(page.getByTestId('save-status')).toHaveText('Saved')
    }
  }
  const doneOnDisk = async () => ((await (await fetch(`${srv.url}/db/state`)).json()).tables.tickets as { status: string }[]).filter(t => t.status === 'done').length
  await expect.poll(doneOnDisk).toBe(2)
})

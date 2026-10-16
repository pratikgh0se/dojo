import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ServerHarness } from './harness'

// R1 retarget of the old Today tick-box black-box test (README "Retired hooks": the Today tick drawers and boxes are gone).
// The surviving intent: served by dojo-server (disk sync on, the Dock launcher's path) a completion control flips its visible
// state right after the click (no waiting for the IndexedDB live query), the page settles on "Saved", and the done tickets reach
// the disk. Completion is now `ticket-done` on the ticket view (TICKET-10), reached from Today's `start-button` (TICKET-04);
// for watch/read tickets the explain-it-simply answer-first gate (TICKET-15) is exercised in the same pass.
let srv: ServerHarness
let ctx: BrowserContext | null = null
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await ctx?.close(); ctx = null; await srv.dispose() })

const doneOnDisk = async (srv: ServerHarness) =>
  ((await (await fetch(`${srv.url}/db/state`)).json()).tables.tickets as { status: string }[]).filter(t => t.status === 'done').length

/** Today -> START -> (explain gate when the ticket has questions) -> DONE; returns the ticket id. */
async function startAndFinishQuest(page: Page): Promise<{ id: string; explained: boolean }> {
  await page.getByTestId('start-button').click()
  await expect(page).toHaveURL(/\/do\/[^/?#]+$/)
  const id = decodeURIComponent(new URL(page.url()).pathname.split('/')[2])
  await expect(page.getByTestId('ticket-done')).toBeVisible()
  await expect(page.getByTestId('ticket-start')).toHaveCount(0)
  const explained = (await page.getByTestId('ticket-explain').count()) > 0
  if (explained) {
    // TICKET-15: answer first. Reveal stays disabled until every answer box holds text, then it works.
    await expect(page.getByTestId('ticket-reveal')).toBeDisabled()
    const boxes = page.locator('[data-testid^="ticket-explain-answer-"]')
    const n = await boxes.count()
    for (let i = 0; i < n; i++) await boxes.nth(i).fill('in my own words')
    await expect(page.getByTestId('ticket-reveal')).toBeEnabled()
    await page.getByTestId('ticket-reveal').click()
    await expect(page.getByTestId('ticket-reference-1')).toBeVisible()
  }
  // R2: a build ticket of a lab the server knows gates Done on its checks; "Mark done without checks" finishes it without them (LAB-23)
  const done = page.getByTestId('ticket-done')
  const skip = page.getByTestId('ticket-lab-skip-checks')
  await expect(async () => { expect((await done.isEnabled()) || (await skip.isVisible())).toBe(true) }).toPass()
  if (await done.isEnabled()) await done.click()
  else await skip.click()
  // the state flips with the click, not a live query later (the original bug this test guards)
  await expect(page.getByTestId('ticket-done-state')).toBeVisible({ timeout: 2000 })
  await expect(page.getByTestId('ticket-done')).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  return { id, explained }
}

test('Done on the ticket view works on a fresh disk database: the state flips with the click, settles on Saved and reaches the disk (black-box steps)', async ({ browser }) => {
  ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date('2026-10-14T10:00:00+05:30'))
  await page.goto(`/#writer=${srv.token()}`) // the launcher's URL (Addendum 3)
  await expect(page).toHaveURL(srv.url + '/') // the token is taken out of the address bar
  const date = page.getByRole('textbox', { name: 'Start date' })
  await date.fill('2026-10-05')
  await page.getByRole('button', { name: 'START · PLAN' }).click()
  await date.waitFor({ state: 'hidden' })
  await expect(page.getByTestId('screen-today')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  expect(await doneOnDisk(srv)).toBe(0)

  const seen: string[] = []
  for (let i = 0; i < 2; i++) {
    const { id, explained } = await startAndFinishQuest(page)
    test.info().annotations.push({ type: `quest-${i + 1}`, description: `${id} explain-gate=${explained}` })
    seen.push(id)
    await expect.poll(() => doneOnDisk(srv)).toBe(i + 1)
    await page.getByTestId('do-back').click()
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await expect(page.getByTestId('today-quest')).toBeVisible() // another quest is offered
  }
  expect(new Set(seen).size).toBe(2) // a finished ticket does not come back as the next quest
})

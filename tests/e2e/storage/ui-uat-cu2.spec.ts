import { expect, test } from '@playwright/test'
import { openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-2 (dojo-acceptance/reports/uat/cu-2.md, 96c58d5), to controller ruling 24
// (ui-foundation.md), the ones that need the real dojo-server: S1 a running session survives a reload (and a quit) with
// the pill. (P3-10, the check dialog's question labels, is retired with the learning-card "Mark done" check: see the S-C decisions.)
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

test('S1: a reload during a running ticket timer keeps the pill, Today\'s resume quest and the right time, against the real server', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p200')
  await page.getByTestId('ticket-start').click() // the one start control (TICKET-03): a session at the remembered length
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('session-timer')).toBeVisible()
  await page.getByTestId('do-back').click() // leave Do (a direct visit has no earlier screen, so Back lands on Today)
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('session-pill')).toBeVisible()
  await expect(page.getByTestId('today-quest')).toHaveAttribute('data-action', 'resume') // TICKET-13: Today resumes the ticket in progress
  const before = await page.getByTestId('session-pill-time').textContent()
  await page.reload()
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('session-pill')).toBeVisible()
  await expect(page.getByTestId('today-quest')).toHaveAttribute('data-action', 'resume')
  await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus')
  const secs = (s: string | null) => Number(s!.slice(0, 2)) * 60 + Number(s!.slice(3, 5))
  expect(Math.abs(secs(await page.getByTestId('session-pill-time').textContent()) - secs(before))).toBeLessThanOrEqual(5)
  // other screens, after the reload (the Board and Progress are retired: Path and Review stand in)
  for (const path of ['/path', '/review']) {
    await page.goto(path)
    await expect(page.getByTestId('session-pill'), path).toBeVisible()
  }
  // End from the pill's card ends it for good: the row is on the disk, the pill is gone after another reload
  await page.getByTestId('session-pill-link').click()
  await page.getByTestId('session-end').click()
  const end = page.getByRole('dialog', { name: 'End session' })
  await end.getByRole('textbox', { name: 'Done' }).fill('survived')
  await end.getByRole('button', { name: 'Save' }).click()
  await expect(end).toBeHidden()
  await expect.poll(async () => (await rows(srv, 'sessions')).filter(s => s.outcome === 'studied').length).toBe(1)
  await page.reload()
  await expect(page.getByTestId('session-pill')).toHaveCount(0)
  await expect(page.getByTestId('timer-state')).toHaveText('ready')
  await ctx.close()
})

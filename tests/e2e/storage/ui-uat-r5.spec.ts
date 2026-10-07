import { expect, test, type Page } from '@playwright/test'
import { draftSprint1, openApp, putTicket, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the code-blind Electron UAT run 5 (dojo-acceptance/reports/uat/dojo-electron-r5.md, b179041), to
// controller ruling 20 (ui-foundation.md): an even split, and what a split card's Do screen offers.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

/** p200 with a drafted brief set to `min` minutes, through Edit brief. */
async function p200At(page: Page, min: number) {
  await draftSprint1(page)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  await ed.getByRole('spinbutton', { name: 'Minutes' }).fill(String(min))
  await ed.getByRole('button', { name: 'Save' }).click()
  await expect(ed).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).brief?.minutes).toBe(min)
}

test('r5 P3 #4 / ruling 20 S1: a 110-min card whose brief proposes 50 + 60 splits evenly, 55 + 55', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await p200At(page, 110)
  const t = await ticket(srv, 'p200')
  await putTicket(srv, { ...t, brief: { ...t.brief, splitSuggestion: [{ title: 'Build', minutes: 50 }, { title: 'Break', minutes: 60 }] } })
  await page.reload()
  await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await expect(sp.getByRole('spinbutton', { name: 'Parts' })).toHaveValue('2')
  await expect(sp.getByTestId('split-preview')).toHaveText(/^Cut this card into 2 sessions \(55 and 55 min\)\./)
  await sp.getByRole('spinbutton', { name: 'Parts' }).fill('3')
  await expect(sp.getByTestId('split-preview')).toHaveText(/^Cut this card into 3 sessions \(37, 37 and 36 min\)\./)
  await sp.getByRole('spinbutton', { name: 'Parts' }).fill('2')
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).children?.length).toBe(2)
  const kids = (await rows(srv, 'tickets')).filter(k => k.childOf === 'p200').sort((a, b) => a.id.localeCompare(b.id))
  expect(kids.map(k => [k.title, k.estMin])).toEqual([['Build', 55], ['Break', 55]]) // the proposal's titles stay
  await ctx.close()
})

test('r5 P3 #3: a split card\'s Do screen has no timer or outcomes; it lists its sessions, ✓ on the done ones', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await p200At(page, 35)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).children?.length).toBe(3)
  // solve part 1
  await page.goto('/do/p200~1')
  await page.getByTestId('do-outcome-solved').click()
  await expect.poll(async () => (await ticket(srv, 'p200~1')).status).toBe('done')

  await page.goto('/do/p200')
  const list = page.getByTestId('split-sessions')
  await expect(list.getByTestId('split-parent-note')).toHaveText('Split into 3 sessions — work on them one by one:')
  const items = list.locator('li')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toHaveText('200 · Number of Islands · part 1 of 3 · 12 min · ✓ done')
  await expect(items.nth(1)).toHaveText('200 · Number of Islands · part 2 of 3 · 12 min')
  await expect(items.nth(2)).toHaveText('200 · Number of Islands · part 3 of 3 · 11 min')
  // the brief stays readable
  await expect(page.getByTestId('card-brief')).toBeVisible()
  await expect(page.getByTestId('card-brief').getByTestId('brief-goal')).toHaveText(/Number of Islands/)
  // nothing that would only refuse: no timer starts, no Start session, no outcome buttons
  await expect(page.getByTestId('start-session')).toHaveCount(0)
  await expect(page.getByTestId('do-timer-preset-25')).toHaveCount(0)
  await expect(page.getByTestId('do-timer-preset-50')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start custom' })).toHaveCount(0)
  for (const id of ['do-outcome-solved', 'do-outcome-help', 'do-outcome-giveup']) await expect(page.getByTestId(id)).toHaveCount(0)
  // Space (start/pause the timer elsewhere) starts nothing here and raises no refusal toast
  await page.locator('body').press(' ')
  await expect(page.getByText('This card was split', { exact: false })).toHaveCount(0)
  // each session is one click away
  await list.getByTestId('do-p200~2').click()
  await page.waitForURL(/\/do\/p200~2$/)
  await expect(page.getByTestId('do-outcome-solved')).toBeVisible()
  await expect(page.getByTestId('do-timer-preset-25')).toBeVisible()
  await ctx.close()
})

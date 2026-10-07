import { expect, test, type Page } from '@playwright/test'
import { CLOCK, draftSprint1, openApp, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the code-blind Electron UAT run 7 (dojo-acceptance/reports/uat/dojo-electron-r7.md, 52c72b0), to
// controller ruling 22 (ui-foundation.md): the day plan after a split (D1), the Week's second pass (D2) and the
// mid-week onboarding note (D3).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

/** LC 200 with a drafted brief cut to 35 min, split into `parts` on its Do screen (the r7 card). */
async function splitP200(page: Page, parts = 3) {
  await draftSprint1(page)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  await ed.getByRole('spinbutton', { name: 'Minutes' }).fill('35')
  await ed.getByRole('button', { name: 'Save' }).click()
  await expect(ed).toBeHidden()
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.getByRole('spinbutton', { name: 'Parts' }).fill(String(parts))
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).children?.length).toBe(parts)
}

const weekItems = (page: Page, day: string) => page.getByTestId(`day-${day}`).locator('.week-picks > li > a')

test('r7 P2 #1 / ruling 22 D1: a split card\'s open parts take its place in Today and Week; 695 stays; a done part drops out', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv) // Tue 2026-10-06, start Mon 10-05: Interview · code
  await page.goto('/')
  await expect(page.getByTestId('now-headline')).toHaveText('Code · 2 × 25 min')
  await expect(page.getByTestId('now-text')).toHaveText('Two timed problems, 25 min each, no agent: 200 Number of Islands · 695 Max Area of Island')
  await page.goto('/week')
  await expect(weekItems(page, 'Tue')).toHaveText(['200 · Number of Islands', '695 · Max Area of Island'])

  await splitP200(page, 3)
  // Today: the block keeps its size; its parts stand where 200 stood, 695 after them; NOW names the first open item
  await page.goto('/')
  await expect(page.getByTestId('now-headline')).toHaveText('Code · 2 × 25 min')
  await expect(page.getByTestId('now-text')).toHaveText(
    'Two timed problems in four sessions, no agent: 200 · Number of Islands — part 1 of 3 · 12 min, part 2 of 3 · 12 min, part 3 of 3 · 11 min · 695 Max Area of Island',
  )
  await expect(page.getByTestId('now-time')).toHaveText('21:00 – 21:50') // G6: the shipped sample plan's block (schedule.block)
  // Week: the same on Tuesday, the day 200 had
  await page.goto('/week')
  await expect(weekItems(page, 'Tue')).toHaveText([
    '200 · Number of Islands · part 1 of 3', '200 · Number of Islands · part 2 of 3', '200 · Number of Islands · part 3 of 3', '695 · Max Area of Island',
  ])

  // Start opens part 1; finish it, and it drops out of the slot
  await page.goto('/')
  await page.getByTestId('start-button').click()
  await page.waitForURL(/\/do\/p200~1$/)
  await page.getByTestId('do-outcome-solved').click()
  await expect.poll(async () => (await ticket(srv, 'p200~1')).status).toBe('done')
  await page.goto('/')
  await expect(page.getByTestId('now-headline')).toHaveText('Code · 2 × 25 min')
  await expect(page.getByTestId('now-text')).toHaveText(
    'Two timed problems in three sessions, no agent: 200 · Number of Islands — part 2 of 3 · 12 min, part 3 of 3 · 11 min · 695 Max Area of Island',
  )
  await expect(page.getByTestId('start-button')).toHaveAttribute('href', /\/do\/p200~2$/)
  await page.goto('/week')
  await expect(weekItems(page, 'Tue')).toHaveText(['200 · Number of Islands · part 2 of 3', '200 · Number of Islands · part 3 of 3', '695 · Max Area of Island'])
  await expect(page.locator('.week-picks a', { hasText: 'part 1 of 3' })).toHaveCount(0)
  await ctx.close()
})

test('r7 P3 #2 / ruling 22 D2: Week marks the plan\'s second pass at a card with "↻ again"', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/week')
  // the routine card is Thursday's, and Sunday re-solves it from memory
  const thu = page.getByTestId('day-Thu')
  const sun = page.getByTestId('day-Sun')
  await expect(thu.getByRole('link', { name: /^Set the routine/ })).toBeVisible()
  await expect(thu.locator('.week-again')).toHaveCount(0)
  await expect(sun.getByRole('link', { name: /^Set the routine/ })).toBeVisible()
  const chip = page.getByTestId('again-Sun-m1w1i1')
  await expect(chip).toHaveText('↻ again')
  await expect(chip).toHaveAttribute('data-tip', 'Second pass: re-solve it from memory')
  // the first listing of every card is unmarked; AI days have no second pass
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Sat']) await expect(page.getByTestId(`day-${d}`).locator('.week-again')).toHaveCount(0)
  // the chip sits on the card's own row, after its link
  const row = sun.locator('li', { has: chip })
  await expect(row.getByRole('link')).toHaveText(/^Set the routine/)
  await ctx.close()
})

test('r7 P3 #1 / ruling 22 D3: on a Tuesday the default start (Monday just gone) says why', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(CLOCK.sprint1)) // Tue 2026-10-06
  await page.goto(`/#writer=${srv.token()}`)
  const date = page.getByRole('textbox', { name: 'Start date' })
  await expect(date).toHaveValue('2026-10-05')
  const note = page.getByTestId('start-date-note')
  await expect(note).toHaveText("Week 1 started on Monday; its first day's items are on the Board.")
  await expect(date).toHaveAttribute('aria-describedby', 'onboarding-note')
  await expect(page.getByTestId('start-date-warn')).toHaveCount(0)
  // another date: the note goes (today, a Tuesday, gets the ruling-21 warning instead)
  await date.fill('2026-10-06')
  await expect(note).toHaveCount(0)
  await expect(page.getByTestId('start-date-warn')).toBeVisible()
  await date.fill('2026-10-05')
  await expect(note).toBeVisible()
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await expect(date).toBeHidden()
  await expect(page.getByTestId('now-eyebrow')).toContainText('SPRINT 1 · DAY 2 OF 14')
  await ctx.close()
})

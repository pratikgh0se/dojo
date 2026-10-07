import { expect, test } from '@playwright/test'
import { CLOCK, draftSprint1, learningCard, openApp, putTicket, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// The shell-today-board rerun on 48cae36 (reports/ui/shell-today-board/findings.md, rulings 9 and 11).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

test('F9/F10: Spar buttons are default 36 on desktop and tablet; Start ▸ stays 40; phone 44', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const [w, spar, start] of [[1280, 36, 40], [834, 36, 40], [393, 44, 44]] as const) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/')
    for (const id of ['spar-50', 'spar-25']) expect(Math.round((await page.getByTestId(id).boundingBox())!.height), `${id} ${w}`).toBe(spar)
    expect(Math.round((await page.getByTestId('start-button').boundingBox())!.height), `start ${w}`).toBe(start)
  }
  await ctx.close()
})

test('M25: Check your understanding with no questions has one actions row: flex, gap 8, wrap, Edit brief then Cancel', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await putTicket(srv, learningCard('w-noq', 'No questions'))
  await page.reload()
  await draftSprint1(page)
  const t = await ticket(srv, 'w-noq')
  await putTicket(srv, { ...t, brief: { ...t.brief, questions: [] } }) // seeded: a watch card whose brief lost its questions
  await page.reload()
  await page.goto('/do/w-noq')
  await page.getByTestId('card-brief').getByRole('button', { name: 'Mark done' }).click()
  const dlg = page.getByRole('dialog', { name: 'Check your understanding' })
  await expect(dlg.getByTestId('check-no-questions')).toBeVisible()
  const edit = dlg.getByRole('button', { name: 'Edit brief' })
  const row = edit.locator('xpath=..')
  expect(await row.evaluate(e => [getComputedStyle(e).display, getComputedStyle(e).columnGap, getComputedStyle(e).flexWrap])).toEqual(['flex', '8px', 'wrap'])
  await expect(row.getByRole('button')).toHaveText(['Edit brief', 'Cancel'])
  await ctx.close()
})

test('M4: the Plan custom-minutes error and the Split parts error show below the field, on input, blur and submit', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  await dlg.getByRole('radio', { name: 'Custom' }).check()
  const focus = dlg.getByLabel('Focus minutes')
  await focus.fill('0') // min/max are back (Q20), so arrow keys clamp; a typed value still raises the app's own error
  const err = dlg.locator('p.form-error[role="alert"]')
  await expect(err).toHaveText('Focus minutes must be 1 to 180.')
  expect(await err.evaluate(e => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize, getComputedStyle(e).color])).toEqual([expect.stringMatching(/Space Mono/), '14px', 'rgb(255, 112, 112)'])
  await focus.fill('25')
  await expect(err).toHaveCount(0)
  await focus.fill('0')
  await dlg.getByTestId('plan-start').click()
  await expect(err).toBeVisible()
  await page.keyboard.press('Escape')
  await putTicket(srv, { ...learningCard('w-split', 'Long read'), estMin: 180 })
  await page.reload()
  await draftSprint1(page)
  await page.goto('/do/w-split')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  const parts = sp.getByLabel('Parts')
  await parts.fill('13')
  const perr = sp.locator('p.p-err[role="alert"]')
  await expect(perr).toHaveText(/^Split into 2 to \d+ parts$/)
  await parts.fill('6') // ruling 20 S2: max min(8, ⌊60/10⌋) = 6 for the 60-min brief
  await expect(perr).toHaveCount(0)
  await parts.fill('20')
  await parts.blur()
  await expect(perr).toBeVisible()
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(perr).toBeVisible()
  await ctx.close()
})

test('M17: brief-progress shares the Draft briefs row at 800 and 834', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [800, 834]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/board')
    await page.evaluate(() => localStorage.setItem('dojo-ai-fake-delay-ms', '400'))
    const btn = page.getByRole('button', { name: /^Draft briefs for Sprint/ })
    await btn.click()
    const prog = page.getByTestId('brief-progress')
    await prog.waitFor()
    const [b, p] = [(await btn.boundingBox())!, (await prog.boundingBox())!]
    expect(Math.abs((b.y + b.height / 2) - (p.y + p.height / 2)), `${w}`).toBeLessThanOrEqual(6)
    // the first pass drafts the sprint; the second has nothing left to draft and says so (UAT cu-3 P3-1): same row either way
    await prog.filter({ hasText: /^(Done|Every card in Sprint \d+ already has a brief)$/ }).waitFor({ timeout: 60_000 })
  }
  await ctx.close()
})

test('final Q20/Q21: Focus, Break and Parts expose their range; the DL1 error is form-error; errors also fire on blur', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  await dlg.getByRole('radio', { name: 'Custom' }).check()
  for (const [name, min, max] of [['Focus minutes', '1', '180'], ['Break minutes', '1', '60']]) {
    const f = dlg.getByRole('spinbutton', { name })
    await expect(f).toHaveAttribute('min', min)
    await expect(f).toHaveAttribute('max', max)
  }
  await dlg.getByLabel('Break minutes').fill('99')
  await dlg.getByLabel('Break minutes').blur()
  await expect(dlg.getByTestId('form-error')).toHaveText('Break minutes must be 1 to 60.')
  await page.keyboard.press('Escape')
  await putTicket(srv, { ...learningCard('w-split2', 'Long read'), estMin: 180 })
  await page.reload()
  await draftSprint1(page)
  await page.goto('/do/w-split2')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const parts = page.getByRole('dialog', { name: 'Split into sessions' }).getByRole('spinbutton', { name: 'Parts' })
  await expect(parts).toHaveAttribute('min', '2')
  await expect(parts).toHaveAttribute('max', '6') // ruling 20 S2: min(8, ⌊60/10⌋)
  await ctx.close()
})

test('final (ruling 23 K3 replaces "wraps"): the NOW tile Open link is one line inside the tile at 393, 375 and 320, and a 44 px target', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [393, 375, 320]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/')
    const open = page.getByTestId('open-link')
    await open.waitFor()
    const label = open.locator('.now-open-label')
    // the heavy-load lead's label (findings 9/10), then one far longer than the tile: never a second line, never past the tile
    for (const text of ['Open · LeetCode 207 ↗', 'Open · A very long link label that cannot fit the phone tile at all ↗']) {
      await label.evaluate((e, t) => { e.textContent = t }, text)
      const b = (await open.boundingBox())!
      expect(b.height, `${w} ${text}`).toBeGreaterThanOrEqual(44)
      expect(b.height, `${w} ${text}`).toBeLessThanOrEqual(44.5)
      expect(await label.evaluate(e => e.getBoundingClientRect().height), `${w} ${text}`).toBeLessThan(26)
      const tile = (await page.locator('.now-tile').boundingBox())!
      expect(b.x + b.width, `${w} ${text}`).toBeLessThanOrEqual(tile.x + tile.width + 0.5)
    }
  }
  await ctx.close()
})

test('final: the roll-over line renders deterministically when the first server read is slow (local copy rendered first)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await expect(page.getByTestId('now-headline')).toBeVisible()
  await page.clock.setSystemTime(new Date(CLOCK.sprint2))
  await page.route('**/db/state', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue().catch(() => {}) })
  await page.reload()
  await expect(page.getByTestId('rolled-note')).toHaveText(/^\d+ cards rolled from Sprint 1$/, { timeout: 15_000 })
  await expect.poll(async () => (await rows(srv, 'tickets')).filter(t => (t.rolledFrom ?? []).includes(1)).length, { timeout: 15_000 }).toBeGreaterThan(0)
  await page.waitForTimeout(2500)
  await expect(page.getByTestId('rolled-note')).toBeVisible()
  await ctx.close()
})

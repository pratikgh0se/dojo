import { expect, test, type Browser, type Locator } from '@playwright/test'
import { CLOCK, openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// The settings-progress-ref rerun on 48cae36 (reports/ui/settings-progress-ref/findings.md, Controller ruling 11).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

const css = (l: Locator, prop: string) => l.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
const PHONE = { width: 393, height: 852 }

async function freshContext(browser: Browser, writer: boolean, state: 'fail' | 'hold') {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(CLOCK.sprint1))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  await page.route('**/db/state', async route => {
    if (state === 'fail') return route.fulfill({ status: 500, body: '{"error":"boom"}', contentType: 'application/json' })
    await held
    await route.continue().catch(() => {})
  })
  return { ctx, page, release, url: writer ? `/#writer=${srv.token()}` : '/' }
}

test('R7 / Q10: no local copy and /db/state answering 500 shows the error card, never onboarding (writer and read-only)', async ({ browser }) => {
  const { ctx } = await openApp(browser, srv) // the server is onboarded
  await ctx.close()
  for (const writer of [true, false]) {
    for (const path of ['', 'path', 'skills', 'review', 'settings']) { // R1 destinations (the Board and Progress routes redirect, SHELL-20)
      const f = await freshContext(browser, writer, 'fail')
      await f.page.goto(writer ? `/${path}#writer=${srv.token()}` : `/${path}`)
      const fatal = f.page.locator('.fatal')
      await expect(fatal, `${writer} ${path}`).toBeVisible({ timeout: 20_000 })
      await expect(fatal.getByRole('heading', { level: 1 })).toHaveText("Dojo couldn't start")
      await expect(fatal).toContainText('Reading the saved data from the Dojo server failed.')
      await expect(fatal.locator('ol li')).toHaveCount(3)
      expect(await css(fatal.locator('.fatal-msg'), 'font-size')).toBe('15px')
      await expect(f.page.getByText('Pick your start date')).toHaveCount(0)
      await f.ctx.close()
    }
  }
})

test('F7: the loading line is Space Mono 15', async ({ browser }) => {
  const { ctx } = await openApp(browser, srv)
  await ctx.close()
  const f = await freshContext(browser, false, 'hold')
  await f.page.goto('/settings')
  const loading = f.page.locator('p.loading')
  await expect(loading).toBeVisible({ timeout: 5000 })
  expect(await css(loading, 'font-size')).toBe('15px')
  expect(await css(loading, 'font-family')).toMatch(/Space Mono/)
  f.release()
  await f.ctx.close()
})

test('Phone sizes: DSA heat cells 20 drawn / 44 hit, ticks and links 44; bank cells 44; Settings inputs (start date, lane budgets, session minutes) and Atlas search 44', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize(PHONE)
  await page.goto('/dsa?topic=2')
  const cell = page.getByTestId('cell-p200')
  const cb = (await cell.boundingBox())!
  expect(Math.round(cb.width)).toBeGreaterThanOrEqual(44)
  expect(await cell.evaluate(e => [getComputedStyle(e, '::before').width, getComputedStyle(e, '::before').height])).toEqual(['20px', '20px'])
  const edges = async (sel: string) => page.locator(sel).evaluateAll(els => els.slice(0, 6).flatMap(c => {
    c.scrollIntoView({ block: 'center' })
    const r = c.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    return [[cx - 22, cy], [cx + 22, cy], [cx, cy - 22], [cx, cy + 22]].filter(([x, y]) => document.elementFromPoint(x, y) !== c).map(() => (c as HTMLElement).dataset.testid)
  }))
  expect(await edges('button.heat-cell:not([disabled])')).toEqual([])
  const detail = page.getByTestId('topic-detail')
  const tick = detail.locator('.tick').first()
  expect(Math.round((await tick.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  expect(Math.round((await tick.boundingBox())!.width)).toBeGreaterThanOrEqual(44)
  expect(Math.round((await detail.locator('.trow').getByRole('link', { name: /LeetCode/ }).first().boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  await page.goto('/banks')
  const bc = page.locator('[data-testid^="bank-cell-"]').first()
  const bb = (await bc.boundingBox())!
  expect(Math.round(bb.width)).toBeGreaterThanOrEqual(44)
  expect(Math.round(bb.height)).toBeGreaterThanOrEqual(44)
  expect(await edges('[data-testid^="bank-cell-"]')).toEqual([])
  const btick = page.getByTestId('bank-item-tick').first()
  const tb = (await btick.boundingBox())!
  expect([Math.round(tb.width), Math.round(tb.height)]).toEqual([20, 20])
  expect(await css(btick, 'accent-color')).toBe('rgb(255, 138, 42)')
  for (const id of ['bank-item-link', 'bank-item-inplan']) expect(Math.round((await page.getByTestId(id).first().boundingBox())!.height), id).toBeGreaterThanOrEqual(44)
  await page.goto('/settings')
  // the sprint "Core minutes" input is retired; the pace section's weekly lane budgets and the session length replace it (SET-01, SET-06)
  for (const [label, input] of [
    ['Start date', page.getByRole('textbox', { name: 'Start date' })],
    ['Monday budget', page.getByTestId('settings-budget-1')],
    ['Saturday budget', page.getByTestId('settings-budget-6')],
    ['Session minutes', page.getByTestId('settings-session-minutes')],
  ] as const) {
    expect(Math.round((await input.boundingBox())!.height), label).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'Settings does not scroll sideways at 393').toBeLessThanOrEqual(PHONE.width)
  await page.goto('/atlas')
  expect(Math.round((await page.getByRole('searchbox').first().boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  await page.setViewportSize({ width: 1280, height: 900 })
  expect(Math.round((await page.getByRole('searchbox').first().boundingBox())!.height)).toBe(36)
  await ctx.close()
})

test('closing rerun: the Banks "Source ↗" link is a 44 x 44 tap target on phone', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [560, 393, 375]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/banks?bank=neetcode150')
    const link = page.getByTestId('banks-source-link')
    await link.waitFor()
    const b = (await link.boundingBox())!
    expect(Math.round(b.width), `${w}`).toBeGreaterThanOrEqual(44)
    expect(Math.round(b.height), `${w}`).toBeGreaterThanOrEqual(44)
  }
  await ctx.close()
})

test('closing rerun Q28: on phone the error card keeps the 16 px side gutter', async ({ browser }) => {
  const { ctx } = await openApp(browser, srv)
  await ctx.close()
  const f = await freshContext(browser, false, 'fail')
  for (const w of [393, 375, 560]) {
    await f.page.setViewportSize({ width: w, height: 800 })
    await f.page.goto('/')
    const card = f.page.locator('.fatal')
    await card.waitFor({ timeout: 20_000 })
    const b = (await card.boundingBox())!
    expect(Math.round(b.x), `${w}`).toBe(16)
    expect(Math.round(w - (b.x + b.width)), `${w}`).toBe(16)
  }
  await f.ctx.close()
})


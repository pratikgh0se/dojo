import { expect, test } from '@playwright/test'
import { openApp } from './briefs-helpers'
import { ServerHarness } from './harness'

// The shell-today-board rerun on 48cae36 (reports/ui/shell-today-board/findings.md, rulings 9 and 11).
// R1 (S2 wave 2): Spar buttons (F9/F10), the Plan dialog (M4, final Q20/Q21) and the learning-card Check dialog (M25) are retired
// (README Retired "Old Today panels", "More timers and dialogs removed by one timer"). What survives is the size of the one Start
// button on Today and the one-line resource link on the quest card.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

test('F9/F10: Start is the default 36 on desktop and tablet and the 44 full-width phone button (TODAY-30)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const [w, h] of [[1280, 36], [834, 36], [393, 44], [375, 44]] as const) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/')
    const b = (await page.getByTestId('start-button').boundingBox())!
    expect(Math.round(b.height), `start ${w}`).toBe(h)
    if (w < 400) expect(b.width, `start width ${w}`).toBeGreaterThanOrEqual(w * 0.9)
  }
  await ctx.close()
})

test('final (ruling 23 K3 replaces "wraps"): the quest card Open link is one line inside the card at 393, 375 and 320, and a 44 px target', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [393, 375, 320]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/')
    const open = page.getByTestId('open-link')
    await open.waitFor()
    const link = page.getByTestId('today-link')
    const b = (await link.boundingBox())!
    expect(b.height, `${w}`).toBeGreaterThanOrEqual(44)
    expect(b.height, `${w}`).toBeLessThanOrEqual(44.5)
    const card = (await page.getByTestId('today-quest').boundingBox())!
    expect(b.x + b.width, `${w}`).toBeLessThanOrEqual(card.x + card.width + 0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${w} no horizontal scroll (GLOBAL-06)`).toBeLessThanOrEqual(w)
  }
  // 375 x 667 (GLOBAL-06's phone), and the desktop floor of WCAG 2.5.8
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByTestId('today-link').waitFor()
  expect((await page.getByTestId('today-link').boundingBox())!.height, '375x667').toBeGreaterThanOrEqual(44)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByTestId('today-link').waitFor()
  expect((await page.getByTestId('today-link').boundingBox())!.height, 'desktop').toBeGreaterThanOrEqual(24)
  await ctx.close()
})

test('final (ruling 23 K3, one-line half): the quest card Open link is one line inside the card at 393, 375 and 320; a label far longer than the card wraps inside it and never scrolls the page sideways (GLOBAL-06)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [393, 375, 320]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/')
    const link = page.getByTestId('today-link')
    await link.waitFor()
    const card = (await page.getByTestId('today-quest').boundingBox())!
    const real = (await link.boundingBox())!
    expect(real.height, `${w} real label`).toBeLessThanOrEqual(44.5) // one line inside the 44 px phone target
    expect(real.x + real.width, `${w} real label`).toBeLessThanOrEqual(card.x + card.width + 0.5)
    // the R1 card lets a label that cannot fit wrap (the ruling-23 "never a second line" is not in the contracts); it must stay in the card
    await link.evaluate(e => { e.textContent = 'Open · A very long link label that cannot fit the phone card at all' })
    const long = (await link.boundingBox())!
    expect(long.x, `${w} long label`).toBeGreaterThanOrEqual(card.x - 0.5)
    expect(long.x + long.width, `${w} long label`).toBeLessThanOrEqual(card.x + card.width + 0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${w} long label`).toBeLessThanOrEqual(w)
  }
  await ctx.close()
})

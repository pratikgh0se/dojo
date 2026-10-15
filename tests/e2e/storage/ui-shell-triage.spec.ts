import { expect, test, type Locator, type Page } from '@playwright/test'
import { openApp } from './briefs-helpers'
import { ServerHarness } from './harness'

// The APP findings of the blind UI lane shell-today-board (reports/ui/shell-today-board/triage.md §4,
// Controller ruling 9): each test pins one root issue on the real page.
// R1 (S2 wave 2): the Plan dialog (A2), the Today drawers (A6/A8/SH2/M14/M7), the roll-over line (A9) and the learning-card
// Check dialog (A7/M23/M24) are retired; the design-session Discard dialog and the onboarding card survive.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

const box = async (l: Locator) => (await l.boundingBox())!
const css = (l: Locator, prop: string) => l.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)

/** F6.6 house box: min(640, vw - 32) wide, top 48 (16 on phone), title Display S #ffb545. */
async function expectHouseBox(page: Page, dialog: Locator, phone = false) {
  const vw = page.viewportSize()!.width
  await page.waitForTimeout(400) // the srin entrance slide (translateY 4px) settles first
  const b = await box(dialog)
  expect(Math.round(b.width)).toBe(Math.min(640, vw - 32))
  expect(Math.round(b.y)).toBe(phone ? 16 : 48)
  const title = dialog.getByRole('heading').first()
  expect(await css(title, 'color')).toBe('rgb(255, 181, 69)')
  expect(await css(title, 'font-size')).toBe('16px')
}

/** CLOSE · DESIGN ends the drawing at once (R-F2), so the design session's one confirm is Discard. */
async function discardOpen(page: Page) {
  await page.goto('/designs/session/d-ratelimit')
  await page.getByTestId('design-mode-skip-ai').check()
  await page.getByTestId('session-start').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  const opener = page.getByTestId('session-discard')
  await opener.focus()
  await page.keyboard.press('Enter')
  return { opener, dialog: page.getByRole('dialog', { name: 'Discard this session?' }) }
}

test('A4 / A5: the design-session confirm is the house Dialog: trap, inert, Esc, focus return, box and actions', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const { opener, dialog } = await discardOpen(page)
  await expect(dialog).toBeVisible()
  await expectHouseBox(page, dialog)
  const discardBtn = page.getByTestId('session-discard-confirm')
  const cancelBtn = page.getByTestId('session-discard-cancel')
  await expect(discardBtn).toHaveClass(/sr-btn-danger/)
  await expect(cancelBtn).toHaveClass(/sr-btn-quiet/)
  expect(await page.locator('#root').evaluate(e => (e as HTMLElement).inert)).toBe(true)
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  // Discard: danger first, quiet Cancel; phone box and stacked actions below 400
  await page.setViewportSize({ width: 375, height: 812 })
  await opener.click()
  const discard = page.getByRole('dialog', { name: 'Discard this session?' })
  await expectHouseBox(page, discard, true)
  const a = await box(discardBtn)
  const c = await box(cancelBtn)
  expect(Math.round(a.width)).toBe(Math.round(c.width))
  expect(Math.round(a.height)).toBe(44)
  expect(c.y).toBeGreaterThan(a.y)
  await ctx.close()
})

test('M4 / M5 / M6: onboarding card width on phone; empty date shows the app error; the date field keeps its ring', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 560, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`/#writer=${srv.token()}`)
  const card = page.locator('.onboarding-card')
  await card.waitFor()
  expect(Math.round((await box(card)).width)).toBe(528)
  const date = page.getByRole('textbox', { name: 'Start date' })
  await date.fill('')
  await page.getByRole('button', { name: 'START · PLAN' }).click()
  const err = page.getByTestId('form-error')
  await expect(err).toBeVisible()
  expect(await css(err, 'font-size')).toBe('14px')
  expect(await css(date, 'border-top-color')).toBe('rgb(255, 77, 77)')
  await date.focus()
  expect(await css(date, 'outline-style')).toBe('solid')
  await ctx.close()
})

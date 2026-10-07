import { expect, test, type Locator, type Page } from '@playwright/test'
import { CLOCK, draftSprint1, learningCard, openApp, putTicket, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// The APP findings of the blind UI lane shell-today-board (reports/ui/shell-today-board/triage.md §4,
// Controller ruling 9): each test pins one root issue on the real page.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

const box = async (l: Locator) => (await l.boundingBox())!
const css = (l: Locator, prop: string) => l.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
const PHONE = { width: 393, height: 852 }
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

async function expectChoiceRow(label: Locator, control: Locator) {
  const rb = await box(control)
  expect([Math.round(rb.width), Math.round(rb.height)]).toEqual([20, 20])
  expect(await css(control, 'accent-color')).toBe('rgb(255, 138, 42)')
  expect(await css(label, 'text-transform')).toBe('none')
  expect(await css(label, 'font-size')).toBe('17px')
  expect(await css(label, 'font-weight')).toBe('400')
  expect(await css(label, 'column-gap')).toBe('10px')
}

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

async function endDrawingOpen(page: Page) {
  await page.goto('/designs/session/d-ratelimit')
  await page.getByRole('radio', { name: 'Solo' }).check()
  await page.getByRole('button', { name: 'Start · 45 min' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  const opener = page.getByRole('button', { name: 'End drawing' })
  await opener.focus()
  await page.keyboard.press('Enter')
  return { opener, dialog: page.getByRole('dialog', { name: 'End drawing now?' }) }
}

test('A1: logo-cube, keys-legend p and bd-rebalance carry their testids', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await expect(page.getByTestId('logo-cube')).toHaveAttribute('aria-hidden', 'true')
  const legend = page.getByTestId('keys-legend')
  expect(await legend.evaluate(e => e.tagName)).toBe('P')
  await expect(legend).toContainText('a atlas')
  await draftSprint1(page)
  await page.goto('/settings')
  await page.getByRole('spinbutton', { name: 'Core minutes per sprint' }).fill('120')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await page.goto('/board')
  const strip = page.getByTestId('bd-rebalance')
  await expect(strip).toContainText('budget')
  await expect(strip.getByTestId('rebalance-open')).toBeVisible()
  // A7: the Rebalance? move rows are F6.10 choice rows
  await strip.getByTestId('rebalance-open').click()
  const dialog = page.getByRole('dialog', { name: 'Rebalance?' })
  const first = dialog.locator('[data-testid^="rebalance-move-"]').first()
  await expectChoiceRow(dialog.locator('label.sr-choice').first(), first)
  await ctx.close()
})

test('A2: Plan this session lists every unfinished card of the sprint in a 264 px scrolling well', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  const me = (await rows(srv, 'tickets')).find(t => t.id === 'p200')!
  const open = (await rows(srv, 'tickets')).filter(t => t.sprint === me.sprint && !t.archived && t.status !== 'done')
  const cards = dlg.getByTestId('study-cards')
  await expect(cards.getByRole('checkbox')).toHaveCount(open.length)
  expect(open.some(t => t.track === 'ai')).toBe(true)
  await expect(cards.getByRole('checkbox').first()).toBeDisabled()
  if (open.length > 6) {
    expect(await css(cards, 'max-height')).toBe('264px')
    expect(await cards.evaluate(e => e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY === 'auto')).toBe(true)
  }
  // M4 / M21: Focus 0 shows the app's error below the field; on phone the minutes stack
  await dlg.getByRole('radio', { name: 'Custom' }).check()
  await dlg.getByLabel('Focus minutes').fill('0')
  await dlg.getByTestId('plan-start').click()
  const err = dlg.getByRole('alert')
  await expect(err).toHaveText('Focus minutes must be 1 to 180.')
  expect(await css(err, 'font-size')).toBe('14px')
  expect(await css(dlg.getByLabel('Focus minutes'), 'border-top-color')).toBe('rgb(255, 77, 77)')
  await page.setViewportSize(PHONE)
  const f = await box(dlg.getByLabel('Focus minutes'))
  const b = await box(dlg.getByLabel('Break minutes'))
  expect(b.y).toBeGreaterThan(f.y + f.height - 1)
  await ctx.close()
})

test('A3: Move to sprint… focuses the next sprint; Esc closes it from anywhere and returns focus', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/board')
  const card = page.getByTestId('card-m1w1i1')
  const opener = card.getByRole('button', { name: 'Move to sprint…' })
  await opener.click()
  await expect(page.getByRole('menuitem', { name: 'Sprint 2', exact: true })).toBeFocused()
  await page.locator('body').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Move to sprint' })).toHaveCount(0)
  await expect(opener).toBeFocused()
  // M16: tool labels never wrap at tablet
  await page.setViewportSize({ width: 834, height: 1000 })
  expect(await css(opener, 'white-space')).toBe('nowrap')
  expect(Math.round((await box(opener)).height)).toBeLessThanOrEqual(36)
  await ctx.close()
})

test('A4 / A5: the design-session confirm is the house Dialog: trap, inert, Esc, focus return, box and actions', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const { opener, dialog } = await endDrawingOpen(page)
  await expect(dialog).toBeVisible()
  await expectHouseBox(page, dialog)
  const end = dialog.getByRole('button', { name: 'End drawing' })
  const keep = dialog.getByRole('button', { name: 'Keep going' })
  await expect(end).toHaveClass(/sr-btn-accent/)
  await expect(keep).toHaveClass(/sr-btn-quiet/)
  expect(await page.locator('#root').evaluate(e => (e as HTMLElement).inert)).toBe(true)
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  // Discard: danger first, quiet Cancel; phone box and stacked actions below 400
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Discard' }).first().click()
  const discard = page.getByRole('dialog', { name: 'Discard this session?' })
  await expectHouseBox(page, discard, true)
  await expect(discard.getByRole('button', { name: 'Discard' })).toHaveClass(/sr-btn-danger/)
  await expect(discard.getByRole('button', { name: 'Cancel' })).toHaveClass(/sr-btn-quiet/)
  const a = await box(discard.getByRole('button', { name: 'Discard' }))
  const c = await box(discard.getByRole('button', { name: 'Cancel' }))
  expect(Math.round(a.width)).toBe(Math.round(c.width))
  expect(Math.round(a.height)).toBe(44)
  expect(c.y).toBeGreaterThan(a.y)
  await ctx.close()
})

test('A6 / A8 / SH2 / M14 / M7: Today drawer links wrap and are 44 tall on phone; difficulty text is primary; drawer titles', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize(PHONE)
  await page.goto('/')
  const dsa = page.getByTestId('drawer-dsa')
  await dsa.getByRole('button', { expanded: false }).click()
  const links = dsa.locator('.dig-problem-link')
  expect(await links.count()).toBeGreaterThan(0)
  const clipped = await links.evaluateAll(ls => ls.filter(l => l.scrollWidth > l.clientWidth + 1).length)
  expect(clipped).toBe(0)
  const lb = await box(links.first())
  expect(lb.height).toBeGreaterThanOrEqual(44)
  const diff = dsa.locator('.dig-diff').first()
  expect(await css(diff, 'color')).toBe('rgb(244, 239, 230)')
  expect(await css(dsa.locator('.drawer-title'), 'color')).toBe('rgb(58, 180, 255)')
  expect(await css(page.getByTestId('drawer-tasks').locator('.drawer-title'), 'color')).toBe('rgb(255, 181, 69)')
  const tasks = page.getByTestId('drawer-tasks')
  await tasks.getByRole('button', { expanded: false }).click()
  const doLink = tasks.getByRole('link', { name: /^Do: / }).first()
  expect((await box(doLink)).height).toBeGreaterThanOrEqual(44)
  expect(await css(page.getByText('Dig in · tap a row to open'), 'font-size')).toBe('15px')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await ctx.close()
})

test('A9: one aggregated roll-over line', async ({ browser }) => {
  const SPRINT3 = '2026-11-03T10:00:00+05:30'
  const { ctx, page } = await openApp(browser, srv, SPRINT3)
  await putTicket(srv, { ...learningCard('old-a', 'Old card A', 3), rolledFrom: [1] })
  await putTicket(srv, { ...learningCard('old-b', 'Old card B', 3), rolledFrom: [1, 2] })
  await putTicket(srv, { ...learningCard('old-c', 'Old card C', 3), rolledFrom: [2] })
  const ts = await rows(srv, 'tickets')
  const n = ts.filter(t => t.sprint === 3 && t.status !== 'done' && !t.archived && (t.rolledFrom ?? []).length > 0).length
  await page.reload()
  await expect(page.getByTestId('rolled-note')).toHaveCount(1)
  await expect(page.getByTestId('rolled-note')).toHaveText(`${n} cards rolled from Sprint 2`)
  await ctx.close()
})

test('A7 / M23 / M24: Check dialog choice rows, AI error line, busy labels', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await putTicket(srv, learningCard('w-hash', 'Hash maps'))
  await page.reload()
  await draftSprint1(page)
  await page.goto('/do/w-hash')
  await page.evaluate(() => localStorage.setItem('dojo-ai-fake-delay-ms', '1200'))
  await page.getByRole('button', { name: 'Mark done' }).click()
  const dialog = page.getByRole('dialog', { name: 'Check your understanding' })
  const group = dialog.getByRole('radiogroup', { name: 'Which is Hash maps?' })
  const radio = group.getByRole('radio', { name: 'Hash maps', exact: true })
  await expectChoiceRow(group.locator('label.sr-choice').first(), group.getByRole('radio').first())
  await dialog.getByRole('textbox').first().fill('An answer')
  await radio.check()
  await dialog.getByRole('button', { name: 'Check answers' }).click()
  await expect(dialog.getByRole('button', { name: 'Checking…' })).toBeDisabled()
  await expect(dialog.getByTestId('check-verdict')).toBeVisible({ timeout: 10_000 })
  await ctx.close()
})

test('M24 / M26 / M27: Deliverable textarea named by the prompt; Get feedback busy; Edit brief fields', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  await page.goto('/do/m1w1i2')
  await page.evaluate(() => localStorage.setItem('dojo-ai-fake-delay-ms', '1200'))
  await page.getByRole('button', { name: 'Mark done' }).click()
  const dialog = page.getByRole('dialog', { name: 'Deliverable' })
  const area = dialog.getByRole('textbox', { name: /Paste your code, typed by hand/ })
  await expect(area).toBeVisible()
  expect(await css(area, 'min-height')).toBe('120px')
  await expect(dialog.locator('.p-field > label')).toHaveCount(0)
  await area.fill('def f(): pass')
  await dialog.getByRole('button', { name: 'Get feedback' }).click()
  await expect(dialog.getByRole('button', { name: 'Getting feedback…' })).toBeDisabled()
  await expect(dialog.getByTestId('deliverable-feedback')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Edit brief' }).first().click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  for (const name of ['Outcome', "What you'll learn (one per line)"]) {
    const t = ed.getByLabel(name)
    expect(await t.evaluate(e => e.tagName)).toBe('TEXTAREA')
    expect(await css(t, 'min-height')).toBe('120px')
    expect(await css(t, 'resize')).toBe('vertical')
  }
  await expect(ed.getByLabel('Day type').locator('option')).toHaveText(['Focus', 'Light', 'Long'])
  // M20: dialog field labels Chivo 15/700 upper, inputs 36 tall
  const label = ed.locator('.p-field > label').first()
  expect(await css(label, 'font-size')).toBe('15px')
  expect(await css(label, 'text-transform')).toBe('uppercase')
  expect(Math.round((await box(ed.getByLabel('Goal'))).height)).toBeGreaterThanOrEqual(36)
  await ctx.close()
})

test('Ruling 9: no blank screen while /db/state is held, with a local copy and in a fresh context', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await expect(page.getByTestId('now-headline')).toBeVisible()
  // local copy: hold the first server read; Today and Board render the local copy at once
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  await page.route('**/db/state', async route => { await held; await route.continue().catch(() => {}) })
  await page.goto(`/#writer=${srv.token()}`)
  await expect(page.getByTestId('now-headline')).toBeVisible({ timeout: 3000 })
  await page.goto('/board')
  await expect(page.getByTestId('strip')).toBeVisible({ timeout: 3000 })
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  release()
  await ctx.close()
  // fresh context: no local copy, "Loading…" after 300 ms, then the screen once the read lands
  const fresh = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const p2 = await fresh.newPage()
  await p2.clock.setSystemTime(new Date(CLOCK.sprint1))
  let release2!: () => void
  const held2 = new Promise<void>(r => { release2 = r })
  await p2.route('**/db/state', async route => { await held2; await route.continue().catch(() => {}) })
  await p2.goto(`/#writer=${srv.token()}`)
  await expect(p2.locator('p.loading')).toHaveText('Loading…', { timeout: 3000 })
  release2()
  await expect(p2.getByTestId('now-headline')).toBeVisible({ timeout: 15_000 })
  await fresh.close()
})

test('M2 / M3 / M5 / M9 / M10 / M11 / M19: More label, key hints, onboarding width, load-focus, Start, badges, column heads', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await expect(page.getByTestId('load-focus')).toHaveText(/^\d+ min of real focus in the last 7 days$/)
  expect(Math.round((await box(page.getByTestId('start-button'))).height)).toBe(40)
  const badge = page.locator('.ms-badge').first()
  expect(await css(badge, 'font-family')).toContain('Space Mono')
  await page.goto('/progress')
  await page.getByTestId('more-button').click()
  const key = page.locator('.more-key').first()
  expect(await css(key, 'font-weight')).toBe('400')
  expect(await css(key, 'line-height')).toBe('20.3px')
  await page.keyboard.press('Escape')
  await page.setViewportSize(PHONE)
  const more = page.getByTestId('more-button')
  await expect(more).toHaveAccessibleName('More · Progress ▾')
  await expect.poll(async () => (await more.innerText()).trim()).toBe('MORE ▾') // the resize reaches the media query a beat later
  await page.goto('/board')
  const head = page.locator('h2.col-head').first()
  expect((await head.innerText()).trim()).not.toMatch(/[−+]$/)
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
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  const err = page.getByTestId('form-error')
  await expect(err).toBeVisible()
  expect(await css(err, 'font-size')).toBe('14px')
  expect(await css(date, 'border-top-color')).toBe('rgb(255, 77, 77)')
  await date.focus()
  expect(await css(date, 'outline-style')).toBe('solid')
  await ctx.close()
})

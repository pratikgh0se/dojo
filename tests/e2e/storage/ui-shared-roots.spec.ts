import { expect, test, type Locator, type Page } from '@playwright/test'
import { openApp } from './briefs-helpers'
import { ServerHarness } from './harness'

// The shared APP roots of the blind UI lanes (settings-progress-ref and shell-today-board triage, Controller
// rulings 8 and 9): phone touch targets, the F6.10 choice rows, difficulty chip text, role line-heights and
// square selects. Screen-local settings-progress-ref items live with builder B.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

const box = async (l: Locator) => (await l.boundingBox())!
const css = (l: Locator, prop: string) => l.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
async function expectHit(l: Locator, label: string, wide = true) {
  const b = await box(l)
  expect(b.height, `${label} height`).toBeGreaterThanOrEqual(44)
  if (wide) expect(b.width, `${label} width`).toBeGreaterThanOrEqual(44)
}
const PHONE = { width: 393, height: 852 }

async function closeForm(page: Page) {
  await page.goto('/designs/session/d-ratelimit')
  await page.getByRole('radio', { name: 'Solo' }).check()
  await page.getByRole('button', { name: 'Start · 45 min' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  await page.getByRole('button', { name: 'End drawing' }).click()
  await page.getByRole('dialog', { name: 'End drawing now?' }).getByRole('button', { name: 'End drawing' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('close')
}

/** F6.10: a 20 x 20 accent control, its label on the right (gap 10), Chivo 17/400 sentence case. */
async function expectChoiceRow(label: Locator, control: Locator) {
  const rb = await box(control)
  expect([Math.round(rb.width), Math.round(rb.height)]).toEqual([20, 20])
  expect(await css(control, 'accent-color')).toBe('rgb(255, 138, 42)')
  expect(await css(label, 'text-transform')).toBe('none')
  expect(await css(label, 'font-size')).toBe('17px')
  expect(await css(label, 'font-weight')).toBe('400')
  expect(await css(label, 'font-family')).toContain('Chivo')
  expect(await css(label, 'column-gap')).toBe('10px')
  const lb = await box(label)
  expect(rb.x - lb.x).toBeLessThanOrEqual(2)
}

test('M1 / SH3: role line-heights (Display M 24/1.2, Display S 16/1.25, Title 22/1.3, LV)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await expect(page.getByTestId('level')).toBeVisible()
  expect(await css(page.getByTestId('level'), 'line-height')).toBe('28.8px')
  expect(await css(page.getByTestId('load-minutes'), 'line-height')).toBe('28.6px')
  await page.goto('/progress')
  expect(await css(page.locator('h1.screen-title'), 'line-height')).toBe('28.8px')
  expect(await css(page.getByRole('heading', { name: 'Burn-up' }), 'line-height')).toBe('20px')
  await ctx.close()
})

test('settings A4 / A6 / M9: design-session choice rows, Back and Add targets, square selects', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await closeForm(page)
  const q4 = page.getByRole('radiogroup', { name: 'Which deep dive could you not answer without notes?' })
  await expectChoiceRow(q4.locator('label').last(), q4.getByRole('radio', { name: 'None, I answered all four' }))
  const sel = page.locator('select').first()
  await sel.waitFor()
  expect(await css(sel, 'appearance')).toBe('none')
  expect(await css(sel, 'border-top-left-radius')).toBe('0px')
  await page.setViewportSize(PHONE)
  await expectHit(page.getByRole('link', { name: '‹ Back' }), '‹ Back')
  await expectHit(q4.locator('label').first(), 'q4 row', false)
  await expectHit(page.getByTestId('kit-palette').getByRole('button').first(), 'Add <kind>', false)
  await ctx.close()
})

test('settings A4 / A7: DSA warm-up player and study link targets; difficulty chips keep primary text', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/dsa?topic=2')
  const warm = page.getByRole('region', { name: 'Warm-up', exact: true })
  const chip = page.locator('.chip.diff-chip').first()
  await chip.waitFor()
  expect(await css(chip, 'color')).toBe('rgb(244, 239, 230)')
  await page.setViewportSize(PHONE)
  expect(await css(chip, 'padding-top')).toBe('2px') // M10: chips are padded 2 6 on phone
  for (const name of ['First step', 'Step back', 'Step forward', 'Last step']) await expectHit(warm.getByRole('button', { name, exact: true }), name)
  for (const name of ['Predict', 'Own input', 'Snapshot']) await expectHit(warm.getByRole('button', { name, exact: true }), name, false)
  await expectHit(page.locator('.topic-links a').first(), 'study link', false)
  await ctx.close()
})

test('settings A4: Progress evidence rows, AI shelf summary, Atlas problem links, Mentors room links', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize(PHONE)
  await page.goto('/progress')
  await expectHit(page.getByTestId('ev-dsa-solved'), 'ev-dsa-solved', false)
  await page.goto('/atlas?pattern=topo-sort')
  await expectHit(page.getByRole('list', { name: 'Problems' }).getByRole('link').first(), 'atlas problem link', false)
  await page.goto('/ai')
  await expectHit(page.getByTestId('shelf').locator('summary'), 'Optional shelf', false)
  await page.goto('/mentors')
  await expectHit(page.locator('.room-name').first(), 'room link', false)
  await ctx.close()
})

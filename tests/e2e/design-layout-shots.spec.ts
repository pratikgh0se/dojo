import { mkdirSync, writeFileSync } from 'node:fs'
import { test, type Page } from '@playwright/test'
import { addKinds, begin, drawS1, endDrawing, fillClose, RL, RL_DIVES, startSession, openNotes } from './design-helpers'

// Layout shots and measurements for the design session (setup, live drawing, done) at 1280 x 800 and 390 px. Not part of the
// normal run:  DESIGN_LAYOUT_SHOTS=1 DOJO_PORT=88xx npx playwright test tests/e2e/design-layout-shots.spec.ts --project=chromium
// PNGs land in DESIGN_LAYOUT_SHOTS_DIR (default docs/screenshots).
test.skip(!process.env.DESIGN_LAYOUT_SHOTS, 'run with DESIGN_LAYOUT_SHOTS=1 to write the design layout screenshots')
const OUT = process.env.DESIGN_LAYOUT_SHOTS_DIR ?? 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
const SIZES = [['1280x800', 1280, 800], ['390', 390, 844]] as const

const measure = (page: Page) => page.evaluate(() => {
  const r = (id: string) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height), visibleH: Math.round(Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0))), scrollsInside: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1 } }
  return { pageH: document.documentElement.scrollHeight, pageW: document.documentElement.scrollWidth, vw: innerWidth, canvas: r('kit-canvas'), palette: r('kit-palette'), notes: r('notes-panel'), chat: r('session-interviewer'), input: r('session-chat-input') }
})

test('palette open 1280x800', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await begin(page)
  await startSession(page, 'Interviewer')
  await page.getByTestId('session-msg').first().waitFor()
  await addKinds(page, ['gateway', 'service', 'sql'])
  await page.getByTestId('kit-family-data').click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/design-palette-open-1280x800.png` })
})

for (const [name, w, h] of SIZES) {
  test(`setup ${name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: w, height: h })
    await begin(page)
    await page.goto(`/designs/session/${RL}`)
    await page.getByTestId('session-start').waitFor()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/design-setup-${name}.png` })
    if (name !== '1280x800') await page.screenshot({ path: `${OUT}/design-setup-${name}-full.png`, fullPage: true })
  })
  test(`live ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await begin(page)
    await startSession(page, 'Interviewer')
    await page.getByTestId('session-msg').first().waitFor()
    await addKinds(page, ['gateway', 'service', 'sql'])
    const chat = page.getByTestId('session-chat-input')
    for (let i = 0; i < 2; i++) {
      const n = await page.getByTestId('session-msg').count()
      await chat.fill(`answer ${i + 1}: about 5M daily users, two edits a second per document at peak`)
      await page.getByTestId('session-send').click()
      await page.getByTestId('session-msg').nth(n + 1).waitFor({ timeout: 10_000 })
    }
    await openNotes(page)
    await page.getByTestId('notes-field-req-fn').fill('Edit one photo together, see changes live.')
    await openNotes(page)
    await page.getByTestId('notes-field-assumptions').fill('5M daily users, 2 edits per second at peak, 30 KB per diff.')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/design-live-${name}.png` })
    if (name !== '1280x800') await page.screenshot({ path: `${OUT}/design-live-${name}-full.png`, fullPage: true })
    writeFileSync(`${OUT}/.measure-live-${name}.json`, JSON.stringify(await measure(page), null, 1))
  })
  test(`done ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await begin(page)
    // an AI-partner session, nine answers, closed, graded (design-interviewer D-37): the done view then has the grade and the conversation
    await startSession(page, 'Interviewer')
    await drawS1(page)
    for (let i = 1; i <= 9; i++) {
      const n = await page.getByTestId('session-msg').count()
      await page.getByTestId('session-chat-input').fill(`answer ${i}`)
      await page.getByTestId('session-send').click()
      await page.getByTestId('session-msg').nth(n + 1).waitFor({ timeout: 10_000 })
    }
    await endDrawing(page)
    await fillClose(page, RL_DIVES[0])
    await page.getByTestId('session-grade').waitFor()
    const row2 = page.getByTestId('session-tradeoff-row-2')
    await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
    await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
    await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
    await page.getByTestId('session-complete').click()
    await page.getByTestId('session-phase').filter({ hasText: 'Done' }).waitFor()
    await page.clock.resume() // a frozen clock starves the paint of a screenshot
    await page.getByTestId('session-reference').locator('sr-diagram').waitFor({ timeout: 15_000 }).catch(() => {})
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/design-done-${name}.png` })
    // the whole page: a tall window, so nothing depends on how a full-page capture stitches a scrolling root
    const total = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: w, height: Math.min(total + 20, 6000) })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/design-done-${name}-full.png` })
    writeFileSync(`${OUT}/.measure-done-${name}.json`, JSON.stringify(await page.evaluate(() => ({ pageH: document.documentElement.scrollHeight, pageW: document.documentElement.scrollWidth })), null, 1))
  })
}

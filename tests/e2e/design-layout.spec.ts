import { expect, test, type Page } from '@playwright/test'
import { begin, completeS1, drawS1, endDrawing, fillClose, guard, resumeAndGo, RL, RL_DIVES, scoreS1, startSession } from './design-helpers'

const noPageScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560)
const scrollsInside = async (page: Page, testId: string) =>
  expect(await page.getByTestId(testId).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)

test('D-56 desktop: canvas left, side panel right', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  const canvas = (await page.getByTestId('kit-canvas').boundingBox())!
  const side = (await page.getByTestId('session-interviewer').boundingBox())!
  expect(side.x).toBeGreaterThanOrEqual(canvas.x + canvas.width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  check()
})

test('D-57 560 px: every phase and the tab stay inside the viewport', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 560, height: 900 })
  await begin(page)
  await page.goto(`/designs/session/${RL}`)
  await noPageScroll(page)
  await page.getByRole('button', { name: 'Start · 45 min' }).click()
  await drawS1(page)
  await noPageScroll(page)
  await scrollsInside(page, 'kit-palette')
  await scrollsInside(page, 'kit-canvas')
  const canvas = (await page.getByTestId('kit-canvas').boundingBox())!
  await endDrawing(page)
  await noPageScroll(page)
  const close = (await page.getByTestId('session-close').boundingBox())!
  expect(close.y).toBeGreaterThanOrEqual(canvas.y + canvas.height)
  await fillClose(page, RL_DIVES[1])
  await noPageScroll(page)
  await page.goto('/designs')
  await noPageScroll(page)
  await page.goto(`/designs/session/${RL}`)
  check()
})

test('D-57 560 px: done view stacks and the wall scrolls in its well', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 560, height: 900 })
  await begin(page)
  await completeS1(page)
  await noPageScroll(page)
  const yours = (await page.getByTestId('session-yours').boundingBox())!
  const ref = (await page.getByTestId('session-reference').boundingBox())!
  expect(ref.y).toBeGreaterThanOrEqual(yours.y + yours.height)
  await resumeAndGo(page, () => page.goto('/designs'))
  await noPageScroll(page)
  expect(await page.getByTestId('wall-grid').evaluate(el => el.parentElement!.scrollWidth > el.parentElement!.clientWidth)).toBe(true)
  check()
})

test('D-58 reduced motion: no flash, static flows, static loader', async ({ page }) => {
  const check = guard(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await begin(page)
  await page.evaluate(() => localStorage.setItem('dojo-ai-fake-delay-ms', '600'))
  await startSession(page)
  await drawS1(page)
  await endDrawing(page)
  await fillClose(page, RL_DIVES[1])
  const before = await page.evaluate(() => document.documentElement.dataset.flashes ?? '0')
  await scoreS1(page)
  await page.getByRole('button', { name: 'Complete session' }).click()
  await expect(page.getByTestId('toast').filter({ hasText: '+20 xp · Saved' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.flashes ?? '0')).toBe(before)
  const loader = page.getByTestId('session-reference-loading')
  await expect(loader).toBeVisible()
  expect(await loader.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0)
  // The fake AI's delay hook uses a real setTimeout, which the frozen page.clock never fires on
  // its own (same gap as Task 14's design-done.spec.ts); advance it past the 600 ms delay.
  await page.clock.runFor(700)
  const ref = page.getByTestId('session-reference')
  await ref.getByRole('button', { name: 'Play flows' }).click()
  // diagram.js's own reduceMotion() check draws a fixed, numbered packet regardless of `play` or
  // any tick, so the shadow-root SVG markup is deterministic; comparing it (rather than a
  // rasterized screenshot) avoids compositor/AA jitter under software rendering (SwiftShader) that
  // made a byte-for-byte PNG comparison here flaky under load even though nothing is animating.
  const svgHtml = () => ref.locator('sr-diagram').evaluate(el => el.shadowRoot?.querySelector('svg')?.outerHTML ?? '')
  const a = await svgHtml()
  await page.clock.runFor(500)
  const b = await svgHtml()
  expect(b).toBe(a)
  expect(await ref.evaluate(el => el.getAnimations({ subtree: true }).filter(x => x.playState === 'running').length)).toBe(0)
  check()
})

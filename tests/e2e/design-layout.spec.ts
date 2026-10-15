import { expect, test, type Page } from '@playwright/test'
import { begin, completeS1, drawS1, endDrawing, fillClose, guard, resumeAndGo, RL, RL_DIVES, scoreS1, startSession } from './design-helpers'

const noPageScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560)
const scrollsInside = async (page: Page, testId: string) =>
  // the palette's row of family buttons and tools is its scroller; every other id scrolls itself
  expect(await (testId === 'kit-palette' ? page.getByTestId(testId).locator('.kit-palette-row') : page.getByTestId(testId)).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)

test('D-56 desktop: canvas left, chat and notes right', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  const canvas = (await page.getByTestId('kit-canvas').boundingBox())!
  const notes = (await page.getByTestId('notes-panel').boundingBox())!
  expect(notes.x).toBeGreaterThanOrEqual(canvas.x + canvas.width)
  // the AI partner's chat is a dock outside the tabs: in the right column, above the tabs and the notes
  const chat = (await page.getByTestId('session-interviewer').boundingBox())!
  expect(chat.x).toBeGreaterThanOrEqual(canvas.x + canvas.width)
  expect(chat.y + chat.height).toBeLessThanOrEqual(notes.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  check()
})

// DESIGN-11: at 1280 x 800 the newest AI message and the chat box are both inside the viewport without scrolling, at the opener
// and after a long conversation (older messages scroll inside the dock; the newest sits just above the box).
test('DESIGN-11 desktop 1280x800: the newest AI message and the chat input are in the viewport, unscrolled', async ({ page }, info) => {
  const check = guard(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await begin(page)
  await startSession(page, 'Interviewer')
  const inViewport = async (label: string) => {
    const r = await page.evaluate(() => {
      const box = (e: Element) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom } }
      const ai = [...document.querySelectorAll('[data-testid="session-msg"][data-from="ai"]')].pop()!
      return { scrollY: window.scrollY, vh: window.innerHeight, ai: box(ai), input: box(document.querySelector('[data-testid="session-chat-input"]')!), send: box(document.querySelector('[data-testid="session-send"]')!) }
    })
    expect(r.scrollY, label).toBe(0)
    for (const [name, b] of [['newest AI message', r.ai], ['chat input', r.input], ['send', r.send]] as const) {
      expect(b.top, `${label}: ${name} top`).toBeGreaterThanOrEqual(0)
      expect(b.bottom, `${label}: ${name} bottom`).toBeLessThanOrEqual(r.vh)
    }
    expect(r.ai.bottom, `${label}: newest AI message is above the input`).toBeLessThanOrEqual(r.input.top)
  }
  await expect(page.locator('[data-testid="session-msg"][data-from="ai"]').first()).toBeVisible()
  await inViewport('opener')
  const chat = page.getByTestId('session-chat-input')
  for (let i = 0; i < 6; i++) {
    const n = await page.getByTestId('session-msg').count()
    await chat.fill(`answer ${i} with a few more words to make the line wrap around the box`)
    await page.getByTestId('session-send').click()
    await expect(page.getByTestId('session-msg')).toHaveCount(n + 2, { timeout: 10_000 })
  }
  await inViewport('after six answers')
  // no overlap rule of DESIGN-09: the notes still sit beside the canvas
  const canvas = (await page.getByTestId('kit-canvas').boundingBox())!
  const notes = (await page.getByTestId('notes-panel').boundingBox())!
  expect(Math.min(canvas.y + canvas.height, notes.y + notes.height) - Math.max(canvas.y, notes.y)).toBeGreaterThan(canvas.height / 2)
  await page.screenshot({ path: info.outputPath('dock-1280x800.png') })
  check()
})

// DESIGN-23b / D2 (visual pass): the palette is one row (family buttons, divider, four tools), so the canvas starts high and fills the
// screen at 1280 x 800; no tile shows while every family is closed; nothing scrolls sideways or, on the page, vertically.
test('D2 desktop 1280x800: one-row palette, canvas starts at most 200 px down and fills the viewport', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await begin(page)
  await startSession(page, 'Interviewer')
  await expect(page.locator('[data-testid="session-msg"][data-from="ai"]').first()).toBeVisible()
  const canvas = (await page.getByTestId('kit-canvas').boundingBox())!
  expect(canvas.y, 'canvas top').toBeLessThanOrEqual(200)
  expect(canvas.y + canvas.height, 'canvas bottom is inside the viewport').toBeLessThanOrEqual(800)
  // the footer bar (F2, DESIGN-88) takes one 56 px row under the workspace, so the canvas is 436 px here, not 490
  expect(canvas.height, 'canvas fills most of the screen height').toBeGreaterThanOrEqual(420)
  const m = await page.evaluate(() => ({
    pageH: document.documentElement.scrollHeight, pageW: document.documentElement.scrollWidth,
    row: (() => { const e = document.querySelector('[data-testid="kit-palette"] .kit-palette-row')!; return { sideways: e.scrollWidth > e.clientWidth + 1 } })(),
    canvasScrolls: (() => { const e = document.querySelector('[data-testid="kit-canvas"]')!; return e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 })(),
  }))
  expect(m.pageH, 'the page does not scroll').toBeLessThanOrEqual(800)
  expect(m.pageW, 'no sideways scroll').toBeLessThanOrEqual(1280)
  expect(m.row.sideways, 'the row is not clipped sideways').toBe(false)
  expect(m.canvasScrolls, 'an empty-ish canvas has no inner scroll').toBe(false)
  // a single row: the palette is one 36 px button high (plus padding), and every family button and tool shares one line
  const pal = (await page.getByTestId('kit-palette').boundingBox())!
  expect(pal.height, 'one row').toBeLessThanOrEqual(70)
  const ids = [...(await page.locator('[data-testid^="kit-family-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')!))), 'kit-add-custom', 'kit-add-note', 'kit-add-table', 'kit-add-frame']
  expect(ids).toHaveLength(15)
  const ys = new Set<number>()
  for (const id of ids) {
    const b = (await page.getByTestId(id).boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(pal.x)
    expect(b.x + b.width).toBeLessThanOrEqual(pal.x + pal.width)
    ys.add(Math.round((b.y + b.height / 2) / 10))
  }
  expect(ys.size, 'every family button and tool on one line').toBe(1)
  // no tile is on screen while every family is closed
  await expect(page.locator('[data-testid^="kit-tile-"]:visible')).toHaveCount(0)
  // the dock stays at the top of the right column and the notes beside the canvas (more than half of its height)
  const chat = (await page.getByTestId('session-interviewer').boundingBox())!
  const notes = (await page.getByTestId('notes-panel').boundingBox())!
  expect(chat.x).toBeGreaterThanOrEqual(canvas.x + canvas.width)
  expect(chat.y).toBeLessThan(canvas.y)
  expect(Math.min(canvas.y + canvas.height, notes.y + notes.height) - Math.max(canvas.y, notes.y)).toBeGreaterThan(canvas.height / 2)
  check()
})

// DESIGN-23a: a flyout opens under its button, over the canvas (the canvas does not move), inside the viewport and the palette's width.
test('D2 desktop 1280x800: a flyout opens over the canvas without moving it, inside the palette width', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await begin(page)
  await startSession(page, 'Solo')
  const before = (await page.getByTestId('kit-canvas').boundingBox())!
  const pal = (await page.getByTestId('kit-palette').boundingBox())!
  for (const family of ['client', 'data', 'flow']) {
    await page.getByTestId(`kit-family-${family}`).click()
    const fly = (await page.getByTestId('kit-flyout').boundingBox())!
    const btn = (await page.getByTestId(`kit-family-${family}`).boundingBox())!
    expect((await page.getByTestId('kit-canvas').boundingBox())!.y, `${family}: the canvas does not move`).toBe(before.y)
    expect(fly.y, `${family}: the flyout is under its button`).toBeGreaterThanOrEqual(btn.y + btn.height - 6)
    expect(fly.y, `${family}: and over the canvas`).toBeLessThan(before.y + 40)
    expect(fly.x).toBeGreaterThanOrEqual(pal.x - 1)
    expect(fly.x + fly.width).toBeLessThanOrEqual(pal.x + pal.width + 1)
    expect(fly.y + fly.height).toBeLessThanOrEqual(800)
    const tiles = (await page.locator('[data-testid^="kit-tile-"]:visible').all())
    expect(tiles.length).toBeGreaterThan(0)
    for (const t of tiles) {
      const b = (await t.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(fly.x - 1)
      expect(b.x + b.width).toBeLessThanOrEqual(fly.x + fly.width + 1)
    }
    await page.keyboard.press('Escape')
  }
  check()
})

test('D2 phone 390: no sideways page scroll, the palette row scrolls inside its own box, a flyout is full width', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await begin(page)
  await startSession(page, 'Interviewer')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await scrollsInside(page, 'kit-palette')
  // a flyout opens full width under the swipe row, and the page still does not scroll sideways
  await page.getByTestId('kit-family-data').click()
  const pal = (await page.getByTestId('kit-palette').boundingBox())!
  const fly = (await page.getByTestId('kit-flyout').boundingBox())!
  expect(fly.width).toBeGreaterThanOrEqual(pal.width - 4)
  expect(fly.x).toBeGreaterThanOrEqual(pal.x - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByTestId('kit-tile-sql').click()
  await expect(page.getByTestId('kit-node-sql-1')).toBeVisible()
  check()
})

test('D-57 560 px: every phase and the tab stay inside the viewport', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 560, height: 900 })
  await begin(page)
  await page.goto(`/designs/session/${RL}`)
  await noPageScroll(page)
  await page.getByTestId('session-start').click()
  await drawS1(page)
  await noPageScroll(page)
  await scrollsInside(page, 'kit-palette')
  await scrollsInside(page, 'kit-canvas')
  // page coordinates: CLOSE · DESIGN is in the footer now, so pressing it scrolls the page to the bottom first
  const pageY = async (id: string) => page.getByTestId(id).evaluate(el => el.getBoundingClientRect().top + window.scrollY)
  const canvasBottom = await pageY('kit-canvas') + (await page.getByTestId('kit-canvas').boundingBox())!.height
  await endDrawing(page)
  await noPageScroll(page)
  expect(await pageY('session-close')).toBeGreaterThanOrEqual(canvasBottom)
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
  await page.getByTestId('session-complete').click()
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

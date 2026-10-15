import { expect, test, type Page } from '@playwright/test'
import { begin, endDrawing, fillClose, guard, liveRow, openNotes, RL, RL_DIVES, resumeAndGo, startSession } from './design-helpers'

// R1 F2: the notes accordion, the footer bar and Pause (DESIGN-82 to DESIGN-96). Screenshots with R1_SHOTS=<dir>.
const IDS = ['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']
const MIN = 60_000
const SHOTS = process.env.R1_SHOTS

const expanded = (page: Page, id: string) => page.getByTestId(`notes-section-${id}-toggle`).getAttribute('aria-expanded')
const timer = (page: Page) => page.getByTestId('session-timer').innerText()
const stored = (page: Page) => liveRow(page) as unknown as Promise<{ pausedAt?: number | null; pausedMs?: number; minutes: number; lockedAt?: number; phase: string; canvas: { nodes: unknown[] }; notes?: { api: string } }>
const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!

test('DESIGN-82/83/84 the accordion: Requirements open first, several can be open, the open set survives a reload and is per tab', async ({ page, context }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  for (const id of IDS) {
    const toggle = page.getByTestId(`notes-section-${id}-toggle`)
    await expect(toggle).toHaveAttribute('aria-expanded', id === 'requirements' ? 'true' : 'false')
    await expect(toggle.getByTestId(`notes-section-${id}-title`)).toBeVisible()
    await expect(toggle.getByTestId(`notes-section-${id}-count`)).toBeVisible()
  }
  await expect(page.getByTestId('notes-field-req-fn')).toBeVisible()
  await expect(page.getByTestId('notes-field-req-nfr')).toBeVisible()
  await expect(page.getByTestId('notes-field-api')).not.toBeVisible()
  const ops = (await liveRow(page)) // nothing here writes the data
  await page.getByTestId('notes-section-api-toggle').click()
  await page.getByTestId('notes-section-open-toggle').click()
  await expect(page.getByTestId('notes-field-api')).toBeVisible()
  await expect(page.getByTestId('notes-field-open')).toBeVisible()
  await page.getByTestId('notes-section-api-toggle').click()
  expect(await expanded(page, 'api')).toBe('false')
  expect(await expanded(page, 'open')).toBe('true')
  expect(await expanded(page, 'requirements')).toBe('true')
  await expect(page.getByTestId('notes-field-api')).not.toBeVisible()
  expect(await liveRow(page)).toEqual(ops)
  // keyboard: Tab to a toggle, Space opens it
  await page.getByTestId('notes-section-tradeoffs-toggle').focus()
  await page.keyboard.press('Space')
  expect(await expanded(page, 'tradeoffs')).toBe('true')
  // a reload keeps the set
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('notes-panel')).toBeVisible()
  expect(await Promise.all(IDS.map(id => expanded(page, id)))).toEqual(['true', 'false', 'false', 'false', 'true', 'true'])
  // a new browser tab of the same session starts with the default
  const other = await context.newPage()
  await other.goto(`/designs/session/${RL}`)
  await expect(other.getByTestId('notes-panel')).toBeVisible()
  expect(await Promise.all(IDS.map(id => other.getByTestId(`notes-section-${id}-toggle`).getAttribute('aria-expanded')))).toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
  await other.close()
  check()
})

test('DESIGN-85/86 counts follow the typing, a closed section keeps its text, Data model counts tables', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  const count = (id: string) => page.getByTestId(`notes-section-${id}-count`)
  for (const id of IDS) await expect(count(id)).toHaveText('0')
  await page.getByTestId('notes-field-req-fn').fill('upload\n\n   \nview')
  await page.getByTestId('notes-field-req-nfr').fill('p99 under 200 ms')
  await expect(count('requirements')).toHaveText('3')
  await openNotes(page, 'api')
  await page.getByTestId('notes-field-api').fill('RPS 20000')
  await page.getByTestId('notes-section-api-toggle').click() // closed again
  await expect(page.getByTestId('notes-field-api')).not.toBeVisible()
  await expect(page.getByTestId('notes-field-api')).toHaveValue('RPS 20000')
  await expect(count('api')).toHaveText('1')
  await openNotes(page, 'api')
  await page.getByTestId('notes-field-api').pressSequentially(' and more')
  await page.getByTestId('notes-section-api-toggle').click()
  await page.clock.runFor(1000)
  await expect.poll(async () => (await stored(page)).notes?.api).toBe('RPS 20000 and more')
  await expect(count('api')).toHaveText('1')
  // Data model: lines of its box, then tables
  await openNotes(page, 'data-model')
  await page.getByTestId('notes-field-data-model').fill('a\nb')
  await expect(count('data-model')).toHaveText('2')
  await page.getByTestId('schema-add-table').click()
  await expect(count('data-model')).toHaveText('1 table')
  await page.getByTestId('schema-add-table').click()
  await expect(count('data-model')).toHaveText('2 tables')
  await expect(count('tradeoffs')).toHaveText('0') // no unit word anywhere else
  check()
})

test('DESIGN-42 Ctrl+. opens Requirements when it is closed and focuses its first box', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('notes-section-requirements-toggle').click()
  await expect(page.getByTestId('notes-field-req-fn')).not.toBeVisible()
  await page.getByTestId('kit-canvas').focus()
  await page.keyboard.press('Control+.')
  expect(await expanded(page, 'requirements')).toBe('true')
  await expect(page.getByTestId('notes-field-req-fn')).toBeFocused()
  await page.keyboard.press('Control+.')
  await expect(page.getByTestId('kit-canvas')).toBeFocused()
  check()
})

test('DESIGN-87 close and score: every section is open, read-only, and cannot be closed', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await endDrawing(page)
  const all = async () => {
    for (const id of IDS) expect(await expanded(page, id), id).toBe('true')
    await page.getByTestId('notes-section-api-toggle').click()
    expect(await expanded(page, 'api')).toBe('true')
    await expect(page.getByTestId('notes-field-api')).toBeVisible()
    await expect(page.getByTestId('notes-field-api')).toHaveAttribute('readonly', '')
  }
  await all()
  await fillClose(page, RL_DIVES[0])
  await all()
  await expect(page.getByTestId('session-footer')).toHaveCount(0)
  check()
})

test('DESIGN-88/89 the footer bar: inside 1280 x 800, under the canvas and the tabs, the order of its controls, the graded line per mode', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await begin(page)
  await startSession(page, 'Interviewer')
  const f = await box(page, 'session-footer')
  const canvas = await box(page, 'kit-canvas')
  const tabs = await box(page, 'session-tabs')
  expect(f.y + f.height, 'footer inside the viewport').toBeLessThanOrEqual(800)
  expect(f.y).toBeGreaterThanOrEqual(canvas.y + canvas.height)
  expect(f.y).toBeGreaterThanOrEqual(tabs.y + tabs.height)
  expect(f.x).toBeLessThanOrEqual(canvas.x + 2)
  expect(f.x + f.width).toBeGreaterThanOrEqual(tabs.x + tabs.width - 2)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800)
  const order = await page.getByTestId('session-footer').evaluate(el => ['session-autosave', 'session-graded', 'session-pause', 'session-close-design'].map(id => el.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().left))
  expect(order).toEqual([...order].sort((a, b) => a - b))
  const last = await page.getByTestId('session-footer').evaluate(el => [...el.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].pop()!.getAttribute('data-testid'))
  expect(last).toBe('session-close-design')
  await expect(page.getByTestId('session-rail').getByTestId('session-close-design')).toHaveCount(0)
  await expect(page.getByTestId('session-rail').getByTestId('session-discard')).toBeVisible()
  await expect(page.getByTestId('session-graded')).toHaveText('Canvas, notes and the chat are all graded.')
  // the autosave line is in view on every tab
  for (const tab of ['partner', 'dives', 'notes']) {
    await page.getByTestId(`session-tab-${tab}`).click()
    await expect(page.getByTestId('session-autosave')).toBeVisible()
  }
  await expect(page.getByTestId('session-autosave')).toHaveText('Autosave on')
  expect(await page.locator('[data-accent="primary"]').count()).toBe(1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feat-f2-live-1280x800.png` })
  check()
})

test('DESIGN-89 the graded line reads per mode (solo)', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await expect(page.getByTestId('session-graded')).toHaveText('Canvas and notes are graded.')
  check()
})

test('DESIGN-89 the graded line reads per mode (with someone)', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'With someone')
  await expect(page.getByTestId('session-graded')).toHaveText('Your partner scores the canvas and notes.')
  check()
})

test('DESIGN-88 the footer at 1100 sits under the panels; at 375 the buttons are inside the viewport and nothing scrolls sideways', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 1100, height: 800 })
  await begin(page)
  await startSession(page, 'Solo')
  let f = await box(page, 'session-footer')
  expect(f.y + f.height).toBeLessThanOrEqual(800)
  for (const w of [1099, 375]) {
    await page.setViewportSize({ width: w, height: w === 375 ? 667 : 800 })
    f = await page.getByTestId('session-footer').evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y + window.scrollY, width: b.width, height: b.height } })
    const tabs = await page.getByTestId('session-tabs').evaluate(el => { const b = el.getBoundingClientRect(); return b.bottom + window.scrollY })
    expect(f.y, `${w}: under the panels`).toBeGreaterThanOrEqual(tabs - 1)
    for (const id of ['session-pause', 'session-close-design']) {
      const b = await box(page, id)
      expect(b.x, `${w}: ${id}`).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width, `${w}: ${id}`).toBeLessThanOrEqual(w)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${w}: no sideways scroll`).toBeLessThanOrEqual(w)
  }
  if (SHOTS) {
    await page.getByTestId('session-footer').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/feat-f2-live-375.png`, fullPage: true })
  }
  check()
})

test('DESIGN-90/91/92/93/94 Pause stops the clock, makes the work read-only, survives a reload and Resume goes on', async ({ page }) => {
  test.setTimeout(90_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  await openNotes(page, 'api')
  await page.getByTestId('notes-field-api').fill('POST /photos')
  await page.clock.runFor(30_000)
  await expect(page.getByTestId('session-timer')).toHaveText('44:30')
  await page.getByTestId('session-pause').click()
  await expect(page.getByTestId('session-pause')).toHaveText('Resume')
  await expect(page.getByTestId('session-phase')).toHaveText('Paused')
  await expect(page.getByTestId('session-paused')).toHaveText('Paused. The clock is stopped.')
  await expect.poll(async () => (await stored(page)).pausedAt).toBeTruthy()
  const row = await stored(page)
  expect(row.phase).toBe('drawing')
  expect(row.pausedMs ?? 0).toBe(0)
  await page.clock.runFor(120_000)
  await expect(page.getByTestId('session-timer')).toHaveText('44:30')
  // read-only: notes, canvas tools and the chat; sections and tabs still work
  await expect(page.getByTestId('notes-field-api')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('kit-add-custom')).toBeDisabled()
  await expect(page.getByTestId('kit-add-note')).toBeDisabled()
  await expect(page.getByTestId('kit-add-table')).toBeDisabled()
  await expect(page.getByTestId('kit-add-frame')).toBeDisabled()
  await expect(page.getByTestId('schema-add-table')).toBeDisabled()
  await page.getByTestId('notes-field-api').click()
  await page.keyboard.type('zzz')
  await expect(page.getByTestId('notes-field-api')).toHaveValue('POST /photos')
  await page.getByTestId('kit-canvas').focus()
  for (const k of ['n', 'c', 't', 'g']) await page.keyboard.press(k)
  await page.getByTestId('notes-section-open-toggle').click() // sections still open and close
  expect(await expanded(page, 'open')).toBe('true')
  await page.getByTestId('session-tab-dives').click()
  await page.getByTestId('session-tab-partner').click()
  await expect(page.getByTestId('session-chat-input')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('session-send')).toBeDisabled()
  await expect(page.getByTestId('session-hint')).toBeDisabled()
  expect((await stored(page)).canvas.nodes).toHaveLength(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feat-f2-paused-1280x800.png` })
  // no auto-lock however long it stays paused
  await page.clock.fastForward(10 * 60 * MIN) // one jump, not 36,000 ticks
  await expect(page.getByTestId('session-phase')).toHaveText('Paused')
  await expect(page.getByTestId('session-timer')).toHaveText('44:30')
  expect((await stored(page)).phase).toBe('drawing')
  // a reload keeps the pause
  const pausedAt = (await stored(page)).pausedAt
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-paused')).toBeVisible()
  await expect(page.getByTestId('session-pause')).toHaveText('Resume')
  await expect(page.getByTestId('session-phase')).toHaveText('Paused')
  await expect(page.getByTestId('session-timer')).toHaveText('44:30')
  expect((await stored(page)).pausedAt).toBe(pausedAt)
  // resume: the clock goes on from 44:30 and the pause is stored
  await page.getByTestId('session-pause').click()
  await expect(page.getByTestId('session-pause')).toHaveText('Pause')
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await expect(page.getByTestId('session-paused')).toHaveCount(0)
  await expect.poll(async () => (await stored(page)).pausedAt ?? null).toBeNull()
  const resumed = await stored(page)
  expect(resumed.pausedMs!).toBeGreaterThanOrEqual(10 * 60 * MIN + 120_000)
  await page.clock.runFor(10_000)
  await expect(page.getByTestId('session-timer')).toHaveText('44:20')
  await expect(page.getByTestId('notes-field-api')).not.toHaveAttribute('readonly', '')
  check()
})

test('DESIGN-95 Close while paused locks with the pause left out of the minutes; Discard while paused still asks', async ({ page }) => {
  test.setTimeout(90_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.clock.runFor(10 * MIN)
  await page.getByTestId('session-pause').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Paused')
  await page.clock.runFor(20 * MIN)
  await page.getByTestId('session-close-design').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
  await expect(page.getByTestId('session-timer')).toHaveText('35:00')
  await expect.poll(async () => (await stored(page)).phase).toBe('close')
  const row = await stored(page)
  expect(row.minutes).toBe(10)
  expect(row.pausedAt ?? null).toBeNull()
  expect(Math.abs(row.pausedMs! - 20 * MIN)).toBeLessThanOrEqual(2000)
  check()
})

test('DESIGN-95 Discard while paused opens the dialog and confirming removes the session', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('session-pause').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Paused')
  await page.getByTestId('session-discard').click()
  await expect(page.getByTestId('session-discard-confirm')).toBeVisible()
  await page.getByTestId('session-discard-confirm').click()
  await expect(page.getByTestId('session-start')).toBeVisible()
  check()
})

test('DESIGN-96 the partner card clock follows the pause', async ({ page, context }) => {
  test.setTimeout(90_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'With someone')
  const id = (await liveRow(page)).id
  await page.clock.runFor(30_000)
  await page.clock.resume() // a frozen clock starves the mount of a new page
  const card = await context.newPage()
  await card.goto(`/#/partner/${id}`)
  await expect(card.getByTestId('partner-card')).toBeVisible()
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 500))
  await page.clock.runFor(1000)
  await page.getByTestId('session-pause').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Paused')
  const frozen = await timer(page)
  await page.clock.runFor(60_000)
  await expect(card.getByTestId('partner-clock')).toHaveText(frozen)
  expect(await timer(page)).toBe(frozen)
  await page.getByTestId('session-pause').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await check()
})

import { expect, test, type Page } from '@playwright/test'
import { addKind, begin, endDrawing, fillClose, guard, liveRow, putDesignSession, RL, RL_DIVES, startSession } from './design-helpers'

// Blind-fix round 2, unit 2b: DESIGN-06 (the countdown), GLOBAL-03/DESIGN-74 (the view toggle), GLOBAL-04 (grade total font),
// GLOBAL-05 (square radios) and GLOBAL-10 (session-grade on a finished With someone session).
const ACCENT = 'rgb(255, 138, 42)'

// A native radio is drawn round by the browser whatever the page sets (its computed radius can read 50%): these radios draw themselves (appearance none) as squares.
const radiiOf = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll(els => els.map(e => {
    const cs = getComputedStyle(e)
    return { id: e.getAttribute('data-testid'), r: `${cs.borderTopLeftRadius}|${cs.borderBottomRightRadius}`, appearance: cs.appearance }
  }))

test('DESIGN-06 the countdown drops by one second per second from the first reading', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo') // the rail was on screen (setup) before the clock froze, so its tick is not on the session\'s own second
  const secs = async () => {
    const [m, s] = (await page.getByTestId('session-timer').innerText()).split(':').map(Number)
    return m * 60 + s
  }
  const reads = [await secs()]
  for (let i = 0; i < 4; i++) { await page.clock.runFor(1000); reads.push(await secs()) }
  expect(reads[0]).toBeLessThanOrEqual(2700)
  expect(reads[0]).toBeGreaterThanOrEqual(2690)
  for (let i = 1; i < reads.length; i++) expect(reads[i - 1] - reads[i], `step ${i} of ${reads.join(', ')}`).toBe(1)
  check()
})

test('GLOBAL-03 / DESIGN-74 the selected view toggle and a selected link are not accent-filled; the one accent is the phase\'s advance button', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await addKind(page, 'browser')
  await addKind(page, 'gateway')
  await page.getByTestId('kit-node-browser-1').click()
  await page.keyboard.press('l')
  await page.getByTestId('kit-node-gateway-1').click()
  await page.locator('[data-testid^="kit-link-browser-1-"]').first().click() // a selected link marker is a pressed button too
  await expect(page.getByTestId('kit-view-2d')).toHaveAttribute('aria-pressed', 'true')
  const accentFilled = await page.locator('button').evaluateAll((els, accent) =>
    els.filter(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).backgroundColor === accent && e.getAttribute('data-accent') !== 'primary').map(e => e.getAttribute('data-testid') ?? e.textContent), ACCENT)
  expect(accentFilled).toEqual([])
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
  await expect(page.getByTestId('session-close-design')).toHaveCSS('background-color', ACCENT)
  // still clearly selected: it differs from the unselected Iso switch
  const on = await page.getByTestId('kit-view-2d').evaluate(e => getComputedStyle(e).backgroundColor)
  const off = await page.getByTestId('kit-view-iso').evaluate(e => getComputedStyle(e).backgroundColor)
  expect(on).not.toBe(off)
  await page.getByTestId('kit-view-iso').click()
  await expect(page.getByTestId('kit-view-iso')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.getByTestId('kit-view-iso').evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(ACCENT)
  check()
})

test('GLOBAL-05 the close and score radios are square', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await endDrawing(page)
  const q4 = await radiiOf(page, '[data-testid^="session-close-q4-"]')
  expect(q4.length).toBe(5)
  for (const r of q4) expect(r, String(r.id)).toEqual({ id: r.id, r: '0px|0px', appearance: 'none' })
  await fillClose(page, RL_DIVES[1])
  const dives = await radiiOf(page, 'input[type="radio"][data-testid^="session-dive-score-"]')
  expect(dives.length).toBe(12)
  for (const r of dives) expect(r, String(r.id)).toEqual({ id: r.id, r: '0px|0px', appearance: 'none' })
  const lenses = await page.locator('[data-testid="session-score"] input[type="radio"]').evaluateAll(els => els.map(e => `${getComputedStyle(e).borderTopLeftRadius} ${getComputedStyle(e).appearance}`))
  expect(lenses.length).toBeGreaterThan(12)
  expect(new Set(lenses)).toEqual(new Set(['0px none']))
  // a checked one still reads as checked (its fill is drawn)
  await page.getByTestId('session-dive-score-1-1').check()
  await expect(page.getByTestId('session-dive-score-1-1')).toBeChecked()
  check()
})

test('GLOBAL-05 the partner card radios are square', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'With someone')
  const id = (await liveRow(page)).id
  await page.clock.resume() // a frozen clock starves the mount of a new page (see design-helpers `freeze`)
  const card = await page.context().newPage()
  await card.goto(`/#/partner/${id}`)
  await expect(card.getByTestId('partner-card')).toBeVisible()
  const rows = await radiiOf(card, '[data-testid^="partner-score-"][type="radio"]')
  expect(rows.length).toBe(5 * 5 + 4 * 3)
  for (const r of rows) expect(r, String(r.id)).toEqual({ id: r.id, r: '0px|0px', appearance: 'none' })
  check()
})

test('GLOBAL-10 / GLOBAL-04 a finished With someone session shows session-grade; its total is not pixel type inside a paragraph', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.goto(`/designs/session/${RL}`)
  await page.getByTestId('session-start').waitFor()
  const at = await page.evaluate(() => Date.now())
  await putDesignSession(page, {
    id: 'ds-done-someone', designId: RL, at: at - 60 * 60_000, phase: 'done', mode: 'human-partner', view: '2d', endedAt: at - 10 * 60_000, lockedAt: at - 15 * 60_000, minutes: 45,
    canvas: { layout: 'manual', nodes: [], links: [], zones: [], flows: [], notes: [] },
    close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 'none', readNext: 'DDIA' },
    deepDives: RL_DIVES.map((q, i) => ({ q, answered: ([2, 1, 2, 1] as const)[i], by: 'partner' })),
    tradeoffs: [], lenses: {}, rubric: 14, rubricBy: 'partner',
    partner: { name: 'Sam', at: at - 12 * 60_000, scores: { perItem: [4, 3, 3, 2, 2], deepDives: [2, 1, 2, 1] } },
  })
  await page.goto(`/designs/session/${RL}?session=ds-done-someone`)
  await expect(page.getByTestId('session-summary')).toBeVisible()
  await expect(page.getByTestId('session-grade')).toBeVisible()
  await expect(page.getByTestId('session-grade-total')).toContainText('14 of 20')
  expect(await page.getByTestId('session-grade-total').evaluate(e => !!e.closest('p, label, button, li, td, th'))).toBe(false)
  for (let n = 1; n <= 5; n++) await expect(page.getByTestId(`session-grade-item-${n}`)).toBeVisible()
  check()
})

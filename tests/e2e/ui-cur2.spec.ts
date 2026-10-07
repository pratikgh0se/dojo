import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-r2 (dojo-acceptance/reports/uat/cu-r2.md). The stray-key P2 lives in ui-cu1.spec.ts.
const TUE = '2026-10-06T10:00:00'

async function openDo(page: Page) {
  await page.clock.setFixedTime(IST(TUE))
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  const id = (await page.getByTestId('start-button').getAttribute('href'))!.replace('/do/', '')
  await page.goto(`/do/${id}`)
  await expect(page.getByTestId('do-screen')).toBeVisible()
}

test.describe('A2#6 · a locked ladder rung says why when clicked', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('Hint, Picture, Video and Solution each give their reason', async ({ page }) => {
    await openDo(page)
    const say: Array<[string, RegExp]> = [
      ['hint', /Hint opens after 10 minutes/],
      ['picture', /Picture opens once you have opened a Hint/],
      ['video', /Video opens once you have opened the Picture/],
      ['solution', /Solution opens after you give up/],
    ]
    for (const [rung, re] of say) {
      await page.getByTestId(`ladder-rung-${rung}`).click({ position: { x: 20, y: 12 } })
      await expect(page.getByTestId(`ladder-locked-why-${rung}`)).toHaveText(re)
    }
    expect(await page.getByTestId('ladder-spent').getAttribute('data-xp')).toBe('0')
  })
})

test.describe('A2#47 · Atlas "Sort by problems left" reads as on', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('pressed state changes the border colour and shows a check', async ({ page }) => {
    await page.clock.setFixedTime(IST(TUE))
    await onboard(page, '2026-10-05')
    await page.goto('/atlas')
    await expect(page.getByTestId('screen-atlas')).toHaveAttribute('data-ready', 'true')
    const btn = page.getByRole('button', { name: 'Sort by problems left' })
    const look = () => btn.evaluate(e => ({ border: getComputedStyle(e).borderTopColor, before: getComputedStyle(e, '::before').content }))
    const off = await look()
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    const on = await look()
    expect(on.border).not.toBe(off.border)
    expect(on.before).toContain('✓')
    expect(off.before === 'none' || off.before === 'normal').toBe(true)
  })
})

test.describe('A2#55 · Hello Interview empty chips', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('S-12 keeps the dash text; each dash names what is missing on hover and to a reader', async ({ page }) => {
    await page.clock.setFixedTime(IST(TUE))
    await onboard(page, '2026-10-05')
    await page.goto('/banks?bank=hellointerview')
    await expect(page.getByTestId('screen-banks')).toHaveAttribute('data-ready', 'true')
    const d = page.getByTestId('bank-item-difficulty').first()
    const p = page.getByTestId('bank-item-pattern').first()
    await expect(d).toHaveText('—')
    await expect(p).toHaveText('—')
    await expect(d).toHaveAttribute('data-tip', 'No difficulty for this item')
    await expect(p).toHaveAttribute('data-tip', 'No pattern for this item')
  })
})

test.describe('A2#45 · the warm-up scrubber at 375', () => {
  test.use({ viewport: { width: 375, height: 860 } })
  test('is a full-width row, not a stub between the buttons', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/dsa?topic=7')
    const scrub = page.getByRole('region', { name: 'Warm-up', exact: true }).getByTestId('lab-scrub')
    await expect(scrub).toBeVisible()
    const box = (await scrub.boundingBox())!
    expect(box.width).toBeGreaterThan(260)
    expect(box.height).toBeGreaterThanOrEqual(20)
  })
})

test.describe('A2#Map · sprint tiles are touch targets at 375', () => {
  test.use({ viewport: { width: 375, height: 860 } })
  test('every Map sprint tile is at least 44 x 44', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/map')
    const tiles = page.locator('.path-sprint')
    await expect(tiles.first()).toBeVisible()
    const sizes = await tiles.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10] }))
    expect(sizes.length).toBeGreaterThan(3)
    for (const [w, h] of sizes) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44) }
  })
})

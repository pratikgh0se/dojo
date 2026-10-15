import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-5 (dojo-acceptance/reports/uat/cu-5.md, 45f8e44: Python, the visual families, labs,
// projects, checks). The P2 findings have their own specs (storage/families-size, storage/grade-real, vitest); the P3s that
// are about layout and scroll are measured here, on the real page.
const TUE = '2026-10-06T10:00:00' // sprint 1 day 2

async function open(page: Page) {
  await page.clock.setFixedTime(IST(TUE))
  await onboard(page, '2026-10-05')
}

test.describe('P3-5 · Back from Do returns the DSA bank to the place it was left', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the same scroll position, every time, even when the bank is slow to fill in', async ({ page }) => {
    await open(page)
    await page.goto('/dsa?topic=1')
    const rows = page.getByTestId('topic-detail').locator('[data-testid^="do-"]')
    await expect(rows.first()).toBeVisible()
    const n = await rows.count()
    expect(n).toBeGreaterThan(3)
    // a slow machine: the bank draws a few frames after the page is back, so the first scroll lands on a short page
    const cdp = await page.context().newCDPSession(page)
    for (let round = 0; round < 3; round++) {
      // a row well down the page, scrolled to the middle of the window
      const last = rows.nth(n - 1)
      await last.scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy(0, 120))
      const before = await page.evaluate(() => window.scrollY)
      expect(before).toBeGreaterThan(300)
      await last.click()
      await expect(page).toHaveURL(/\/do\//)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 })
      await page.getByTestId('do-back').click()
      await expect(page).toHaveURL(/\/dsa\?topic=1/)
      await expect(page.getByTestId('topic-detail')).toBeVisible()
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      await expect.poll(() => page.evaluate(() => window.scrollY), { message: `round ${round}`, timeout: 4000 }).toBeGreaterThanOrEqual(before - 2)
      expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(before + 2)
    }
  })
})

test.describe('P3-10 · the Atlas two-up "Compare with" select shows the chosen walkthrough', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('its box is wide enough for the title it holds', async ({ page }) => {
    await open(page)
    await page.goto('/atlas?pattern=binary-search')
    await page.getByRole('list', { name: 'Walkthroughs', exact: true }).getByRole('listitem').filter({ has: page.getByText('Binary search', { exact: true }) }).getByRole('button', { name: 'Two-up', exact: true }).click()
    const select = page.getByRole('combobox', { name: 'Compare with', exact: true })
    await expect(select).toBeVisible()
    const room = await select.evaluate(el => {
      const s = el as HTMLSelectElement
      const cs = getComputedStyle(s)
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const text = s.options[s.selectedIndex].text
      const inner = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      return { text, inner, need: ctx.measureText(text).width, width: s.getBoundingClientRect().width }
    })
    expect(room.width, 'the select is more than a stub with a caret').toBeGreaterThan(150)
    expect(room.inner, `"${room.text}" fits its box`).toBeGreaterThanOrEqual(room.need)
  })
})

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

test.describe('P3-14 · /ai on a phone: a ladder row keeps its Blank test button on screen', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the stage ladder does not scroll sideways, and every row shows its button inside the window', async ({ page }) => {
    await open(page)
    await page.goto('/ai')
    const ladder = page.getByTestId('ai-cube-ladder')
    await expect(ladder).toBeVisible()
    const scroller = ladder.locator('.p-scroll')
    const overflow = await scroller.evaluate(el => el.scrollWidth - el.clientWidth)
    expect(overflow, 'the ladder scrolls sideways inside its panel').toBeLessThanOrEqual(1)
    for (const nn of ['00', '05', '11']) {
      const row = page.getByTestId(`ai-cube-row-${nn}`)
      await row.scrollIntoViewIfNeeded()
      const btn = page.getByTestId(`ai-blank-${nn}`)
      const b = (await btn.boundingBox())!
      expect(b.x, `Blank test ${nn} starts on screen`).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width, `Blank test ${nn} ends on screen`).toBeLessThanOrEqual(375)
      const r = (await row.boundingBox())!
      expect(b.x + b.width, `Blank test ${nn} sits inside its row`).toBeLessThanOrEqual(r.x + r.width + 1)
      // the three cubes stay beside the stage name
      for (const cell of ['learn', 'build', 'prove']) {
        const c = (await page.getByTestId(`ai-cube-${nn}-${cell}`).boundingBox())!
        expect(c.x + c.width).toBeLessThanOrEqual(375)
        expect(c.y).toBeLessThan(b.y)
      }
    }
  })
})

test.describe('P3-9 · the First loss tile keeps its text inside', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('a long artifact title wraps inside the tile instead of running into its border', async ({ page }) => {
    await open(page)
    await page.goto('/ai')
    await page.getByRole('button', { name: 'Add artifact' }).click()
    const add = page.getByRole('dialog', { name: 'New artifact' })
    await add.getByLabel('Title', { exact: true }).fill('micrograd engine with a rather long title')
    await add.getByLabel('Stage', { exact: true }).selectOption({ label: 'Stage 01' })
    await add.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(add).toBeHidden()
    await page.getByTestId('board-card').filter({ hasText: 'micrograd engine with a rather long title' }).getByTestId('board-card-open').click()
    const dlg = page.getByRole('dialog', { name: 'Artifact · micrograd engine with a rather long title' })
    const form = dlg.getByTestId('measure-form')
    await form.getByLabel('Measure', { exact: true }).selectOption('loss')
    await form.getByLabel('Value', { exact: true }).fill('1.98')
    await form.getByRole('button', { name: 'Add measure' }).click()
    await expect(dlg.getByTestId('measure-list').getByRole('listitem')).toHaveCount(1)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    const tile = page.getByTestId('measure-first-loss')
    await tile.scrollIntoViewIfNeeded()
    // the pinned text is untouched
    await expect(tile).toHaveText('1.98 · S1 · micrograd engine with a rather long title')
    const fit = await tile.evaluate(el => {
      const box = el.closest('.sr-tile')!.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = [...range.getClientRects()]
      return { tileRight: box.right, tileLeft: box.left, textRight: Math.max(...rects.map(r => r.right)), textLeft: Math.min(...rects.map(r => r.left)), lines: new Set(rects.map(r => Math.round(r.top))).size }
    })
    expect(fit.textRight, 'the text stops inside the tile').toBeLessThanOrEqual(fit.tileRight - 8)
    expect(fit.textLeft).toBeGreaterThanOrEqual(fit.tileLeft + 8)
    expect(fit.lines).toBeGreaterThan(1) // it wrapped, at its spaces
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

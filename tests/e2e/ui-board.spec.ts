import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// ui-board B3 + ui-dialogs DL11 / rendering check: measured layout per breakpoint.
async function openBoard(page: Page) {
  await page.clock.setFixedTime(IST('2026-10-07T10:00:00'))
  await onboard(page, '2026-10-05')
  await page.goto('/board')
  await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
}
const box = (page: Page, testId: string) => page.getByTestId(testId).evaluate(e => e.getBoundingClientRect().toJSON())
const scrollWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth)

test.describe('Board at 834 (tablet)', () => {
  test.use({ viewport: { width: 834, height: 1000 } })
  test('all four columns share one row with no page scroll; the strip wraps into 2 rows', async ({ page }) => {
    await openBoard(page)
    const cols = await Promise.all(['slid', 'todo', 'doing', 'done'].map(c => box(page, `col-${c}`)))
    expect(new Set(cols.map(c => Math.round(c.top))).size).toBe(1)
    for (const c of cols) expect(c.width).toBeGreaterThan(170)
    expect(cols[3].right).toBeLessThanOrEqual(834 - 23)
    expect(await scrollWidth(page)).toBeLessThanOrEqual(834)
    const tops = await page.getByTestId('strip').locator('button').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size)
    expect(tops).toBe(2)
    // touch widths: the rail is always visible
    await expect(page.getByTestId('col-todo').getByRole('link', { name: /^Do: / }).first()).toBeVisible()
  })
})

test.describe('Board at 1280 (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('the slide dialog is 640 wide, centred, 48 from the top, titled in Silkscreen accent', async ({ page }) => {
    await openBoard(page)
    const native: string[] = []
    page.on('dialog', d => { native.push(d.message()); void d.dismiss() })
    await page.getByRole('button', { name: 'Slide sprint ›' }).click()
    const dlg = page.getByRole('dialog', { name: 'Slide sprint?' })
    await expect(dlg).toBeVisible()
    await dlg.evaluate(e => Promise.all(e.getAnimations().map(a => a.finished))) // srin: 160 ms translateY
    const b = await dlg.evaluate(e => e.getBoundingClientRect().toJSON())
    expect(Math.round(b.width)).toBe(640)
    expect(Math.abs(b.left - (1280 - 640) / 2)).toBeLessThanOrEqual(1)
    expect(Math.round(b.top)).toBe(48)
    const h2 = await dlg.locator('h2').evaluate(e => { const s = getComputedStyle(e); return [s.fontFamily.split(',')[0].replace(/"/g, ''), s.fontSize, s.fontWeight, s.color] })
    expect(h2).toEqual(['Silkscreen', '16px', '700', 'rgb(255, 181, 69)'])
    const p = await dlg.locator('p').evaluate(e => { const s = getComputedStyle(e); return [s.fontSize, s.lineHeight] })
    expect(p).toEqual(['17px', '26.35px'])
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('button', { name: 'Slide sprint ›' })).toBeFocused()
    expect(native).toEqual([])
  })
})

for (const width of [393, 375]) {
  test.describe(`Board at ${width} (phone)`, () => {
    test.use({ viewport: { width, height: 852 } })
    test('columns stack with only Todo and Doing open; dialogs sit at x = 16 and never widen the page', async ({ page }) => {
      await openBoard(page)
      for (const [c, open] of [['slid', 'false'], ['todo', 'true'], ['doing', 'true'], ['done', 'false']] as const) {
        await expect(page.getByTestId(`col-${c}`).locator('h2 > button')).toHaveAttribute('aria-expanded', open)
      }
      const todo = await box(page, 'col-todo')
      const doing = await box(page, 'col-doing')
      expect(doing.top).toBeGreaterThan(todo.bottom)
      expect(await scrollWidth(page)).toBeLessThanOrEqual(width)
      const tools = await page.getByTestId('col-todo').locator('article').first().getByRole('button', { name: 'Pin' }).evaluate(e => e.getBoundingClientRect().height)
      expect(tools).toBeGreaterThanOrEqual(44)
      for (const [btn, name] of [['Slide sprint ›', 'Slide sprint?'], ['Shift plan ›', 'Shift plan?']]) {
        await page.getByRole('button', { name: btn }).click()
        const dlg = page.getByRole('dialog', { name })
        await dlg.evaluate(e => Promise.all(e.getAnimations().map(a => a.finished))) // srin: 160 ms translateY
        const b = await dlg.evaluate(e => e.getBoundingClientRect().toJSON())
        expect(Math.round(b.left)).toBe(16)
        expect(Math.round(b.right)).toBe(width - 16)
        expect(Math.round(b.top)).toBe(16)
        expect(await scrollWidth(page)).toBeLessThanOrEqual(width)
        for (const h of await dlg.getByRole('button').evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON())))
          { expect(h.height).toBeGreaterThanOrEqual(44); expect(Math.round(h.width)).toBe(Math.round(b.width) - 38) }
        await dlg.getByRole('button', { name: 'Cancel' }).click()
        await expect(dlg).toBeHidden()
      }
    })
  })
}

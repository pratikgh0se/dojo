import { expect, test } from './fixtures'
import { IST, idbAll, onboard } from './helpers'

type Row = { id: string; status: string; orderOverride?: number }

// R1 blind-fix 2c: Path clauses PATH-10, PATH-15, PATH-19, PATH-22.
async function openPath(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.goto('/path')
  await expect(page.getByTestId('path-upnext-title')).toBeVisible()
}

test('PATH-10: "/" pressed the moment the Path screen appears still focuses the search box and is not typed', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.goto('/path')
  await expect(page.getByTestId('screen-path')).toBeVisible() // the screen root is there before its chunk and queue have loaded
  await page.keyboard.press('/')
  await expect(page.getByTestId('path-search')).toBeFocused()
  await expect(page.getByTestId('path-search')).toHaveValue('')
})

test('PATH-15: "Show more" lists a long lane in a few presses, and the line goes when nothing remains', async ({ page }) => {
  await openPath(page)
  const more = page.getByTestId('path-upnext-more')
  await expect(more).toBeVisible()
  const rows = () => page.locator('[data-testid="path-upnext"] [data-testid^="row-"]').count()
  let n = await rows()
  let presses = 0
  while (await more.count()) {
    await more.click()
    presses++
    await expect.poll(rows).toBeGreaterThan(n)
    expect((await rows()) - n).toBeGreaterThanOrEqual(10)
    n = await rows()
    expect(presses).toBeLessThan(8)
  }
  await expect(more).toHaveCount(0)
})

test('PATH-19 / PATH-22: a row far down the list drops into Doing, and nothing sets Done by dragging', async ({ page }) => {
  await openPath(page)
  const ids = await page.locator('[data-testid="path-upnext"] [data-testid^="row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-ticket-id')!))
  const doing = page.getByTestId('path-doing')
  // Doing stays on screen while the list scrolls, so the pointer never has to scroll away from the row it holds
  await page.mouse.wheel(0, 700)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  await expect(doing).toBeInViewport()

  const far = ids[ids.length - 1]
  await page.getByTestId(`row-${far}`).dragTo(doing)
  await expect.poll(async () => (await idbAll<Row>(page, 'tickets')).find(t => t.id === far)?.status).toBe('doing')
  const moved = (await idbAll<Row>(page, 'tickets')).find(t => t.id === far)!
  expect(moved.orderOverride).toBeUndefined()

  // PATH-22: dropping a row on Done changes nothing
  const before = JSON.stringify(await idbAll<Row>(page, 'tickets'))
  const other = ids[0]
  await page.getByTestId(`row-${other}`).dragTo(page.getByTestId('path-done'))
  await page.waitForTimeout(500)
  expect(JSON.stringify(await idbAll<Row>(page, 'tickets'))).toBe(before)
})

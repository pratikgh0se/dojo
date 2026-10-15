import { expect, test } from './fixtures'
import { IST, idbAll, onboard } from './helpers'

type Row = { id: string; order?: number; orderOverride?: number }

// R1 Path (PATH-20 / PATH-31): reordering inside a lane writes only the moved ticket's `orderOverride`, and the order survives a reload.
// Runs in the default project on Dexie and in `real` against dojo-server (tests/e2e/real/subset.ts).
test('R1 Path: Alt+ArrowUp moves a DSA row up within its lane, writes only its orderOverride, and the order survives a reload', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.getByTestId('shell-rail').getByRole('link').nth(1).click() // key 2 would do as well; the rail link keeps the spec off the keyboard
  await expect(page).toHaveURL(/\/path$/)
  await page.getByTestId('path-lane-dsa').click()
  const ids = () => page.locator('[data-testid="path-upnext"] [data-testid^="row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')!.slice('row-'.length)))
  const before = await ids()
  expect(before.length).toBeGreaterThanOrEqual(3)
  const [first, second, third] = before
  const tickets0 = await idbAll<Row>(page, 'tickets')
  const orderOf = (rows: Row[], id: string) => rows.find(t => t.id === id)?.order

  await page.getByTestId(`do-${third}`).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(ids).toEqual([first, third, second, ...before.slice(3)])
  await expect(page.getByTestId(`do-${third}`)).toBeFocused()

  await expect.poll(async () => (await idbAll<Row>(page, 'tickets')).find(t => t.id === third)?.orderOverride).toBeDefined()
  const tickets1 = await idbAll<Row>(page, 'tickets')
  const moved = tickets1.find(t => t.id === third)!
  expect(orderOf(tickets1, third)).toBe(orderOf(tickets0, third)) // `order` is never written
  // between the former 1st and 2nd in effective order
  const eff = (id: string) => tickets1.find(t => t.id === id)!.orderOverride ?? tickets1.find(t => t.id === id)!.order!
  expect(moved.orderOverride!).toBeGreaterThan(eff(first))
  expect(moved.orderOverride!).toBeLessThan(eff(second))
  // no other ticket got an override
  expect(tickets1.filter(t => t.orderOverride !== undefined).map(t => t.id)).toEqual([third])

  await page.reload()
  await page.getByTestId('path-lane-dsa').click()
  await expect.poll(ids).toEqual([first, third, second, ...before.slice(3)])
})

import { expect, test, type Page } from '@playwright/test'
import { IST, appDbName, idbAll, onboard } from './helpers'

// R2 fix round A (rituals.md RIT-50, RIT-64, RIT-69, RIT-73): phone layout and the Open hand-off, in a real browser. Rules are in tests/unit.
const PHONE = { width: 375, height: 667 }

async function idbPut(page: Page, store: string, row: Record<string, unknown>): Promise<void> {
  const dbName = await appDbName(page)
  await page.evaluate(
    ({ store, row, dbName }) => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(store, 'readwrite')
        tx.objectStore(store).put(row)
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
      }
    }),
    { store, row, dbName },
  )
}

async function openToday(page: Page, clock: string): Promise<void> {
  await page.clock.setFixedTime(IST(clock))
  await onboard(page, '2026-10-21')
}

test('RIT-64: on a phone the leading Floor card START is at least 90 percent of the viewport wide and above the tab bar', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await openToday(page, '2026-11-04T10:00:00')
  const start = IST('2026-10-25T10:00:00').getTime()
  await idbPut(page, 'sessions', { id: 's-e2e-old', ticketId: 'none', start, end: start + 25 * 60_000, minutes: 25, outcome: 'studied', xpDelta: 0 })
  await page.reload()
  await expect(page.getByTestId('today-floor')).toHaveAttribute('data-lead', 'restart')
  const box = await page.getByTestId('today-floor-start').boundingBox()
  const bar = await page.getByTestId('shell-tabbar').boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(PHONE.width * 0.9)
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y)
})

test('RIT-73: with the focus line above it, START stays above the tab bar at 375 x 667', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await openToday(page, '2026-11-04T10:00:00')
  await idbPut(page, 'weeklyReviews', { id: 'wr-2026-W44', week: '2026-W44', worked: 'a', change: 'b', focus: 'Finish the roofline function', at: IST('2026-11-01T14:00:00').getTime() })
  await page.reload()
  await expect(page.getByTestId('today-focus')).toBeVisible()
  const box = await page.getByTestId('start-button').boundingBox()
  const bar = await page.getByTestId('shell-tabbar').boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y)
})

test('RIT-50: a control scrolled into view on a phone stops above the tab bar (scroll padding), and not on a desktop', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await openToday(page, '2026-11-04T10:00:00')
  const pad = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0)
  expect(await pad()).toBeGreaterThanOrEqual(68)
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(pad).toBe(0)
})

test('RIT-69: the drill ticket page already shows its title when the URL changes', async ({ page }) => {
  await openToday(page, '2026-11-07T10:00:00')
  await page.getByTestId('today-ritual-open-model-swap-drill').click()
  await page.waitForURL(/\/do\/ritual-model-swap-drill-2026-11$/)
  const text = await page.getByTestId('screen-do').innerText() // a locator read, taken as soon as the URL changed: the root must not be an empty shell
  expect(text.toLowerCase()).toContain('model swap drill')
  expect(text).toContain('180 min')
})

test('RIT-54: on a restart day a started ticket keeps the Floor lead; its quest sits right below the Floor card with the one accent', async ({ page }) => {
  await openToday(page, '2026-11-04T10:00:00')
  const start = IST('2026-10-25T10:00:00').getTime()
  await idbPut(page, 'sessions', { id: 's-e2e-old', ticketId: 'none', start, end: start + 25 * 60_000, minutes: 25, outcome: 'studied', xpDelta: 0 })
  const tickets = await idbAll<Record<string, unknown>>(page, 'tickets')
  const first = tickets.find(t => t.status === 'todo' && t.lane === 'path' && !t.archived)!
  await idbPut(page, 'tickets', { ...first, status: 'doing' })
  await page.reload()
  const floor = page.getByTestId('today-floor')
  await expect(floor).toHaveAttribute('data-lead', 'restart')
  await expect(page.getByTestId('today-welcome')).toBeVisible()
  const quest = page.getByTestId('today-quest')
  await expect(quest).toHaveAttribute('data-action', 'resume')
  const [f, q, t] = await Promise.all([floor.boundingBox(), quest.boundingBox(), page.getByTestId('today-mix-toggle').boundingBox()])
  expect(q!.y).toBeGreaterThanOrEqual(f!.y + f!.height)
  expect(t!.y).toBeGreaterThanOrEqual(q!.y + q!.height)
  await expect(page.getByTestId('start-button')).toHaveAttribute('data-accent', 'primary')
  await expect(page.getByTestId('today-floor-start')).not.toHaveAttribute('data-accent', 'primary')
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
})

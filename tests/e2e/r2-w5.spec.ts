import { expect, test, type Page } from '@playwright/test'
import { WELCOME_LINE } from '../../src/rules/floor'
import { IST, appDbName, idbAll, onboard, serveLegacyPlan } from './helpers'

// R2 W5 (rituals.md): the Floor card and session, the welcome day, the weekly review card and the Journal Week view, in a real browser at
// 1280x800 and 375 wide. The rules themselves are covered by tests/unit/*-rules.test.ts; this walks the screens.
const SHOTS = process.env.DOJO_SHOTS_DIR ?? 'test-results/r2-w5-shots'
const SIZES = [['1280', { width: 1280, height: 800 }], ['375', { width: 375, height: 812 }]] as const

/** A plain `put` into one store of the app's database (a session row on an older day makes the clock day a restart day). */
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

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const guilt = (page: Page) => page.evaluate(() => /overdue|streak|missed days|behind/i.test(document.body.innerText))

async function seedOldSession(page: Page): Promise<void> {
  const start = IST('2026-10-25T10:00:00').getTime()
  await idbPut(page, 'sessions', { id: 's-e2e-old', ticketId: 'none', start, end: start + 25 * 60_000, minutes: 25, outcome: 'studied', xpDelta: 0 })
}

/** `live`: the shipped plan (it carries the four rituals); else the ten-ticket flat plan. */
async function openToday(page: Page, clock: string, live = false): Promise<void> {
  if (!live) await serveLegacyPlan(page)
  await page.clock.setFixedTime(IST(clock))
  await onboard(page, '2026-10-21')
}

for (const [name, size] of SIZES) {
  test(`welcome day at ${name}: the welcome line, the Floor card leads with the one accent, the usual mix is behind a toggle`, async ({ page }) => {
    await page.setViewportSize(size)
    await openToday(page, '2026-11-04T10:00:00')
    await seedOldSession(page)
    await page.reload()
    await page.locator('[data-testid="screen-today"][data-ready="true"]').waitFor()
    await expect(page.getByTestId('today-welcome')).toHaveText(WELCOME_LINE)
    const floor = page.getByTestId('today-floor')
    await expect(floor).toHaveAttribute('data-lead', 'restart')
    await expect(page.getByTestId('today-floor-start')).toHaveAttribute('data-accent', 'primary')
    await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
    const toggle = page.getByTestId('today-mix-toggle')
    await expect(toggle).toHaveText('Show the usual mix')
    await expect(page.getByTestId('today-quest')).toHaveCount(0)
    const box = await page.getByTestId('today-floor-start').boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(name === '375' ? 44 : 32)
    expect(await noSideways(page)).toBe(true)
    expect(await guilt(page)).toBe(false)
    await page.screenshot({ path: `${SHOTS}/w5-today-welcome-${name}.png` })
    await toggle.click()
    await expect(toggle).toHaveText('Hide the usual mix')
    await expect(page.getByTestId('today-quest')).toBeVisible()
  })

  test(`Floor session at ${name}: with no due cards it asks for one line, Save writes the Journal row with floor true and returns to Today`, async ({ page }) => {
    await page.setViewportSize(size)
    await openToday(page, '2026-11-04T10:00:00')
    await seedOldSession(page)
    await page.reload()
    await page.getByTestId('today-floor-start').click()
    await expect(page).toHaveURL(/\/floor$/)
    await expect(page.getByTestId('screen-floor')).toHaveAttribute('data-step', 'line')
    await expect(page.getByTestId('floor-title')).toHaveText('Floor: 15 minutes')
    const save = page.getByTestId('floor-save')
    await expect(save).toBeDisabled()
    await page.getByTestId('floor-line').fill('  Read one page, that was enough  ')
    expect(await noSideways(page)).toBe(true)
    await page.screenshot({ path: `${SHOTS}/w5-floor-line-${name}.png` })
    await save.click()
    await expect(page).toHaveURL(/\/$/)
    const rows = await idbAll<Record<string, unknown>>(page, 'journal')
    expect(rows).toEqual([expect.objectContaining({ day: '2026-11-04', floor: true, line: 'Read one page, that was enough' })])
    expect(await guilt(page)).toBe(false)
  })

  test(`Sunday at ${name}: the weekly review card from 12:00, Open writes the ticket, the Week view saves the review and Today shows the focus`, async ({ page }) => {
    await page.setViewportSize(size)
    await openToday(page, '2026-11-08T13:00:00', true)
    const card = page.getByTestId('today-ritual-weekly-review')
    await expect(card).toHaveAttribute('data-state', 'open')
    await expect(card).toContainText('Weekly review')
    expect(await noSideways(page)).toBe(true)
    await page.screenshot({ path: `${SHOTS}/w5-today-sunday-${name}.png` })
    await page.goto('/journal?view=week')
    const week = page.getByTestId('journal-week')
    await expect(week).toHaveAttribute('data-week', '2026-W45')
    await expect(page.getByTestId('journal-week-save')).toBeDisabled()
    await page.getByTestId('journal-week-worked').fill('Finished the lab outline')
    await page.getByTestId('journal-week-focus').fill('Roofline function and its test')
    expect(await noSideways(page)).toBe(true)
    await page.screenshot({ path: `${SHOTS}/w5-journal-week-${name}.png` })
    await page.getByTestId('journal-week-save').click()
    await expect(page.getByTestId('journal-week-saved')).toBeVisible()
    await expect(page.getByTestId('journal-week-save')).toBeDisabled()
    const rows = await idbAll<Record<string, unknown>>(page, 'weeklyReviews')
    expect(rows).toEqual([expect.objectContaining({ id: 'wr-2026-W45', week: '2026-W45', worked: 'Finished the lab outline', change: '', focus: 'Roofline function and its test' })])
    await page.goto('/')
    await expect(page.getByTestId('today-focus')).toHaveText('Roofline function and its test')
    expect(await guilt(page)).toBe(false)
  })
}

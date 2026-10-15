import { expect, test, type Page } from './fixtures'
import { IST, idbAll, onboard } from './helpers'

// R1 F1: the Today ritual column (TODAY-33 to TODAY-48). Clock: Wednesday 2026-11-04 10:00 IST, ISO week 2026-W45.
// pictures go to F1_SHOTS_DIR (the visual-check folder); by default into test-results
const SHOTS = process.env.F1_SHOTS_DIR ?? 'test-results/feat-f1'
const GREEN = 'rgb(61, 220, 132)'
const WED = IST('2026-11-04T10:00:00')

type Ticket = { id: string; origin: string; kind: string; lane: string; title: string; estMin: number; status: string; xp: number; text?: string }
type Pulse = { id: string; day: string; at: number; text: string }
const tickets = (page: Page) => idbAll<Ticket>(page, 'tickets')
const ritualTickets = async (page: Page) => (await tickets(page)).filter(t => t.origin.startsWith('ritual:'))
const states = (page: Page) => Promise.all([0, 1, 2, 3, 4, 5, 6].map(i => page.getByTestId(`today-week-${i}`).getAttribute('data-state')))
const colour = (page: Page, testId: string) => page.getByTestId(testId).evaluate(el => getComputedStyle(el).color)
const noSideways = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

async function start(page: Page, now = WED) {
  await page.clock.setFixedTime(now)
  await onboard(page, '2026-10-21')
}

test.describe('desktop 1280 x 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the pulse: input, Log, Enter, persists, Edit overwrites the same row, no XP', async ({ page }) => {
    await start(page)
    const card = page.getByTestId('today-pulse')
    await expect(card).toContainText('Daily AI pulse · 15 min')
    await expect(page.getByTestId('today-pulse-input')).toBeVisible()
    await expect(page.getByTestId('today-pulse-log')).toBeDisabled()
    expect(await idbAll<Pulse>(page, 'pulses')).toHaveLength(0) // loading Today wrote nothing
    expect(await ritualTickets(page)).toHaveLength(0)
    await page.screenshot({ path: `${SHOTS}/feat-f1-pulse-open-1280.png` })

    await page.getByTestId('today-pulse-input').fill('x'.repeat(160))
    expect(await page.getByTestId('today-pulse-input').inputValue()).toHaveLength(140)
    await page.getByTestId('today-pulse-input').fill('  Asked Claude to explain attention without maths  ')
    await page.getByTestId('today-pulse-input').press('Enter')
    await expect(page.getByTestId('today-pulse-text')).toHaveText('Asked Claude to explain attention without maths')
    await expect(page.getByTestId('today-pulse-when')).toHaveText('Logged this morning')
    expect(await colour(page, 'today-pulse-done')).toBe(GREEN)
    const rows = await idbAll<Pulse>(page, 'pulses')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'pulse-2026-11-04', day: '2026-11-04', text: 'Asked Claude to explain attention without maths' })
    expect(Math.abs(rows[0].at - WED.getTime())).toBeLessThan(5000)
    await page.waitForTimeout(1800)
    await page.screenshot({ path: `${SHOTS}/feat-f1-pulse-done-1280.png` })
    // with disk sync on (the `real` project) the row reaches the server's document store too
    const disk = () => page.evaluate(async () => {
      try { const r = await fetch('/db/state'); const j = r.ok ? await r.json() as { tables?: Record<string, unknown[]> } : null; return j?.tables ? (j.tables.pulses ?? []).length : null } catch { return null }
    })
    if ((await disk()) !== null) await expect.poll(disk, { timeout: 10_000 }).toBe(1)

    await page.reload()
    await expect(page.getByTestId('today-pulse-text')).toBeVisible()

    await page.getByTestId('today-pulse-edit').click()
    await expect(page.getByTestId('today-pulse-input')).toHaveValue('Asked Claude to explain attention without maths')
    await page.getByTestId('today-pulse-input').fill('')
    await expect(page.getByTestId('today-pulse-log')).toBeDisabled()
    await page.getByTestId('today-pulse-input').fill('Compared two small models on one prompt')
    await page.getByTestId('today-pulse-log').click()
    await expect(page.getByTestId('today-pulse-text')).toHaveText('Compared two small models on one prompt')
    const after = await idbAll<Pulse>(page, 'pulses')
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe('pulse-2026-11-04')
    expect((await idbAll<{ xp: number }>(page, 'tickets')).every(t => t.xp === 0)).toBe(true)
    expect(await idbAll(page, 'sessions')).toHaveLength(0)
    await expect(page.getByTestId('xp-total')).toHaveText(/\b0\b/)
  })

  test('the weekly card: copy, strip, layout, Open creates the ticket, finishing it turns the card Done', async ({ page }) => {
    await start(page)
    const card = page.getByTestId('today-ritual-try-new-model')
    await expect(card).toContainText('Try a model · weekly')
    await expect(page.getByTestId('today-ritual-due')).toHaveText('Due Saturday')
    await expect(card).toContainText('Run one small open model, then note its tokens per second and what limited it. 30 minutes, any day before Saturday.')
    expect(await states(page)).toEqual(['past', 'past', 'today', '', '', 'due', ''])
    await expect(page.getByTestId('today-week')).toHaveText('MTWTFSS')
    expect(await page.getByTestId('today-week').locator('a, button, [tabindex]').count()).toBe(0)
    expect(await card.getAttribute('data-accent')).toBeNull()
    expect(await ritualTickets(page)).toHaveLength(0)
    // day zero: both panels show with no streak, debt or due-count text (TODAY-22)
    const text = (await page.getByTestId('screen-today').innerText())
    expect(text).not.toMatch(/streak|debt|\d+\s+due/i)

    // TODAY-48 layout: both in the right column, pulse above weekly, quest to the left
    const q = (await page.getByTestId('today-quest').boundingBox())!
    const p = (await page.getByTestId('today-pulse').boundingBox())!
    const w = (await card.boundingBox())!
    expect(p.x).toBeGreaterThanOrEqual(q.x + q.width - 1)
    expect(w.x).toBeGreaterThanOrEqual(q.x + q.width - 1)
    expect(p.y + p.height).toBeLessThanOrEqual(w.y)
    await page.screenshot({ path: `${SHOTS}/feat-f1-today-1280.png` })

    await page.getByTestId('today-ritual-open-try-new-model').click()
    await expect(page).toHaveURL(/\/do\/ritual-try-new-model-2026-W45$/)
    const made = await ritualTickets(page)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({
      id: 'ritual-try-new-model-2026-W45', kind: 'ritual', lane: 'ritual', origin: 'ritual:try-new-model:2026-W45', title: 'Try a model', estMin: 30, status: 'todo', xp: 0,
      text: 'Run one small open model, then note its tokens per second and what limited it. 30 minutes, any day before Saturday.',
    })
    await expect(page.getByTestId('ticket-done')).toBeVisible() // TICKET-23: the ritual shows Done, and Start beside it
    await expect(page.getByTestId('ticket-start')).toBeVisible()
    await page.getByTestId('ticket-done').click()
    await expect(page.getByTestId('ticket-done-state')).toBeVisible()
    const done = (await ritualTickets(page))[0]
    expect(done).toMatchObject({ status: 'done', xp: 5 })
    await expect(page.getByTestId('xp-total')).toContainText('5')

    await page.getByTestId('do-back').click()
    await expect(page.getByTestId('screen-today')).toBeVisible()
    const card2 = page.getByTestId('today-ritual-try-new-model')
    await expect(card2).toContainText('Done')
    expect(await colour(page, 'today-ritual-done')).toBe(GREEN)
    expect(await states(page)).toEqual(['past', 'past', 'done', '', '', 'due', ''])
    await expect(page.getByTestId('today-ritual-due')).toHaveText('Done Wednesday')
    await expect(page.getByTestId('today-ritual-open-try-new-model')).toHaveAttribute('href', '/do/ritual-try-new-model-2026-W45')
    await expect(page.getByTestId('today-ritual-skip-try-new-model')).toHaveCount(0)
    // the finished ticket is not drawn a second time as a generic ritual card
    await expect(page.getByTestId('today-ritual-ritual-try-new-model-2026-W45')).toHaveCount(0)
    await page.waitForTimeout(1800)
    await page.screenshot({ path: `${SHOTS}/feat-f1-weekly-done-1280.png` })
  })

  test('the week strip on the due day, on Sunday and on Monday', async ({ page }) => {
    await start(page, IST('2026-11-07T10:00:00'))
    expect(await states(page)).toEqual(['past', 'past', 'past', 'past', 'past', 'due', ''])
    await expect(page.getByTestId('today-ritual-due')).toHaveText('Due Saturday')
    await page.clock.setFixedTime(IST('2026-11-08T10:00:00'))
    await page.reload()
    expect(await states(page)).toEqual(['past', 'past', 'past', 'past', 'past', 'due', 'today'])
    await page.clock.setFixedTime(IST('2026-11-02T10:00:00'))
    await page.reload()
    expect(await states(page)).toEqual(['today', '', '', '', '', 'due', ''])
  })

  test('Skip this week hides the card for the ISO week, creates nothing, and the next Monday shows it again', async ({ page }) => {
    await start(page)
    const before = (await tickets(page)).length
    await page.getByTestId('today-ritual-skip-try-new-model').click()
    await expect(page.getByTestId('today-ritual-try-new-model')).toHaveCount(0)
    await expect(page.getByTestId('today-pulse')).toBeVisible()
    expect((await tickets(page)).length).toBe(before)
    await page.clock.setFixedTime(IST('2026-11-08T10:00:00'))
    await page.reload()
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await expect(page.getByTestId('today-ritual-try-new-model')).toHaveCount(0)
    await page.clock.setFixedTime(IST('2026-11-09T10:00:00'))
    await page.reload()
    await expect(page.getByTestId('today-ritual-try-new-model')).toBeVisible()
    expect(await states(page)).toEqual(['today', '', '', '', '', 'due', ''])
    expect(await ritualTickets(page)).toHaveLength(0)
  })

  test('a new day shows the pulse input again and keeps yesterday\'s row', async ({ page }) => {
    await start(page)
    await page.getByTestId('today-pulse-input').fill('Yesterday line')
    await page.getByTestId('today-pulse-log').click()
    await expect(page.getByTestId('today-pulse-text')).toBeVisible()
    await page.clock.setFixedTime(IST('2026-11-05T10:00:00'))
    await page.reload()
    await expect(page.getByTestId('today-pulse-input')).toBeVisible()
    await expect(page.getByTestId('today-pulse-done')).toHaveCount(0)
    expect(await idbAll<Pulse>(page, 'pulses')).toHaveLength(1)
  })

  test('"Logged this ..." follows the local hour', async ({ browser }) => {
    for (const [hh, word] of [['11:59', 'morning'], ['12:00', 'afternoon'], ['16:59', 'afternoon'], ['17:00', 'evening']] as const) {
      const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 800 } })
      const page = await ctx.newPage()
      await start(page, IST(`2026-11-04T${hh}:00`))
      await page.getByTestId('today-pulse-input').fill('a line')
      await page.getByTestId('today-pulse-log').click()
      await expect(page.getByTestId('today-pulse-when')).toHaveText(`Logged this ${word}`)
      await ctx.close()
    }
  })
})

test.describe('phone 375 x 667', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('the phone copy and order, no sideways scroll; the "Logged" line is hidden', async ({ page }) => {
    await start(page)
    await expect(page.getByTestId('today-ritual-due')).toHaveText('Sat')
    await expect(page.getByTestId('today-ritual-try-new-model')).toContainText('Due Saturday. Run one small open model and note tokens per second.')
    expect(await states(page)).toEqual(['past', 'past', 'today', '', '', 'due', ''])
    await noSideways(page)
    const y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y
    const [qy, py, wy, sy] = [await y('today-quest'), await y('today-pulse'), await y('today-ritual-try-new-model'), await y('today-stats-toggle')]
    expect(qy).toBeLessThan(py)
    expect(py).toBeLessThan(wy)
    expect(wy).toBeLessThan(sy)
    await page.getByTestId('today-pulse-input').fill('Asked Claude to explain attention without maths')
    await page.getByTestId('today-pulse-input').press('Enter')
    await expect(page.getByTestId('today-pulse-text')).toBeVisible()
    await expect(page.getByTestId('today-pulse-when')).toBeHidden()
    await noSideways(page)
    await page.waitForTimeout(1800) // let the saved toast fade before the picture
    await page.screenshot({ path: `${SHOTS}/feat-f1-today-375.png`, fullPage: true })

    await page.getByTestId('today-ritual-open-try-new-model').click()
    await expect(page).toHaveURL(/\/do\/ritual-try-new-model-2026-W45$/)
    await page.getByTestId('ticket-done').click()
    await expect(page.getByTestId('ticket-done-state')).toBeVisible()
    await page.getByTestId('do-back').click()
    await expect(page.getByTestId('today-ritual-due')).toHaveText('Done Wed')
    await noSideways(page)
    await page.waitForTimeout(1800)
    await page.screenshot({ path: `${SHOTS}/feat-f1-weekly-done-375.png`, fullPage: true })
  })

  test('at 1099 wide the order is quest, pulse, weekly, stats in one column', async ({ page }) => {
    await page.setViewportSize({ width: 1099, height: 800 })
    await start(page)
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!
    const [q, p, w, s] = [await box('today-quest'), await box('today-pulse'), await box('today-ritual-try-new-model'), await box('today-stats-toggle')]
    expect(q.y + q.height).toBeLessThanOrEqual(p.y)
    expect(p.y + p.height).toBeLessThanOrEqual(w.y)
    expect(w.y + w.height).toBeLessThanOrEqual(s.y)
    expect(Math.abs(p.x - q.x)).toBeLessThan(2)
  })
})

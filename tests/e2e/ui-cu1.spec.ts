import { expect, test, type Page } from '@playwright/test'
import { idbAll, IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-1 (dojo-acceptance/reports/uat/cu-1.md, 96c58d5), to controller ruling 23
// (ui-foundation.md): K1 the screen keys, K3 the Today quest actions at phone width, and the P3 look fixes. R1 follows the
// contracts: Today has one quest card with `start-button` (a button, TODAY-01/24), Enter starts it (TODAY-23), the letter keys
// d and s of the old NOW tile are gone with the sprint slide, and a problem's page keeps its own keys (TICKET-25).
const TUE = '2026-10-06T10:00:00' // the quest is the first watch ticket, with a resource link (youtube.com)

async function open(page: Page, at: string, path = '/', ready = 'today') {
  await page.clock.setFixedTime(IST(at))
  await onboard(page, '2026-10-05')
  if (path !== '/') await page.goto(path)
  await expect(page.getByTestId(`screen-${ready}`)).toHaveAttribute('data-ready', 'true')
}
type Row = { id: string; kind: string; status: string }
const tickets = (page: Page) => idbAll<Row>(page, 'tickets')
/** The quest ticket's id: `today-quest` carries it (TODAY-01). */
const leadId = async (page: Page) => (await page.getByTestId('today-quest').getAttribute('data-ticket-id'))!
/** A not-started problem ticket: its page keeps the letter keys d and f, Space and Esc (TICKET-25; the other kinds have only F). */
const problemId = async (page: Page) => (await tickets(page)).find(t => t.kind === 'problem' && t.status === 'todo')!.id

test.describe('K1 · Today keys', () => {
  test.use({ viewport: { width: 1280, height: 520 } })

  test('Enter starts the quest ticket, and only when focus is on the page body (TODAY-23, TODAY-24)', async ({ page }) => {
    await open(page, TUE)
    const id = await leadId(page)
    const before = (await tickets(page)).map(t => `${t.id}:${t.status}`).join()
    // the retired letter shortcuts (d marked the NOW item done, s slid it) do nothing on Today
    await page.keyboard.press('d')
    await page.keyboard.press('s')
    await page.waitForTimeout(300)
    await expect(page.getByTestId('screen-today')).toBeVisible()
    expect((await tickets(page)).map(t => `${t.id}:${t.status}`).join()).toBe(before)
    // Enter with focus on another button activates that button, not the quest
    await page.getByTestId('today-pick-else').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('today-pick-list')).toBeVisible()
    await expect(page).not.toHaveURL(/\/do\//)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('today-pick-list')).toHaveCount(0)
    // no click: a click on page background is a stray one (cu-r2 A2#22); Enter on the body starts the quest
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/do/${id}$`))
    await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.status).toBe('doing')
  })
})

test.describe('K1 · Do keys', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('on a problem s changes nothing and Esc leaves Do', async ({ page }) => {
    await open(page, TUE)
    const id = await problemId(page)
    const before = (await tickets(page)).find(t => t.id === id)!
    await page.goto(`/do/${id}`)
    await expect(page.getByTestId('do-screen')).toBeVisible()
    // no click: a click on page background is a stray one and the letter shortcuts ignore it (cu-r2 A2#22)
    await page.keyboard.press('s') // the old "slide to the next sprint" key: retired with the sprints
    await page.waitForTimeout(300)
    expect((await tickets(page)).find(t => t.id === id)).toEqual(before)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('do-screen')).toHaveCount(0)
    await expect(page.getByTestId('screen-today')).toBeVisible()
  })
})

for (const width of [375, 393]) {
  test.describe(`K3 · Today quest actions at ${width}`, () => {
    test.use({ viewport: { width, height: 852 } })

    test('the resource link is one line, Start is the full-width 44 px button above Pick something else (TODAY-29, TODAY-30)', async ({ page }) => {
      await open(page, TUE)
      const box = (id: string) => page.getByTestId(id).evaluate(e => e.getBoundingClientRect().toJSON() as DOMRect)
      const [link, start, pick] = await Promise.all(['today-link', 'start-button', 'today-pick-else'].map(box))
      const actions = await page.locator('.qc-actions').evaluate(e => e.getBoundingClientRect().toJSON() as DOMRect)
      // the link: one line, inside the card, with its whole label in the accessible name
      expect(link.height).toBeLessThanOrEqual(44.5) // one line inside the 44 px phone target
      expect(link.left).toBeGreaterThanOrEqual(0)
      expect(link.right).toBeLessThanOrEqual(width)
      await expect(page.getByTestId('today-link')).toHaveAttribute('aria-label', /^Open · youtube\.com, .+\(opens in a new tab\)$/)
      // Start: the whole row, 44 tall, fully on screen at scroll 0, and Pick something else under it
      expect(start.width).toBeCloseTo(actions.width, 0)
      expect(start.left).toBeCloseTo(actions.left, 0)
      expect(start.width).toBeGreaterThanOrEqual(width * 0.9)
      expect(start.height).toBeGreaterThanOrEqual(44)
      expect(pick.top).toBeGreaterThanOrEqual(start.bottom)
      expect(pick.width).toBeCloseTo(actions.width, 0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })

    test('a long resource label never widens the page', async ({ page }) => {
      await open(page, TUE)
      await page.getByTestId('today-link').evaluate(e => { e.textContent = 'Open · A very long link label that cannot fit the phone card at all ↗' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const link = (await page.getByTestId('today-link').boundingBox())!
      expect(link.x + link.width).toBeLessThanOrEqual(width)
    })

    test('Pick something else: a long title wraps, its "lane · minutes" cell stays on one line (GLOBAL-06)', async ({ page }) => {
      await open(page, TUE)
      await page.getByTestId('today-pick-else').click()
      await expect(page.getByTestId('today-pick-list')).toBeVisible()
      // a flex item's box stretches to the row, so count the text lines through a Range (distinct line tops)
      const rows = await page.locator('.qc-pitem').evaluateAll(els => els.map(b => {
        const lines = (el: Element) => {
          const r = document.createRange()
          r.selectNodeContents(el)
          return new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size
        }
        return { meta: lines(b.querySelector('.qc-meta')!), title: lines(b.querySelector('.qc-ptitle')!) }
      }))
      expect(rows.length).toBeGreaterThan(3)
      for (const r of rows) expect(r.meta, 'meta is one line').toBe(1)
      expect(rows.some(r => r.title > 1), 'at least one title wraps to a second line').toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  })
}

test.describe('P3 · onboarding', () => {
  test.use({ viewport: { width: 700, height: 700 } })

  test('P3-2 / P3-3: the error is format-neutral and goes when a valid date is picked', async ({ page }) => {
    // a fixed Wednesday: the clock is pinned so the default date is stable
    await page.clock.setFixedTime(IST('2026-10-07T10:00:00'))
    await page.goto('/')
    const date = page.getByTestId('onboarding-start-date')
    await date.fill('')
    await page.getByTestId('onboarding-submit').click()
    const error = page.getByTestId('form-error')
    await expect(error).toHaveText('Pick a valid date.') // the native field shows dd/mm/yyyy, so no YYYY-MM-DD
    await expect(date).toHaveAttribute('aria-invalid', 'true')
    await date.fill('2026-10-05') // the Monday just gone
    await expect(error).toHaveCount(0)
    await expect(date).not.toHaveAttribute('aria-invalid')
    // weekday roles are gone (TODAY-08): neither the mid-week note nor the Monday warning applies to any date
    await expect(page.getByTestId('start-date-note')).toHaveCount(0)
    await expect(page.getByTestId('start-date-warn')).toHaveCount(0)
    await date.fill('2026-10-07') // a Wednesday
    await expect(page.getByTestId('start-date-warn')).toHaveCount(0)
    await expect(page.getByTestId('start-date-note')).toHaveCount(0)
  })

  test('P3-7: the calendar icon\'s keyboard focus is a 2 px orange ring, not Chrome\'s white box', async ({ page }) => {
    await page.goto('/')
    const date = page.getByRole('textbox', { name: 'Start date' })
    await date.focus() // the day segment
    const box = (await date.boundingBox())!
    const icon = { x: box.x + box.width - 44, y: box.y - 6, width: 44, height: box.height + 12 }
    // count the house orange (#ff8a2a) and pure white pixels in the icon's cell
    const count = async () => page.evaluate(async b64 => {
      // no fetch of a data: URL (the app's CSP connect-src forbids it, G6): decode the bytes by hand
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))], { type: 'image/png' }))
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let orange = 0, white = 0
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 255) < 8 && Math.abs(d[i + 1] - 138) < 12 && Math.abs(d[i + 2] - 42) < 16) orange++
        if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white++
      }
      return { orange, white, w: c.width, h: c.height }
    }, (await page.screenshot({ clip: icon })).toString('base64'))
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab') // month, year
    const onYear = await count()
    await page.keyboard.press('Tab') // the calendar icon
    const onIcon = await count()
    // the icon's glyph is white at every stop; the white box around it is the UA ring, and must not come back
    expect(onIcon.white).toBeLessThanOrEqual(onYear.white + 4)
    // a ring 2 px thick around a box about 24 px square: about 4 * 2 * 24 = 192 px, at 1x
    expect(onIcon.orange).toBeGreaterThan(120)
    // and the field's own ring (a segment focused) is not what is being counted: it is gone while the icon has focus
    await page.keyboard.press('Shift+Tab')
    await expect(date).toBeFocused()
  })
})

test.describe('cu-r2 A2#22 · a stray click on page background arms no card shortcut', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Do: click the background, type "sdf" and Space: nothing completes, starts or moves', async ({ page }) => {
    await open(page, TUE)
    const id = await problemId(page)
    const before = (await tickets(page)).find(t => t.id === id)!
    await page.goto(`/do/${id}`)
    await expect(page.getByTestId('do-screen')).toBeVisible()
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.type('sdf')
    await page.keyboard.press('Space')
    await page.waitForTimeout(400)
    await expect(page.getByTestId('do-screen')).toBeVisible()
    await expect(page.getByTestId('focus-screen')).toHaveCount(0)
    await expect(page.getByTestId('timer-state')).toHaveText('ready') // Space did not start the session
    expect((await tickets(page)).find(t => t.id === id)).toEqual(before)
  })

  test('a started problem: after the same stray click, f, d and Space neither open focus mode, solve nor pause', async ({ page }) => {
    await open(page, TUE)
    const id = await problemId(page)
    await page.goto(`/do/${id}`)
    await page.getByTestId('ticket-start').click()
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.type('fd')
    await page.keyboard.press('Space')
    await page.waitForTimeout(400)
    await expect(page.getByTestId('focus-screen')).toHaveCount(0)
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    expect((await tickets(page)).find(t => t.id === id)?.status).toBe('doing')
  })
})

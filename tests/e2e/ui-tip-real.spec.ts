import { expect, test, type Page } from '@playwright/test'
import { IST, idbPatch, onboard } from './helpers'

// UAT cu-final2 rows 1, 2, 4: a REAL pointer (stepped mouse moves, then a 1 s rest) must see the bubble, not just the attribute.
const TUE = '2026-10-06T10:00:00'
async function open(page: Page, path: string, ready: string) {
  await page.clock.setFixedTime(IST(TUE))
  await onboard(page, '2026-10-05')
  if (path !== '/') await page.goto(path)
  await expect(page.getByTestId(`screen-${ready}`)).toHaveAttribute('data-ready', 'true')
}
/** Moves like a hand: in from the corner in steps, lands on the centre of the element's box, rests 1 s. */
async function rest(page: Page, sel: ReturnType<Page['locator']>) {
  await sel.scrollIntoViewIfNeeded()
  const b = (await sel.boundingBox())!
  await page.mouse.move(3, 3)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.waitForTimeout(1000)
}

test.describe('real-pointer tooltips (cu-final2 rows 1, 2, 4)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Today consistency cells, empty and lit', async ({ page }) => {
    await open(page, '/', 'today')
    await idbPatch(page, 'tickets', ['p200', 'p127'], { status: 'done', xp: 10, doneAt: IST(TUE).getTime(), doneAtApprox: false })
    await page.reload()
    await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
    const cells = page.locator('.cons-cal [data-testid="cal-cell"]:not([aria-hidden])')
    const n = await cells.count()
    expect(n).toBeGreaterThan(20)
    for (const i of [0, 3, Math.floor(n / 2), n - 1]) {
      await rest(page, cells.nth(i))
      await expect(page.getByTestId('tip'), `cell ${i}`).toBeVisible()
      await expect(page.getByTestId('tip')).toContainText(/logged/)
      await page.mouse.move(3, 3)
      await expect(page.getByTestId('tip')).toBeHidden()
    }
  })

  test('Board Done header, with cards in Done', async ({ page }) => {
    await open(page, '/board', 'board')
    await idbPatch(page, 'tickets', ['p200', 'p127', 'p695'], { status: 'done', xp: 10, doneAt: IST(TUE).getTime(), doneAtApprox: false })
    await page.reload()
    await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('count-done')).not.toHaveText('0')
    for (const c of ['doing', 'done']) {
      await rest(page, page.getByTestId(`head-${c}`))
      await expect(page.getByTestId('tip'), c).toBeVisible()
      await expect(page.getByTestId('tip')).toContainText(`in ${c === 'done' ? 'Done' : 'Doing'}`)
      await page.mouse.move(3, 3)
    }
  })

  test('Banks Hello Interview empty chips', async ({ page }) => {
    await open(page, '/banks?bank=hellointerview', 'banks')
    const chips = page.locator('[data-testid="bank-item-difficulty"][data-empty="true"], [data-testid="bank-item-pattern"][data-empty="true"]')
    expect(await chips.count()).toBeGreaterThan(0)
    await rest(page, chips.first())
    await expect(page.getByTestId('tip')).toBeVisible()
    await expect(page.getByTestId('tip')).toContainText(/No (difficulty|pattern) for this item/)
  })

  test('an unrelated pane scrolling does not take the bubble from a resting pointer', async ({ page }) => {
    await open(page, '/', 'today')
    const cell = page.locator('.cons-cal [data-testid="cal-cell"]:not([aria-hidden])').nth(3)
    await rest(page, cell)
    await expect(page.getByTestId('tip')).toBeVisible()
    await page.evaluate(() => document.querySelector('.cons-label')!.dispatchEvent(new Event('scroll')))
    await page.waitForTimeout(700)
    await expect(page.getByTestId('tip')).toBeVisible()
  })

  test('Do: the "This attempt" bubble covers neither Retreat nor Pause', async ({ page }) => {
    await open(page, '/do/p200', 'do')
    await page.getByTestId('do-timer-preset-25').click()
    await expect(page.getByTestId('timer-pause')).toBeVisible()
    await rest(page, page.getByTestId('do-timer-elapsed'))
    const tip = page.getByTestId('tip')
    await expect(tip).toContainText('This attempt')
    const t = (await tip.boundingBox())!
    for (const loc of [page.getByRole('button', { name: /Retreat/ }), page.getByTestId('timer-pause'), page.getByTestId('start-session')]) {
      const b = (await loc.boundingBox())!
      expect(t.x < b.x + b.width && b.x < t.x + t.width && t.y < b.y + b.height && b.y < t.y + t.height).toBe(false)
    }
  })
})

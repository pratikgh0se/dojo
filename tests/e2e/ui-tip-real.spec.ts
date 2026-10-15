import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// UAT cu-final2 rows 1, 2, 4: a REAL pointer (stepped mouse moves, then a 1 s rest) must see the bubble, not just the attribute.
// R1: the Today Consistency grid, the Do "This attempt" tip and Retreat are retired (README "Retired hooks": cal-*; Retreat is a banned word, GLOBAL-01),
// so the only controls that carry `data-tip` are the empty difficulty and pattern chips of Banks (BankGroups.tsx). This file is the surviving
// coverage of the tooltip mechanism and runs every case on those chips.
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

const emptyChips = (page: Page) => page.locator('[data-testid="bank-item-difficulty"][data-empty="true"], [data-testid="bank-item-pattern"][data-empty="true"]')

test.describe('real-pointer tooltips (cu-final2 rows 1, 2, 4)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Banks empty chips: several chips each show their bubble to a resting pointer, and it goes when the pointer leaves', async ({ page }) => {
    await open(page, '/banks?bank=hellointerview', 'banks')
    const chips = emptyChips(page)
    const n = await chips.count()
    expect(n).toBeGreaterThan(2)
    for (const i of [0, 1, Math.floor(n / 2), n - 1]) {
      await rest(page, chips.nth(i))
      await expect(page.getByTestId('tip'), `chip ${i}`).toBeVisible()
      await expect(page.getByTestId('tip')).toContainText(/No (difficulty|pattern) for this item/)
      await page.mouse.move(3, 3)
      await expect(page.getByTestId('tip')).toBeHidden()
    }
  })

  test('Banks Hello Interview empty chips', async ({ page }) => {
    await open(page, '/banks?bank=hellointerview', 'banks')
    const chips = emptyChips(page)
    expect(await chips.count()).toBeGreaterThan(0)
    await rest(page, chips.first())
    await expect(page.getByTestId('tip')).toBeVisible()
    await expect(page.getByTestId('tip')).toContainText(/No (difficulty|pattern) for this item/)
  })

  test('an unrelated element scrolling does not take the bubble from a resting pointer', async ({ page }) => {
    await open(page, '/banks?bank=hellointerview', 'banks')
    await rest(page, emptyChips(page).nth(1))
    await expect(page.getByTestId('tip')).toBeVisible()
    await page.evaluate(() => document.querySelector('[data-testid="banks-search"]')!.dispatchEvent(new Event('scroll')))
    await page.waitForTimeout(700)
    await expect(page.getByTestId('tip')).toBeVisible()
  })

  test('the bubble sits clear of the chip it describes and of the chip beside it', async ({ page }) => {
    await open(page, '/banks?bank=hellointerview', 'banks')
    const chip = emptyChips(page).first()
    await rest(page, chip)
    const tip = page.getByTestId('tip')
    await expect(tip).toContainText(/No (difficulty|pattern) for this item/)
    const t = (await tip.boundingBox())!
    // the chip it describes and the row's other chip (the bubble is drawn under the control, never over it: app.css .tip)
    for (const loc of [chip, page.getByTestId('bank-item-pattern').first(), page.getByTestId('bank-item-difficulty').first()]) {
      const b = (await loc.boundingBox())!
      expect(t.x < b.x + b.width && b.x < t.x + t.width && t.y < b.y + b.height && b.y < t.y + t.height).toBe(false)
    }
  })
})

import { expect, test, type Page } from './fixtures'
import { IST, idbCount, onboard, serveLegacyPlan } from './helpers'

const counts = async (page: Page, expected: { slid: number; todo: number; doing: number; done: number }) => {
  for (const [col, n] of Object.entries(expected)) {
    await expect(page.getByTestId(`count-${col}`)).toHaveText(String(n))
  }
}
const pickSprint = (page: Page, n: number) =>
  page.getByRole('navigation', { name: 'Sprints' }).getByRole('button', { name: `Sprint ${n}`, exact: true }).click()

test('M2: drag to Done, Slide sprint, Shift plan, Undo twice', async ({ page }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(IST('2026-09-21T09:00:00'))
  await onboard(page)
  await page.getByRole('link', { name: 'Board' }).click()
  await expect(page.getByTestId('board-sprint')).toHaveText('S2')
  await counts(page, { slid: 0, todo: 14, doing: 0, done: 0 })

  await page.getByTestId('card-m1w2t1').dragTo(page.getByTestId('col-done'))
  await expect(page.getByTestId('toast').filter({ hasText: '+10 xp' })).toBeVisible()
  await counts(page, { slid: 0, todo: 13, doing: 0, done: 1 })

  // DL11: a house-style dialog (not window.confirm) shows the count and the resulting size.
  await page.getByRole('button', { name: 'Slide sprint ›' }).click()
  const slideDlg = page.getByRole('dialog', { name: 'Slide sprint?' })
  await expect(slideDlg.locator('p')).toHaveText(/^Move 13 unfinished cards from S2 to S3\? S3 will have 29 cards \([\d.]+ h\)\./)
  await slideDlg.getByRole('button', { name: 'Slide 13 cards' }).click()
  await expect(page.getByTestId('toast').filter({ hasText: 'Slid 13 to S3' })).toBeVisible()
  await counts(page, { slid: 0, todo: 0, doing: 0, done: 1 })

  await pickSprint(page, 3)
  await counts(page, { slid: 13, todo: 16, doing: 0, done: 0 })
  await expect(page.getByTestId('debt-own')).toHaveText('own 16')
  await expect(page.getByTestId('debt-slid')).toHaveText('slid in 13')
  await expect(page.getByTestId('debt-avg')).toHaveText('plan avg 7')
  const slidCard = page.getByTestId('col-slid').locator('article').first()
  await expect(slidCard).toContainText('from S2')
  expect(await slidCard.evaluate(el => getComputedStyle(el).borderLeftColor)).toBe('rgb(255, 77, 77)')

  await page.getByRole('button', { name: 'Shift plan ›' }).click()
  const shiftDlg = page.getByRole('dialog', { name: 'Shift plan?' })
  await expect(shiftDlg).toContainText('Shift every unfinished ticket from S3 onward by one sprint?')
  await shiftDlg.getByRole('button', { name: 'Shift plan', exact: true }).click()
  await expect(page.getByTestId('toast').filter({ hasText: /^Shifted \d+ tickets$/ })).toBeVisible()
  await counts(page, { slid: 0, todo: 0, doing: 0, done: 0 })
  await expect(page.getByTestId('strip-73')).toBeAttached()
  await pickSprint(page, 4)
  await counts(page, { slid: 13, todo: 16, doing: 0, done: 0 })

  // UAT r3 J7: the drag to Done is an undo step too (Undo (3) after the slide and the shift)
  await expect(page.getByTestId('undo')).toHaveText('Undo (3)')
  await page.getByTestId('undo').click()
  await counts(page, { slid: 0, todo: 16, doing: 0, done: 0 })
  await expect(page.getByTestId('strip-73')).not.toBeAttached()
  await pickSprint(page, 3)
  await counts(page, { slid: 13, todo: 16, doing: 0, done: 0 })

  await expect(page.getByTestId('undo')).toHaveText('Undo (2)')
  await page.getByTestId('undo').click()
  await counts(page, { slid: 0, todo: 16, doing: 0, done: 0 })
  await pickSprint(page, 2)
  await counts(page, { slid: 0, todo: 13, doing: 0, done: 1 })
  await expect(page.getByTestId('undo')).toHaveText('Undo (1)')
  await expect(page.getByTestId('undo')).toBeEnabled() // the drag to Done is left

  expect(await idbCount(page, 'events')).toBe(6) // + the column event of the drag
})

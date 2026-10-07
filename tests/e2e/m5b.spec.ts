import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

test('M5b demo: find this Sunday’s design and its deep dives (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.keyboard.press('4')
  await expect(page).toHaveURL(/\/designs$/)
  await expect(page.getByTestId('next-design-text')).toHaveText('Design bank starts S21')
  await expect(page.getByTestId('designs-done')).toHaveText('0/48')

  // Sprint 21, day 1 (Mon 2027-07-12)
  await page.clock.setFixedTime(IST('2027-07-12T21:10:00'))
  await page.reload()
  await expect(page.getByTestId('next-design-title')).toHaveText('The method, on a whiteboard, in 45 minutes')
  await page.getByTestId('open-next-tier').click()
  await expect(page).toHaveURL(/\/designs\?tier=1$/)
  await expect(page.getByTestId('tier-1')).toHaveAttribute('aria-pressed', 'true')

  const dives = page.getByTestId('dives-d-method')
  await dives.locator('summary').click()
  await expect(dives.getByText('API and data model before boxes')).toBeVisible()

  await page.getByTestId('tick-d-method').click()
  await expect(page.getByTestId('toast').filter({ hasText: '+20 xp' })).toBeVisible()
  await expect(page.getByTestId('designs-done')).toHaveText('1/48')
  await expect(page.getByTestId('designs-dives')).toHaveText('4')
  await expect(page.getByTestId('next-design-title')).toHaveText('Back-of-envelope sheet you know by heart')

  const events = await idbAll<{ t: string; id: string }>(page, 'events')
  // the jump to sprint 21 also rolled the unfinished cards on: that is one `rolled` event, not part of this story
  expect(events.filter(e => e.t !== 'rolled').map(e => [e.t, e.id])).toEqual([['tick', 'd-method']])
})

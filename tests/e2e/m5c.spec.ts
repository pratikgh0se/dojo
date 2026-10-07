import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

test('M5c demo: see where Stage 01 stands and tick a teach-back (live plan)', async ({ page }) => {
  // Sprint 2, day 1 (Mon 2026-10-19): Stage 01 (S2–S4) is current.
  await page.clock.setFixedTime(IST('2026-10-19T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.keyboard.press('5')
  await expect(page).toHaveURL(/\/ai$/)

  await expect(page.locator('[data-testid^="stage-count-"]')).toHaveCount(12)
  await expect(page.getByTestId('stage-state-0')).toHaveText('Behind')
  await expect(page.getByTestId('stage-state-1')).toHaveText('Now')
  await expect(page.getByTestId('stage-1')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('stage-7')).toContainText('S31–S38')

  const ladder = await page.getByTestId('stage-ladder').locator(':scope > li').allTextContents()
  const s7 = ladder.findIndex(t => t.startsWith('Stage 07'))
  expect(ladder[s7 + 1]).toBe('Checkpoint · S38')

  await page.getByTestId('cube-stage-01-micrograd-w1-teachback').click()
  await expect(page.getByTestId('toast').filter({ hasText: '+10 xp' })).toBeVisible()
  await expect(page.getByTestId('stage-count-1')).toHaveText('1/12')
  await expect(page.getByTestId('balance-teachback')).toHaveText('1/72')

  await page.getByTestId('stage-row-2').click()
  await expect(page).toHaveURL(/\/ai\?stage=1&sprint=2$/)
  await expect(page.getByTestId('sprint-tickets')).toContainText('Teach-back')

  const events = await idbAll<{ t: string; id: string }>(page, 'events')
  expect(events.map(e => [e.t, e.id])).toEqual([['tick', 'stage-01-micrograd-w1-teachback']])
})

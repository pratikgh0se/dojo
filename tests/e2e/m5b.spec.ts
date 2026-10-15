import { expect, test, type Page } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

// /dsa, /designs, /atlas and /banks are in no rail item any more (SHELL-21): the palette is the way in (SHELL-17)
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
async function viaPalette(page: Page, query: string, path: string) {
  await page.keyboard.press(`${MOD}+k`)
  await page.getByTestId('shell-palette-input').fill(query)
  await expect(page.getByTestId('shell-palette-item').first()).toHaveAttribute('data-target', path)
  await page.keyboard.press('Enter')
}

test('M5b demo: find the next design and its deep dives (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await viaPalette(page, 'designs', '/designs')
  await expect(page).toHaveURL(/\/designs$/)
  await expect(page.getByTestId('next-design-title')).toHaveText('The method, on a whiteboard, in 45 minutes')
  await expect(page.getByTestId('designs-done')).toHaveText('0/48')

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
  // R1 has no roll-over (README Retired: sprint machinery), so jumping the clock to sprint 21 writes nothing besides the tick
  expect(events.map(e => [e.t, e.id])).toEqual([['tick', 'd-method']])
})

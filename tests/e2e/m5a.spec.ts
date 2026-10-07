import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

test('M5a demo: pick a topic, tick two problems, open one in Do (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')

  await page.keyboard.press('3')
  await expect(page).toHaveURL(/\/dsa$/)
  await expect(page.getByTestId('dsa-solved')).toHaveText('0/169')
  await expect(page.locator('[data-testid^="heat-row-"]')).toHaveCount(17)

  await page.getByTestId('topic-1').click()
  await expect(page).toHaveURL(/\/dsa\?topic=1$/)
  await expect(page.getByTestId('topic-detail')).toContainText('Graphs: BFS and DFS on grids and adjacency lists')

  await page.getByTestId('tick-p200').click()
  await expect(page.getByTestId('toast').filter({ hasText: '+10 xp' })).toBeVisible()
  await expect(page.getByTestId('cell-p200')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('cell-p127').click()
  await expect(page.getByTestId('tick-p127')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('dsa-solved')).toHaveText('2/169')
  await expect(page.getByTestId('dsa-hard')).toHaveText('1')

  const events = await idbAll<{ t: string; id: string }>(page, 'events')
  expect(events.map(e => [e.t, e.id])).toEqual([['tick', 'p200'], ['tick', 'p127']])

  await page.reload()
  await expect(page.getByTestId('topic-detail')).toBeVisible()
  await expect(page.getByTestId('cell-p200')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('do-p695').click()
  await expect(page).toHaveURL(/\/do\/p695$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/dsa\?topic=1$/)
  await expect(page.getByTestId('topic-detail')).toBeVisible()
})

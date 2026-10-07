import { expect, test } from '@playwright/test'
import { idbPatch, IST, onboard } from './helpers'

test('M5d demo: follow a locked node to the parent holding it back; sprint prev/next (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.keyboard.press('6')
  await expect(page).toHaveURL(/\/map$/)

  await expect(page.getByTestId('node-ml')).toHaveAttribute('data-state', 'locked')
  await page.getByTestId('node-ml').click()
  await expect(page.getByTestId('skill-what')).toContainText('Linear and logistic regression')
  await expect(page.getByTestId('skill-why')).toContainText('smallest complete version')
  await expect(page.getByTestId('need-calc')).toContainText('Calculus + chain rule · 0%')
  await page.getByTestId('need-calc').click()
  await expect(page).toHaveURL(/skill=calc/)
  await expect(page.getByTestId('skill-detail')).toContainText('Calculus + chain rule')

  await page.getByTestId('path-1').click()
  await expect(page.getByTestId('sprint-title')).toContainText('Sprint 1 · Block 1: Forge begins: math you can picture')
  await expect(page.getByText('S1 · Forge begins: math you can picture')).toBeVisible()
  await expect(page.getByTestId('sprint-view')).toContainText('Stage 00: Setup + math by picture')
  await page.getByTestId('sprint-next').click()
  await expect(page.getByTestId('sprint-title')).toContainText('Sprint 2')
  await page.getByTestId('sprint-prev').click()
  await expect(page.getByTestId('sprint-title')).toContainText('Sprint 1')
})

test('Progress: rings match the live plan, NOW marker, no sessions yet', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-20T21:10:00'))
  await onboard(page, '2026-10-05')
  await idbPatch(page, 'tickets', ['p200', 'p127'], { status: 'done', xp: 10, doneAt: IST('2026-10-06T21:30:00').getTime(), doneAtApprox: false })
  await page.reload()
  await page.getByTestId('now-eyebrow').waitFor()
  await page.keyboard.press('7')
  await expect(page).toHaveURL(/\/progress$/)
  await expect(page.getByTestId('ring-all-count')).toHaveText('2/650')
  await expect(page.getByTestId('ring-ai-count')).toHaveText('0/288')
  await expect(page.getByTestId('ring-interview-count')).toHaveText('2/362')
  await expect(page.getByTestId('ring-dsa-count')).toHaveText('2/169')
  await expect(page.getByTestId('ring-designs-count')).toHaveText('0/48')
  await expect(page.locator('[data-marker="now"]')).toHaveCount(1)
  await expect(page.getByTestId('pace-hard')).toHaveText('1')
  await expect(page.getByTestId('no-sessions')).toHaveText('No sessions yet')
  await expect(page.locator('[data-testid^="badge-"]')).toHaveCount(12)
})

async function assertChartLabelsDontOverlap(page: import('@playwright/test').Page) {
  const chart = page.getByRole('img', { name: 'Minutes per week, last 8 weeks' })
  const boxes = await chart.locator('text.chart-label').evaluateAll(els =>
    els
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => el.getBoundingClientRect())
      .map(r => ({ x: r.x, right: r.x + r.width })),
  )
  expect(boxes.length).toBeGreaterThan(0)
  for (let i = 0; i < boxes.length - 1; i++) {
    expect(boxes[i].right).toBeLessThanOrEqual(boxes[i + 1].x + 0.5)
  }
}

test('Week: today highlighted, Friday rests, picks follow the forge rotation', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-07T21:10:00')) // Wed, S1 day 3
  await onboard(page, '2026-10-05')
  await page.keyboard.press('8')
  await expect(page).toHaveURL(/\/week$/)
  await expect(page.getByTestId('day-Wed')).toHaveAttribute('aria-current', 'date')
  await expect(page.getByTestId('day-Wed')).toContainText('AI · rebuild')
  await expect(page.getByTestId('day-Mon')).toContainText('Stage 00 Setup + math by picture, watch 1 of 1')
  await expect(page.getByTestId('day-Fri')).toHaveClass(/rest/)
  await expect(page.locator('[data-testid^="cal-"]')).toHaveCount(14)
  await expect(page.getByTestId('cal-2026-10-07')).toHaveClass(/is-today/)
  await expect(page.getByRole('img', { name: 'Minutes per week, last 8 weeks' })).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 900 })
  await assertChartLabelsDontOverlap(page)
  await page.setViewportSize({ width: 560, height: 900 })
  await assertChartLabelsDontOverlap(page)
})

import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// Controller finding #1: the page background used to stop mid-window because body's
// height was only as tall as its content. html/body now fill the viewport so the grid
// background covers the whole window at any content height, on every screen.
test.use({ viewport: { width: 1280, height: 900 } })

async function assertBodyFillsViewport(page: Page, where: string) {
  const { bodyHeight, innerHeight } = await page.evaluate(() => ({
    bodyHeight: document.body.getBoundingClientRect().height,
    innerHeight: window.innerHeight,
  }))
  expect(bodyHeight, where).toBeGreaterThanOrEqual(innerHeight)
}

type PlanTicket = { id: string; lane: string; order: number }

// R1 Today (TODAY-01, TODAY-07, TODAY-32): before the start date it already offers the first ticket of the queue as the one quest, with the
// one START button. The old command center (now-*, carrot-hp, "This sprint" button, upcoming-list) is retired (README Retired).
test('before start, Today offers the first queue ticket as its one quest and the page fills the window (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-09-28T09:00:00'))
  await onboard(page, '2026-10-05')

  const plan = (await (await page.request.get('/data/plan.json')).json()) as { tickets: PlanTicket[] }
  const first = plan.tickets.filter(t => t.lane === 'path').sort((a, b) => a.order - b.order)[0]
  const quest = page.getByTestId('today-quest')
  await expect(quest).toHaveAttribute('data-action', 'start')
  await expect(quest).toHaveAttribute('data-ticket-id', first.id)
  await expect(page.getByTestId('today-reason')).toContainText(/next in your queue/i)
  await expect(page.getByTestId('start-button')).toHaveText(/^START · /i)
  await expect(page.getByTestId('start-button')).toHaveAttribute('data-accent', 'primary')
  await expect(page.getByTestId('screen-today')).not.toContainText(/sprint/i)
  await expect(page.getByTestId('today-second')).toHaveCount(0)
  await assertBodyFillsViewport(page, 'today')
})

// the same finding on every screen the window can show at 1280 x 900, short pages (Skills, Review) and long ones alike
for (const [name, path] of [
  ['path', '/path'], ['skills', '/skills'], ['review', '/review'], ['settings', '/settings'], ['guide', '/guide'],
  ['dsa', '/dsa'], ['designs', '/designs'], ['atlas', '/atlas'], ['banks', '/banks'],
] as const) {
  test(`the page fills the window on ${name}`, async ({ page }) => {
    await page.clock.setFixedTime(IST('2026-09-28T09:00:00'))
    await onboard(page, '2026-10-05')
    await page.goto(path)
    await expect(page.getByTestId(`screen-${name}`)).toBeVisible()
    await assertBodyFillsViewport(page, name)
  })
}

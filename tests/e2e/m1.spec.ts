import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { IST, idbAll, idbCount, serveLegacyPlan } from './helpers'

const MONDAY_S2 = IST('2026-09-21T09:00:00')
// plan.flat.v2.json holds 3 plan tickets, 3 DSA bank problems, 2 design bank items and 2 tasks: the app seeds each once
const FIXTURE_TICKETS = 10

test('M1: first launch asks for a start date, seeds once, survives reload and a second tab (Review Focus #1)', async ({ page, context }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(MONDAY_S2)
  await page.goto('/')
  // SHELL-27: onboarding has no rail, tab bar or palette; the date is pre-filled with a valid date (a Monday: today, ruling 21)
  await expect(page.getByTestId('screen-onboarding')).toBeVisible()
  await expect(page.getByTestId('shell-rail')).toHaveCount(0)
  await expect(page.getByTestId('shell-tabbar')).toHaveCount(0)
  await expect(page.getByTestId('onboarding-start-date')).toHaveValue('2026-09-21')

  await page.getByTestId('onboarding-start-date').fill('2026-09-07')
  await page.getByTestId('onboarding-submit').click()
  await page.locator('[data-testid="screen-today"][data-ready="true"]').waitFor()
  const quest = page.getByTestId('today-quest')
  // the fixture's first open ticket is the 45 min watch m1w1t1 (TODAY-07)
  await expect(quest).toHaveAttribute('data-ticket-id', 'm1w1t1')
  await expect(quest).toHaveAttribute('data-action', 'start')
  await expect(page.getByTestId('today-title')).toHaveText('Watch the tour')
  await expect(page.getByTestId('xp-total')).toHaveAttribute('data-value', '0')
  await expect(page.getByTestId('shell-header').getByTestId('level')).toHaveAttribute('data-value', '0')
  expect((await idbAll<{ startDate: string }>(page, 'settings'))[0].startDate).toBe('2026-09-07')
  expect(await idbCount(page, 'tickets')).toBe(FIXTURE_TICKETS)
  expect(await idbCount(page, 'events')).toBe(0)

  await page.reload()
  await expect(quest).toHaveAttribute('data-ticket-id', 'm1w1t1')
  await expect(page.getByTestId('screen-onboarding')).toHaveCount(0)
  expect(await idbCount(page, 'tickets')).toBe(FIXTURE_TICKETS)
  expect(await idbCount(page, 'events')).toBe(0)

  const second = await context.newPage()
  await serveLegacyPlan(second)
  await second.clock.setFixedTime(MONDAY_S2)
  await second.goto('/')
  await expect(second.getByTestId('today-quest')).toHaveAttribute('data-ticket-id', 'm1w1t1')
  await expect(second.getByTestId('screen-onboarding')).toHaveCount(0)
  expect(await idbCount(second, 'tickets')).toBe(FIXTURE_TICKETS)
  expect(await idbCount(second, 'events')).toBe(0)
  expect((await idbAll<{ startDate: string }>(second, 'settings'))[0].startDate).toBe('2026-09-07')
  await second.close()
})

const WARN = (day: string) =>
  `Sprints follow a Monday-to-Sunday rhythm (Monday is the AI watch day). Starting on ${day} puts some of week 1 out of order. Pick a Monday to keep it in order.`

const brokenPlan = (): string => {
  const plan = JSON.parse(readFileSync(new URL('../../public/data/plan.json', import.meta.url), 'utf8'))
  delete plan.tickets[0].id
  return JSON.stringify(plan)
}

const badBodies: Array<{ name: string; status: number; body: () => string; message: string }> = [
  { name: 'missing (404)', status: 404, body: () => 'Not found', message: 'returned HTTP 404' },
  { name: 'empty', status: 200, body: () => '', message: 'is not valid JSON' },
  { name: 'not JSON', status: 200, body: () => 'plan goes here', message: 'is not valid JSON' },
  { name: 'wrong shape', status: 200, body: () => '{"sprints":[]}', message: 'is not a plan v2 (planFormat 2)' },
  { name: 'malformed entry', status: 200, body: brokenPlan, message: 'plan v2: ticket without an id' },
]

for (const c of badBodies) {
  test(`M1: plan.json ${c.name} → error screen, nothing seeded (Review Focus #2)`, async ({ page }) => {
    await page.route('**/data/plan.json', route =>
      route.fulfill({ status: c.status, contentType: 'application/json', body: c.body() }),
    )
    await page.goto('/')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Plan data problem')
    await expect(alert).toContainText(c.message)
    expect(await idbCount(page, 'tickets')).toBe(0)
  })
}

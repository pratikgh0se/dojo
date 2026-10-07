import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { IST, idbCount, onboard, serveLegacyPlan } from './helpers'

const MONDAY_S2 = IST('2026-09-21T09:00:00')

test('M1: first launch asks for a start date, seeds once, survives reload and a second tab (Review Focus #1)', async ({ page, context }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(MONDAY_S2)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Pick your start date' })).toBeVisible()
  await expect(page.getByLabel('Start date')).toHaveValue('2026-09-21') // a Monday: today (ruling 21)

  await page.getByLabel('Start date').fill('2026-09-07')
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await expect(page.getByTestId('now-eyebrow')).toHaveText('SPRINT 2 · DAY 1 OF 14 · AI · watch')
  await expect(page.getByTestId('now-text')).toContainText('Watch Essence of Linear Algebra')
  await expect(page.getByTestId('xp-total')).toHaveText('0 XP')
  await expect(page.getByTestId('level')).toHaveText('LV 0')
  await expect(page.getByTestId('form-name')).toHaveText('Pom · BASE')
  expect(await idbCount(page, 'tickets')).toBe(533)
  expect(await idbCount(page, 'events')).toBe(0)

  await page.reload()
  await expect(page.getByTestId('now-eyebrow')).toHaveText('SPRINT 2 · DAY 1 OF 14 · AI · watch')
  expect(await idbCount(page, 'tickets')).toBe(533)
  expect(await idbCount(page, 'events')).toBe(0)

  const second = await context.newPage()
  await serveLegacyPlan(second)
  await second.clock.setFixedTime(MONDAY_S2)
  await second.goto('/')
  await expect(second.getByTestId('now-eyebrow')).toHaveText('SPRINT 2 · DAY 1 OF 14 · AI · watch')
  expect(await idbCount(second, 'tickets')).toBe(533)
  expect(await idbCount(second, 'events')).toBe(0)
  await second.close()
})

const WARN = (day: string) =>
  `Sprints follow a Monday-to-Sunday rhythm (Monday is the AI watch day). Starting on ${day} puts some of week 1 out of order. Pick a Monday to keep it in order.`

test('ruling 21: onboarding defaults to a Monday; a non-Monday warns live in onboarding and Settings, never blocking', async ({ page }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(IST('2026-09-24T09:00:00')) // a Thursday: next Monday
  await page.goto('/')
  const date = page.getByLabel('Start date')
  const warn = page.getByTestId('start-date-warn')
  await expect(date).toHaveValue('2026-09-28')
  await expect(warn).toHaveCount(0)
  await date.fill('2026-09-08')
  await expect(warn).toHaveText(WARN('Tuesday'))
  await date.fill('2026-09-07')
  await expect(warn).toHaveCount(0)
  await date.fill('2026-09-09')
  await expect(warn).toHaveText(WARN('Wednesday'))
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await expect(page.getByTestId('now-eyebrow')).toBeVisible()

  await page.getByTestId('more-button').click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const field = page.getByRole('textbox', { name: 'Start date' })
  await expect(field).toHaveValue('2026-09-09')
  await expect(warn).toHaveText(WARN('Wednesday')) // the saved start is a Wednesday
  await field.fill('2026-09-21')
  await expect(warn).toHaveCount(0)
  await field.fill('2026-09-26')
  await expect(warn).toHaveText(WARN('Saturday'))
  await page.getByRole('button', { name: 'Save start date' }).click()
  await expect(page.getByTestId('toast').filter({ hasText: 'Start date set to 2026-09-26' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Pick a valid date' })).toHaveCount(0)
  await expect(warn).toHaveText(WARN('Saturday'))
})

test('M1: Settings edits the start date and Today follows', async ({ page }) => {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(MONDAY_S2)
  await onboard(page)
  await page.getByTestId('more-button').click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page.getByTestId('plan-version')).toHaveText('Plan version 2026-09-05')
  await page.getByLabel('Start date').fill('2026-09-21')
  await page.getByRole('button', { name: 'Save start date' }).click()
  await expect(page.getByTestId('plan-position')).toHaveText('Today is sprint 1, day 1 of 14.')
  await page.getByRole('link', { name: 'Today' }).click()
  await expect(page.getByTestId('now-eyebrow')).toHaveText('SPRINT 1 · DAY 1 OF 14 · AI · watch')
})

const brokenPlan = (): string => {
  const plan = JSON.parse(readFileSync(new URL('../../public/data/plan.json', import.meta.url), 'utf8'))
  delete plan.sprints[0].ai[0].id
  return JSON.stringify(plan)
}

const badBodies: Array<{ name: string; status: number; body: () => string; message: string }> = [
  { name: 'missing (404)', status: 404, body: () => 'Not found', message: 'returned HTTP 404' },
  { name: 'empty', status: 200, body: () => '', message: 'is not valid JSON' },
  { name: 'not JSON', status: 200, body: () => 'plan goes here', message: 'is not valid JSON' },
  { name: 'wrong shape', status: 200, body: () => '{"sprints":[]}', message: 'is missing sprints/rotation/dsa_bank/design_bank' },
  { name: 'malformed entry', status: 200, body: brokenPlan, message: 'sprint 1: task without an id' },
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

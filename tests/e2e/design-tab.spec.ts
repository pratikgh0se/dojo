import { expect, test } from '@playwright/test'
import { idbCount } from './helpers'
import { begin, completeS1, guard, resumeAndGo, RL, RL_TITLE } from './design-helpers'

const TIERS = ['Foundations', 'Core distributed systems', 'Hard classic designs', 'Data-heavy systems', 'ML platforms', 'LLM and agentic systems']

test('D-1 start a session from the tier list', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.goto('/designs')
  await page.getByRole('region', { name: 'Tier ladder' }).getByRole('button', { name: 'Core distributed systems' }).click()
  await page.getByRole('button', { name: `Start session: ${RL_TITLE}` }).click()
  await expect(page).toHaveURL(new RegExp(`/designs/session/${RL}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(RL_TITLE)
  await expect(page.getByTestId('session-phase')).toHaveText('setup')
  check()
})

test('D-2 every one of the 48 designs has exactly one Start session button', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.goto('/designs')
  let total = 0
  for (const t of TIERS) {
    await page.getByRole('region', { name: 'Tier ladder' }).getByRole('button', { name: t }).click()
    const detail = page.getByTestId('tier-detail')
    const rows = await detail.locator('.design-item').count()
    const starts = detail.getByRole('button', { name: /^Start session: / })
    expect(await starts.count()).toBe(rows)
    total += rows
  }
  expect(total).toBe(48)
  check()
})

test('D-54 completion ticks the design; unticking keeps the session', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await completeS1(page)
  await resumeAndGo(page, () => page.goto('/designs'))
  await expect(page.getByRole('region', { name: 'Tier ladder' }).getByRole('heading')).toContainText('1 of 48 designs')
  // The real plan.json's "Core distributed systems" tier has 11 designs (verified against the
  // Designs-per-tier aria-label at runtime), not the plan's assumed 5.
  await expect(page.getByRole('img', { name: /Distributed 1 of 11 done/ })).toBeVisible()
  await expect(page.getByTestId('designs-sundays')).toHaveText('2 deep dives answered')
  await page.getByRole('region', { name: 'Tier ladder' }).getByRole('button', { name: 'Core distributed systems' }).click()
  const box = page.getByRole('checkbox', { name: `Done: ${RL_TITLE}` })
  await expect(box).toBeChecked()
  await box.click()
  await expect(box).not.toBeChecked()
  expect(await idbCount(page, 'designSessions')).toBe(1)
  check()
})

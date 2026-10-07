import { expect, test } from '@playwright/test'
import { IST, onboard } from './helpers'

// Every tab of the old index.html (overview, tree, plan, bank, dbank, ai, mentors, ritual) has a home.
// dbank's heading is the prototype's literal "Tier ladder · {done} of {total} designs" (kept as-is),
// so it needs a regex match instead of the exact-string match the other homes use.
const HOMES: Array<[string, string, string | RegExp]> = [
  ['overview', '/overview', 'What this plan covers, so nothing else needs to'],
  ['tree', '/map', 'Skill tree'],
  ['plan', '/map', 'Sprint path'],
  ['bank', '/dsa', 'Topics'],
  ['dbank', '/designs', /^Tier ladder( · \d+ of \d+ designs)?$/],
  ['ai', '/ai', 'Working with AI'],
  ['mentors', '/mentors', 'The protocol'],
  ['ritual', '/ritual', 'The rotation'],
]

test('M5e demo: the old index.html’s eight tabs each have a home, no console errors (live plan)', async ({ page }) => {
  const errors: string[] = []
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', e => errors.push(e.message))

  await page.clock.setFixedTime(IST('2026-10-20T21:10:00'))
  await onboard(page, '2026-10-05')

  for (const [old, path, heading] of HOMES) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, exact: typeof heading === 'string' }), `index.html #${old} → ${path}`).toBeVisible()
    await expect(page.getByTestId('soon')).toHaveCount(0)
  }

  await page.goto('/overview')
  await expect(page.locator('[data-testid^="band-phase-"]')).toHaveCount(8)
  await expect(page.locator('[data-testid^="band-stage-"]')).toHaveCount(12)
  await expect(page.getByTestId('band-design-0')).toHaveAttribute('data-from', '21')
  await expect(page.getByTestId('timeline-now')).toHaveCount(1)

  await page.goto('/mentors')
  await expect(page.getByTestId('room-card')).toHaveCount(12)

  await page.goto('/ritual')
  await expect(page.getByTestId('ritual-Sat')).toContainText('Saturday · AI · build + break')
  await page.getByTestId('open-map').click()
  await expect(page).toHaveURL(/\/map$/)

  expect(errors).toEqual([])
})

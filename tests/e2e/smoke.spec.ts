import { expect, test } from '@playwright/test'

test('dev server serves the app and plan.json on 127.0.0.1:$DOJO_PORT', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Dojo')
  const res = await request.get('/data/plan.json')
  expect(res.status()).toBe(200)
  const plan = await res.json()
  expect(plan.planFormat).toBe(2)
  for (const k of ['areas', 'phases', 'nodes', 'tickets']) {
    expect(Array.isArray(plan[k]), `${k} is an array`).toBe(true)
    expect(plan[k].length, `${k} is non-empty`).toBeGreaterThan(0)
  }
  const ids = plan.tickets.map((t: { id: string }) => t.id)
  expect(new Set(ids).size, 'ticket ids are unique').toBe(ids.length)
})

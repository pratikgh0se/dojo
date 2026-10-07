import { expect, test } from '@playwright/test'

test('dev server serves the app and plan.json on 127.0.0.1:$DOJO_PORT', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Dojo')
  const res = await request.get('/data/plan.json')
  expect(res.status()).toBe(200)
  const plan = await res.json()
  expect(plan.sprints).toHaveLength(72)
})

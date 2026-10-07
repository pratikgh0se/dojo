import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { begin, completeS1, guard, resumeAndGo } from './design-helpers'

test('D-39…D-44 reference beside yours, diff, cache, flows, two PNGs', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.evaluate(() => localStorage.setItem('dojo-ai-fake-delay-ms', '400'))
  await completeS1(page)
  await expect(page.getByTestId('session-reference-loading')).toBeVisible()
  const ref = page.getByTestId('session-reference')
  // The fake AI's delay hook uses a real setTimeout, which page.clock virtualizes and freezes
  // (same Playwright Clock semantics gap as batch 2's discrepancy #4); advance it past the
  // 400 ms delay so the reference call actually resolves.
  await page.clock.runFor(500)
  await expect(ref.getByRole('button', { name: 'JSON' })).toBeVisible()
  await expect(page.getByTestId('session-reference-loading')).toHaveCount(0)

  const yours = page.getByTestId('session-yours')
  await expect(yours).toBeVisible()
  await expect(yours.locator('[data-testid^="kit-node-"]')).toHaveCount(0)
  const a = (await yours.boundingBox())!
  const b = (await ref.boundingBox())!
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)

  const texts = (id: string) => page.getByTestId(id).getByTestId('session-diff-item').allTextContents()
  expect(await texts('session-diff-mine')).toEqual(['cache (Cache 1)', 'sql (Sql 1)'])
  expect(await texts('session-diff-ref')).toEqual(['browser (Client)', 'nosql (Counters)'])
  expect(await texts('session-diff-links')).toEqual(['gateway → service: yours async, reference sync'])
  await expect(page.getByRole('region', { name: 'Differences' })).toContainText('Information, not a score.')

  await ref.getByRole('button', { name: 'JSON' }).click()
  const json = JSON.parse((await page.getByTestId('session-reference-json').textContent()) ?? '{}')
  expect(json.nodes).toHaveLength(4)

  const play = ref.getByRole('button', { name: 'Play flows' })
  await play.click()
  await expect(play).toHaveAttribute('aria-pressed', 'true')
  await page.clock.runFor(1000)
  await play.click()
  await expect(play).toHaveAttribute('aria-pressed', 'false')

  const [d1] = await Promise.all([page.waitForEvent('download'), yours.getByRole('button', { name: 'Export PNG' }).click()])
  expect(d1.suggestedFilename()).toBe('d-ratelimit-2026-10-11.png')
  const [d2] = await Promise.all([page.waitForEvent('download'), ref.getByRole('button', { name: 'Export reference PNG' }).click()])
  expect(d2.suggestedFilename()).toBe('d-ratelimit-2026-10-11-reference.png')
  expect([...readFileSync((await d2.path())!).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

  await page.evaluate(() => localStorage.removeItem('dojo-ai-fake-delay-ms'))
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('done')
  await expect(page.getByTestId('session-reference-loading')).toHaveCount(0)
  await page.getByTestId('session-reference').getByRole('button', { name: 'JSON' }).click()
  expect(JSON.parse((await page.getByTestId('session-reference-json').textContent()) ?? '{}')).toEqual(json)
  check()
})

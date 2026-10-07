import { expect, test } from '@playwright/test'
import { onboard } from './helpers'

/**
 * Review I2: pom-stage.js (generated, never hand-edited) builds a fresh THREE.Scene per attach
 * and its disconnectedCallback only cancels the render loop, so 10 Today↔Board round trips took
 * the shared WebGLRenderer's tracked memory from 42→462 geometries, 10→100 textures. The React
 * wrapper (src/ui/engines/PomStage.tsx) now disposes every geometry/material/texture in the
 * scene on unmount. Round-trip a few times and assert those counts don't climb.
 */
test('Pom stage does not leak GPU geometries/textures across Today↔Board round trips', async ({ page }) => {
  await onboard(page, '2026-10-05')
  await page.locator('pom-stage').waitFor()

  const memory = () =>
    page.evaluate(() => {
      const ctor = customElements.get('pom-stage') as unknown as
        | { shared?: { info: { memory: { geometries: number; textures: number } } } }
        | undefined
      const mem = ctor?.shared?.info.memory
      return mem ? { geometries: mem.geometries, textures: mem.textures } : null
    })

  // Let the first mount's scene finish building before taking the baseline.
  await page.waitForTimeout(500)
  const before = await memory()
  expect(before).not.toBeNull()

  for (let i = 0; i < 5; i++) {
    await page.getByRole('link', { name: 'Board', exact: true }).click()
    await page.getByTestId('col-todo').waitFor()
    await page.getByRole('link', { name: 'Today', exact: true }).click()
    await page.locator('pom-stage').waitFor()
  }
  await page.waitForTimeout(500)
  const after = await memory()

  expect(after).not.toBeNull()
  expect(after!.geometries).toBeLessThanOrEqual(before!.geometries)
  expect(after!.textures).toBeLessThanOrEqual(before!.textures)
})

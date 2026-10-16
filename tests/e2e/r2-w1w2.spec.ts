import { expect, test, type Page } from '@playwright/test'
import { IST, idbAll, onboard, serveLegacyPlan } from './helpers'

// R2 W1+W2: the one UI change of the lab engine, the Settings "Labs folder" field (labs.md LAB-58, LAB-59). The engine itself is covered by
// tests/unit/labs-*.test.ts and the contract walk (tests/unit/labs-contract-walk.test.ts); the lab block and the review panel are W3's.
const SHOTS = process.env.DOJO_SHOTS_DIR ?? 'test-results/r2-w1w2-shots'

async function openSettings(page: Page): Promise<void> {
  await serveLegacyPlan(page)
  await page.clock.setFixedTime(IST('2026-11-04T10:00:00'))
  await onboard(page, '2026-10-21')
  await page.goto('/settings')
  await expect(page.getByTestId('settings-labs-root')).toBeVisible()
}
const settingsRow = async (page: Page) => (await idbAll<Record<string, unknown>>(page, 'settings')).find(r => r.id === 'main')!
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('LAB-58/59: the labs folder field defaults to ~/labs, stores what is typed (trimmed) on blur, and clears to absent', async ({ page }) => {
  await openSettings(page)
  const input = page.getByTestId('settings-labs-root')
  await expect(input).toHaveCount(1)
  await expect(input).toHaveAttribute('placeholder', '~/labs')
  await expect(input).toHaveValue('')
  await expect(page.getByLabel('Labs folder')).toBeVisible()
  const help = page.getByTestId('settings-labs-root-help')
  await expect(help).toBeVisible()
  await expect(help).toContainText('Set up lab creates')
  expect(await settingsRow(page)).not.toHaveProperty('labsRoot') // nothing is written on load

  const before = await settingsRow(page)
  await input.fill('  ~/my-labs ')
  await input.blur()
  await expect.poll(async () => (await settingsRow(page)).labsRoot).toBe('~/my-labs')
  const { labsRoot: _stored, ...rest } = await settingsRow(page)
  const { labsRoot: _none, ...restBefore } = before
  expect(rest).toEqual(restBefore) // nothing else in settings changed

  await page.reload()
  await expect(page.getByTestId('settings-labs-root')).toHaveValue('~/my-labs')
  await page.getByTestId('settings-labs-root').fill('/tmp/x') // an invalid value is stored as typed; the server judges it at set up
  await page.getByTestId('settings-labs-root').blur()
  await expect.poll(async () => (await settingsRow(page)).labsRoot).toBe('/tmp/x')
  await page.getByTestId('settings-labs-root').fill('')
  await page.getByTestId('settings-labs-root').blur()
  await expect.poll(async () => 'labsRoot' in (await settingsRow(page))).toBe(false)
  await expect(page.getByTestId('settings-labs-root')).toHaveValue('')
})

for (const [name, size] of [['1280', { width: 1280, height: 800 }], ['375', { width: 375, height: 812 }]] as const) {
  test(`Settings at ${name}: the labs folder field and its help line fit, text is at least 14px, no sideways scroll`, async ({ page }) => {
    await page.setViewportSize(size)
    await openSettings(page)
    const input = page.getByTestId('settings-labs-root')
    await input.scrollIntoViewIfNeeded()
    const box = await input.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width)
    const fonts = await page.evaluate(() => ['settings-labs-root', 'settings-labs-root-help'].map(id => parseFloat(getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!).fontSize)))
    for (const f of fonts) expect(f).toBeGreaterThanOrEqual(14)
    expect(await noSideways(page)).toBe(true)
    await page.getByTestId('settings-labs-root-help').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/w1w2-settings-${name}.png` })
  })
}

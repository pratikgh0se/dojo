import { expect, test } from '@playwright/test'
import { IST, onboard } from './helpers'

// F8: every routed screen has screen-<name>, data-ready="true" and exactly one h1; G1 at phone widths.
const SCREENS: Array<[string, string]> = [
  ['/atlas', 'atlas'], ['/map', 'map'], ['/week', 'week'], ['/overview', 'overview'],
  ['/mentors', 'mentors'], ['/ritual', 'ritual'], ['/settings', 'settings'], ['/progress', 'progress'],
]

for (const width of [1280, 834, 375]) {
  test.describe(`screen roots at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } })
    test('screen-<name> becomes ready, one h1, no page scroll, no Silkscreen off the scale', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-07T10:00:00'))
      await onboard(page, '2026-10-05')
      for (const [path, name] of SCREENS) {
        await page.goto(path)
        await expect(page.getByTestId(`screen-${name}`)).toHaveAttribute('data-ready', 'true')
        await expect(page.locator('h1')).toHaveCount(1)
        const r = await page.evaluate(() => {
          const bad: string[] = []
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            if (!cs.fontFamily.startsWith('Silkscreen') || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim())) continue
            if (![16, 24, 32, 48].includes(parseFloat(cs.fontSize))) bad.push(`${el.className}:${cs.fontSize}`)
          }
          return { sw: document.documentElement.scrollWidth, bad }
        })
        expect(r.sw, path).toBeLessThanOrEqual(width)
        expect(r.bad, path).toEqual([])
      }
      await page.goto('/settings')
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Start date' })).toHaveValue('2026-10-05')
      // (storage-status reads the disk store only when disk sync runs; this suite's dev server has it off)
      await expect(page.getByTestId('storage-status')).toHaveText(/^Storage · /)
    })
  })
}

import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// R1 navigation: the thirteen destinations (rail on a desktop; tab bar and More sheet on a phone), keys 1 to 6, the ? overlay,
// the Ctrl or Cmd K palette reaching every screen, and every retired route landing on Today (SHELL-01, 03, 05, 19, 20, 21).
// Board and Journal belong to other workstreams: here they are only listed, their navigation is the merger's check.
const ITEMS: Array<[id: string, label: string, path: string, key: string]> = [
  ['today', 'Today', '/', '1'], ['path', 'Path', '/path', '2'], ['skills', 'Skills', '/skills', '5'], ['review', 'Review', '/review', '6'],
]
const PALETTE: Array<[query: string, path: string, screen: string, dest: string]> = [
  ['atlas', '/atlas', 'atlas', 'atlas'], ['banks', '/banks', 'banks', 'banks'], ['dsa', '/dsa', 'dsa', 'dsa'], ['designs', '/designs', 'designs', 'designs'],
]
const RETIRED = ['/week', '/overview', '/mentors', '/ritual', '/map', '/progress', '/ai', '/no-such-page']

const urlFor = (path: string) => (path === '/' ? /:\d+\/$/ : new RegExp(`${path}$`))
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function noHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
}

async function ready(page: Page, screen: string) {
  await expect(page.getByTestId(`screen-${screen}`)).toHaveAttribute('data-ready', 'true')
}

for (const width of [560, 1280]) {
  test.describe(`nav at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    // the rail is the wide-window chrome (thirteen items), the tab bar the narrow-window one (four items and More)
    const bar = (page: Page) => page.getByTestId(width < 768 ? 'shell-tabbar' : 'shell-rail')

    test('the destinations in order, each reachable, and no old More button or key legend', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      const items = bar(page).locator('[data-testid^="shell-nav-"]')
      if (width < 768) {
        await expect(items).toHaveCount(4)
        await expect(items).toHaveText([/^Today/, /^Path/, /^Board/, /^Review/])
        await expect(bar(page).getByTestId('shell-tab-more')).toHaveText('More')
      } else {
        await expect(items).toHaveCount(13)
        await expect(items).toHaveText(['Today', 'Path', 'Board', 'Journal', 'Skills', 'Review', 'AI', 'DSA', 'Designs', 'Banks', 'Atlas', 'Portfolio', 'Guide'].map(l => new RegExp(`^${l}`)))
      }
      for (const [id, label, path] of ITEMS.filter(i => width >= 768 || i[0] !== 'skills')) {
        await bar(page).getByTestId(`shell-nav-${id}`).click()
        await expect(page).toHaveURL(urlFor(path))
        await expect(bar(page).getByTestId(`shell-nav-${id}`)).toHaveAttribute('aria-current', 'page')
        await expect(bar(page).getByTestId(`shell-nav-${id}`)).toHaveAccessibleName(label)
        await noHorizontalOverflow(page)
      }
      await expect(page.getByTestId('more-button')).toHaveCount(0)
      await expect(page.getByTestId('keys-legend')).toHaveCount(0)
    })

    test('keys 1 to 6 switch screens and are ignored in a text field', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      for (const [, , path, key] of ITEMS) {
        await page.keyboard.press(key)
        await expect(page).toHaveURL(urlFor(path))
      }
      await page.goto('/settings')
      await ready(page, 'settings')
      await page.getByLabel('Start date').focus()
      await page.keyboard.press('5')
      await expect(page).toHaveURL(/\/settings$/)
    })

    test('? lists the shortcuts, Esc closes it', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      await page.keyboard.press('?')
      const dlg = page.getByTestId('shell-shortcuts')
      await expect(dlg).toBeVisible()
      await expect(dlg).toContainText('Today')
      await page.keyboard.press('Escape')
      await expect(dlg).toBeHidden()
    })

    test('Ctrl or Cmd K reaches the topic and practice screens, which the rail or the More sheet also show as current', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      for (const [query, path, screen, dest] of PALETTE) {
        await page.keyboard.press(`${MOD}+k`)
        await expect(page.getByTestId('shell-palette')).toBeVisible()
        await page.getByTestId('shell-palette-input').fill(query)
        await expect(page.getByTestId('shell-palette-item').first()).toHaveAttribute('data-target', path)
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(urlFor(path))
        await ready(page, screen)
        if (width < 768) await expect(bar(page).getByTestId('shell-tab-more')).toHaveAttribute('aria-current', 'page')
        else await expect(bar(page).locator('[aria-current="page"]')).toHaveAttribute('data-testid', `shell-nav-${dest}`)
        await noHorizontalOverflow(page)
      }
    })

    test('the rail toggle survives a reload straight after the click, in both directions (NAV-42)', async ({ page }) => {
      test.skip(width < 768, 'the rail is desktop chrome')
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      const rail = page.getByTestId('shell-rail')
      const toggle = page.getByTestId('shell-rail-toggle')
      const widthNow = async () => (await rail.boundingBox())!.width
      await expect(rail).toBeVisible()
      expect(Math.abs((await widthNow()) - 200)).toBeLessThanOrEqual(2) // the first session shows the labels (SHELL-08)
      await toggle.click() // collapse
      await page.reload() // no wait: the write may not have committed
      await expect(rail).toBeVisible()
      expect(Math.abs((await widthNow()) - 56)).toBeLessThanOrEqual(2)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click() // expand again
      await page.reload()
      await expect(rail).toBeVisible()
      expect(Math.abs((await widthNow()) - 200)).toBeLessThanOrEqual(2)
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await page.waitForTimeout(2000)
      await page.reload()
      await expect(rail).toBeVisible()
      expect(Math.abs((await widthNow()) - 200)).toBeLessThanOrEqual(2)
    })

    test('each retired route ends at Today', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      for (const path of RETIRED) {
        await page.goto(path)
        await expect(page).toHaveURL(urlFor('/'))
        await ready(page, 'today')
      }
    })
  })
}

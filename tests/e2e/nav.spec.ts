import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

const PRIMARY: Array<[string, string]> = [
  ['Today', '/'], ['Board', '/board'], ['DSA', '/dsa'], ['Designs', '/designs'], ['AI', '/ai'],
]
const MORE: Array<[string, string]> = [
  ['Map', '/map'], ['Progress', '/progress'], ['Week', '/week'], ['Overview', '/overview'],
  ['Atlas', '/atlas'], ['Banks', '/banks'], ['Mentors', '/mentors'], ['Ritual', '/ritual'], ['Settings', '/settings'],
]
const KEYS: Array<[string, string]> = [
  ['2', '/board'], ['3', '/dsa'], ['4', '/designs'], ['5', '/ai'], ['6', '/map'], ['7', '/progress'],
  ['8', '/week'], ['9', '/overview'], ['0', '/settings'], ['a', '/atlas'], ['b', '/banks'], ['1', '/'],
]

/** Text a sighted user sees: text nodes not inside a visually-hidden (1 x 1 clipped) element. */
const visibleText = (l: import('@playwright/test').Locator) => l.evaluate(el => {
  const out: string[] = []
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    let hidden = false
    for (let a = n.parentElement; a && a !== el.parentElement; a = a.parentElement) {
      const b = a.getBoundingClientRect()
      if (b.width <= 1 || b.height <= 1 || getComputedStyle(a).visibility === 'hidden') hidden = true
    }
    if (!hidden) out.push(n.textContent ?? '')
  }
  return out.join('').replace(/\s+/g, ' ').trim()
})

const urlFor = (path: string) => (path === '/' ? /:\d+\/$/ : new RegExp(`${path}$`))

async function noHorizontalOverflow(page: Page) {
  // Every screen shows <p class="loading"> until its Dexie queries resolve; wait for that to
  // clear (the app's actual "screen is ready" signal — not every destination has an
  // h1.screen-title: Today uses h1.now-headline, Settings has no h1 at all) so we measure the
  // real layout instead of racing the loading placeholder.
  await expect(page.locator('p.loading')).toHaveCount(0)
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
}

async function headerFits(page: Page) {
  const vw = page.viewportSize()!.width
  const boxes = await page
    .locator('nav[aria-label="Main"] > a, nav[aria-label="Main"] [data-testid="more-button"]')
    .evaluateAll(els => els.filter(e => e.getClientRects().length > 0).map(e => {
      const r = e.getBoundingClientRect()
      // the active tab is pressed (translateY 4px, F3.1, with a stepped transition): offsetTop ignores
      // transforms, so it gives the row the tab sits on, not where the press has moved its box
      let top = 0
      for (let n: HTMLElement | null = e as HTMLElement; n; n = n.offsetParent as HTMLElement | null) top += n.offsetTop
      return { left: r.left, right: r.right, top }
    }))
  // ui-shell S1: phone (< 768) keeps Today, Board, DSA and More; Designs and AI move into More.
  expect(boxes).toHaveLength(vw < 768 ? 4 : 6)
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0)
    expect(b.right).toBeLessThanOrEqual(vw + 1)
  }
  expect(new Set(boxes.map(b => b.top)).size).toBe(1)

}

for (const width of [560, 1280]) {
  test.describe(`nav at ${width}px (Review Focus #1)`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('all fourteen destinations reachable, header fits, keys work', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      const nav = page.getByRole('navigation', { name: 'Main' })
      await headerFits(page)

      for (const [label, path] of PRIMARY) {
        if (width < 768 && (path === '/designs' || path === '/ai')) {
          await page.getByTestId('more-button').click()
          await page.getByRole('menuitem', { name: label, exact: true }).click()
        } else await nav.getByRole('link', { name: label, exact: true }).click()
        await expect(page).toHaveURL(urlFor(path))
        await noHorizontalOverflow(page)
        await headerFits(page)
      }
      for (const [label, path] of MORE) {
        await page.getByTestId('more-button').click()
        await page.getByRole('menuitem', { name: label, exact: true }).click()
        await expect(page).toHaveURL(urlFor(path))
        await noHorizontalOverflow(page)
        await headerFits(page)
      }

      await page.goto('/')
      await page.getByTestId('now-eyebrow').waitFor()
      for (const [key, path] of KEYS) {
        await page.keyboard.press(key)
        await expect(page).toHaveURL(urlFor(path))
      }

      const menu = page.getByRole('menu', { name: 'More' })
      await page.keyboard.press('m')
      await expect(menu).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(page.getByTestId('more-button')).toBeFocused()

      await page.goto('/settings')
      await page.getByLabel('Start date').focus()
      await page.keyboard.press('3')
      await page.keyboard.press('m')
      await expect(page).toHaveURL(/\/settings$/)
      await expect(menu).toBeHidden()

      await expect(page.locator('header.topbar > .theme-toggle')).toHaveCount(0)
    })
  })
}

for (const width of [393, 375]) {
  test.describe(`phone header at ${width}px (ui-shell S1, F5, G1)`, () => {
    test.use({ viewport: { width, height: 852 } })

    test('four 44 px tabs fit inside the gutters, no wordmark or key legend, no page scroll', async ({ page }) => {
      await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
      await onboard(page, '2026-10-05')
      const nav = page.getByRole('navigation', { name: 'Main' })
      const tabs = nav.locator('a:visible, [data-testid="more-button"]')
      await expect(tabs).toHaveText(['Today', 'Board', 'DSA', /More/])
      for (const box of await tabs.evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()))) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.left).toBeGreaterThanOrEqual(15)
        expect(box.right).toBeLessThanOrEqual(width - 15)
      }
      await expect(page.getByText('INFRA', { exact: false }).first()).toBeHidden()
      await expect(page.locator('footer.keys-legend')).toBeHidden()
      await noHorizontalOverflow(page)
      await page.getByTestId('more-button').click()
      const menu = page.getByRole('menu', { name: 'More' })
      await expect(menu.getByRole('menuitem').first()).toHaveAccessibleName('Designs')
      const m = await menu.evaluate(e => e.getBoundingClientRect().toJSON())
      expect(m.right).toBeLessThanOrEqual(width - 15)
      expect(m.left).toBeGreaterThanOrEqual(0)
      await noHorizontalOverflow(page)
      await menu.getByRole('menuitem', { name: 'AI', exact: true }).click()
      await expect(page).toHaveURL(/\/ai$/)
      // G4 review 6, then UAT cu-1 P3-14: "More · <Tab> ▾" shows where it fits beside Today/Board/DSA ("AI" does at 393, not at
      // 375; "Settings" at neither, measured ~430 px), else the visible label is "More ▾" in the accent and the accessible
      // name carries the tab.
      const more = page.getByTestId('more-button')
      await expect(more).toHaveClass(/tab-on/)
      expect(await visibleText(more)).toBe(width === 393 ? 'More · AI ▾' : 'More ▾')
      await expect(more).toHaveAccessibleName('More · AI ▾')
      await page.goto('/settings')
      expect(await visibleText(more)).toBe('More ▾')
      await expect(more).toHaveAccessibleName('More · Settings ▾')
    })
  })
}

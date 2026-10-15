import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard, serveLegacyPlan } from './helpers'
import { ownTextElements } from './type-scan'
import { APPROACHES } from '../../src/content/approaches'

// ux spec section 1 (readability), checked in a real browser at 1280x900: no visible element with its
// own text under 14 px; Silkscreen only at 16/24/32/48 and never on p or td; reading text is Chivo
// at 17 px or more with a line height of at least 1.5 x.
const SCREENS: Array<[string, string]> = [
  ['today', '/'], ['path', '/path'], ['skills', '/skills'], ['review', '/review'], ['do', '/do/m1w2t1'], ['dsa', '/dsa'],
  ['designs', '/designs'], ['banks', '/banks'], ['settings', '/settings'], ['guide', '/guide'],
]

test.describe('readability (ux spec section 1)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  for (const [name, path] of SCREENS) {
    test(`type scale on ${name}`, async ({ page }) => {
      // the ten-ticket legacy fixture has no skill tree and no design bank in sprint range, so Skills and Designs walk the live plan
      if (name !== 'skills' && name !== 'designs') await serveLegacyPlan(page)
      await page.clock.setFixedTime(IST('2026-09-21T09:00:00'))
      await onboard(page)
      await page.goto(path)
      await expect(page.getByTestId(`screen-${name}`)).toHaveAttribute('data-ready', 'true')
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(600)
      const els = await ownTextElements(page)
      expect(els.length).toBeGreaterThan(3)
      const tiny = els.filter(e => e.size < 14).map(e => `${e.tag}.${e.cls} "${e.text}" ${e.size}px`)
      expect(tiny, 'text under 14px').toEqual([])
      const pixel = els.filter(e => /^"?Silkscreen/.test(e.family))
      const badSize = pixel.filter(e => ![16, 24, 32, 48].includes(e.size)).map(e => `${e.tag}.${e.cls} "${e.text}" ${e.size}px`)
      expect(badSize, 'Silkscreen at an uncrisp size').toEqual([])
      const badTag = pixel.filter(e => e.tag === 'p' || e.tag === 'td').map(e => `${e.tag}.${e.cls} "${e.text}"`)
      expect(badTag, 'Silkscreen on p or td').toEqual([])
      if (name === 'do') {
        // ui-do D4 / ruling 10: the ladder's rung notes are Chivo 15 secondary descriptions, not reading text
        // Today (R1) has no drawers or dig notes: its one-line captions (qc-reason, 15 px) are secondary text held to GLOBAL-04's 14 px
        // floor above, not the 17 px reading rule, so only Do keeps the reading-text check. The ticket view's meta lines (dk-meta, 14 px:
        // the node's why under "Why this ticket", the checked-answers status) are the same kind of secondary text.
        const ps = els.filter(e => e.tag === 'p' && e.cls !== 'rung-note' && !/\bdk-meta\b/.test(e.cls))
        expect(ps.length).toBeGreaterThan(0)
        const bad = ps
          .filter(e => !/^"?Chivo/.test(e.family) || e.size < 17 || e.lh < 1.5 * e.size - 0.01)
          .map(e => `p.${e.cls} "${e.text}" ${e.family} ${e.size}px lh ${e.lh}`)
        expect(bad, 'reading text').toEqual([])
      }
    })
  }
})

// GLOBAL-04: the next-design callout title is a Silkscreen <h3> at 16 px (never a <p> or <td>); it only shows while a design is due,
// so the live-plan walk above (callout text state) does not cover it.
test.describe('readability: the next-design callout', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('type scale on designs with a next design shown', async ({ page }) => {
    await serveLegacyPlan(page) // its design bank is in sprint range on 2026-09-21, so the callout shows a title
    await page.clock.setFixedTime(IST('2026-09-21T09:00:00'))
    await onboard(page)
    await page.goto('/designs')
    await expect(page.getByTestId('screen-designs')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('next-design-title')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const pixel = (await ownTextElements(page)).filter(e => /^"?Silkscreen/.test(e.family))
    expect(pixel.filter(e => e.tag === 'p' || e.tag === 'td').map(e => `${e.tag}.${e.cls} "${e.text}"`), 'Silkscreen on p or td').toEqual([])
  })
})

// GLOBAL-04: a <sup> (the exponent in an approach's complexity, "O(2^V)") is held to the same 14 px floor as any text.
test.describe('readability: superscripts', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('the exponent in an approach chip computes at 14 px or more', async ({ page }) => {
    await page.clock.setFixedTime(IST('2026-10-06T10:00:00'))
    await onboard(page, '2026-10-05')
    const todo = (await idbAll<{ id: string; kind: string; status: string }>(page, 'tickets')).filter(t => t.kind === 'problem' && t.status === 'todo')
    const hit = todo.find(t => (APPROACHES[t.id] ?? []).some(a => a.complexity.includes('^')))
    expect(hit, 'a todo problem whose approaches carry a power').toBeTruthy()
    await page.goto(`/do/${hit!.id}`)
    await expect(page.getByTestId('screen-do')).toBeVisible()
    const more = page.getByTestId('dsa-approaches-more')
    if ((await more.getAttribute('open')) === null) await more.locator('summary').click()
    const sup = page.locator('sup').first()
    await expect(sup).toBeVisible()
    expect(await sup.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14)
    const own = (await ownTextElements(page)).filter(e => e.tag === 'sup')
    expect(own.length).toBeGreaterThan(0)
    expect(own.filter(e => e.size < 14).map(e => `${e.text} ${e.size}px`)).toEqual([])
  })
})

// ux spec section 2 (dark only), contract UX-05.
test.describe('dark only (UX-05)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('Settings has no theme control, the root is color-scheme dark, and a light request changes nothing', async ({ page }) => {
    await serveLegacyPlan(page)
    await page.clock.setFixedTime(IST('2026-09-21T09:00:00'))
    await onboard(page)
    await page.goto('/settings')
    await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-ready', 'true')
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('button, input, select, textarea, a, [role="button"], [role="radio"], [role="switch"], [role="checkbox"]')]
        .map(e => `${e.getAttribute('aria-label') ?? ''} ${(e.textContent ?? '').trim()} ${(e as HTMLInputElement).labels?.[0]?.textContent ?? ''}`.trim()))
    expect(names.filter(n => /theme|light|dark/i.test(n))).toEqual([])
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')

    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(() => localStorage.setItem('dojo:theme', 'light'))
    await page.reload()
    await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-ready', 'true')
    const lum = await page.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number).map(v => v / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    })
    expect(lum).toBeLessThan(0.1)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
  })
})

// contract UX-16: text inside the engines' shadow roots, also engines mounted after navigation.
test.describe('engine text (UX-16)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('the algorithm player and the Designs engines draw at 14 px or more, no odd Silkscreen', async ({ page }) => {
    await page.clock.setFixedTime(IST('2026-10-06T21:00:00'))
    await onboard(page, '2026-10-05')
    const check = async (label: string) => {
      const els = (await ownTextElements(page)).filter(e => e.shadow)
      expect(els.length, `${label}: shadow text found`).toBeGreaterThan(0)
      const tiny = els.filter(e => e.size < 13.95).map(e => `${e.tag}.${e.cls} "${e.text}" ${e.size}px`)
      const pixel = els.filter(e => /^"?Silkscreen/.test(e.family) && ![16, 24, 32, 48].includes(Math.round(e.size))).map(e => `${e.tag} ${e.size}px`)
      expect([label, tiny, pixel]).toEqual([label, [], []])
    }
    // R1 Today has no engine (the health chart left with the old Today), so only the DSA player and Designs carry shadow text
    // mounted after navigation: Do the DSA topic player
    await page.goto('/dsa')
    await page.getByTestId('heat-row-1').click()
    await expect(page.getByTestId('dsa-warmup')).toBeVisible()
    await page.waitForFunction(() => !!document.querySelector('sr-algo')?.shadowRoot?.querySelector('.say'))
    await check('algo player')
    await page.getByRole('button', { name: /^Play|Step|›|▶/i }).first().click({ timeout: 2000 }).catch(() => {})
    await check('algo player after a step')
    await page.goto('/designs')
    await expect(page.getByTestId('screen-designs')).toHaveAttribute('data-ready', 'true')
    await page.waitForFunction(() => [...document.querySelectorAll('sr-chart,sr-diagram')].every(c => !!c.shadowRoot?.querySelector('svg')))
    await check('designs')
  })
})

import { expect, test, type Locator, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// reports/ui/settings-progress-ref/triage.md: the screen-local roots (A5, M2–M8, M11–M15, M17) and
// Controller ruling 8 S5, S6, S9. App-wide roots (A1, A4, A6, A7, M1, M9, M10, M16) are another builder's.

const SECONDARY = 'rgb(180, 186, 208)' // --sr-text-secondary #b4bad0 (F1.3, F1.5 chart label)

async function css(l: Locator, props: string[]): Promise<Record<string, string>> {
  return l.evaluate((el, ps) => {
    const cs = getComputedStyle(el)
    return Object.fromEntries(ps.map(p => [p, cs.getPropertyValue(p)]))
  }, props)
}
const fam = (s: string) => s.split(',')[0].replace(/"/g, '').trim()

async function start(page: Page): Promise<void> {
  await page.clock.setFixedTime(IST('2026-10-14T10:00:00'))
  await onboard(page, '2026-10-05')
}

async function noPageScroll(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
}

test.describe('desktop 1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Settings: start date text is Chivo 15/400', async ({ page }) => {
    await start(page)
    await page.goto('/settings')
    const c = await css(page.getByRole('textbox', { name: 'Start date' }), ['font-family', 'font-size', 'font-weight'])
    expect(`${fam(c['font-family'])} ${c['font-size']} ${c['font-weight']}`).toBe('Chivo 15px 400')
  })

  test('DSA: the pick-a-topic hint is Chivo 15/400 secondary', async ({ page }) => {
    await start(page)
    await page.goto('/dsa')
    const c = await css(page.getByTestId('dsa-hint'), ['font-family', 'font-size', 'font-weight', 'color'])
    expect(`${fam(c['font-family'])} ${c['font-size']} ${c['font-weight']} ${c.color}`).toBe(`Chivo 15px 400 ${SECONDARY}`)
  })

  test('Atlas: cells 24 x 18, headers Space Mono 14 upper, row header ellipsis + title, search Chivo 15', async ({ page }) => {
    await start(page)
    await page.goto('/atlas')
    const m = page.getByTestId('atlas-matrix')
    const cell = (await m.locator('[data-testid^="atlas-cell-"]').first().boundingBox())!
    expect(Math.round(cell.width)).toBe(24)
    expect(Math.round(cell.height)).toBe(18)
    const th = m.locator('[data-testid^="atlas-row-"]').first().locator('th')
    const t = await css(th, ['font-family', 'font-size', 'text-transform', 'text-overflow', 'text-align', 'color'])
    expect(`${fam(t['font-family'])} ${t['font-size']} ${t['text-transform']} ${t['text-overflow']} ${t['text-align']}`).toBe('Space Mono 14px uppercase ellipsis right')
    expect(await th.getAttribute('title')).toBeTruthy()
    expect(await th.locator('button').getAttribute('title')).toBe(await th.getAttribute('title'))
    expect(t.color).toBe(SECONDARY)
    const atom = await css(m.locator('.am-atom').first(), ['font-family', 'font-size', 'text-transform'])
    expect(`${fam(atom['font-family'])} ${atom['font-size']} ${atom['text-transform']}`).toBe('Space Mono 14px uppercase')
    const s = await css(page.getByRole('searchbox').or(page.getByRole('textbox')).first(), ['font-family', 'font-size', 'font-weight'])
    expect(`${fam(s['font-family'])} ${s['font-size']} ${s['font-weight']}`).toBe('Chivo 15px 400')
  })

  test('Banks: search 36 tall, tabs Chivo 15/700, Clear filters quiet, Mine label Chivo, Classify accent', async ({ page }) => {
    await start(page)
    await page.goto('/banks')
    const search = page.getByTestId('banks-search')
    expect(Math.round((await search.boundingBox())!.height)).toBe(36)
    const tab = page.getByRole('tab').first()
    const tc = await css(tab, ['font-family', 'font-size', 'font-weight'])
    expect(`${fam(tc['font-family'])} ${tc['font-size']} ${tc['font-weight']}`).toBe('Chivo 15px 700')
    const clear = page.getByTestId('banks-clear-filters')
    const cc = await css(clear, ['background-color', 'border-top-width', 'border-top-color'])
    expect(cc).toMatchObject({ 'background-color': 'rgba(0, 0, 0, 0)', 'border-top-width': '2px', 'border-top-color': 'rgb(65, 73, 104)' })
    expect(Math.round((await clear.boundingBox())!.height)).toBe(32)
    await page.getByRole('tab', { name: /^Mine/ }).click()
    const lab = await css(page.getByTestId('mine-add').locator('label span').first(), ['font-family', 'font-size', 'font-weight', 'text-transform', 'color'])
    expect(`${fam(lab['font-family'])} ${lab['font-size']} ${lab['font-weight']} ${lab['text-transform']} ${lab.color}`).toBe(`Chivo 15px 700 uppercase ${SECONDARY}`)
    await expect(page.getByTestId('mine-classify')).toHaveClass(/sr-btn-accent/)
  })

  test('Designs: deep-dive wall well is .sc; list padding 24; no 100 px padding', async ({ page }) => {
    await start(page)
    await page.goto('/designs')
    await expect(page.getByTestId('screen-designs')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('.ev-wall-well')).toHaveClass(/\bsc\b/)
    const pads = await page.locator('.prose-list').evaluateAll(els => els.map(e => getComputedStyle(e).paddingLeft))
    expect(pads.length).toBeGreaterThan(0)
    expect(new Set(pads)).toEqual(new Set(['24px']))
    const off = await page.locator('body').evaluate(root => [...root.querySelectorAll('*')]
      .filter(e => { const cs = getComputedStyle(e); return cs.paddingLeft === '100px' || cs.paddingRight === '100px' }).length)
    expect(off).toBe(0)
  })

  test('Design session: the palette row and the canvas are .sc scrollers; the row scrolls instead of clipping', async ({ page }) => {
    await start(page)
    await page.goto('/designs/session/d-ratelimit')
    await page.getByTestId('session-start').click()
    const pal = page.getByTestId('kit-palette').locator('.kit-palette-row')
    await expect(pal).toHaveClass(/\bsc\b/)
    await expect(page.getByTestId('kit-canvas')).toHaveClass(/\bsc\b/)
    const p = await pal.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }))
    if (p.sw > p.cw) expect(p.ox).toBe('auto')
  })
})

test.describe('phone 393', () => {
  test.use({ viewport: { width: 393, height: 852 } })

  // R1: the sprint "Core minutes per sprint" field is retired (the sprint machinery is: README "Retired hooks"). Ruling 8 S5 (a numeric
  // Settings field is 160 wide on a phone, not full width) is kept on the standalone numeric field Settings has now, the session
  // length (SET-06, a text input with a numeric keypad, found by its hook). The seven daily budgets (SET-01) are numeric fields
  // too and compute to 160 as well (R1 polish, settings.css .ps-field), inside the screen with no sideways scroll.
  test('Settings: the session-length field is 160 wide on phone, the budget fields stay on screen (ruling 8 S5)', async ({ page }) => {
    await start(page)
    await page.goto('/settings')
    const mins = page.getByTestId('settings-session-minutes')
    await mins.scrollIntoViewIfNeeded()
    expect(Math.round((await mins.boundingBox())!.width)).toBe(160)
    for (const i of [0, 6]) {
      const b = page.getByTestId(`settings-budget-${i}`)
      await b.scrollIntoViewIfNeeded()
      const box = (await b.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(393)
      expect(Math.round(box.width), `budget ${i}`).toBe(160)
    }
    await noPageScroll(page, 393)
  })

  test('DSA: stat tiles are one column on phone', async ({ page }) => {
    await start(page)
    await page.goto('/dsa')
    await expect(page.getByTestId('dsa-solved')).toBeVisible()
    const xs = await page.locator('.dsa .stat-strip > .stat').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().x)))
    expect(xs).toHaveLength(3)
    expect(new Set(xs).size).toBe(1)
  })
})

test.describe('R1 polish: numeric Settings fields are 160 wide', () => {
  for (const [w, h] of [[1280, 800], [375, 667]] as const) {
    test(`the seven budgets and the session length compute to 160 px at ${w}, with no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await start(page)
      await page.goto('/settings')
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-ready', 'true')
      for (const id of [...[0, 1, 2, 3, 4, 5, 6].map(i => `settings-budget-${i}`), 'settings-session-minutes']) {
        expect(await page.getByTestId(id).evaluate(e => getComputedStyle(e).width), `${id} at ${w}`).toBe('160px')
      }
      await noPageScroll(page, w)
    })
  }

  test('Settings with a mid-week start date shows no Board, Sprint or "AI watch day" text', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await start(page) // 2026-10-14 is a Wednesday, the start date 2026-10-05 a Monday
    await page.goto('/settings')
    await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-ready', 'true')
    await page.getByLabel('Start date').fill('2026-10-07') // a Wednesday
    await expect(page.getByTestId('start-date-warn')).toHaveCount(0)
    expect((await page.getByTestId('screen-settings').innerText())).not.toMatch(/\bBoard\b|Sprint|AI watch day/i)
  })
})

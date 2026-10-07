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

  test('Progress: chart labels secondary, rings 15/700, empties Chivo 15, redo 400, burn-up fills its well (720 x 220 at least), evidence Mono 15, no 100 px padding', async ({ page }) => {
    await start(page)
    await page.goto('/progress')
    await expect(page.getByTestId('screen-progress')).toHaveAttribute('data-ready', 'true')
    // M2 + M4
    const label = page.getByTestId('ring-all').locator('.ring-label')
    expect(await css(label, ['font-family', 'font-size', 'font-weight', 'color'])).toMatchObject({ 'font-size': '15px', 'font-weight': '700', color: SECONDARY })
    expect((await css(page.getByTestId('ring-all-count'), ['color'])).color).toBe(SECONDARY)
    expect((await css(page.locator('.chart-legend').first(), ['color'])).color).toBe(SECONDARY)
    // M3
    for (const id of ['no-sessions', 'no-study-sessions', 'help-ladder-empty', 'no-reviews']) {
      const c = await css(page.getByTestId(id), ['font-family', 'font-size', 'font-weight', 'color'])
      expect(`${id} ${fam(c['font-family'])} ${c['font-size']} ${c['font-weight']} ${c.color}`).toBe(`${id} Chivo 15px 400 ${SECONDARY}`)
    }
    // M5
    expect((await css(page.getByTestId('redo-passed-value'), ['font-weight']))['font-weight']).toBe('400')
    // M6: drawn at least 720 x 220, centred in its well; UAT r3 J2: a wider well is filled edge to edge
    const svg = page.getByRole('img', { name: 'Planned vs done, cumulative by sprint' })
    const b = (await svg.boundingBox())!
    expect(b.width).toBeGreaterThanOrEqual(720)
    expect(Math.round(b.height)).toBe(220)
    const well = (await svg.locator('xpath=..').boundingBox())!
    expect(Math.abs((b.x - well.x) - (well.x + well.width - b.x - b.width))).toBeLessThanOrEqual(2)
    expect(well.width - b.width).toBeLessThanOrEqual(24) // only the well's padding and border
    // S6: evidence row value Space Mono 15
    const v = await css(page.getByTestId('ev-dsa-solved-value'), ['font-family', 'font-size'])
    expect(`${fam(v['font-family'])} ${v['font-size']}`).toBe('Space Mono 15px')
    // M11: no 100 px side padding anywhere on the screen
    const off = await page.getByTestId('screen-progress').evaluate(root => [...root.querySelectorAll('*')]
      .filter(e => { const cs = getComputedStyle(e); return cs.paddingLeft === '100px' || cs.paddingRight === '100px' }).length)
    expect(off).toBe(0)
  })

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

  test('Design session: palette and canvas are .sc scrollers; the palette scrolls instead of clipping', async ({ page }) => {
    await start(page)
    await page.goto('/designs/session/d-ratelimit')
    await page.getByRole('button', { name: 'Start · 45 min' }).click()
    const pal = page.getByTestId('kit-palette')
    await expect(pal).toHaveClass(/\bsc\b/)
    await expect(page.getByTestId('kit-canvas')).toHaveClass(/\bsc\b/)
    const p = await pal.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }))
    if (p.sw > p.cw) expect(p.ox).toBe('auto')
  })

  test('Overview, Mentors, Ritual: lists padding 24; Mentors and Ritual paragraphs are Body 17', async ({ page }) => {
    await start(page)
    for (const path of ['/overview', '/mentors', '/ritual']) {
      await page.goto(path)
      await expect(page.getByTestId(`screen-${path.slice(1)}`)).toHaveAttribute('data-ready', 'true')
      const pads = await page.locator('.prose-list').evaluateAll(els => els.map(e => getComputedStyle(e).paddingLeft))
      expect(pads.length, path).toBeGreaterThan(0)
      expect(new Set(pads), path).toEqual(new Set(['24px']))
      if (path === '/overview') continue
      const bad = await page.locator('main').evaluate(root => [...root.querySelectorAll('p')].filter(p => p.getBoundingClientRect().width > 0).flatMap(p => {
        const cs = getComputedStyle(p)
        const f = cs.fontFamily.split(',')[0].replace(/"/g, '').trim()
        if (f === 'Space Mono') return []
        return f !== 'Chivo' || cs.fontSize !== '17px' || parseFloat(cs.lineHeight) < 25.5 ? [`${(p.textContent ?? '').slice(0, 30)} ${f} ${cs.fontSize}/${cs.lineHeight}`] : []
      }))
      expect(bad, path).toEqual([])
    }
  })

  test('AI and Map: cube and meter gaps are 2', async ({ page }) => {
    await start(page)
    await page.goto('/map')
    await expect(page.locator('.path-cubes').first()).toBeVisible()
    const g = await page.locator('.path-cubes').first().evaluate(e => getComputedStyle(e).columnGap)
    expect(g).toBe('2px')
    await page.goto('/ai')
    await expect(page.getByTestId('screen-ai')).toHaveAttribute('data-ready', 'true')
    const minis = await page.locator('.p-mini').evaluateAll(els => els.map(e => getComputedStyle(e).columnGap))
    expect(minis.length).toBeGreaterThan(0)
    expect(new Set(minis)).toEqual(new Set(['2px']))
  })
})

test.describe('phone 393', () => {
  test.use({ viewport: { width: 393, height: 852 } })

  test('Progress: the burn-up keeps 720 x 220 and scrolls inside an .sc well', async ({ page }) => {
    await start(page)
    await page.goto('/progress')
    const svg = page.getByRole('img', { name: 'Planned vs done, cumulative by sprint' })
    const b = (await svg.boundingBox())!
    expect(Math.round(b.width)).toBe(720)
    expect(Math.round(b.height)).toBe(220)
    const well = svg.locator('xpath=..')
    await expect(well).toHaveClass(/\bsc\b/)
    const w = await well.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }))
    expect(w.ox).toBe('auto')
    expect(w.sw).toBeGreaterThan(w.cw)
    await noPageScroll(page, 393)
  })

  test('Settings: Workload spinbutton is 160 wide on phone (ruling 8 S5)', async ({ page }) => {
    await start(page)
    await page.goto('/settings')
    const n = page.getByRole('spinbutton', { name: 'Core minutes per sprint' })
    expect(Math.round((await n.boundingBox())!.width)).toBe(160)
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

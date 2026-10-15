import { expect, test, type Page } from '@playwright/test'
import { idbAll, IST, onboard } from './helpers'

// R1 scope 2, W3 + W8 + W9: the rail with its toggle (NAV-01 to NAV-08), the phone tab bar and More sheet (NAV-09 to NAV-14),
// keys 1 to 6 (SHELL-02, 03), the Guide (NAV-27 to NAV-31), the Designs search (NAV-32 to NAV-36), the palette (NAV-37 to NAV-39)
// and Path's remembered filter (NAV-40, NAV-41). /board, /journal and /ai-topics are other workstreams' screens: their links,
// keys and palette targets are asserted here, their navigation is not (the merger checks it).
// pictures go to S2_W3_SHOTS_DIR (the visual-check folder); by default into test-results
const SHOTS = process.env.S2_W3_SHOTS_DIR ?? 'test-results/scope2-w3-shots'
const ORDER = ['today', 'path', 'board', 'journal', 'skills', 'review', 'ai', 'dsa', 'designs', 'banks', 'atlas', 'guide']
const LABEL: Record<string, string> = { today: 'Today', path: 'Path', board: 'Board', journal: 'Journal', skills: 'Skills', review: 'Review', ai: 'AI', dsa: 'DSA', designs: 'Designs', banks: 'Banks', atlas: 'Atlas', guide: 'Guide' }
const ROUTE: Record<string, string> = { today: '/', path: '/path', board: '/board', journal: '/journal', skills: '/skills', review: '/review', ai: '/ai-topics', dsa: '/dsa', designs: '/designs', banks: '/banks', atlas: '/atlas', guide: '/guide' }
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const urlFor = (path: string) => (path === '/' ? /:\d+\/$/ : new RegExp(`${path.replace('/', '\\/')}$`))

async function start(page: Page) {
  await page.clock.setFixedTime(IST('2026-11-04T10:00:00'))
  await onboard(page, '2026-11-02')
}
const ready = (page: Page, screen: string) => expect(page.getByTestId(`screen-${screen}`)).toHaveAttribute('data-ready', 'true')
const noSideways = async (page: Page) => {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(sw).toBeLessThanOrEqual(iw)
}
async function storedNavLabels(page: Page): Promise<string | undefined> {
  const rows = await idbAll<{ id: string; navLabels?: string }>(page, 'settings')
  return rows.find(r => r.id === 'main')?.navLabels
}
async function width(page: Page, id = 'shell-rail') { return (await page.getByTestId(id).boundingBox())!.width }

test.describe('desktop 1280 x 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('NAV-01/02/03/07: twelve items in three groups, labels, links and headings', async ({ page }) => {
    await start(page)
    const rail = page.getByTestId('shell-rail')
    const items = rail.locator('[data-testid^="shell-nav-"]')
    await expect(items).toHaveCount(12)
    expect(await items.evaluateAll(els => els.map(e => e.getAttribute('data-testid')))).toEqual(ORDER.map(i => `shell-nav-${i}`))
    for (const id of ORDER) {
      const a = page.getByTestId(`shell-nav-${id}`)
      await expect(a).toHaveAccessibleName(LABEL[id])
      await expect(a).toHaveText(new RegExp(`^${LABEL[id]}`))
      expect(new URL((await a.getAttribute('href'))!, 'http://x').pathname.replace(/^\/#/, '')).toBe(ROUTE[id])
    }
    await expect(page.getByTestId('more-button')).toHaveCount(0)
    await expect(page.getByTestId('keys-legend')).toHaveCount(0)
    await expect(page.getByTestId('shell-rail-group-title-topics')).toHaveText('Topics')
    await expect(page.getByTestId('shell-rail-group-title-practice')).toHaveText('Practice')
    const focusable = await rail.locator('a[href], button').evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
    expect(focusable.slice(-2)).toEqual(['shell-nav-guide', 'shell-rail-toggle'])
    // the screens that exist on this branch: each item shows its own screen and is the one current item
    for (const id of ['path', 'skills', 'review', 'dsa', 'designs', 'banks', 'atlas', 'guide', 'today']) {
      await page.getByTestId(`shell-nav-${id}`).click()
      await expect(page).toHaveURL(urlFor(ROUTE[id]))
      await ready(page, id)
      await expect(rail.locator('[aria-current="page"]')).toHaveCount(1)
      await expect(page.getByTestId(`shell-nav-${id}`)).toHaveAttribute('aria-current', 'page')
    }
    for (const [route, id] of [['/skills/stats', 'skills'], ['/designs?tier=1', 'designs']] as const) {
      await page.goto(route)
      await expect(page.getByTestId(`shell-nav-${id}`)).toHaveAttribute('aria-current', 'page')
    }
    for (const route of ['/settings']) {
      await page.goto(route)
      await expect(rail.locator('[aria-current="page"]')).toHaveCount(0)
    }
  })

  test('NAV-04/05/06: the rail fits, the toggle collapses by click, Enter and Space, and the choice survives a reload and Settings', async ({ page }) => {
    await start(page)
    const toggle = page.getByTestId('shell-rail-toggle')
    const fits = async () => {
      const boxes = await page.locator('[data-testid^="shell-nav-"], [data-testid="shell-rail-toggle"]').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom, r.left, r.right] }))
      expect(boxes).toHaveLength(13)
      for (const [t, b, l, r] of boxes) { expect(t).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(800); expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1280) }
      const sorted = [...boxes].sort((a, b) => a[0] - b[0])
      for (let i = 1; i < sorted.length; i++) expect(sorted[i][0]).toBeGreaterThanOrEqual(sorted[i - 1][1] - 0.5)
      expect(await page.evaluate(() => { const r = document.querySelector('[data-testid="shell-rail"]')!; return r.scrollHeight <= r.clientHeight })).toBe(true)
    }
    await expect.poll(() => width(page)).toBeGreaterThanOrEqual(198)
    expect(await width(page)).toBeLessThanOrEqual(202)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toHaveAccessibleName('Collapse navigation')
    await expect(toggle).toHaveText('Collapse navigation')
    await fits()
    await page.screenshot({ path: `${SHOTS}/scope2-w3-rail-expanded-1280.png` })
    // groups: the gap between groups is larger than the gap between two items of a group (expanded and collapsed)
    const gaps = async () => page.evaluate(() => {
      const top = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
      return { inside: top('shell-nav-path').top - top('shell-nav-today').bottom, between: top('shell-nav-ai').top - top('shell-nav-review').bottom }
    })
    let g = await gaps(); expect(g.between).toBeGreaterThan(g.inside)
    await toggle.click()
    await expect.poll(() => width(page)).toBeLessThanOrEqual(58)
    expect(await width(page)).toBeGreaterThanOrEqual(54)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveAccessibleName('Expand navigation')
    await expect.poll(() => storedNavLabels(page)).toBe('hover')
    for (const id of ORDER) await expect(page.getByTestId(`shell-nav-${id}`).locator('.sh-rl')).toBeHidden()
    await expect(page.getByTestId('shell-rail-group-title-topics')).toBeHidden()
    await expect(page.getByTestId('shell-rail-group-title-practice')).toBeHidden()
    g = await gaps(); expect(g.between).toBeGreaterThan(g.inside)
    await fits()
    await page.screenshot({ path: `${SHOTS}/scope2-w3-rail-collapsed-1280.png` })
    // hover and focus labels (>= 14 px), also on the toggle
    await page.getByTestId('shell-nav-path').hover()
    const tip = page.getByTestId('shell-nav-path').locator('.sh-rl')
    await expect(tip).toBeVisible()
    await expect(tip).toHaveText('Path')
    expect(await tip.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14)
    await page.mouse.move(700, 400)
    await toggle.focus()
    const ttip = toggle.locator('.sh-rl')
    await expect(ttip).toBeVisible()
    await expect(ttip).toHaveText('Expand navigation')
    expect(await ttip.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14)
    await page.screenshot({ path: `${SHOTS}/scope2-w3-rail-tooltip-1280.png`, clip: { x: 0, y: 0, width: 420, height: 800 } })
    // the reload keeps it, Settings agrees
    await page.reload()
    await expect(page.getByTestId('shell-rail-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(await width(page)).toBeLessThanOrEqual(58)
    await page.goto('/settings')
    await expect(page.getByTestId('settings-nav-labels')).not.toBeChecked()
    await page.getByTestId('settings-nav-labels').check()
    await expect.poll(() => width(page)).toBeGreaterThanOrEqual(198)
    await expect.poll(() => storedNavLabels(page)).toBe('always')
    await expect(page.getByTestId('shell-rail-toggle')).toHaveAttribute('aria-expanded', 'true')
    // keyboard: Enter, then Space
    await page.getByTestId('shell-rail-toggle').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => width(page)).toBeLessThanOrEqual(58)
    await page.keyboard.press('Space')
    await expect.poll(() => width(page)).toBeGreaterThanOrEqual(198)
    await expect.poll(() => storedNavLabels(page)).toBe('always')
    await fits()
  })

  test('SHELL-02/03: keys 1 to 6 reach the first six destinations in every rail state; 7 8 9 0 do nothing; none for AI to Guide', async ({ page }) => {
    await start(page)
    for (const collapsed of [false, true]) {
      if (collapsed) { await page.getByTestId('shell-rail-toggle').click(); await expect.poll(() => width(page)).toBeLessThanOrEqual(58) }
      await page.locator('body').click({ position: { x: 700, y: 400 } })
      for (const [key, path] of [['2', '/path'], ['5', '/skills'], ['6', '/review'], ['1', '/']] as const) {
        await page.keyboard.press(key)
        await expect(page).toHaveURL(urlFor(path))
      }
      // 3 and 4 go to /board and /journal: those screens belong to other workstreams, so only the key mapping is asserted (unit tests)
      await page.keyboard.press('2')
      await expect(page).toHaveURL(/\/path$/)
      for (const k of ['7', '8', '9', '0']) await page.keyboard.press(k)
      await expect(page).toHaveURL(/\/path$/)
      await page.keyboard.press('1')
      await expect(page).toHaveURL(urlFor('/'))
    }
    const keyed = await page.locator('[data-testid^="shell-nav-"]').evaluateAll(els => els.map(e => [e.getAttribute('data-testid'), e.getAttribute('aria-keyshortcuts')]))
    expect(keyed.filter(([, k]) => k).map(([id, k]) => `${id}:${k}`)).toEqual(ORDER.slice(0, 6).map((id, i) => `shell-nav-${id}:${i + 1}`))
  })

  test('NAV-30/31: the Guide opens from the rail, the gear, the palette and the ? overlay', async ({ page }) => {
    await start(page)
    await page.getByTestId('shell-nav-guide').click()
    await expect(page).toHaveURL(/\/guide$/)
    await expect(page.getByTestId('guide-title')).toHaveText('How Dojo works')
    await expect(page.getByTestId('shell-nav-guide')).toHaveAttribute('aria-current', 'page')
    await page.goto('/path')
    await page.getByTestId('shell-gear').click()
    await page.getByTestId('shell-menu-guide').click()
    await expect(page).toHaveURL(/\/guide$/)
    await expect(page.getByTestId('shell-gear-menu')).toHaveCount(0)
    await page.goto('/path')
    await ready(page, 'path')
    await page.keyboard.press(`${MOD}+k`)
    await page.getByTestId('shell-palette-input').fill('guide')
    await expect(page.locator('[data-testid="shell-palette-item"][data-target="/guide"]')).toBeVisible()
    await page.locator('[data-testid="shell-palette-item"][data-target="/guide"]').click()
    await expect(page).toHaveURL(/\/guide$/)
    await expect(page.getByTestId('shell-palette')).toHaveCount(0)
    await page.goto('/path')
    await ready(page, 'path')
    await page.locator('body').click({ position: { x: 700, y: 20 } })
    await page.keyboard.press('?')
    const ov = page.getByTestId('shell-shortcuts')
    await expect(ov).toBeVisible()
    for (const k of ['1', '2', '3', '4', '5', '6']) await expect(ov.locator('dt kbd', { hasText: new RegExp(`^${k}$`) })).toHaveCount(1)
    await page.getByTestId('shell-shortcuts-guide').click()
    await expect(page).toHaveURL(/\/guide$/)
    await expect(ov).toHaveCount(0)
    // the Guide's own button; Esc leaves the Guide in place
    await page.getByTestId('guide-open-shortcuts').click()
    await expect(page.getByTestId('shell-shortcuts')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('shell-shortcuts')).toHaveCount(0)
    await expect(page.getByTestId('screen-guide')).toBeVisible()
  })

  test('NAV-27 to NAV-29: the Guide has nine sections and one line per destination', async ({ page }) => {
    await start(page)
    await page.goto('/guide')
    await ready(page, 'guide')
    await expect(page.locator('h1')).toHaveCount(1)
    const secs = await page.locator('[data-testid^="guide-section-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
    expect(secs).toEqual(['overview', 'destinations', 'board', 'review', 'skills', 'ritual', 'design', 'mentors', 'shortcuts'].map(s => `guide-section-${s}`))
    const text = (id: string) => page.getByTestId(`guide-section-${id}`).innerText().then(t => t.toLowerCase())
    const over = await text('overview'); expect(over.indexOf('today')).toBeLessThan(over.indexOf('ticket')); expect(over.indexOf('ticket')).toBeLessThan(over.indexOf('done')); expect(over.indexOf('done')).toBeLessThan(over.indexOf('journal'))
    for (const w of ['board', 'sprint', 'blocked', 'need help', 'backlog']) expect(await text('board')).toContain(w)
    for (const w of ['pulse', 'try a model']) expect(await text('ritual')).toContain(w)
    expect(await text('design')).toContain('design session')
    const sc = await text('shortcuts'); for (const k of '123456?') expect(sc).toContain(k)
    expect(await page.locator('main').innerText()).not.toMatch(/interview/i)
    const lines = page.getByTestId('guide-section-destinations').locator('[data-testid^="guide-dest-"]')
    await expect(lines).toHaveCount(12)
    for (const [i, id] of ORDER.entries()) {
      const li = lines.nth(i)
      await expect(li).toHaveAttribute('data-testid', `guide-dest-${id}`)
      const a = li.locator('a')
      expect(new URL((await a.getAttribute('href'))!, 'http://x').pathname.replace(/^\/#/, '')).toBe(ROUTE[id])
      await expect(a).toHaveText(LABEL[id])
      expect((await li.boundingBox())!.height).toBeLessThan(60) // one line at 1280
    }
    await page.screenshot({ path: `${SHOTS}/scope2-w3-guide-1280.png`, fullPage: true })
  })

  test('NAV-32 to NAV-36: the Designs search', async ({ page }) => {
    await start(page)
    await page.goto('/designs?tier=2')
    await ready(page, 'designs')
    const box = page.getByTestId('designs-search')
    await expect(box).toHaveAccessibleName('Search designs')
    await expect(page.getByTestId('designs-search-clear')).toHaveCount(0)
    expect((await box.boundingBox())!.y).toBeLessThan((await page.getByTestId('tier-ladder').boundingBox())!.y)
    await expect(page.getByTestId('tier-detail')).toBeVisible()
    for (const id of ['designs-done', 'designs-dives', 'next-design', 'tier-ladder', 'tier-1', 'tier-2']) await expect(page.getByTestId(id)).toBeVisible()
    // a query spans tiers and replaces the tier detail
    await box.fill('cache')
    const res = page.getByTestId('designs-search-results')
    await expect(res).toBeVisible()
    await expect(page.getByTestId('tier-detail')).toHaveCount(0)
    await expect(page.getByTestId('designs-hint')).toHaveCount(0)
    const n = Number(await page.getByTestId('designs-search-count').getAttribute('data-count'))
    expect(n).toBeGreaterThan(0)
    await expect(page.getByTestId('designs-search-count')).toHaveText(`${n} designs`)
    await expect(page).toHaveURL(/tier=2&q=cache$/)
    const heads = await res.locator('[data-testid^="designs-search-tier-"]').allInnerTexts()
    for (const h of heads) expect(h).toMatch(/^Tier \d+ · [^(]+$/)
    await expect(res.locator('[data-testid^="row-"]')).toHaveCount(n)
    await page.screenshot({ path: `${SHOTS}/scope2-w3-designs-search-1280.png` })
    // words, order, difficulty, tier, spaces
    await box.fill('  CACHE   ')
    await expect(page.getByTestId('designs-search-count')).toHaveAttribute('data-count', String(n))
    await box.fill('zzzz')
    await expect(page.getByTestId('designs-search-empty')).toHaveText('No design matches that.')
    await expect(page.getByTestId('designs-search-count')).toHaveText('0 designs')
    await expect(page.getByTestId('designs-search-clear')).toBeVisible()
    await box.fill('   ')
    await expect(res).toHaveCount(0)
    await box.fill('hard')
    const hard = Number(await page.getByTestId('designs-search-count').getAttribute('data-count'))
    expect(hard).toBeGreaterThan(0)
    await box.fill('medium')
    expect(Number(await page.getByTestId('designs-search-count').getAttribute('data-count'))).toBeGreaterThan(0)
    // reversed words of one title keep it
    await box.fill('cache')
    const firstTitle = (await res.locator('.trow-title').first().innerText()).trim()
    const words = firstTitle.split(/\s+/).filter(w => /^[A-Za-z]+$/.test(w)).slice(0, 2)
    if (words.length === 2) {
      await box.fill(`${words[1]} ${words[0]}`)
      await expect(res.locator('.trow-title', { hasText: firstTitle })).toHaveCount(1)
    }
    // the history: one Back from a row's Session button returns to the query
    await box.fill('cache')
    const startBtn = res.locator('[data-testid^="design-start-"]').first()
    const sid = (await startBtn.getAttribute('data-testid'))!.replace('design-start-', '')
    await expect(startBtn).toHaveAccessibleName(/^Start session: /)
    await expect(res.getByTestId(`do-${sid}`)).toBeVisible()
    await res.getByTestId(`dives-${sid}`).locator('summary').click()
    await expect(res.getByTestId(`dives-${sid}`)).toHaveAttribute('open', '')
    await startBtn.click()
    await expect(page).toHaveURL(new RegExp(`/designs/session/${sid}`))
    await page.goBack()
    await expect(page).toHaveURL(/\/designs\?tier=2&q=cache$/)
    await expect(box).toHaveValue('cache')
    await page.reload()
    await expect(page.getByTestId('designs-search')).toHaveValue('cache')
    await expect(page.getByTestId('designs-search-results')).toBeVisible()
    // clear returns to the tier of the URL
    await page.getByTestId('designs-search-clear').click()
    await expect(page.getByTestId('designs-search-results')).toHaveCount(0)
    await expect(page.getByTestId('tier-detail')).toBeVisible()
    await expect(page).toHaveURL(/\/designs\?tier=2$/)
  })

  test('NAV-37 to NAV-39: the palette sends design tickets to the session and lists the destinations', async ({ page }) => {
    await start(page)
    type T = { id: string; title: string; kind: string; status: string; order: number; orderOverride?: number }
    const tickets = await idbAll<T>(page, 'tickets')
    const design = tickets.find(t => t.kind === 'design' && t.status !== 'done')!
    const watch = tickets.find(t => t.kind === 'watch' && t.status !== 'done')!
    const word = (t: T) => t.title.split(/\s+/).sort((a, b) => b.length - a.length)[0]
    await page.keyboard.press(`${MOD}+k`)
    const input = page.getByTestId('shell-palette-input')
    const items = page.getByTestId('shell-palette-item')
    // empty query: the six keyed destinations first, with their numbers
    const first = await items.evaluateAll(els => els.slice(0, 6).map(e => [e.getAttribute('data-target'), e.textContent]))
    expect(first.map(f => f[0])).toEqual(['/', '/path', '/board', '/journal', '/skills', '/review'])
    first.forEach((f, i) => expect(f[1]).toContain(String(i + 1)))
    for (const [q, to] of [['board', '/board'], ['journal', '/journal'], ['ai topics', '/ai-topics'], ['guide', '/guide'], ['dsa', '/dsa'], ['designs', '/designs'], ['banks', '/banks'], ['atlas', '/atlas']] as const) {
      await input.fill(q)
      await expect(page.locator(`[data-testid="shell-palette-item"][data-target="${to}"]`).first()).toBeVisible()
    }
    await input.fill(design.title)
    await expect(page.locator(`[data-testid="shell-palette-item"][data-target="/designs/session/${design.id}"]`)).toHaveCount(1)
    await expect(page.locator(`[data-testid="shell-palette-item"][data-target="/do/${design.id}"]`)).toHaveCount(0)
    await input.fill(watch.title)
    await expect(page.locator(`[data-testid="shell-palette-item"][data-target="/do/${watch.id}"]`)).toHaveCount(1)
    void word
    // Enter opens the session; nothing is written to the ticket
    await input.fill(design.title)
    await expect(items.first()).toHaveAttribute('data-target', `/designs/session/${design.id}`)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/designs/session/${design.id}$`))
    await ready(page, 'design-session')
    await expect(page.getByTestId('shell-palette')).toHaveCount(0)
    const after = (await idbAll<T>(page, 'tickets')).find(t => t.id === design.id)!
    expect([after.status, after.order, after.orderOverride]).toEqual([design.status, design.order, design.orderOverride])
  })

  test('NAV-40/41: Path keeps its lane and search on Back, and clearing forgets them', async ({ page }) => {
    await start(page)
    await page.goto('/path')
    await ready(page, 'path')
    await page.getByTestId('path-lane-dsa').click()
    const rowsOf = () => page.locator('[data-testid^="row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-ticket-id')))
    const titles = await page.locator('[data-testid^="row-"] .trow-title, [data-testid^="row-"] a').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()).filter(Boolean))
    const word = (titles.join(' ').match(/[A-Za-z]{5,}/) ?? ['graph'])[0].toLowerCase()
    await page.getByTestId('path-search').fill(word)
    const before = await rowsOf()
    expect(before.length).toBeGreaterThan(0)
    await page.locator('[data-testid^="do-"]').first().click()
    await expect(page).toHaveURL(/\/do\//)
    await page.goBack()
    await ready(page, 'path')
    await expect(page.getByTestId('path-search')).toHaveValue(word)
    await expect(page.getByTestId('path-lane-dsa')).toHaveAttribute('aria-pressed', 'true')
    expect(await rowsOf()).toEqual(before)
    await page.reload()
    await expect(page.getByTestId('path-search')).toHaveValue(word)
    await expect(page.getByTestId('path-lane-dsa')).toHaveAttribute('aria-pressed', 'true')
    // Start on a row (the button shows on hover), then Back
    await page.locator('[data-testid^="row-"]').first().hover()
    await page.locator('[data-testid^="path-row-start-"]').first().click()
    await expect(page).toHaveURL(/\/do\//)
    await page.goBack()
    await expect(page.getByTestId('path-search')).toHaveValue(word)
    await expect(page.getByTestId('path-lane-dsa')).toHaveAttribute('aria-pressed', 'true')
    // a fresh tab is clean
    const fresh = await page.context().newPage()
    await fresh.goto('/path')
    await expect(fresh.getByTestId('path-search')).toHaveValue('')
    await expect(fresh.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
    await fresh.close()
    // clearing forgets it
    await page.getByTestId('path-search').fill('zzzzqq')
    await page.getByTestId('path-search-clear').click()
    await expect(page.getByTestId('path-search')).toHaveValue('')
    await expect(page.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('[data-testid^="do-"]').first().click()
    await page.goBack()
    await expect(page.getByTestId('path-search')).toHaveValue('')
    await expect(page.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('phone 375 x 667', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('NAV-09 to NAV-14: the tab bar, the More sheet, its geometry and where you are', async ({ page }) => {
    await start(page)
    const bar = page.getByTestId('shell-tabbar')
    await expect(page.getByTestId('shell-rail')).toHaveCount(0)
    await expect(page.getByTestId('more-button')).toHaveCount(0)
    const kids = await bar.locator('[data-testid]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')).filter(i => !i!.includes('badge')))
    expect(kids).toEqual(['shell-nav-today', 'shell-nav-path', 'shell-nav-board', 'shell-nav-review', 'shell-tab-more'])
    await expect(bar).toContainText('More')
    const bb = (await bar.boundingBox())!
    expect(Math.abs(bb.height - 68)).toBeLessThanOrEqual(4)
    expect(Math.abs(bb.y + bb.height - 667)).toBeLessThanOrEqual(1)
    for (const id of ['today', 'path', 'board', 'review']) await expect(page.getByTestId(`shell-nav-${id}`)).toBeVisible()
    await noSideways(page)
    const more = page.getByTestId('shell-tab-more')
    await more.click()
    const sheet = page.getByTestId('shell-more-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('role', 'dialog')
    await expect(sheet).toHaveAccessibleName(/\w/)
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    const ids = await sheet.locator('[data-testid^="shell-nav-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
    expect(ids).toEqual(['journal', 'skills', 'ai', 'dsa', 'designs', 'banks', 'atlas', 'guide'].map(i => `shell-nav-${i}`))
    await expect(page.getByTestId('shell-more-group-title-topics')).toHaveText('Topics')
    await expect(page.getByTestId('shell-more-group-title-practice')).toHaveText('Practice')
    const sb = (await sheet.boundingBox())!
    const tb = (await bar.boundingBox())!
    expect(tb.y - (sb.y + sb.height)).toBeGreaterThanOrEqual(0)
    expect(tb.y - (sb.y + sb.height)).toBeLessThanOrEqual(8)
    expect(await page.evaluate(() => document.elementsFromPoint(10, 10).some(e => e.matches('[data-testid="shell-more-sheet"]')))).toBe(false)
    for (const loc of await sheet.locator('[data-testid^="shell-nav-"]').all()) {
      const b = (await loc.boundingBox())!
      expect(b.height).toBeGreaterThanOrEqual(44); expect(b.width).toBeGreaterThanOrEqual(44)
    }
    await noSideways(page)
    for (const id of ['today', 'path', 'board', 'review']) await expect(sheet.getByTestId(`shell-nav-${id}`)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/scope2-w3-more-sheet-375.png` })
    // closes without navigating: Esc (focus back), tap outside, More again
    const url = page.url()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(more).toBeFocused()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await page.mouse.click(10, 10)
    await expect(sheet).toHaveCount(0)
    await more.click()
    await more.click()
    await expect(sheet).toHaveCount(0)
    expect(page.url()).toBe(url)
    // an item navigates and closes the sheet; More then shows where you are
    for (const id of ['skills', 'dsa', 'designs', 'banks', 'atlas', 'guide']) {
      await more.click()
      await sheet.getByTestId(`shell-nav-${id}`).click()
      await expect(page).toHaveURL(urlFor(ROUTE[id]))
      await ready(page, id)
      await expect(sheet).toHaveCount(0)
      await expect(more).toHaveAttribute('aria-current', 'page')
      for (const t of ['today', 'path', 'board', 'review']) await expect(page.getByTestId(`shell-nav-${t}`)).not.toHaveAttribute('aria-current', 'page')
      await more.click()
      await expect(sheet.getByTestId(`shell-nav-${id}`)).toHaveAttribute('aria-current', 'page')
      await page.keyboard.press('Escape')
      await noSideways(page)
    }
    await page.getByTestId('shell-nav-path').click()
    await expect(page.getByTestId('shell-nav-path')).toHaveAttribute('aria-current', 'page')
    await expect(more).not.toHaveAttribute('aria-current', 'page')
    await page.goto('/settings')
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(0)
    // a hardware keyboard: 5 goes to Skills and More is current
    await page.goto('/path')
    await page.locator('body').click({ position: { x: 300, y: 300 } })
    await page.keyboard.press('5')
    await expect(page).toHaveURL(/\/skills$/)
    await expect(more).toHaveAttribute('aria-current', 'page')
    await page.screenshot({ path: `${SHOTS}/scope2-w3-tabbar-375.png` })
  })

  test('the Guide and the Designs search have no sideways scroll at 375', async ({ page }) => {
    await start(page)
    await page.goto('/guide')
    await ready(page, 'guide')
    await noSideways(page)
    await page.screenshot({ path: `${SHOTS}/scope2-w3-guide-375.png`, fullPage: true })
    await page.goto('/designs')
    await ready(page, 'designs')
    await page.getByTestId('designs-search').fill('cache')
    await expect(page.getByTestId('designs-search-results')).toBeVisible()
    await noSideways(page)
    await page.screenshot({ path: `${SHOTS}/scope2-w3-designs-search-375.png` })
  })
})


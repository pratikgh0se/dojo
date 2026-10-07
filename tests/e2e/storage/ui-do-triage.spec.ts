import { expect, test, type Page } from '@playwright/test'
import { GO_VF } from '../../helpers/visualSolutions'
import { draftSprint1, learningCard, openApp, putTicket, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// The APP findings of the blind UI lane do-dp-families (reports/ui/do-dp-families/triage.md §4, Controller
// ruling 7): each test pins one root issue on the real page.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
const P91_TABLE = `package main

import "dojo/tk"

func numDecodings(s string) int {
	t := tk.Table("dp", 1, len(s)+1)
	t.Set(0, 0, 1)
	if s[0] != '0' {
		t.Set(0, 1, 1)
	} else {
		t.Set(0, 1, 0)
	}
	for i := 2; i <= len(s); i++ {
		v := 0
		if s[i-1] != '0' {
			v += t.Get(0, i-1)
		}
		if s[i-2] == '1' || (s[i-2] == '2' && s[i-1] <= '6') {
			v += t.Get(0, i-2)
		}
		t.Set(0, i, v, tk.Dep(0, i-1), tk.Dep(0, i-2), tk.Rule("{0} + {1}"))
	}
	return t.Get(0, len(s))
}
`
async function run(page: Page, id: string, code: string, mode: 'Run' | 'Submit' = 'Run') {
  await page.goto(`/do/${id}`)
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id && (r.lang ?? 'go') === 'go')?.source, { timeout: 5000 }).toBe(code)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/^(Passed|Failed)/, { timeout: 90_000 })
  await page.getByTestId('dp-view').waitFor()
}

test('A1 / UAT r4: a long title with a URL never widens the page; the rail title is one line, two on phone (then cut), with a tooltip', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const long = `Read https://example.com/a/really/long/path/that/never/breaks/${'x'.repeat(120)} and take notes`
  await putTicket(srv, learningCard('long-title-card', long))
  for (const w of [375, 393, 560, 800, 834]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/do/long-title-card')
    await page.getByTestId('do-title').waitFor()
    expect(await overflow(page), `${w}`).toBeLessThanOrEqual(0)
    const rail = page.locator('.do-rail-title')
    await expect(rail).toHaveAttribute('title', long)
    if (w >= 768) expect(await rail.evaluate(e => getComputedStyle(e).whiteSpace)).toBe('nowrap')
    else {
      const [ws, clamp, lh, h] = await rail.evaluate(e => [getComputedStyle(e).whiteSpace, getComputedStyle(e).webkitLineClamp, parseFloat(getComputedStyle(e).lineHeight), e.getBoundingClientRect().height] as const)
      expect([ws, clamp], `${w}`).toEqual(['normal', '2'])
      expect(Math.round(h / lh), `${w}: two lines`).toBe(2)
    }
  }
  await ctx.close()
})

test('A2 / A3 / A15 / S10: Esc clears a pressed element first; arrows rove between cells; Home and End anywhere in the band; tree window note; 44 px hit areas on phone', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await run(page, 'p91', P91_TABLE)
  // A2
  await page.getByTestId('dp-cell-0-1').click()
  await expect(page.getByTestId('dp-cell-0-1')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/do\/p91$/)
  await expect(page.getByTestId('dp-cell-0-1')).toHaveAttribute('aria-pressed', 'false')
  // A3 K1: focus by script (not a click) and ArrowRight
  await page.getByTestId('dp-cell-0-1').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('dp-cell-0-2')).toBeFocused()
  // A3 K2: End then Home with focus on Next step
  await page.getByRole('button', { name: 'Previous step' }).click()
  await page.getByRole('button', { name: 'Next step' }).focus()
  await page.keyboard.press('End')
  const counter = page.getByTestId('dp-step-counter')
  const n = (await counter.textContent())!.match(/\/ (\d+)/)![1]
  await expect(counter).toHaveText(`Step ${n} / ${n}`)
  await page.keyboard.press('Home')
  await expect(counter).toHaveText(`Step 1 / ${n}`)
  // S10: on phone, a cell's hit area reaches 22 px from its centre on every side
  await page.setViewportSize({ width: 393, height: 900 })
  await page.keyboard.press('End')
  await page.getByTestId('dp-cell-0-2').scrollIntoViewIfNeeded()
  const probe = await page.getByTestId('dp-cell-0-2').evaluate(el => {
    const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2
    return [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]].map(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === el || el.contains(hit) })
  })
  expect(probe).toEqual([true, true, true, true])
  // Esc with nothing pressed leaves Do
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/board$/)
  // A15 and S10 on tree nodes: 700 calls in one case
  const many = 'package main\n\nimport "dojo/tk"\n\nfunc numDecodings(s string) int {\n\tif len(s) != 2 {\n\t\treturn 3\n\t}\n\tfor i := 0; i < 700; i++ {\n\t\ttk.Enter("f", i)\n\t\ttk.Exit(i)\n\t}\n\treturn 2\n}\n'
  await run(page, 'p91', many)
  await expect(page.getByTestId('dp-tree-pane').getByTestId('dp-note')).toHaveText('Showing the latest 600 of 700 calls')
  await page.setViewportSize({ width: 393, height: 900 })
  const node = page.getByTestId('dp-tree').getByRole('treeitem').last()
  await node.scrollIntoViewIfNeeded()
  const nprobe = await node.evaluate(el => {
    const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2
    return [[cx, cy - 21], [cx, cy + 21]].map(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === el || el.contains(hit) })
  })
  expect(nprobe).toEqual([true, true])
  await ctx.close()
})

test('A4 / A5 / A6 / A7 / A11 / S1 / S4: timer controls and readout, the signature, the no-brief line, gutter on first paint, the rail banner, dashed locked rungs', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/do/p91')
  await page.getByTestId('code-editor').waitFor()
  // A11: on first paint each gutter number sits on its own 24 px line
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)
  const gut = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-content .cm-line')].slice(0, 5).map(e => e.getBoundingClientRect().top)
    const nums = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(e => /^\d+$/.test(e.textContent ?? '') && e.getBoundingClientRect().height > 0).slice(0, 5).map(e => e.getBoundingClientRect().top)
    return lines.map((t, i) => Math.abs(t - nums[i]))
  })
  for (const d of gut) expect(d).toBeLessThanOrEqual(1)
  // S1
  await expect(page.locator('.do-rail')).toHaveAttribute('role', 'banner')
  // A6, Go then Python
  await expect(page.getByTestId('code-sig')).toHaveText('func numDecodings(s string) int')
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Python' }).check()
  await expect(page.getByTestId('code-sig')).toHaveText('def numDecodings(s: str) -> int:')
  // A7
  await expect(page.locator('p.brief-note').filter({ hasText: 'No brief yet' })).toHaveText('No brief yet. Draft briefs for this sprint from the Board.')
  // S4: rungs not yet open are dashed
  await expect(page.getByTestId('ladder-rung-hint')).toHaveCSS('border-top-style', 'dashed')
  // A5 and A4
  const panelReadout = page.getByTestId('timer-panel-readout')
  await expect(panelReadout).toHaveText('--:--')
  await page.getByTestId('do-timer-preset-25').click()
  await expect(panelReadout).toHaveText(/^\d\d:\d\d$/)
  await expect(page.getByTestId('do-timer-preset-25')).toHaveCount(0)
  await expect(page.locator('.timer').getByRole('button', { name: 'Pause' })).toBeVisible()
  const retreat = page.locator('.timer').getByRole('button', { name: 'Retreat' })
  await expect(retreat).toHaveClass(/sr-btn-quiet/)
  await page.locator('.timer').getByRole('button', { name: 'Pause' }).click()
  // UAT J3: Pause keeps the block (state paused, Resume); Retreat abandons it
  await expect(page.getByTestId('timer-state')).toHaveText('paused')
  await expect(page.locator('.timer').getByRole('button', { name: 'Resume' })).toBeVisible()
  await retreat.click()
  await expect(panelReadout).toHaveText('--:--')
  await ctx.close()
})

test('A8 / A9: a briefed ticket offers Split into sessions, and a Draft brief has exactly one accent (Approve)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  await page.goto('/do/m1w1i1')
  const card = page.getByTestId('card-brief')
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: 'Split into sessions' })).toBeVisible()
  await expect(card.locator('.sr-btn-accent')).toHaveCount(1)
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveClass(/sr-btn-accent/)
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByTestId('brief-status')).toHaveText('Approved')
  await expect(card.locator('.sr-btn-accent')).toHaveCount(1)
  await expect(card.getByRole('button', { name: 'Mark done' })).toHaveClass(/sr-btn-accent/)
  await ctx.close()
})

test('A10 / A13 / A14 / S8: the unknown-ticket screen, 44 px phone targets, the warn Read-only toast, a current DSU root keeps its border', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/zz-no-such-ticket')
  await expect(page.locator('.do-missing')).toHaveText('No ticket zz-no-such-ticket.')
  await expect(page.getByTestId('do-back')).toHaveText('‹ Back')
  // S8
  await run(page, 'p684', GO_VF.vf03[1])
  await page.getByTestId('dp-scrubber').press('Home')
  await page.evaluate(async () => {
    const root = document.querySelector('[data-testid="dp-view"]')!
    const next = [...root.querySelectorAll('button')].find(b => b.textContent === 'Next step') as HTMLButtonElement
    for (let i = 0; i < 500 && !(root.querySelector('[data-testid="dsu-caption"]')?.textContent ?? '').startsWith('union(1, 4)'); i++) { next.click(); await new Promise(r => setTimeout(r, 0)) }
  })
  await expect(page.getByTestId('dsu-node-1')).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('dsu-node-1')).toHaveCSS('border-top-color', 'rgb(61, 220, 132)')
  // A13 at 393
  await page.setViewportSize({ width: 393, height: 900 })
  await page.goto('/do/p91')
  await page.getByTestId('do-screen').waitFor()
  const tall = async (loc: ReturnType<Page['locator']>, what: string) => { const b = await loc.first().boundingBox(); expect(Math.round(b!.height), what).toBeGreaterThanOrEqual(44); expect(Math.round(b!.width), what).toBeGreaterThanOrEqual(44) }
  await tall(page.getByTestId('do-back'), 'do-back')
  await tall(page.locator('.open-link'), 'Open link')
  await tall(page.getByTestId('dsa-approaches').getByRole('button').first(), 'approach chip')
  await tall(page.getByTestId('ladder-open-hint'), 'rung button')
  await page.getByTestId('start-session').click()
  await page.getByTestId('plan-dialog').getByRole('textbox').first().fill('Try one approach')
  await page.getByTestId('plan-start').click()
  await page.getByTestId('session-panel').waitFor()
  await tall(page.getByTestId('session-panel').locator('label', { hasText: 'Soft chime' }), 'Soft chime row')
  await ctx.close()
  // A13 save-status link and A14 in a read-only browser
  const ro = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 393, height: 900 } })
  const rp = await ro.newPage()
  await rp.goto('/do/p91')
  await rp.getByTestId('readonly-banner').waitFor()
  const ss = rp.getByTestId('save-status')
  expect(await ss.evaluate(e => e.tagName)).toBe('A') // read-only: save-status is a link to Settings
  await tall(ss, 'read-only save-status link')
  await rp.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(rp.getByTestId('toast').first()).toHaveText(/^Read-only/)
  await expect(rp.getByTestId('toast').first()).toHaveCSS('color', 'rgb(255, 224, 90)')
  await ro.close()
})

test('A12: picture players in the two-up scroll rather than clip at 393', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 393, height: 900 })
  await page.goto('/do/p91')
  const strip = page.getByTestId('dsa-approaches')
  await strip.getByRole('button', { name: 'Pick two' }).click()
  const chips = strip.getByRole('button').filter({ hasNotText: /Pick two/ })
  await chips.nth(1).click()
  await chips.nth(2).click()
  await page.waitForTimeout(800)
  const clipped = await page.evaluate(() => [...document.querySelectorAll('sr-algo, sr-algo2')].flatMap(host => [...(host.shadowRoot?.querySelectorAll('.stage > svg') ?? [])].map(svg => {
    const s = svg as SVGSVGElement
    const b = s.getBBox(); const vb = s.viewBox.baseVal
    return b.x < vb.x - 0.5 || b.x + b.width > vb.x + vb.width + 0.5
  })))
  expect(clipped.length).toBeGreaterThan(0)
  expect(clipped.every(c => !c)).toBe(true)
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await ctx.close()
})

// ---------------------------------------------------------------- the Minor roots M1–M21 (triage §4)

const css = (page: Page, sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!

test('Minors on the Do screen: M1 type roles, M2 history head, M3 rail, M4 custom input, M5 cubes, M7 two-up row, M8 brief header, M17 language text, M18 layers, M20 gutter, M21 brief paddings', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await draftSprint1(page)
  await page.goto('/do/p91')
  await page.getByTestId('code-editor').waitFor()
  expect(await css(page, '[data-testid="do-title"]', 'line-height')).toBe('28.6px') // M1
  expect(Math.round((await box(page, '.do-rail')).height)).toBeGreaterThanOrEqual(44) // M3
  expect(Math.round((await box(page, '.timer-controls input')).height)).toBe(36) // M4
  const cube = await box(page, '[data-testid="ladder-cost-hint"]')
  expect([Math.round(cube.width), Math.round(cube.height)]).toEqual([32, 32]) // M5
  expect(await css(page, '.lang-option[data-checked="true"] span', 'color')).toBe('rgb(26, 29, 43)') // M17
  expect(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).zIndex === '200').map(e => `${e.tagName}.${e.className}`))).toEqual([]) // M18
  const gp = await page.locator('.cm-lineNumbers .cm-gutterElement').nth(1).evaluate(e => [getComputedStyle(e).paddingLeft, getComputedStyle(e).paddingRight])
  for (const p of gp) expect(['0px', '4px', '8px', '12px', '14px', '16px']).toContain(p) // M20
  // M7: the two-up controls on one row. In Do's 450 px Approaches column one row leaves the select a stub ("Tab": UAT cu-4 P3-2), so
  // there Compare with has a row to itself and Own input and Close two-up share the next; the one row is for a wide two-up (cu-4 spec).
  const strip = page.getByTestId('dsa-approaches')
  await strip.getByRole('button', { name: 'Pick two' }).click()
  const chips = strip.getByRole('button').filter({ hasNotText: /Pick two/ })
  await chips.nth(1).click()
  await chips.nth(2).click()
  const head = page.getByTestId('lab-two-up').locator('.lab-two-up-head')
  const ys = await head.locator('button').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)))
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4)
  // M8 and M21 and M1 (meta line)
  await page.goto('/do/m1w1i1')
  const card = page.getByTestId('card-brief')
  await card.waitFor()
  const h2 = await card.getByRole('heading', { name: 'Brief' }).boundingBox()
  const chip = await page.getByTestId('brief-status').boundingBox()
  expect(Math.abs((h2!.y + h2!.height / 2) - (chip!.y + chip!.height / 2))).toBeLessThanOrEqual(6)
  expect(chip!.x).toBeGreaterThan(h2!.x + h2!.width)
  expect(await css(page, '[data-testid="brief-status"]', 'border-top-width')).toBe('2px')
  expect(await css(page, '[data-testid="brief-status"]', 'padding-top')).toBe('0px')
  expect(await css(page, '.brief-steps', 'padding-left')).toBe('24px')
  const meta = page.locator('.brief-meta').first()
  await expect(meta).toHaveText(/^\d+ min · (Focus|Light|Long) day$/)
  expect(await meta.evaluate(e => getComputedStyle(e).fontFamily)).toMatch(/^"?Space Mono/)
  expect(await meta.evaluate(e => getComputedStyle(e).fontSize)).toBe('14px')
  // M1 session phase weight, M2 history head line not a p
  await page.getByTestId('start-session').click()
  await page.getByTestId('plan-dialog').getByRole('textbox').first().fill('Read the brief')
  await page.getByTestId('plan-start').click()
  await page.getByTestId('session-phase').waitFor()
  expect(await css(page, '[data-testid="session-phase"]', 'font-weight')).toBe('700')
  await page.getByTestId('session-end').click()
  await page.getByTestId('end-dialog').getByRole('textbox').first().fill('read it')
  await page.getByTestId('end-save').click()
  const row = page.getByTestId('session-history').locator('[data-testid^="session-history-"]').first()
  await row.waitFor()
  expect(await row.locator('.hist-row-head').evaluate(e => e.tagName)).not.toBe('P')
  expect(await row.locator('p').first().evaluate(e => getComputedStyle(e).fontSize)).toBe('17px')
  // M1 given-up line
  await page.goto('/do/p200')
  await page.getByTestId('do-outcome-giveup').click()
  const given = page.getByTestId('do-given-up')
  await given.waitFor()
  expect(await given.evaluate(e => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize, getComputedStyle(e).color])).toEqual([expect.stringMatching(/^"?Space Mono/), '15px', 'rgb(255, 224, 90)'])
  await ctx.close()
})

test('Minors in the trace and families: M9 case rows, M10 mapping, M11 tree well, M12 legend at tablet, M13 2-D grid, M15 heap slots, M16 list arrows', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  // M9: a failing row reads ✗ <call> → <got>
  await page.goto('/do/p91')
  const wrong = 'package main\n\nfunc numDecodings(s string) int {\n\tif len(s) <= 2 { return len(s) }; return len(s) + 1\n}\n'
  await page.getByRole('textbox', { name: 'Code' }).fill(wrong)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p91')?.source, { timeout: 5000 }).toBe(wrong)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText('Failed 1/2', { timeout: 90_000 })
  await expect(page.getByTestId('run-case-2')).toContainText('✗ numDecodings("226") → 4')
  // M10, M11, M12 on the memo + table fixture
  const both = `package main

import "dojo/tk"

var memo map[int]int
var t *tk.Tab

func f(i int) int {
	if v, ok := memo[i]; ok {
		tk.Hit("f", i)
		return v
	}
	tk.Enter("f", i)
	v := 1
	if i > 1 {
		v = f(i-1) + f(i-2)
	}
	memo[i] = v
	t.Set(0, i, v)
	tk.Exit(v)
	return v
}

func numDecodings(s string) int {
	memo = map[int]int{}
	t = tk.Table("dp", 1, len(s)+1)
	tk.Link("f", "dp")
	f(len(s))
	if s == "12" {
		return 2
	}
	return 3
}
`
  await run(page, 'p91', both)
  const mapping = page.getByTestId('dp-mapping')
  await expect(mapping).toContainText('f(i) ↔ dp[i]')
  await expect(mapping).toContainText('press a cell or a call to link them')
  expect(await mapping.evaluate(e => getComputedStyle(e).fontFamily)).toMatch(/^"?Chivo/)
  const well = await page.getByTestId('dp-tree-pane').evaluate(p => {
    const nodes = [...p.querySelectorAll('[data-testid^="dp-node-"]')].map(n => n.getBoundingClientRect().bottom)
    return p.getBoundingClientRect().bottom - Math.max(...nodes)
  })
  expect(well).toBeLessThanOrEqual(16)
  await page.setViewportSize({ width: 834, height: 900 })
  await page.waitForTimeout(100)
  const mapB = await mapping.boundingBox()
  const legB = await page.getByTestId('dp-legend').boundingBox()
  expect(legB!.x).toBeGreaterThan(mapB!.x + 100)
  expect(legB!.y).toBeLessThan(mapB!.y + mapB!.height)
  // M13: a 2-D table: row gap = column gap, row labels centred on their row
  await page.setViewportSize({ width: 1280, height: 900 })
  const lcs = 'package main\n\nimport "dojo/tk"\n\nfunc longestCommonSubsequence(a string, b string) int {\n\tt := tk.Table("dp", 3, 3)\n\tfor i := 0; i < 3; i++ {\n\t\tfor j := 0; j < 3; j++ {\n\t\t\tt.Set(i, j, i+j)\n\t\t}\n\t}\n\tif a == "abcde" {\n\t\treturn 3\n\t}\n\treturn 3\n}\n'
  await run(page, 'p1143', lcs)
  const g = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(`[data-testid="${s}"]`)!.getBoundingClientRect()
    return { col: r('dp-cell-0-1').left - r('dp-cell-0-0').right, row: r('dp-cell-1-0').top - r('dp-cell-0-0').bottom, label: (r('dp-row-1').top + r('dp-row-1').height / 2) - (r('dp-cell-1-0').top + r('dp-cell-1-0').height / 2) }
  })
  expect(Math.round(g.row)).toBe(Math.round(g.col))
  expect(Math.abs(g.label)).toBeLessThanOrEqual(1)
  // M15 heap slots, M16 list arrows
  await run(page, 'p215', GO_VF.vf04[1])
  const slot = await box(page, '[data-testid="heap-slot-0"]')
  expect(slot.width).toBeGreaterThanOrEqual(64)
  expect(Math.round(slot.height)).toBeGreaterThanOrEqual(40)
  await run(page, 'p206', GO_VF.vf07[1])
  const arrow = await box(page, '.fam-arrow')
  expect(Math.abs(arrow.width - 24)).toBeLessThanOrEqual(1)
  await ctx.close()
})

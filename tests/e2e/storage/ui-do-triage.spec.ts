import { expect, test, type Page } from '@playwright/test'
import { GO_VF } from '../../helpers/visualSolutions'
import { learningCard, openApp, openApproaches, putTicket, rows } from './briefs-helpers'
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

test('A1 / UAT r4: a long title with a URL never widens the page; the ticket view wraps it whole, the problem rail title is one line, two on phone (then cut), with a tooltip', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const long = `Read https://example.com/a/really/long/path/that/never/breaks/${'x'.repeat(120)} and take notes`
  await putTicket(srv, learningCard('long-title-card', long))
  await putTicket(srv, { ...learningCard('long-title-problem', long), kind: 'problem', difficulty: 'M', track: 'interview' })
  for (const w of [375, 393, 560, 800, 834]) {
    await page.setViewportSize({ width: w, height: 900 })
    // a watch card is a ticket view (TICKET-01): the title is the h1, wrapped whole, nothing clipped and nothing wider than the page
    await page.goto('/do/long-title-card')
    const title = page.getByTestId('do-title')
    await title.waitFor()
    await expect(title).toHaveText(long)
    expect(await overflow(page), `${w} ticket view`).toBeLessThanOrEqual(0)
    expect(await title.evaluate(e => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1), `${w}: the whole title shows`).toBe(true)
    // a problem keeps its sticky rail: one line on desktop, two on phone, the full title in the tooltip
    await page.goto('/do/long-title-problem')
    await page.getByTestId('do-title').waitFor()
    expect(await overflow(page), `${w} problem`).toBeLessThanOrEqual(0)
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
  await expect(page).toHaveURL(/\/$/) // a direct load has no earlier screen: Esc leaves to Today (the Board is retired, SHELL-20)
  await expect(page.getByTestId('screen-today')).toBeVisible()
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

test('A4 / A5 / A6 / A7 / A11 / S1 / S4: timer controls and readout, the signature, the no-brief line, gutter on first paint, the rail, dashed locked rungs', async ({ browser }) => {
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
  // S1: the sticky rail is a labelled group, not a second banner (274c712: one banner per page, the Shell's header)
  await expect(page.locator('.do-rail')).toHaveAttribute('role', 'group')
  await expect(page.locator('.do-rail')).toHaveAttribute('aria-label', 'Ticket')
  await expect(page.getByRole('banner')).toHaveCount(1)
  // A6, Go then Python
  await expect(page.getByTestId('code-sig')).toHaveText('func numDecodings(s string) int')
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Python' }).check()
  await expect(page.getByTestId('code-sig')).toHaveText('def numDecodings(s: str) -> int:')
  // A7: a problem without a brief says so, and no longer points at the Board (TICKET-25: `no-brief` may appear on problems)
  await expect(page.getByTestId('no-brief')).toHaveText(/^No brief for this ticket yet\./)
  await expect(page.getByTestId('no-brief')).not.toContainText('Board')
  // S4: rungs not yet open are dashed
  await expect(page.getByTestId('ladder-rung-hint')).toHaveCSS('border-top-style', 'dashed')
  // A5 and A4 on the one ticket timer (TICKET-03/07): the readout shows the remembered length before the start, then counts down;
  // `ticket-start` is replaced by Pause, End session is the quiet button, and no preset buttons exist (TICKET-08)
  const readout = page.getByTestId('timer-readout')
  await expect(readout).toHaveText('25:00')
  await expect(page.getByTestId('timer-state')).toHaveText('ready')
  await page.getByTestId('ticket-start').click()
  await expect(readout).toHaveText(/^2[45]:\d\d$/)
  await expect(page.getByTestId('ticket-start')).toHaveCount(0)
  await expect(page.getByTestId('do-timer-preset-25')).toHaveCount(0)
  await expect(page.getByTestId('timer-pause')).toBeVisible()
  await expect(page.getByTestId('session-end')).toHaveClass(/sr-btn-quiet/)
  // UAT J3: Pause keeps the block (state paused, Resume); End session closes it and the timer is ready again
  await page.getByTestId('timer-pause').click()
  await expect(page.getByTestId('timer-state')).toHaveText('paused')
  await expect(page.getByTestId('timer-resume')).toBeVisible()
  await page.getByTestId('session-end').click()
  await page.getByTestId('end-dialog').getByTestId('end-save').click()
  await expect(page.getByTestId('timer-state')).toHaveText('ready')
  await expect(readout).toHaveText('25:00')
  await ctx.close()
})

test('A10 / A13 / A14 / S8: the unknown-ticket screen, 44 px phone targets, the warn Read-only toast, a current DSU root keeps its border', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/zz-no-such-ticket')
  // TICKET-02: one sentence and one action, no stack trace
  await expect(page.locator('.do-missing')).toHaveText('That ticket is not on your path.')
  await expect(page.getByTestId('ticket-missing-action')).toHaveAttribute('href', '/path')
  await expect(page.getByTestId('do-back')).toHaveText('Back')
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
  await tall((await openApproaches(page)).getByRole('button').first(), 'approach chip')
  await tall(page.getByTestId('ladder-open-hint'), 'rung button')
  // the Plan dialog and the Soft chime row are retired; in a running ticket the timer's own buttons are the phone targets
  await page.getByTestId('ticket-start').click()
  await page.getByTestId('session-panel').waitFor()
  await tall(page.getByTestId('timer-pause'), 'Pause')
  await tall(page.getByTestId('session-end'), 'End session')
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
  const strip = await openApproaches(page)
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

test('Minors in the trace and families: M9 case rows, M10 mapping, M11 tree well, M12 legend at tablet, M13 2-D grid, M15 heap slots, M16 list arrows', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  // M9: a failing row reads <error glyph> <call> → <got>
  await page.goto('/do/p91')
  const wrong = 'package main\n\nfunc numDecodings(s string) int {\n\tif len(s) <= 2 { return len(s) }; return len(s) + 1\n}\n'
  await page.getByRole('textbox', { name: 'Code' }).fill(wrong)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p91')?.source, { timeout: 5000 }).toBe(wrong)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText('Failed 1/2', { timeout: 90_000 })
  await expect(page.getByTestId('run-case-2')).toContainText('numDecodings("226") → 4')
  await expect(page.getByTestId('run-case-2').locator('svg.glyph')).toHaveAttribute('data-glyph', 'error')
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

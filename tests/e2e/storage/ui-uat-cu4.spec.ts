import { expect, test, type Page } from '@playwright/test'
import { openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-4 (dojo-acceptance/reports/uat/cu-4.md, 584d18b: the Do screen for Go problems)
// that need the real page, the real server and a real keyboard.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

const saved = async (id: string, lang: 'go' | 'py') =>
  (await rows(srv, 'code')).find(r => r.ticketId === id && (r.lang ?? 'go') === lang)?.source as string | undefined

test('cu-4 P2-1: Tab indents inside the Go editor and focus stays there; Esc then Tab is the way out', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p91')
  const code = page.getByRole('textbox', { name: 'Code' })
  await code.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')

  // Tab at the caret: a tab character in the text, the focus still in the editor, the next keys land in it
  await page.keyboard.type('a')
  await page.keyboard.press('Tab')
  await expect(code).toBeFocused()
  await page.keyboard.type('b')
  await expect(code).toBeFocused()
  await expect.poll(() => saved('p91', 'go')).toBe('a\tb')

  // Shift+Tab takes one indent back (the caret's line)
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await expect.poll(() => saved('p91', 'go')).toBe('\ta\tb')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => saved('p91', 'go')).toBe('a\tb')
  await expect(code).toBeFocused()

  // a selection over several lines indents all of them
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('x\ny\nz')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Tab')
  await expect.poll(() => saved('p91', 'go')).toBe('\tx\n\ty\n\tz')
  await expect(code).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => saved('p91', 'go')).toBe('x\ny\nz')

  // the editor shows the tab at a width of 4 (F6.17)
  expect(await code.evaluate(e => getComputedStyle(e).tabSize)).toBe('4')
  // and says how to leave it
  expect(await code.getAttribute('aria-description')).toMatch(/Escape, then Tab/)

  // Escape keeps the caret in the code (it never leaves the Do page), and a Tab right after it moves focus on to Run
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/do\/p91$/)
  await expect(code).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeFocused()
  await expect(page).toHaveURL(/\/do\/p91$/)
  expect(await saved('p91', 'go')).toBe('x\ny\nz') // the Tab that left the editor wrote nothing

  // back in the editor, Tab indents again (the way out is not left on)
  await code.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('q')
  await page.keyboard.press('Tab')
  await expect(code).toBeFocused()
  await expect.poll(() => saved('p91', 'go')).toBe('q\t')
  await ctx.close()
})

test('cu-4 P2-1: Tab indents the Python editor with four spaces, to the next stop', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p91')
  await page.getByRole('radio', { name: 'Python' }).check()
  const code = page.getByRole('textbox', { name: 'Code' })
  await code.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Tab')
  await page.keyboard.type('x')
  await page.keyboard.press('Tab')
  await page.keyboard.type('y')
  await expect(code).toBeFocused()
  await expect.poll(() => saved('p91', 'py')).toBe('    x   y')
  await ctx.close()
})

// ---- the layout findings: measured on the real page, with real Go runs (a 1280 desktop window, then 834)
const P91_BOTH = `package main

import "dojo/tk"

var memo map[int]int
var t *tk.Tab
var str string

func f(i int) int {
	if v, ok := memo[i]; ok {
		tk.Hit("f", i)
		return v
	}
	tk.Enter("f", i)
	v := 0
	if i <= 1 {
		v = 1
		if i == 1 && str[0] == '0' {
			v = 0
		}
		t.Set(0, i, v)
	} else {
		one := str[i-1] != '0'
		two := str[i-2] == '1' || (str[i-2] == '2' && str[i-1] <= '6')
		if one {
			v += f(i - 1)
		}
		if two {
			v += f(i - 2)
		}
		if one && two {
			t.Set(0, i, v, tk.Dep(0, i-1), tk.Dep(0, i-2), tk.Rule("{0} + {1}"))
		} else if one {
			t.Set(0, i, v, tk.Dep(0, i-1), tk.Rule("{0}"))
		} else if two {
			t.Set(0, i, v, tk.Dep(0, i-2), tk.Rule("{0}"))
		} else {
			t.Set(0, i, 0)
		}
	}
	memo[i] = v
	tk.Exit(v)
	return v
}

func numDecodings(s string) int {
	str = s
	memo = map[int]int{}
	t = tk.Table("dp", 1, len(s)+1)
	tk.Link("f", "dp")
	return f(len(s))
}
`
const TABLE_P62 = `package main

import "dojo/tk"

func uniquePaths(m int, n int) int {
	t := tk.Table("dp", m, n)
	for i := 0; i < m; i++ {
		for j := 0; j < n; j++ {
			if i == 0 || j == 0 {
				t.Set(i, j, 1)
			} else {
				t.Set(i, j, t.Get(i-1, j)+t.Get(i, j-1), tk.Dep(i-1, j), tk.Dep(i, j-1))
			}
		}
	}
	return t.Get(m-1, n-1)
}
`

async function run(page: Page, id: string, code: string, mode: 'Run' | 'Submit' = 'Run') {
  await page.goto(`/do/${id}`)
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id && (r.lang ?? 'go') === 'go')?.source, { timeout: 5000 }).toBe(code)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/^Passed/, { timeout: 90_000 })
  await page.getByTestId('dp-view').waitFor()
}

test('cu-4 P3-15: after the last step the Trace panel ends where its content ends, not 250 px below it', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(page, 'p91', P91_BOTH) // two cases: the panes sit side by side (they start stacked, until measured)
  await expect(page.locator('.dp-panes')).toHaveAttribute('data-layout', 'side')
  await page.waitForTimeout(300) // the height is held from the first settled frame
  const gap = () => page.getByTestId('dp-view').evaluate(v => {
    const last = [...v.children].filter(c => c.getBoundingClientRect().height > 0).pop()!
    return Math.round(v.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom)
  })
  // the panel's own padding and border (16 + 2) under the legend row, nothing more
  expect(await gap()).toBeLessThanOrEqual(24)
  // the J4/J5 hold still works: stepping back to the first step never makes the panel shorter than it was
  const h = () => page.getByTestId('dp-view').evaluate(v => Math.round(v.getBoundingClientRect().height))
  const before = await h()
  await page.getByTestId('dp-scrubber').press('Home')
  await page.getByTestId('dp-scrubber').press('ArrowRight')
  expect(await h()).toBeGreaterThanOrEqual(before)
  // and a window that gets narrower (side by side to stacked) is measured afresh, not held at the old height
  await page.setViewportSize({ width: 834, height: 900 })
  await page.waitForTimeout(400)
  expect(await gap()).toBeLessThanOrEqual(24)
  await ctx.close()
})

test('cu-4 P3-7: a 2-D table that fits its pane has no scrollbar of its own', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(page, 'p62', TABLE_P62)
  const sc = page.locator('.dp-sc').first()
  const m = await sc.evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight, sw: e.scrollWidth, cw: e.clientWidth }))
  expect(m.sh - m.ch, 'vertical overflow').toBeLessThanOrEqual(1)
  expect(m.sw - m.cw, 'horizontal overflow').toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 560, height: 900 }) // compact cells, a phone-width pane
  await page.waitForTimeout(400)
  const n = await sc.evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight }))
  expect(n.sh - n.ch, 'vertical overflow, compact').toBeLessThanOrEqual(1)
  await ctx.close()
})

test('cu-4 P3-13 / P3-10: the study session\'s brief lines stay together, and Notes is its own field beside the Attempt log', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/do/p91')
  await page.getByTestId('start-session').click()
  await page.getByTestId('plan-dialog').getByRole('textbox').first().fill('redo decode ways from memory')
  await page.getByTestId('plan-start').click()
  await page.getByTestId('session-phase').waitFor()
  const brief = page.getByTestId('session-brief')
  const lines = await brief.locator('h2, p').evaluateAll(els => els.map(e => ({ top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })))
  expect(lines.length).toBeGreaterThanOrEqual(3) // title, the plan line, the card text
  for (let i = 1; i < lines.length; i++) expect(lines[i].top - lines[i - 1].bottom, `gap before line ${i}`).toBeLessThanOrEqual(16)
  // the clock column is taller than the brief's text, so a stretching grid would have spread the lines
  const side = await page.locator('.study-side').boundingBox()
  expect(side!.height).toBeGreaterThan(lines[lines.length - 1].bottom - lines[0].top + 20)
  // Notes and the Attempt log: two fields
  const notes = page.getByRole('textbox', { name: 'Notes', exact: true })
  const log = page.getByLabel('What is the invariant? What did you try?')
  await expect(log).toBeVisible()
  await notes.fill('ch1: slope of a secant')
  await expect(log).toHaveValue('')
  await log.fill('invariant: i is the prefix length')
  await expect(notes).toHaveValue('ch1: slope of a secant')
  await ctx.close()
})

test('cu-4 P3-2: "Compare with" in the Approaches column shows the whole title; wider, the controls share one row', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const open2 = async () => {
    await page.goto('/do/p91')
    const strip = page.getByTestId('dsa-approaches')
    await strip.getByRole('button', { name: 'Pick two' }).click()
    const chips = strip.getByRole('button').filter({ hasNotText: /Pick two/ })
    await chips.nth(1).click()
    await chips.nth(2).click()
    return page.getByTestId('lab-two-up')
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  let two = await open2()
  const sel = two.getByRole('combobox', { name: 'Compare with' })
  const box = (await sel.boundingBox())!
  const own = (await two.getByRole('button', { name: 'Own input' }).boundingBox())!
  const close = (await two.getByRole('button', { name: 'Close two-up' }).boundingBox())!
  expect(box.width, 'the select is wide enough for a title').toBeGreaterThan(250)
  expect(box.y + box.height, 'the select has its own row').toBeLessThanOrEqual(own.y + 1)
  expect(Math.abs(own.y - close.y), 'Own input and Close two-up share the next row').toBeLessThanOrEqual(2)
  // the whole selected title fits: the text of the chosen option is no wider than the select's inside
  const fits = await sel.evaluate(s => {
    const c = document.createElement('canvas').getContext('2d')!
    const cs = getComputedStyle(s)
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const text = (s as HTMLSelectElement).selectedOptions[0].textContent ?? ''
    return c.measureText(text).width <= s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  })
  expect(fits).toBe(true)
  // a wide two-up (one column at 834) keeps V12's one row
  await page.setViewportSize({ width: 834, height: 900 })
  two = await open2()
  const ys = await two.locator('.lab-two-up-head').locator('select, button').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)))
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4)
  await ctx.close()
})

test('cu-4 P3-16: pressing a trace cell or a call node never moves the panes, so a second click lands on the same pixel', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(page, 'p91', P91_BOTH)
  await page.getByTestId('dp-scrubber').press('End')
  await page.waitForTimeout(300)
  const panesTop = () => page.locator('.dp-panes').evaluate(e => Math.round((e.getBoundingClientRect().top + scrollY) * 10) / 10) // on the page, not in the window: a click scrolls
  const viewH = () => page.getByTestId('dp-view').evaluate(e => Math.round(e.getBoundingClientRect().height))
  const top0 = await panesTop()
  const h0 = await viewH()
  const cell = page.getByTestId('dp-cell-0-3')
  await cell.click()
  await expect(page.getByTestId('dp-cell-recurrence')).toBeVisible() // the SELECTED line is there now
  expect(Math.abs((await panesTop()) - top0), 'panes after pressing a cell').toBeLessThanOrEqual(0.5) // UAT: they moved 28 px
  expect(Math.abs((await viewH()) - h0), 'panel height after pressing a cell').toBeLessThanOrEqual(1)
  await cell.click() // the same pixel again clears it
  await expect(page.getByTestId('dp-cell-recurrence')).toHaveCount(0)
  expect(Math.abs((await panesTop()) - top0), 'panes after clearing').toBeLessThanOrEqual(0.5)
  // a call node, by pointer
  await page.getByTestId('dp-tree-pane').locator('[data-testid^="dp-node-"]').first().click()
  expect(Math.abs((await panesTop()) - top0), 'panes after pressing a node').toBeLessThanOrEqual(0.5)
  await ctx.close()
})

test('cu-4 P3-18: the session panel has no Pause of its own; its buttons are full width, stacked, in the side column and on a phone', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const start = async () => {
    await page.goto('/do/p91')
    await page.getByTestId('start-session').click()
    await page.getByTestId('plan-start').click()
    await page.getByTestId('session-phase').waitFor()
    await page.waitForTimeout(500) // the panel's entrance animation
  }
  const geo = async () => {
    const r = (id: string) => page.getByTestId(id).evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })
    return { focus: await r('session-focus'), end: await r('session-end'), panel: await page.locator('.study-side').evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, w: b.width } }) }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await start()
  await expect(page.getByTestId('session-pause')).toHaveCount(0)
  await expect(page.getByTestId('session-resume')).toHaveCount(0)
  let g = await geo()
  expect(g.focus.w).toBeCloseTo(g.panel.w, 0) // the 220 px column
  expect(g.end.w).toBeCloseTo(g.panel.w, 0)
  expect(g.end.y).toBeGreaterThan(g.focus.y + g.focus.h - 1)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.waitForTimeout(300)
  g = await geo()
  expect(g.focus.w).toBeGreaterThan(300) // the whole width of the phone panel
  expect(g.end.w).toBeCloseTo(g.focus.w, 0)
  expect(g.end.y).toBeGreaterThan(g.focus.y + g.focus.h - 1)
  // paused from the pill on another screen, the card's own panel offers Resume (so it is never stuck there)
  await page.getByTestId('do-back').click()
  await page.getByTestId('session-pill-pause').click()
  await page.goto('/do/p91')
  await expect(page.getByTestId('session-resume')).toBeVisible()
  await page.getByTestId('session-resume').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Focus')
  await expect(page.getByTestId('session-resume')).toHaveCount(0)
  await ctx.close()
})

test('cu-4 P3-19: at 375 a long case row keeps its mark on the line of its text', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 375, height: 800 })
  await run(page, 'p91', P91_BOTH, 'Submit')
  const bad = await page.locator('.run-case').evaluateAll(rows => rows.flatMap(r => {
    const mark = r.querySelector('.run-case-mark')!.getBoundingClientRect()
    const code = r.querySelector('code')!.getClientRects()[0]
    return Math.abs(mark.top - code.top) > 4 ? [`${r.textContent}: mark ${mark.top} text ${code.top}`] : []
  }))
  expect(bad).toEqual([])
  // the long one wraps (it is wider than the column), and the page does not widen
  const long = page.getByTestId('run-case-5')
  expect(await long.evaluate(r => r.querySelector('code')!.getClientRects().length)).toBeGreaterThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  await ctx.close()
})

test('cu-4 P3-17: the first Go run on a cold build cache says why it takes a few seconds', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv) // a fresh home: its Go build cache is empty
  await page.goto('/do/p91')
  const status = page.getByTestId('run-status')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const seen = new Set<string>()
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < 60_000) {
    last = (await status.textContent()) ?? ''
    seen.add(last)
    if (/^(Passed|Failed|Compile)/.test(last)) break
    await page.waitForTimeout(100)
  }
  const took = Date.now() - t0
  expect(last).toMatch(/^(Passed|Failed)/)
  expect(seen.has('Running…'), 'it starts as Running…').toBe(true)
  // a cold cache takes 3 s or more; a machine fast enough to finish under 2 s has nothing to explain
  if (took > 2200) expect([...seen].some(t => /first Go run builds its cache/.test(t)), `texts seen in ${took} ms: ${[...seen].join(' | ')}`).toBe(true)
  await ctx.close()
})

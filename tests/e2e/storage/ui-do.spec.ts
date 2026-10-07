import { expect, test, type Page } from '@playwright/test'
import { GO_VF } from '../../helpers/visualSolutions'
import { openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// UI area A (ui-do.md, ui-dp-view.md, ui-visual-families.md): measured layout rules of the Do workbench, the trace
// band and the family panes, on the real page with real Go runs. Looks only: the behaviour is in visual/runner.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

/** p91: memoised f(i) that also writes dp[i], linked (the testers' fixture shape). */
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

async function run(page: Page, id: string, code: string, mode: 'Run' | 'Submit' = 'Run') {
  await page.goto(`/do/${id}`)
  const box = page.getByRole('textbox', { name: 'Code' })
  await box.fill(code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id && (r.lang ?? 'go') === 'go')?.source, { timeout: 5000 }).toBe(code)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/^Passed/, { timeout: 90_000 })
  await page.getByTestId('dp-view').waitFor()
}
async function seek(page: Page, testid: string, text: string) {
  await page.getByTestId('dp-scrubber').press('Home')
  await page.evaluate(async ({ testid, text }) => {
    const root = document.querySelector('[data-testid="dp-view"]')!
    const next = [...root.querySelectorAll('button')].find(b => b.textContent === 'Next step') as HTMLButtonElement
    for (let i = 0; i < 5000 && (root.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '').trim() !== text && !next.disabled; i++) {
      next.click()
      await new Promise(r => setTimeout(r, 0))
    }
  }, { testid, text })
  await expect(page.getByTestId(testid)).toHaveText(text)
}
const box = (page: Page, testid: string) => page.getByTestId(testid).first().boundingBox().then(b => b!)
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

test('ui-do D1 / ui-dp-view L1, A, I, TL: the workbench rows and the trace band at 1280', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(page, 'p91', P91_BOTH)
  await seek(page, 'dp-recurrence', 'dp[3] = dp[2] + dp[1] = 2 + 1 = 3')
  // row A two columns, then code, trace and outcomes, full width
  const stmt = await box(page, 'do-title')
  const ladder = await box(page, 'ladder')
  expect(ladder.x).toBeGreaterThan(stmt.x + 300)
  const code = await box(page, 'code-panel')
  const band = await box(page, 'dp-view')
  const solved = await box(page, 'do-outcome-solved')
  expect(code.y).toBeGreaterThan(ladder.y)
  expect(band.y).toBeGreaterThanOrEqual(code.y + code.height)
  expect(solved.y).toBeGreaterThanOrEqual(band.y + band.height)
  expect(Math.abs(band.width - code.width)).toBeLessThanOrEqual(1)
  expect(await page.getByTestId('code-panel').getByTestId('dp-view').count()).toBe(0) // its own panel, not nested
  // side by side 1:1, table left
  const tp = await box(page, 'dp-table-pane')
  const tr = await box(page, 'dp-tree-pane')
  expect(tr.x).toBeGreaterThan(tp.x + tp.width)
  expect(Math.abs(tp.width - tr.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(tp.y - tr.y)).toBeLessThanOrEqual(1)
  // the index row directly under each cell, centred
  const cell = await box(page, 'dp-cell-0-3')
  const col = await box(page, 'dp-col-3')
  expect(col.y).toBeGreaterThanOrEqual(cell.y + cell.height)
  expect(Math.abs(col.x + col.width / 2 - (cell.x + cell.width / 2))).toBeLessThanOrEqual(1)
  // two green arrows with 8 px heads whose tips touch dp[3]'s top edge, 8 px apart
  const tips = await page.evaluate(() => ['0-2-0-3', '0-1-0-3'].map(id => {
    const g = document.querySelector(`[data-testid="dp-arrow-${id}"]`)!
    const tip = (g.querySelector('polygon') as SVGPolygonElement).points[0]
    const ctm = (g as SVGGElement).getScreenCTM()!
    return { kind: g.getAttribute('data-kind'), x: tip.x * ctm.a + ctm.e, y: tip.y * ctm.d + ctm.f, stroke: getComputedStyle(g.querySelector('polyline')!).stroke }
  }))
  expect(tips.map(t => t.kind)).toEqual(['current', 'current'])
  for (const t of tips) expect(Math.abs(t.y - cell.y)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(Math.abs(tips[0].x - tips[1].x) - 8)).toBeLessThanOrEqual(1)
  expect(tips[0].stroke).toBe('rgb(61, 220, 132)')
  // the overlay is sized to its table (never the 300 px default that forced a scroll)
  const arrows = await page.getByTestId('dp-arrows').first().evaluate(e => [e.getBoundingClientRect().width, (e.closest('.dp-sc') as HTMLElement).scrollWidth, (e.closest('.dp-sc') as HTMLElement).clientWidth])
  expect(arrows[1]).toBeLessThanOrEqual(arrows[2])
  // the tree: one labelled tree per case, root above its children, orthogonal edges
  await expect(page.getByTestId('dp-root-label-1')).toHaveText('numDecodings("12")')
  await expect(page.getByTestId('dp-root-label-2')).toHaveText('numDecodings("226")')
  const nodes = page.getByTestId('dp-tree').getByRole('treeitem')
  const ys = await nodes.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().y)))
  expect(new Set(ys).size).toBe(3) // three levels at a 56 px pitch
  expect([...new Set(ys)].sort((a, b) => a - b).map((y, i, a) => (i ? y - a[i - 1] : 0))).toEqual([0, 56, 56])
  await expect(page.getByTestId('dp-mapping')).toContainText('f(i) ↔ dp[i]')
  await expect(page.getByTestId('dp-legend')).toBeVisible()
  await ctx.close()
})

test('stacked panes, no page overflow and phone controls at 834, 393 and 375', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 834, height: 900 })
  await run(page, 'p91', P91_BOTH)
  for (const w of [834, 393, 375]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.waitForTimeout(100)
    const tp = await box(page, 'dp-table-pane')
    const tr = await box(page, 'dp-tree-pane')
    expect(tr.y, `${w}`).toBeGreaterThanOrEqual(tp.y + tp.height)
    expect(await overflow(page), `${w}`).toBeLessThanOrEqual(0)
  }
  // F6.14 phone: Previous | Next, Play spanning, every button 44 tall; ruling 2: panes pad 8
  const prev = await box(page, 'dp-view').then(() => page.getByRole('button', { name: 'Previous step' }).boundingBox())
  const next = await page.getByRole('button', { name: 'Next step' }).boundingBox()
  const play = await page.getByTestId('dp-view').getByRole('button', { name: 'Play' }).boundingBox()
  expect(Math.abs(prev!.y - next!.y)).toBeLessThanOrEqual(1)
  expect(play!.y).toBeGreaterThan(prev!.y + prev!.height)
  expect(Math.round(play!.height)).toBe(44)
  expect(await page.getByTestId('dp-tree-pane').evaluate(e => getComputedStyle(e).paddingLeft)).toBe('8px')
  await ctx.close()
})

test('F6.17 / F6.18 / F6.15: gutter numbers on their own lines, timer row under Start session, a themed slider', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(page, 'p91', P91_BOTH)
  await page.evaluate(() => document.querySelector('.cm-scroller')!.scrollTo(0, 0))
  const pairs = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-content .cm-line')].slice(0, 6).map(e => e.getBoundingClientRect())
    const nums = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(e => /^\d+$/.test(e.textContent ?? '') && e.getBoundingClientRect().height > 0).slice(0, 6).map(e => e.getBoundingClientRect())
    return lines.map((l, i) => [l.top, nums[i].top, l.height, nums[i].height])
  })
  for (const [lt, nt, lh, nh] of pairs) { expect(Math.abs(lt - nt)).toBeLessThanOrEqual(1); expect(lh).toBe(24); expect(nh).toBe(24) }
  const start = await box(page, 'start-session')
  const blocks = await page.locator('.timer .blocks').boundingBox()
  const readout = await page.locator('.timer .timer-big').boundingBox()
  expect(blocks!.y).toBeGreaterThanOrEqual(start.y + start.height + 4) // below the button and its 4 px drop
  expect(Math.abs((blocks!.y + blocks!.height / 2) - (readout!.y + readout!.height / 2))).toBeLessThanOrEqual(2) // beside the readout
  const slider = await page.getByTestId('dp-scrubber').evaluate(e => ({ a: getComputedStyle(e).appearance, ac: getComputedStyle(e).accentColor }))
  expect(slider.a).toBe('none')
  expect(slider.ac).toBe('rgb(255, 138, 42)')
  await ctx.close()
})

test('ui-visual-families V0.2–V0.4: graph left, heap right; SVG text exactly 14 px at 1280 and 393; the array scrolls inside its box', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(page, 'p743', GO_VF.vf01[1], 'Submit')
  await seek(page, 'graph-caption', 'dist[2] = 3 (via 3)')
  const g = await box(page, 'graph-view')
  const h = await box(page, 'heap-view')
  expect(h.x).toBeGreaterThan(g.x + g.width)
  const textPx = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="graph-view"] svg text')].map(t => parseFloat(getComputedStyle(t).fontSize) * (t as SVGTextElement).getScreenCTM()!.a))
  for (const px of await textPx()) expect(px).toBeCloseTo(14, 1)
  // the tile's text sits inside its rect
  const inside = await page.getByTestId('graph-node-2').evaluate(n => {
    const r = n.querySelector('rect')!.getBoundingClientRect(), t = n.querySelector('text')!.getBoundingClientRect()
    return t.left >= r.left && t.right <= r.right && t.top >= r.top && t.bottom <= r.bottom
  })
  expect(inside).toBe(true)
  await page.setViewportSize({ width: 393, height: 900 })
  await page.waitForTimeout(100)
  for (const px of await textPx()) expect(px).toBeCloseTo(14, 1)
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await run(page, 'p3', GO_VF.vf05[1])
  await seek(page, 'array-caption', 'window [1..3] (len 3)')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await ctx.close()
})

test('no horizontal page scroll at 375 on every Do variant (problem, pack, learning card, AI build), idle, planning and in a session; 44 px language switch', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 375, height: 800 })
  const tickets = await rows(srv, 'tickets')
  const ai = tickets.find(t => t.track === 'ai' && t.sprint === 1 && /rebuild/.test(t.id)) ?? tickets.find(t => t.track === 'ai' && t.sprint === 1)
  const learning = tickets.find(t => t.sprint === 1 && t.brief && t.kind !== 'problem') ?? tickets.find(t => t.track !== 'interview' && t.kind === 'watch')
  const ids = ['p200', 'p91', learning?.id, ai?.id].filter((x): x is string => !!x)
  expect(ids.length).toBeGreaterThanOrEqual(3)
  for (const id of ids) {
    await page.goto(`/do/${id}`)
    await page.getByTestId('do-screen').waitFor()
    await page.waitForTimeout(300)
    expect(await overflow(page), `${id} idle`).toBeLessThanOrEqual(0)
    const giveUp = await page.getByTestId('do-outcome-giveup').boundingBox()
    expect(giveUp!.x + giveUp!.width, `${id} Give up inside the viewport`).toBeLessThanOrEqual(375)
    const start = page.getByTestId('start-session')
    if (await start.isEnabled()) {
      await start.click()
      const plan = page.getByTestId('plan-dialog')
      await plan.waitFor()
      expect(await overflow(page), `${id} planning`).toBeLessThanOrEqual(0)
      await plan.getByRole('textbox').first().fill('Read the statement and try one approach')
      await page.getByTestId('plan-start').click()
      await page.getByTestId('session-panel').waitFor()
      await page.waitForTimeout(200)
      expect(await overflow(page), `${id} in a session`).toBeLessThanOrEqual(0)
      await page.getByTestId('session-end').click()
      await page.getByTestId('end-dialog').waitFor()
      expect(await overflow(page), `${id} ending`).toBeLessThanOrEqual(0)
      await page.getByTestId('end-save').click()
      await page.getByTestId('end-dialog').waitFor({ state: 'hidden' })
    }
  }
  await page.goto('/do/p91')
  await page.getByRole('radiogroup', { name: 'Language' }).waitFor()
  for (const name of ['Go', 'Python']) {
    const h = await page.locator('.lang-option', { hasText: name }).boundingBox()
    expect(Math.round(h!.height), name).toBeGreaterThanOrEqual(44)
  }
  await ctx.close()
})

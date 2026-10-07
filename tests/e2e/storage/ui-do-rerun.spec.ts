import { expect, test, type Page } from '@playwright/test'
import { GO_VF } from '../../helpers/visualSolutions'
import { draftSprint1, learningCard, openApp, putTicket, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// The do-dp-families rerun on 48cae36 (reports/ui/do-dp-families/findings.md, Controller ruling 10).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

const css = (page: Page, sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
async function run(page: Page, id: string, code: string, mode: 'Run' | 'Submit' = 'Run') {
  await page.goto(`/do/${id}`)
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id && (r.lang ?? 'go') === 'go')?.source, { timeout: 5000 }).toBe(code)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/^(Passed|Failed)/, { timeout: 90_000 })
  await page.getByTestId('dp-view').waitFor()
}
const MEMO_P91 = `package main

import "dojo/tk"

var memo map[int]int

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
	tk.Exit(v)
	return v
}

func numDecodings(s string) int {
	memo = map[int]int{}
	f(len(s))
	if s == "12" {
		return 2
	}
	return 3
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

test('Q22: Split on a briefed learning card opens the dialog; the check stays on the parent and is taken once every part is done', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await putTicket(srv, { ...learningCard('w-big', 'Big reading'), estMin: 180 })
  await page.reload()
  await draftSprint1(page)
  await page.goto('/do/w-big')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const dlg = page.getByRole('dialog', { name: 'Split into sessions' })
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Parts').fill('2')
  await dlg.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(dlg).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'w-big')).children?.length).toBe(2)
  const kids: string[] = (await ticket(srv, 'w-big')).children
  for (const k of kids) expect((await ticket(srv, k)).brief).toBeUndefined()
  // the parent offers its check only once every part is done
  const card = page.getByTestId('card-brief')
  await expect(card.getByRole('button', { name: 'Mark done' })).toHaveCount(0)
  for (const k of kids) {
    await page.goto(`/do/${k}`)
    await page.getByTestId('do-outcome-solved').click()
    await expect.poll(async () => (await ticket(srv, k)).status).toBe('done')
  }
  expect((await ticket(srv, 'w-big')).status).not.toBe('done')
  await page.goto('/do/w-big')
  await card.getByRole('button', { name: 'Mark done' }).click()
  const check = page.getByRole('dialog', { name: 'Check your understanding' })
  await check.getByRole('textbox', { name: 'Explain Big reading in your own words' }).fill('I can explain how big reading works')
  await check.getByRole('radiogroup', { name: 'Which is Big reading?' }).getByRole('radio', { name: 'Big reading', exact: true }).check()
  await check.getByRole('button', { name: 'Check answers' }).click()
  await expect(check.getByText('Passed')).toBeVisible()
  await expect.poll(async () => (await ticket(srv, 'w-big')).status).toBe('done')
  await ctx.close()
})

test('F001 / F002 / F003 / F007 / W: rung 1 description 15, active gutter number secondary, select padding on the scale, phone language options 11 14, rail timer-readout + panel timer-panel-readout (ruling 12)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p91')
  await page.getByTestId('code-editor').waitFor()
  expect(await css(page, '[data-testid="ladder-why-attempt"]', 'font-size')).toBe('15px')
  await page.getByRole('textbox', { name: 'Code' }).click()
  expect(await css(page, '.cm-gutterElement.cm-activeLineGutter', 'color')).toBe('rgb(180, 186, 208)')
  await expect(page.getByTestId('timer-readout')).toHaveCount(1)
  expect(await page.getByTestId('timer-readout').evaluate(e => !!e.closest('[role="banner"]'))).toBe(true)
  await expect(page.getByTestId('timer-panel-readout')).toHaveCount(1)
  expect(await page.getByTestId('timer-panel-readout').evaluate(e => !!e.closest('.timer'))).toBe(true)
  const pads = await page.evaluate(() => [...document.querySelectorAll('select')].map(s => getComputedStyle(s).paddingRight))
  for (const p of pads) expect(['4px', '8px', '12px', '14px', '16px', '24px']).toContain(p)
  await page.setViewportSize({ width: 393, height: 852 })
  const pad = await page.locator('.lang-option span').first().evaluate(e => [getComputedStyle(e).paddingTop, getComputedStyle(e).paddingRight, getComputedStyle(e).paddingBottom, getComputedStyle(e).paddingLeft])
  expect(pad).toEqual(['11px', '14px', '11px', '14px'])
  expect(Math.round((await page.locator('.lang-option').first().boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  await ctx.close()
})

test('F008 / F009 / F012: phone tree well ≤ 12, 2-D cell hit areas own their extended edges at 560, list arrows 24 between tiles', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [560, 393, 375]) {
    await page.setViewportSize({ width: w, height: 900 })
    await run(page, 'p91', MEMO_P91)
    const well = await page.getByTestId('dp-tree-pane').evaluate(p => {
      const nodes = [...p.querySelectorAll('[data-testid^="dp-node-"]')].map(n => n.getBoundingClientRect().bottom)
      const cs = getComputedStyle(p)
      return p.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth) - Math.max(...nodes)
    })
    expect(well, `${w}`).toBeLessThanOrEqual(12)
    expect(await page.getByTestId('dp-tree-pane').evaluate(p => getComputedStyle(p).padding), `pane padding ${w}`).toBe('8px') // final F003/F009
  }
  await page.setViewportSize({ width: 560, height: 900 })
  await run(page, 'p62', TABLE_P62)
  const bad = await page.evaluate(() => {
    const out: string[] = []
    for (const c of document.querySelectorAll<HTMLElement>('[data-testid^="dp-cell-"]')) {
      c.scrollIntoView({ block: 'center', inline: 'center' })
      const r = c.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const ext = { left: [cx - 22 + 1, cy], right: [cx + 22 - 1, cy], top: [cx, cy - 22 + 1], bottom: [cx, cy + 22 - 1] } as Record<string, [number, number]>
      for (const [side, [x, y]] of Object.entries(ext)) {
        const hit = document.elementFromPoint(x, y)
        if (!hit || !(hit === c || c.contains(hit))) out.push(`${c.dataset.testid} ${side} → ${hit?.getAttribute('data-testid') ?? hit?.tagName}`)
      }
    }
    return out
  })
  expect(bad).toEqual([])
  await page.setViewportSize({ width: 1280, height: 900 })
  await run(page, 'p206', GO_VF.vf07[1])
  const gaps = await page.evaluate(() => [...document.querySelectorAll('.fam-chain .fam-link')].filter(li => li.querySelector('.fam-cell') && li.querySelector('.fam-arrow')).map(li => {
    const cell = li.querySelector('.fam-cell')!.getBoundingClientRect()
    const arrow = li.querySelector('.fam-arrow')!.getBoundingClientRect()
    return Math.round((arrow.right - cell.right) * 10) / 10
  }))
  expect(gaps.length).toBeGreaterThan(0)
  for (const g of gaps) expect(Math.abs(g - 24)).toBeLessThanOrEqual(1)
  expect(await css(page, '.fam-chain .fam-col > .fam-cell', 'justify-self')).toBe('stretch')
  await ctx.close()
})

test('final F002: on the iPhone SE width "Compare with" fits inside the two-up', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/do/p91')
  const strip = page.getByTestId('dsa-approaches')
  await strip.getByRole('button', { name: 'Pick two' }).click()
  const chips = strip.getByRole('button').filter({ hasNotText: /Pick two/ })
  await chips.nth(1).click()
  await chips.nth(2).click()
  const two = page.getByTestId('lab-two-up')
  const [t, c] = await Promise.all([two.boundingBox(), two.locator('.lab-compare').boundingBox()])
  expect(c!.x + c!.width).toBeLessThanOrEqual(t!.x + t!.width + 0.5)
  expect(await two.locator('.lab-compare select').evaluate(e => e.getBoundingClientRect().right)).toBeLessThanOrEqual(t!.x + t!.width + 0.5)
  await ctx.close()
})

test('closing rerun F001: on phone the trace sits exactly 16 px under the code panel, as soon as it appears', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 560, height: 900 })
  await page.goto('/do/p91')
  await page.getByRole('textbox', { name: 'Code' }).fill(MEMO_P91)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p91')?.source, { timeout: 5000 }).toBe(MEMO_P91)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const view = page.getByTestId('dp-view')
  await view.waitFor({ timeout: 90_000 })
  // measured the moment the trace mounts: no entrance offset may skew the band
  const gap = await page.evaluate(() => {
    const code = document.querySelector('[data-testid="code-panel"]')!.getBoundingClientRect()
    const v = document.querySelector('[data-testid="dp-view"]')!.getBoundingClientRect()
    return Math.round((v.top - code.bottom) * 10) / 10
  })
  expect(gap).toBe(16)
  expect(await view.evaluate(e => getComputedStyle(e).animationName)).toBe('none')
  await ctx.close()
})

test('ruling 17: with a cell pressed and focus on the page body, Esc clears the press and stays on Do; a second Esc leaves', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const TABLE_P91 = `package main

import "dojo/tk"

func numDecodings(s string) int {
	t := tk.Table("dp", 1, len(s)+1)
	t.Set(0, 0, 1)
	for i := 1; i <= len(s); i++ {
		t.Set(0, i, i, tk.Dep(0, i-1))
	}
	if s == "12" {
		return 2
	}
	return 3
}
`
  await run(page, 'p91', TABLE_P91)
  const cell = page.getByTestId('dp-cell-0-1')
  await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); document.body.focus() })
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(cell).toHaveAttribute('aria-pressed', 'false')
  await expect(page).toHaveURL(/\/do\/p91$/)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/board$/)
  await ctx.close()
})

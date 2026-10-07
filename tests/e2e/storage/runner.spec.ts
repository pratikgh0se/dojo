import { expect, test, type Page } from '@playwright/test'
import { openApp, reopen, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// C-RUNNER (Part 4a): the Go runner on Do, through dojo-server with a writer token (needs Go on PATH).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 120_000 })

const P91_OK = `package main

func numDecodings(s string) int {
	prev2, prev1 := 1, 0
	if s[0] != '0' {
		prev1 = 1
	}
	for i := 2; i <= len(s); i++ {
		cur := 0
		if s[i-1] != '0' {
			cur += prev1
		}
		if s[i-2] == '1' || (s[i-2] == '2' && s[i-1] <= '6') {
			cur += prev2
		}
		prev2, prev1 = prev1, cur
	}
	return prev1
}
`
const P91_WRONG = 'package main\n\nfunc numDecodings(s string) int {\n\tif len(s) <= 2 { return len(s) }; return len(s) + 1\n}\n'
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
		one := s[i-1] != '0'
		two := s[i-2] == '1' || (s[i-2] == '2' && s[i-1] <= '6')
		switch {
		case one && two:
			t.Set(0, i, t.Get(0, i-1)+t.Get(0, i-2), tk.Dep(0, i-1), tk.Dep(0, i-2), tk.Rule("{0} + {1}"))
		case one:
			t.Set(0, i, t.Get(0, i-1), tk.Dep(0, i-1), tk.Rule("{0}"))
		case two:
			t.Set(0, i, t.Get(0, i-2), tk.Dep(0, i-2), tk.Rule("{0}"))
		default:
			t.Set(0, i, 0)
		}
	}
	return t.Get(0, len(s))
}
`
const P91_MEMO = `package main

import "dojo/tk"

var str string
var memo map[int]int

// f(i) = decodings of the first i characters
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
	} else {
		if str[i-1] != '0' {
			v += f(i - 1)
		}
		if str[i-2] == '1' || (str[i-2] == '2' && str[i-1] <= '6') {
			v += f(i - 2)
		}
	}
	memo[i] = v
	tk.Exit(v)
	return v
}

func numDecodings(s string) int {
	str = s
	memo = map[int]int{}
	tk.Link("f", "dp")
	tk.Table("dp", 1, len(s)+1)
	return f(len(s))
}
`

async function openDo(page: Page, id: string) {
  await page.goto(`/do/${id}`)
  await expect(page.getByTestId('code-panel')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Code' })).toBeVisible()
}
/** Types the code and waits until the code row on disk holds exactly that text (RN-11 / Addendum 1 Q11). */
async function setCode(page: Page, code: string) {
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  const id = new URL(page.url()).pathname.split('/').pop()
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id)?.source, { timeout: 5000 }).toBe(code)
}
const status = (page: Page) => page.getByTestId('run-status')

test('RN-01/RN-13: a correct Submit passes 5/5 and opens the Solved gate, which closes again in the next attempt', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled()
  await expect(page.getByTestId('do-outcome-help')).toBeDisabled()
  await expect(page.getByTestId('do-outcome-giveup')).toBeEnabled()
  await setCode(page, P91_OK)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled() // Run never opens the gate
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 60_000 })
  for (let k = 1; k <= 5; k++) await expect(page.getByTestId(`run-case-${k}`)).toHaveAttribute('data-pass', 'true')
  await expect(page.getByTestId('do-outcome-solved')).toBeEnabled()
  await expect(page.getByTestId('do-outcome-help')).toBeEnabled()
  await page.reload()
  await expect(page.getByTestId('do-outcome-solved')).toBeEnabled() // same attempt after a reload
  await page.getByTestId('do-outcome-solved').click()
  // p91 has approaches, so Do asks which one was used (labs §7.3) before going back to the Board
  await page.getByRole('group', { name: 'Which approach did you use?' }).getByRole('button', { name: 'Back to Board' }).click()
  await expect(page).toHaveURL(/\/board$/)
  await openDo(page, 'p91')
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled() // the next attempt is gated again
  // a ticket without a pack: no panel, no gate
  await page.goto('/do/p200')
  await expect(page.getByTestId('do-title')).toBeVisible()
  await expect(page.getByTestId('code-panel')).toHaveCount(0)
  await expect(page.getByTestId('do-outcome-solved')).toBeEnabled()
  await ctx.close()
})

test('RN-02/RN-03/RN-04: a wrong answer diffs, a compile error lists its line, a loop times out', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await setCode(page, P91_WRONG)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Failed 1/2', { timeout: 60_000 })
  await expect(page.getByTestId('run-case-1')).toHaveAttribute('data-pass', 'true')
  await expect(page.getByTestId('run-case-2')).toHaveAttribute('data-pass', 'false')
  await expect(page.getByTestId('run-diff')).toHaveText('numDecodings("226"): expected 3, got 4')

  await setCode(page, 'package main\n\nfunc numDecodings(s string) int {\n\treturn nope\n}\n')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Compile error', { timeout: 60_000 })
  await expect(page.getByTestId('run-error').first()).toHaveText('line 4: undefined: nope')

  await setCode(page, 'package main\n\nfunc numDecodings(s string) int {\n\tfor {\n\t}\n}\n')
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Running…')
  await expect(status(page)).toHaveText('Timed out after 3 s', { timeout: 10_000 })
  expect(Date.now() - t0).toBeLessThan(10_000)
  await setCode(page, P91_OK)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })
  await ctx.close()
})

test('RN-11: code is saved as typed and comes back after a reload and in a fresh context', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p198')
  const code = 'package main\n\n// mine\nfunc rob(nums []int) int {\n\treturn len(nums)\n}\n'
  await setCode(page, code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p198'), { timeout: 5000 })
    .toMatchObject({ ticketId: 'p198', lang: 'go', source: code })
  const row = (await rows(srv, 'code')).find(r => r.ticketId === 'p198')!
  expect(typeof row.updatedAt).toBe('number')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Code' })).toContainText('// mine')
  const fresh = await reopen(browser, srv)
  await openDo(fresh.page, 'p198')
  await expect(fresh.page.getByRole('textbox', { name: 'Code' })).toContainText('// mine')
  await fresh.ctx.close()
  await ctx.close()
})

test('RN-12: a read-only browser gets the Read-only toast and sends no run', async ({ browser }) => {
  const w = await openApp(browser, srv)
  await w.ctx.close()
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  const runs: string[] = []
  page.on('request', r => { if (r.url().includes('/tools/run-go')) runs.push(r.url()) })
  await page.goto('/do/p322')
  await expect(page.getByTestId('readonly-banner')).toBeVisible()
  await expect(page.getByTestId('code-panel')).toBeVisible()
  // Deterministic: the read-only check runs before any fetch and raises its toast synchronously, so
  // once a click's own toast is up, that click has decided and no run request can follow it.
  const toasts = page.getByTestId('toast')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(toasts).toHaveCount(1)
  await expect(toasts.first()).toHaveText(/^Read-only/)
  await expect(toasts).toHaveCount(0) // the Run toast has gone (TOAST_MS)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(toasts).toHaveCount(1)
  await expect(toasts.first()).toHaveText(/^Read-only/)
  expect(runs).toEqual([])
  await ctx.close()
})

test('RN-14: the DP table shows the current write, its deps and the recurrence', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await setCode(page, P91_TABLE)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 60_000 })
  const view = page.getByTestId('dp-view')
  const counter = view.getByTestId('dp-step-counter')
  const text = (await counter.textContent())!
  const N = Number(/Step (\d+) \/ (\d+)/.exec(text)![2])
  expect(text).toBe(`Step ${N} / ${N}`)
  // the first dp[3] write in event order is case "226"'s (case "12" has no dp[3])
  const want = 'dp[3] = dp[2] + dp[1] = 2 + 1 = 3'
  await view.getByRole('slider', { name: 'Step' }).fill('1')
  await expect(counter).toHaveText(`Step 1 / ${N}`)
  let found = false
  for (let k = 1; k <= N; k++) {
    if ((await view.getByTestId('dp-recurrence').textContent()) === want) { found = true; break }
    await view.getByRole('button', { name: 'Next step' }).click()
  }
  expect(found).toBe(true)
  await expect(view.getByTestId('dp-recurrence')).toHaveText(want)
  await expect(view.getByTestId('dp-cell-0-3')).toHaveAttribute('data-state', 'current')
  await expect(view.getByTestId('dp-cell-0-2')).toHaveAttribute('data-dep', 'true')
  await expect(view.getByTestId('dp-cell-0-1')).toHaveAttribute('data-dep', 'true')
  await expect(view.getByTestId('dp-cell-0-3')).toHaveText('3')
  await expect(view.getByTestId('dp-cell-0-4')).toHaveCount(0) // "226" has a 1×4 table
  await expect(view.getByTestId('dp-cell-0-0')).toHaveAttribute('data-state', 'set')
  await view.getByRole('button', { name: 'Next step' }).click()
  await expect(view.getByTestId('dp-recurrence')).toHaveText('')
  // UAT r4 #11: a single-dependency write reads "dp[i] = dp[i-1] = v", never "… = v = v"
  await view.getByRole('slider', { name: 'Step' }).fill(String(N))
  const lines = new Set<string>()
  for (let k = N; k >= 1; k--) {
    lines.add((await view.getByTestId('dp-recurrence').textContent()) ?? '')
    if (k > 1) await view.getByRole('button', { name: 'Previous step' }).click()
  }
  const single = [...lines].filter(l => /^dp\[\d+\] = dp\[\d+\] = \d+$/.test(l))
  expect(single.length, [...lines].join(' | ')).toBeGreaterThan(0)
  for (const l of lines) expect(l, l).not.toMatch(/= (\S+) = \1$/)
  await ctx.close()
})

test('RN-15: the call tree shows hits and returns, and cells link to their nodes', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await setCode(page, P91_MEMO)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 60_000 })
  const tree = page.getByTestId('dp-tree')
  const nodes = tree.locator('[data-testid^="dp-node-"]')
  expect(await tree.locator('[data-hit="true"]').count()).toBeGreaterThan(0)
  await expect(tree.locator('[data-hit="true"]').first()).toHaveText(/^f\(\d+\) \(cached\)$/)
  await expect(nodes.filter({ hasText: /^f\(3\)/ }).first()).toHaveText('f(3) → 3') // case "226"'s root
  await page.getByTestId('dp-cell-0-1').click()
  await expect(page.getByTestId('dp-cell-0-1')).toHaveAttribute('aria-pressed', 'true')
  const f1 = nodes.filter({ hasText: /^f\(1\)/ })
  expect(await f1.count()).toBeGreaterThan(1)
  for (const n of await f1.all()) await expect(n).toHaveAttribute('data-linked', 'true')
  await expect(nodes.filter({ hasText: /^f\(2\)/ }).first()).toHaveAttribute('data-linked', 'false')
  await nodes.filter({ hasText: /^f\(2\)/ }).first().click()
  await expect(page.getByTestId('dp-cell-0-2')).toHaveAttribute('data-linked', 'true')
  await ctx.close()
})

test('RN-16: 30000 events show the first 20000 steps', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await setCode(page, 'package main\n\nimport "dojo/tk"\n\nfunc numDecodings(s string) int {\n\tt := tk.Table("dp", 1, 10)\n\tfor i := 0; i < 30000; i++ {\n\t\tt.Set(0, i%10, i)\n\t}\n\treturn 0\n}\n')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Failed 0/2', { timeout: 60_000 })
  await expect(page.getByText('Showing the first 20000 steps')).toBeVisible()
  await expect(page.getByTestId('dp-step-counter')).toHaveText('Step 20000 / 20000')
  await page.getByRole('button', { name: 'Previous step' }).click()
  await expect(page.getByTestId('dp-step-counter')).toHaveText('Step 19999 / 20000')
  await ctx.close()
})

test('RN-17: without Go the page says how to install it and the server stays healthy', async ({ browser }) => {
  await srv.dispose()
  srv = new ServerHarness(undefined, { DOJO_GO_BIN: '/nonexistent/go' })
  await srv.start()
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p62')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText("Go isn't installed: install it with brew install go")
  expect((await fetch(`${srv.url}/db/health`)).status).toBe(200)
  await ctx.close()
})

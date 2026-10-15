import { devices, expect, test, webkit, type Browser, type Page } from '@playwright/test'
import { CLOCK, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// The iOS Simulator alignment pass (reports/sim-align/dojo/report.md, Controller ruling 18), reproduced where possible
// in Playwright WebKit with the iPhone device descriptor (touch: `pointer: coarse`).
let srv: ServerHarness
let wk: Browser
test.beforeAll(async () => { wk = await webkit.launch() })
test.afterAll(async () => { await wk.close() })
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

const IPHONE = { ...devices['iPhone 13'], viewport: { width: 402, height: 874 } }

async function phoneApp(at = CLOCK.sprint1) {
  const ctx = await wk.newContext({ ...IPHONE, baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(at))
  await page.goto(`/#writer=${srv.token()}`)
  const date = page.getByRole('textbox', { name: 'Start date' })
  await date.fill('2026-10-05')
  await page.getByRole('button', { name: 'START · PLAN' }).click()
  await date.waitFor({ state: 'hidden' })
  await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  return { ctx, page }
}
const textEntry = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null
  return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio'].includes((a as HTMLInputElement).type)))
})

test('F2 / F3: the design-session Discard dialog keeps a 16 px gutter on the iPhone and touch opens no keyboard', async () => {
  // F1 (Plan dialog rows growing with their labels) is retired with the Plan dialog (README Retired "plan-dialog"); the gutter and
  // the no-keyboard rule are the house Dialog's, so they are pinned on the dialog that survives.
  const { ctx, page } = await phoneApp()
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  await page.goto('/designs/session/d-ratelimit')
  await page.getByTestId('design-mode-skip-ai').check()
  await page.getByTestId('session-start').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await page.getByTestId('session-discard').tap()
  const dlg = page.getByRole('dialog', { name: 'Discard this session?' })
  await dlg.waitFor()
  expect(await textEntry(page), 'focus on a text field').toBe(false) // F3
  const b = (await dlg.boundingBox())!
  expect(Math.round(b.x)).toBe(16) // F2
  expect(Math.round(402 - (b.x + b.width))).toBe(16)
  await ctx.close()
})

test('F4: a column-0 current cell is never hidden under the sticky row-index column', async () => {
  const { ctx, page } = await phoneApp()
  const code = 'package main\n\nimport "dojo/tk"\n\nfunc uniquePaths(m int, n int) int {\n\tt := tk.Table("dp", m, n)\n\tfor i := 0; i < m; i++ {\n\t\tfor j := 0; j < n; j++ {\n\t\t\tif i == 0 || j == 0 {\n\t\t\t\tt.Set(i, j, 1)\n\t\t\t} else {\n\t\t\t\tt.Set(i, j, t.Get(i-1, j)+t.Get(i, j-1), tk.Dep(i-1, j), tk.Dep(i, j-1))\n\t\t\t}\n\t\t}\n\t}\n\treturn t.Get(m-1, n-1)\n}\n'
  await page.goto('/do/p62')
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p62')?.source, { timeout: 5000 }).toBe(code)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByTestId('dp-view').waitFor({ timeout: 90_000 })
  // walk to the step that writes dp[2][0] with the pane scrolled to the far right first
  const hidden = await page.evaluate(async () => {
    const view = document.querySelector('[data-testid="dp-view"]')!
    const next = [...view.querySelectorAll('button')].find(b => b.textContent === 'Next step') as HTMLButtonElement
    const prev = [...view.querySelectorAll('button')].find(b => b.textContent === 'Previous step') as HTMLButtonElement
    for (let i = 0; i < 400 && !prev.disabled; i++) { prev.click(); await new Promise(r => setTimeout(r, 0)) }
    for (let i = 0; i < 400; i++) {
      const cur = view.querySelector('[data-testid="dp-cell-2-0"][data-state="current"]')
      if (cur) break
      const sc = view.querySelector('[data-testid="dp-table-pane"] .dp-sc') as HTMLElement | null
      if (sc) sc.scrollLeft = sc.scrollWidth
      next.click(); await new Promise(r => setTimeout(r, 0))
    }
    await new Promise(r => requestAnimationFrame(() => r(null)))
    const cell = view.querySelector('[data-testid="dp-cell-2-0"]')!.getBoundingClientRect()
    const idx = view.querySelector('[data-testid="dp-table-pane"] .dp-row')!.getBoundingClientRect()
    return Math.round(idx.right - cell.left)
  })
  expect(hidden, 'px of the current cell under the index column').toBeLessThanOrEqual(0)
  await ctx.close()
})

test('F7: an idle read-only page reads "Read-only" in warn, not "Not saved to disk"', async () => {
  const w = await phoneApp()
  await w.ctx.close()
  const ctx = await wk.newContext({ ...IPHONE, baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  await page.goto('/')
  const status = page.getByTestId('save-status')
  await expect(status).toHaveText('Read-only', { timeout: 15_000 })
  expect(await status.evaluate(e => getComputedStyle(e).color)).toBe('rgb(255, 224, 90)')
  await ctx.close()
})

import { devices, expect, test, webkit, type Browser, type Page } from '@playwright/test'
import { CLOCK, draftSprint1, learningCard, putTicket, rows, ticket } from './briefs-helpers'
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
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await date.waitFor({ state: 'hidden' })
  await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  return { ctx, page }
}
const textEntry = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null
  return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio'].includes((a as HTMLInputElement).type)))
})

test('F1 / F2 / F3: Plan dialog rows grow with their labels, the box keeps a 16 px gutter, and touch opens no keyboard', async () => {
  const { ctx, page } = await phoneApp()
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  const p200 = await ticket(srv, 'p200')
  await putTicket(srv, { ...learningCard('w-long', 'Set the routine: 25 minutes per problem, no hints until time is up; then read the editorial and write down the one idea you missed', p200.sprint) })
  await page.reload()
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  await dlg.waitFor()
  expect(await textEntry(page), 'focus on a text field').toBe(false) // F3
  const b = (await dlg.boundingBox())!
  expect(Math.round(b.x)).toBe(16) // F2
  expect(Math.round(402 - (b.x + b.width))).toBe(16)
  const overlaps = await dlg.getByTestId('study-cards').locator('label.sr-choice').evaluateAll(ls => { // F1
    const r = ls.map(l => l.getBoundingClientRect())
    const out: string[] = []
    for (let i = 1; i < r.length; i++) if (r[i].top < r[i - 1].bottom - 0.5) out.push(`row ${i} overlaps by ${Math.round(r[i - 1].bottom - r[i].top)}`)
    const spans = ls.map(l => [l.getBoundingClientRect(), (l.querySelector('span') as HTMLElement).getBoundingClientRect()] as const)
    for (const [row, span] of spans) if (span.bottom > row.bottom + 0.5) out.push('label text overflows its row')
    return out
  })
  expect(overlaps).toEqual([])
  await ctx.close()
})

test('F3: on touch, Split, End session and focus mode open without focusing a text field', async () => {
  const { ctx, page } = await phoneApp()
  await draftSprint1(page)
  await page.goto('/do/m1w1i1')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  await page.getByRole('dialog', { name: 'Split into sessions' }).waitFor()
  expect(await textEntry(page), 'split').toBe(false)
  await page.keyboard.press('Escape')
  await page.getByTestId('start-session').click()
  await page.getByTestId('plan-start').click()
  await page.getByTestId('session-panel').waitFor()
  await page.getByTestId('session-focus').click()
  await page.getByTestId('focus-screen').waitFor()
  expect(await textEntry(page), 'focus mode').toBe(false)
  await page.getByTestId('session-end').click()
  await page.getByTestId('end-dialog').waitFor()
  expect(await textEntry(page), 'end session').toBe(false)
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

test('F9 / F8: Split opens on a started card (parts in Todo, parent stays Doing) and never shows without a brief', async () => {
  const { ctx, page } = await phoneApp()
  await putTicket(srv, { ...learningCard('w-started', 'Started reading'), estMin: 180 })
  await page.reload()
  await draftSprint1(page)
  await putTicket(srv, { ...(await ticket(srv, 'w-started')), status: 'doing' })
  await page.reload()
  await page.goto('/do/w-started')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.waitFor()
  await sp.getByLabel('Parts').fill('2')
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'w-started')).children?.length).toBe(2)
  const parent = await ticket(srv, 'w-started')
  expect(parent.status).toBe('doing')
  for (const k of parent.children) expect(await ticket(srv, k)).toMatchObject({ status: 'todo', sprint: parent.sprint })
  await page.goto('/do/p62')
  await page.getByTestId('code-editor').waitFor()
  await expect(page.getByRole('button', { name: 'Split into sessions' })).toHaveCount(0)
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

test('F11: Board cards never start a text selection (long press drags)', async () => {
  const { ctx, page } = await phoneApp()
  await page.goto('/board')
  const card = page.locator('article.card').first()
  await card.waitFor()
  expect(await card.evaluate(e => getComputedStyle(e).webkitUserSelect || getComputedStyle(e).userSelect)).toBe('none')
  // -webkit-touch-callout is iOS-only (desktop WebKit drops it); it rides on the same .card rule
  expect(await card.getAttribute('draggable')).toBe('true')
  await ctx.close()
})

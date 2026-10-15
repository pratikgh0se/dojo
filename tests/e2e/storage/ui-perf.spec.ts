import { chromium, expect, test, type Page } from '@playwright/test'
import { openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// The quiet-machine perf diagnostic (reports/perf/dojo-perf-visualizer.md, c4a0a78): idle screens must stay idle.
// The P2 Today-avatar frame-rate test stays retired; the throttle itself is unit tested (tests/unit/stage-throttle.test.ts) and the
// Pom card is back on Today (TODAY-50). The P1 request-budget tests, the P2 trace hint and the P3 favicon are unchanged.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 300_000 })

async function apiRequestsWhileIdle(page: Page, ms: number): Promise<string[]> {
  const seen: string[] = []
  const on = (r: { url: () => string }) => { const u = new URL(r.url()); if (/^\/(db|tools|ai)\//.test(u.pathname)) seen.push(u.pathname) }
  page.on('request', on)
  await page.waitForTimeout(ms)
  page.off('request', on)
  return seen
}

test('P1: Settings is idle: at most 2 /db/* requests in 3 s', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/settings')
  await page.getByRole('region', { name: 'Backups' }).getByRole('listitem').first().waitFor()
  await page.waitForTimeout(500)
  const seen = await apiRequestsWhileIdle(page, 3000)
  expect(seen.length, seen.slice(0, 5).join(', ')).toBeLessThanOrEqual(2)
  await ctx.close()
})

test('P1: a paused library picture player does not keep re-laying itself out; its box is stable', async () => {
  // real scrollbars (headless Chromium hides them by default, which hides the loop: a 15 px scrollbar toggling)
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const { ctx, page } = await openApp(browser, srv)
  for (const [w, pattern] of [[1280, 'binary-search'], [834, 'binary-search'], [834, 'shortest-path'], [393, 'shortest-path']] as const) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto(`/atlas?pattern=${pattern}`)
    await page.getByTestId('atlas-detail').getByRole('button', { name: 'Play', exact: true }).first().click()
    const player = page.locator('.lab-player').first()
    await player.waitFor()
    await player.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.waitForTimeout(1000)
    const r = await player.evaluate(async el => {
      const host = el.querySelector('sr-algo, sr-algo2') as HTMLElement
      let n = 0
      const ro = new ResizeObserver(() => { n++ })
      ro.observe(el); if (host) ro.observe(host)
      const heights = new Set<number>()
      const end = performance.now() + 2000
      await new Promise<void>(res => { const f = () => { heights.add(Math.round(el.getBoundingClientRect().height)); if (performance.now() < end) requestAnimationFrame(f); else res() }; requestAnimationFrame(f) })
      ro.disconnect()
      return { callbacks: n, heights: [...heights] }
    })
    expect(r.heights.length, `${w} ${pattern} ${JSON.stringify(r.heights)}`).toBe(1)
    expect(r.callbacks, `${w} ${pattern}`).toBeLessThanOrEqual(2) // the observers' own first callbacks
  }
  await ctx.close()
  await browser.close()
})

test('P2: a passing run without dojo/tk calls says how to get the trace', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const plain = 'package main\n\nfunc numDecodings(s string) int {\n\tif s == "12" {\n\t\treturn 2\n\t}\n\treturn 3\n}\n'
  await page.goto('/do/p91')
  await page.getByRole('textbox', { name: 'Code' }).fill(plain)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p91')?.source, { timeout: 5000 }).toBe(plain)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/^Passed/, { timeout: 90_000 })
  await expect(page.getByTestId('trace-hint')).toHaveText('No trace yet: call tk.Table / tk.Set in your solution to see the DP picture.')
  await expect(page.getByTestId('dp-view')).toHaveCount(0)
  await ctx.close()
})

test('P3: the page has a favicon that loads', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const href = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(href).toBeTruthy()
  const res = await page.request.get(new URL(href!, srv.url).toString())
  expect(res.status()).toBe(200)
  await ctx.close()
})

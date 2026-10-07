import { statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the code-blind Electron UAT run 3 (dojo-acceptance/reports/uat/dojo-electron-r3.md, e9148d2).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })

test('r3 P2: Draft briefs that drafts nothing says Failed, none of N and how to sign in, and stays until dismissed', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv, undefined, c => c.addInitScript(() => { localStorage.setItem('dojo-ai-fake-fail', 'brief:claude_signed_out') }))
  await page.goto('/board')
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Failed')
  await expect(page.getByTestId('brief-failed')).toHaveText(/^None of the \d+ cards could be drafted\.$/)
  const err = page.getByTestId('ai-error')
  await expect(err).toContainText("Claude Code isn't signed in. Open Terminal, run claude, sign in, then try again.")
  await expect(err.locator('code', { hasText: /^claude$/ })).toBeVisible()
  await expect(page.getByTestId('ai-error-detail')).toHaveText('claude_signed_out: fake brief unavailable')
  // leave the Board and come back: the outcome is still there
  await tab(page, 'Today').click()
  await page.waitForURL(/\/$/)
  await tab(page, 'Board').click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Failed')
  await expect(page.getByTestId('brief-failed')).toHaveText(/^None of the \d+ cards could be drafted\.$/)
  // a relaunch keeps the origin, so a reload stands in for it
  await page.reload()
  await expect(page.getByTestId('brief-progress')).toHaveText('Failed')
  await expect(page.getByTestId('ai-error')).toBeVisible()
  await page.getByTestId('brief-dismiss').click()
  await expect(page.getByTestId('brief-progress')).toHaveCount(0)
  await expect(page.getByTestId('brief-failed')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Draft briefs for Sprint 1' })).toBeEnabled()
  await expect(page.getByTestId('brief-progress')).toHaveCount(0)
  await ctx.close()
})

test("r3 P2: a partly failed run says how many of how many were drafted; never \"the others were\"", async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const queue = (await rows(srv, 'tickets')).filter(t => t.sprint === 1 && t.status !== 'done' && !t.archived && !t.brief)
  expect(queue.length).toBeGreaterThan(2)
  await page.evaluate(id => localStorage.setItem('dojo-ai-fake-fail', `brief@${id}`), queue[0].id as string)
  await page.goto('/board')
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Done', { timeout: 60_000 })
  await expect(page.getByTestId('brief-failed')).toHaveText(`${queue.length - 1} of ${queue.length} drafted; 1 couldn't be.`)
  await expect(page.getByTestId('brief-failed')).not.toContainText('the others')
  await expect(page.getByTestId('ai-error-detail')).toHaveText('claude_failed: fake brief unavailable')
  await ctx.close()
})

const P91_PY = `def numDecodings(s: str) -> int:
    prev2, prev1 = 1, (0 if s[0] == '0' else 1)
    for i in range(2, len(s) + 1):
        cur = 0
        if s[i - 1] != '0':
            cur += prev1
        if s[i - 2] == '1' or (s[i - 2] == '2' and s[i - 1] <= '6'):
            cur += prev2
        prev2, prev1 = prev1, cur
    return prev1
`

test('r3 J4 (P3): warm Python runs stay fast: 5 in a row, each under 1 s', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p91')
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Python' }).check()
  await page.getByRole('textbox', { name: 'Code' }).fill(P91_PY)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p91' && r.lang === 'py')?.source, { timeout: 5000 }).toBe(P91_PY)
  const status = page.getByTestId('run-status')
  const runButton = page.getByRole('button', { name: 'Run', exact: true })
  await runButton.click()
  await expect(status).toHaveText('Passed 2/2', { timeout: 60_000 }) // the first run loads Python
  // every change of the status line, and every Run click, with the page's own clock
  await page.evaluate(() => {
    const w = window as unknown as { __runLog: [number, string][] }
    w.__runLog = []
    const s = document.querySelector('[data-testid="run-status"]')!
    new MutationObserver(() => w.__runLog.push([performance.now(), s.textContent ?? ''])).observe(s, { childList: true, characterData: true, subtree: true })
    document.addEventListener('click', e => { if ((e.target as Element).closest('button')?.textContent?.trim() === 'Run') w.__runLog.push([performance.now(), 'CLICK']) }, true)
  })
  const lastRunMs = () => page.evaluate(() => {
    const log = (window as unknown as { __runLog: [number, string][] }).__runLog
    const c = log.map(x => x[1]).lastIndexOf('CLICK')
    const done = log.slice(c + 1).find(x => x[1] === 'Passed 2/2')
    return c >= 0 && done ? Math.round(done[0] - log[c][0]) : null
  })
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(300) // about how fast a person clicks Run again after reading the result
    await runButton.click()
    await expect.poll(lastRunMs, { timeout: 10_000 }).not.toBeNull()
    times.push((await lastRunMs())!)
  }
  console.log(`warm Python runs (ms): ${times.join(', ')}`)
  for (const t of times) expect(t).toBeLessThan(1000)
  await ctx.close()
})

test('r3 J8 (P3): the daily snapshot is listed at the time it was taken, not 00:00 from its name', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/settings')
  const daily = page.getByTestId('backup-list').locator('li', { hasText: /dojo-\d{4}-\d{2}-\d{2}\.db/ })
  await expect(daily).toHaveCount(1)
  const file = ((await daily.textContent()) ?? '').match(/dojo-\d{4}-\d{2}-\d{2}\.db/)![0]
  const taken = statSync(join(srv.home, 'backups', file)).mtime
  // the page shows local (Asia/Kolkata) minutes
  const ist = new Date(taken.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ')
  await expect(daily).toContainText(ist)
  await ctx.close()
})

test('r3 J1 (P3): at 1280 "Saved" sits at the header\'s right edge, as in the mockups', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  const right = await page.evaluate(() => {
    const bar = document.querySelector('.topbar')!
    const pad = parseFloat(getComputedStyle(bar).paddingRight)
    return { edge: Math.round(bar.getBoundingClientRect().right - pad), saved: Math.round(document.querySelector('[data-testid="save-status"]')!.getBoundingClientRect().right) }
  })
  expect(Math.abs(right.saved - right.edge)).toBeLessThanOrEqual(2)
  await ctx.close()
})

test('r3 J7 (P3): a Board card at 1280 keeps Pin + Move to sprint… on one row and its reserved rail on one more', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.goto('/board')
  const card = page.getByTestId('col-todo').locator('article').first()
  const rows = await card.evaluate(c => {
    const rowsOf = (sel: string) => new Set([...c.querySelectorAll(`${sel} > *`)].map(b => Math.round(b.getBoundingClientRect().top))).size
    return { tools: rowsOf('.bd-tools'), rail: rowsOf('.rail'), height: Math.round(c.getBoundingClientRect().height) }
  })
  expect(rows.tools).toBe(1)
  expect(rows.rail).toBe(1)
  // was about 290 with two rows each. Since UAT cu-3 P3-2 the card also keeps the "Pinned" chip's place (a card whose one source chip
  // leaves no room for it beside it holds one more, empty, chip line), so that pinning never makes it taller: about 241 here.
  expect(rows.height).toBeLessThan(260)
  await ctx.close()
})

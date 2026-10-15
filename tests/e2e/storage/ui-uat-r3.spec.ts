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

test('r3 J1 (P3): at 1280 "Saved" sits in the right-hand cluster of the shell header: after the search, before the level chip, the gear at the right edge', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  // The old `.topbar` with "Saved" on its right edge is the 48 px `shell-header` now (SHELL-07): search, then the save state, the one
  // level/XP chip, and the gear closing the row at the header's right padding edge.
  const g = await page.evaluate(() => {
    const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
    const bar = document.querySelector('[data-testid="shell-header"]')!
    const pad = parseFloat(getComputedStyle(bar).paddingRight)
    return {
      edge: Math.round(bar.getBoundingClientRect().right - pad), gear: Math.round(r('shell-gear').right),
      searchRight: Math.round(r('shell-search').right), savedLeft: Math.round(r('save-status').left), savedRight: Math.round(r('save-status').right),
      levelLeft: Math.round(r('level').left), inside: bar.contains(document.querySelector('[data-testid="save-status"]')),
    }
  })
  expect(g.inside).toBe(true)
  expect(Math.abs(g.gear - g.edge)).toBeLessThanOrEqual(2)
  expect(g.savedLeft).toBeGreaterThanOrEqual(g.searchRight)
  expect(g.savedRight).toBeLessThanOrEqual(g.levelLeft)
  await ctx.close()
})

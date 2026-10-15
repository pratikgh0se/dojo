import { expect, test } from '@playwright/test'
import { goClient, openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the code-blind Electron UAT run 4 (dojo-acceptance/reports/uat/dojo-electron-r4.md, b7a371e), to
// controller ruling 20 (ui-foundation.md): the remaining findings (signed-out drafting, header wrap, file chips).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

test('r4 J9 (open since r3): at 375 a long ticket title wraps whole on the ticket view instead of being cut', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  // a plan watch ticket (a stage's "watch" is a `watch` ticket now); its title is the h1 `do-title` of the ticket view (TICKET-01),
  // the old sticky rail title (`.do-rail-title`, tooltip) only remains on problems (pinned by ui-do-triage A1)
  const watch = (await rows(srv, 'tickets')).find(t => t.kind === 'watch' && !t.archived && String(t.title).length > 30)!
  await page.setViewportSize({ width: 375, height: 700 })
  await goClient(page, `/do/${watch.id}`) // dojo-server answers a direct load of an id with a dot with 404
  const title = page.getByTestId('do-title')
  await expect(title).toHaveText(watch.title)
  // the whole title shows: nothing clipped, nothing wider than the page
  expect(await title.evaluate(e => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1)).toBe(true)
  // measured at rest: a screen's entrance animation (a few px of translate) is over, as in ui-uat-p3's `settled`
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  // and it wraps: it takes at least two lines at 375 (the title is longer than one line of the h1)
  const [lh, h] = await title.evaluate(e => [parseFloat(getComputedStyle(e).lineHeight), e.getBoundingClientRect().height] as const)
  expect(Math.round(h / lh)).toBeGreaterThanOrEqual(2)
  await ctx.close()
})

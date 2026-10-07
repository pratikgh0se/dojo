import { expect, test, type Locator, type Page } from '@playwright/test'
import { openApp, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'
import { GO_VF } from '../../helpers/visualSolutions'

// The remaining P3 findings of the code-blind computer-use UAT (reports/uat/dojo-computer-use.md, 28987d1).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

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
const P91_WRONG = 'package main\n\nfunc numDecodings(s string) int {\n\treturn 0\n}\n'
const P91_TABLE = `package main

import "dojo/tk"

func numDecodings(s string) int {
	t := tk.Table("dp", 1, len(s)+1)
	t.Set(0, 0, 1)
	if s == "12" {
		t.Set(0, 2, 2)
		return 2
	}
	t.Set(0, 3, 3)
	return 3
}
`

async function setCode(page: Page, id: string, code: string) {
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id)?.source, { timeout: 5000 }).toBe(code)
}

test('J3 (P3): the Do statement shows no repo path, and Today\'s watch line agrees with it', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv, '2026-10-05T10:00:00+05:30') // Monday: AI · watch, stage 00
  const ts = await rows(srv, 'tickets')
  const watch = ts.find(t => t.sprint === 1 && t.kind === 'stage' && t.session === 'watch')!
  expect(watch.text).toContain('not code to type along with') // the plan says so
  await expect(page.getByTestId('now-text')).not.toContainText('type along')
  await expect(page.getByTestId('now-text')).toHaveText(/^Watch: /)
  await page.goto(`/do/${watch.id}`)
  const st = page.locator('.statement .st-text')
  await expect(st).toContainText('these are videos, not code to type along with.')
  await expect(st).not.toContainText('brief.md')
  await expect(st).not.toContainText('forge/')
  await ctx.close()
})

test('J4 (P3): results of an earlier run are marked stale once the code changes, until the next Run', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p91')
  await setCode(page, 'p91', P91_WRONG)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/^Failed/, { timeout: 90_000 })
  await expect(page.getByTestId('run-stale')).toHaveCount(0)
  await setCode(page, 'p91', P91_TABLE)
  await expect(page.getByTestId('run-stale')).toHaveText('Code changed since this run. Run it again to check.')
  await expect(page.locator('.code-results')).toHaveAttribute('data-stale', 'true')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText('Passed 2/2', { timeout: 90_000 })
  await expect(page.getByTestId('run-stale')).toHaveCount(0)
  await ctx.close()
})

test('J4 (P3): the trace narration names the case it is in', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p91')
  await setCode(page, 'p91', P91_TABLE)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText('Passed 2/2', { timeout: 90_000 })
  const view = page.getByTestId('dp-view')
  const narration = view.getByTestId('dp-narration')
  await expect(narration).toHaveText(/^Case 2 of 2 \("226"\) · /) // it opens on the last step; r3: it names the input
  await view.getByTestId('dp-scrubber').focus()
  await page.keyboard.press('Home')
  await expect(narration).toHaveText(/^Case 1 of 2 \("12"\) · /)
  await ctx.close()
})

test('J4 (P3): the approach answer shows which one is chosen', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p91')
  await setCode(page, 'p91', P91_OK)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText('Passed 5/5', { timeout: 120_000 })
  await page.getByTestId('do-outcome-solved').click()
  const group = page.getByRole('group', { name: 'Which approach did you use?' })
  const other = group.getByRole('button', { name: 'Other', exact: true })
  const bg = () => other.evaluate(e => getComputedStyle(e).backgroundColor)
  const before = await bg()
  await other.click()
  await expect(other).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(bg).not.toBe(before)
  const first = group.getByRole('button').first()
  await first.click()
  await expect(other).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(bg).toBe(before)
  // complexity is written as maths (2^N as a superscript), not upper-cased into "2∧N"
  await expect(group.locator('sup').first()).toBeVisible()
  await ctx.close()
})

test('J5 (P3, cu-r2 A2#24): the heap pane is the array then the tree, with no helper lines', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 393, height: 900 })
  await page.goto('/do/p743')
  await setCode(page, 'p743', GO_VF.vf01[1])
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText('Passed 5/5', { timeout: 120_000 })
  const view = page.getByTestId('dp-view')
  const scrub = view.getByTestId('dp-scrubber')
  await scrub.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 200 && (await view.getByTestId('heap-slot-0').count()) === 0; i++) await page.keyboard.press('ArrowRight')
  await expect(view.getByTestId('heap-slot-0')).toBeVisible()
  await expect(view.getByTestId('heap-array-label')).toHaveCount(0)
  await expect(view.getByTestId('heap-tree-label')).toHaveCount(0)
  await ctx.close()
})

test('J7 (P3): Back from a Do screen returns to the screen it was opened from (Week), else the Board', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/week')
  await page.locator('main a[href^="/do/"]').first().click()
  await page.waitForURL(/\/do\//)
  await page.getByTestId('do-back').click()
  await page.waitForURL(/\/week$/)
  // Esc leaves the same way
  await page.locator('main a[href^="/do/"]').first().click()
  await page.waitForURL(/\/do\//)
  await page.getByTestId('do-title').waitFor()
  await page.keyboard.press('Escape')
  await page.waitForURL(/\/week$/)
  // a Do screen opened directly (a link, a reload) still goes to the Board
  await page.goto('/do/p91')
  await page.getByTestId('do-back').click()
  await page.waitForURL(/\/board$/)
  await ctx.close()
})

test('J3 (re-UAT P3): Pause → Resume moves nothing: Retreat beside the plain timer, the session buttons under "Focus · paused"', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  // page coordinates (a click may scroll the page)
  const box = (sel: Locator) => sel.evaluate(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x + scrollX), Math.round(b.y + scrollY), Math.round(b.width)] })
  const near = (a: number[], b: number[]) => expect(a.every((v, i) => Math.abs(v - b[i]) <= 1), `${a} vs ${b}`).toBe(true)
  // Root cause of the old flake (40–50%): every .sr-panel mounts with the 160 ms `srin` entrance (translateY 4px → 0
  // in steps(4)). Playwright's stability check passes between two steps, so Start was clicked and `before` measured
  // while the Do panels were still up to 4 px low; the paused measurement came after the animation ended. Measure the
  // resting layout: wait until no entrance animation is running (the ≤ 1 px tolerance is unchanged).
  const settled = () => page.waitForFunction(() => document.getAnimations().every(a => (a as CSSAnimation).animationName !== 'srin' || a.playState === 'finished'))
  await page.goto('/do/p200')
  await page.getByTestId('do-title').waitFor()
  await settled()
  await page.getByTestId('do-timer-preset-25').click()
  const retreat = page.getByRole('button', { name: 'Retreat' })
  await settled()
  const before = await box(retreat)
  const pauseW = (await box(page.getByTestId('timer-pause')))[2]
  await page.getByTestId('timer-pause').click()
  await expect(page.getByTestId('timer-resume')).toBeVisible()
  near(await box(retreat), before)
  near([(await box(page.getByTestId('timer-resume')))[2]], [pauseW])
  await expect(page.getByTestId('timer-resume')).toHaveText('Resume')
  // the study session, in its narrow side column
  await retreat.click()
  await page.getByTestId('start-session').click()
  await page.getByTestId('plan-start').click()
  await page.getByTestId('session-timer').waitFor()
  await settled() // the session panel's entrance animation (a few px of translate) is over
  // UAT cu-4 P3-18: D3.6 has no Pause in the panel; Focus mode and End session are full width of the 220 px column, stacked
  await expect(page.getByTestId('session-pause')).toHaveCount(0)
  const focusBtn = await box(page.getByTestId('session-focus'))
  const endBtn = await box(page.getByTestId('session-end'))
  const side = await box(page.locator('.study-side'))
  near([focusBtn[0], focusBtn[2]], [side[0], side[2]])
  near([endBtn[0], endBtn[2]], [side[0], side[2]])
  expect(endBtn[1]).toBeGreaterThan(focusBtn[1] + 30) // stacked: End session is under Focus mode
  await ctx.close()
})

test('J7 (re-UAT P3): a mouse click on a Board card opens it; a drag still moves it', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/board')
  // a drag moves the card and opens nothing (a card near the top: a drag across a scroll is a Playwright artefact,
  // it scrolls to the target between press and move)
  const top = page.getByTestId('col-todo').locator('article.card').filter({ hasNot: page.getByTestId('do-m1w1i1') }).first()
  await top.waitFor()
  const id = (await top.getAttribute('data-testid'))!.replace(/^card-/, '')
  await top.dragTo(page.getByTestId('col-doing'), { sourcePosition: { x: 24, y: 12 }, targetPosition: { x: 40, y: 60 } })
  await expect.poll(async () => (await ticket(srv, id)).status).toBe('doing')
  await expect(page).toHaveURL(/\/board$/)
  // a click opens it
  await page.getByTestId('card-m1w1i1').locator('.card-title').click()
  await page.waitForURL(/\/do\/m1w1i1$/)
  await ctx.close()
})

test('J7 (re-UAT P3): hovering a Board card shows its rail without moving anything: the cards below keep their boxes', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv) // 1280 wide: the rail shows on hover only
  await page.goto('/board')
  const cards = page.getByTestId('col-todo').locator('article.card')
  await cards.nth(3).waitFor()
  const rects = () => cards.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)] }))
  await page.mouse.move(5, 5)
  const before = await rects()
  for (let i = 0; i < 3; i++) {
    const card = cards.nth(i)
    await expect(card.locator('.rail')).toBeHidden()
    await card.hover({ position: { x: 20, y: 10 } })
    await expect(card.locator('.rail')).toBeVisible()
    expect(await rects(), `hovering card ${i}`).toEqual(before)
  }
  await ctx.close()
})

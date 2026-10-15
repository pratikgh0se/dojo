import { expect, test, type Locator, type Page } from '@playwright/test'
import { learningCard, openApp, putTicket, rows } from './briefs-helpers'
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

test('J3 (P3): the ticket view\'s statement shows no repo path (the plan text says the references are videos)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  // The plan's own tickets no longer carry the forge brief path (the 00-setup stage is gone), so the case is seeded the way the plan
  // used to write it: the text ends with "The brief is forge/stages/00-setup/brief.md". Today's NOW line (`now-text`) is retired
  // (README Retired "Old Today panels"); the ticket view's statement is the one place the text shows (TICKET-14, `ticket-statement`).
  await putTicket(srv, {
    ...learningCard('stage-00-watch', 'Watch the setup walkthroughs'),
    text: 'Watch the three videos in order; these are videos, not code to type along with. The brief is forge/stages/00-setup/brief.md',
  })
  await page.goto('/do/stage-00-watch')
  const st = page.getByTestId('ticket-statement')
  await expect(st).toContainText('these are videos, not code to type along with.')
  await expect(st).not.toContainText('brief.md')
  await expect(st).not.toContainText('forge/')
  await expect(page.getByTestId('do-screen')).not.toContainText('brief.md')
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

/** Starts p200 and returns a box() of any control in page coordinates, once the entrance animations are over. */
async function timerRow(page: Page) {
  // page coordinates (a click may scroll the page)
  const box = (sel: Locator) => sel.evaluate(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x + scrollX), Math.round(b.y + scrollY), Math.round(b.width)] })
  // Root cause of the old flake (40–50%): every .sr-panel mounts with the 160 ms `srin` entrance (translateY 4px → 0
  // in steps(4)). Playwright's stability check passes between two steps, so Start was clicked and `before` measured
  // while the Do panels were still up to 4 px low; the paused measurement came after the animation ended. Measure the
  // resting layout: wait until no entrance animation is running (the ≤ 1 px tolerance is unchanged).
  const settled = () => page.waitForFunction(() => document.getAnimations().every(a => (a as CSSAnimation).animationName !== 'srin' || a.playState === 'finished'))
  await page.goto('/do/p200')
  await page.getByTestId('do-title').waitFor()
  await settled()
  await page.getByTestId('ticket-start').click() // the one start (TICKET-03); "Retreat" and the Plan dialog are retired
  await page.getByTestId('timer-pause').waitFor()
  await settled()
  return box
}
const near = (a: number[], b: number[]) => expect(a.every((v, i) => Math.abs(v - b[i]) <= 1), `${a} vs ${b}`).toBe(true)

test('J3 (re-UAT P3): Pause → Resume moves nothing: End session stays put beside the one timer\'s button', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const box = await timerRow(page)
  const end = page.getByTestId('session-end')
  const before = await box(end)
  await page.getByTestId('timer-pause').click()
  await expect(page.getByTestId('timer-resume')).toBeVisible()
  near(await box(end), before)
  await expect(page.getByTestId('timer-resume')).toHaveText('Resume')
  await ctx.close()
})

test('J3 (re-UAT P3): Pause and Resume are one width (TicketTimer sizes both with Sized, as the pill does)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const box = await timerRow(page)
  const pauseW = (await box(page.getByTestId('timer-pause')))[2]
  await page.getByTestId('timer-pause').click()
  await expect(page.getByTestId('timer-resume')).toBeVisible()
  near([(await box(page.getByTestId('timer-resume')))[2]], [pauseW])
  await ctx.close()
})

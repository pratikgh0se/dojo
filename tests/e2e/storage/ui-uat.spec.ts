import { chromium, expect, test, type Page } from '@playwright/test'
import { openApp, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'
import { GO_VF } from '../../helpers/visualSolutions'

const P91_MEMO_TABLE = `package main

import "dojo/tk"

var memo map[int]int
var t *tk.Tab

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
	t.Set(0, i, v)
	tk.Exit(v)
	return v
}

func numDecodings(s string) int {
	memo = map[int]int{}
	t = tk.Table("dp", 1, len(s)+1)
	tk.Link("f", "dp")
	f(len(s))
	if s == "12" {
		return 2
	}
	return 3
}
`

// The code-blind computer-use UAT of the installed app (reports/uat/dojo-computer-use.md, 28987d1).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 300_000 })

/** Steps a player through every step and returns each step's frame box and Step-forward box. */
async function stepThrough(page: Page, region: ReturnType<Page['locator']>) {
  const fwd = region.getByRole('button', { name: 'Step forward', exact: true })
  const counter = region.getByTestId('lab-step-counter')
  const n = Number(((await counter.textContent()) ?? '').match(/\/ (\d+)/)![1])
  const boxes: { svg: number[]; btn: number[] }[] = []
  for (let k = 0; k <= n; k++) {
    await expect(counter).toHaveText(`STEP ${k} / ${n}`)
    await page.waitForTimeout(30)
    boxes.push(await region.evaluate(el => {
      const host = el.querySelector('sr-algo, sr-algo2') as HTMLElement
      const svg = host.shadowRoot!.querySelector('.stage > svg') as SVGSVGElement
      const r = svg.getBoundingClientRect()
      const b = [...el.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Step forward')!.getBoundingClientRect()
      return { svg: [r.width, r.height, r.x - el.getBoundingClientRect().x], btn: [b.x - el.getBoundingClientRect().x, b.y - el.getBoundingClientRect().y] }
    }))
    if (k < n) await fwd.click()
  }
  return boxes
}

test('J6 (P1): the DSA picture player keeps one scale and the controls never move while stepping (real scrollbars)', async () => {
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [1280, 834, 393]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/dsa?topic=7')
    const warm = page.getByRole('region', { name: 'Warm-up', exact: true })
    await expect(warm.getByRole('group', { name: 'Warm-up walkthroughs' }).getByRole('button', { pressed: true })).toHaveText('Memoization · fib(5)')
    const player = warm.getByTestId('lab-player')
    await player.waitFor()
    await page.waitForTimeout(500)
    const boxes = await stepThrough(page, player)
    const first = boxes[0]
    const off = boxes.map((b, k) => ({ k, b })).filter(({ b }) => b.svg.some((v, i) => Math.abs(v - first.svg[i]) > 1) || b.btn.some((v, i) => Math.abs(v - first.btn[i]) > 1))
    expect(off.slice(0, 3).map(o => `${w} step ${o.k}: ${JSON.stringify(o.b)} vs ${JSON.stringify(first)}`)).toEqual([])
  }
  await ctx.close()
  await browser.close()
})

test('J6 (re-UAT P2): the picture pane keeps one width, and the caption and variables stay in place, from step 0 to 10 (real scrollbars)', async () => {
  const real = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const { ctx, page } = await openApp(real, srv)
  for (const w of [1280, 834]) {
    await page.setViewportSize({ width: w, height: 860 })
    await page.goto('/dsa?topic=7')
    const warm = page.getByRole('region', { name: 'Warm-up', exact: true })
    const player = warm.getByTestId('lab-player')
    await player.waitFor()
    await page.waitForTimeout(400)
    const fwd = player.getByRole('button', { name: 'Step forward', exact: true })
    const seen: string[] = []
    for (let k = 0; k <= 10; k++) {
      await expect(player.getByTestId('lab-step-counter')).toHaveText(new RegExp(`^STEP ${k} /`))
      await page.waitForTimeout(60)
      seen.push(JSON.stringify(await player.evaluate(el => {
        const host = el.querySelector('sr-algo, sr-algo2') as HTMLElement
        const stage = host.shadowRoot!.querySelector('.stage') as HTMLElement
        const box = (q: string) => { const e = el.querySelector(q); return e ? Math.round(e.getBoundingClientRect().height) : -1 }
        return {
          pane: stage.clientWidth, scrolls: stage.scrollWidth > stage.clientWidth + 1,
          wide: host.shadowRoot!.querySelector('.wrap')!.classList.contains('wide'),
          caption: box('[data-testid="lab-caption"]'), vars: box('.lab-vars'),
        }
      })))
      if (k >= 2) await expect(player.locator('.lab-vars dt').first()).toHaveText('n') // the variable stays shown
      if (k < 10) await fwd.click()
    }
    expect(new Set(seen).size, `${w}: ${seen.join(' ')}`).toBe(1)
    expect(JSON.parse(seen[0]).scrolls, `${w}: the frame fits its pane`).toBe(false)
  }
  await ctx.close()
  await real.close()
})

test('J3 (P2): Pause keeps the ticket timer where it is; Resume continues from there; a pause from the pill holds across a page load', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p200')
  await page.getByTestId('ticket-start').click() // the one start (TICKET-03): the presets and the Plan dialog are retired
  const readout = page.getByTestId('timer-readout')
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await page.waitForTimeout(1500)
  await page.getByTestId('timer-pause').click()
  await expect(page.getByTestId('timer-state')).toHaveText('paused')
  const at = await readout.textContent()
  expect(at).toMatch(/^24:5\d$/)
  await expect(page.getByTestId('ticket-start')).toHaveCount(0) // no reset to a start
  await page.waitForTimeout(2500)
  await expect(readout).toHaveText(at!)
  await page.getByTestId('timer-resume').click()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect.poll(async () => await readout.textContent(), { timeout: 5000 }).not.toBe(at)
  // UAT cu-4 P3-18: the card's timer has its own Pause; a running session is also paused from its pill, on any other screen
  const doUrl = page.url()
  await page.getByTestId('do-back').click()
  await page.getByTestId('session-pill-pause').click()
  await page.goto(doUrl)
  await expect(page.getByTestId('timer-state')).toHaveText('paused')
  const held = await readout.textContent()
  await page.waitForTimeout(2500)
  await expect(readout).toHaveText(held!)
  await page.getByTestId('timer-resume').click()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect.poll(async () => await readout.textContent(), { timeout: 5000 }).not.toBe(held)
  await ctx.close()
})

test('J3 / J7 (P2): Today\'s quest card names exactly the ticket Start opens (and again after that ticket is done)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  // The NOW tile ("This sprint" drawer, `now-headline`, `now-eyebrow`) is the quest card now (README Retired "Old Today panels"):
  // `today-title` and `today-kind` name what `start-button` opens (TODAY-01/TODAY-24, TICKET-01).
  const startTarget = async () => {
    await page.goto('/')
    await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
    const title = ((await page.getByTestId('today-title').textContent()) ?? '').trim()
    const kind = ((await page.getByTestId('today-kind').textContent()) ?? '').trim()
    await page.getByTestId('start-button').click()
    await page.waitForURL(/\/do\//)
    const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)
    return { title, kind, id }
  }
  const first = await startTarget()
  await expect(page.getByTestId('do-title')).toHaveText(first.title)
  await expect(page.getByTestId('ticket-kind')).toHaveText(first.kind)
  // finish it in the app (a direct server write races the reload's local copy)
  await page.getByTestId('ticket-done').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await expect.poll(async () => (await ticket(srv, first.id)).status).toBe('done')
  const second = await startTarget()
  expect(second.id).not.toBe(first.id)
  await expect(page.getByTestId('do-title')).toHaveText(second.title)
  await expect(page.getByTestId('ticket-kind')).toHaveText(second.kind)
  await ctx.close()
})

test('P2 scroll: a new screen opens at the top (DSA -> Do, Path); Back returns to where it was', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 393, height: 700 })
  await page.goto('/dsa?topic=2')
  await page.getByTestId('topic-detail').waitFor()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const deep = await page.evaluate(() => window.scrollY)
  expect(deep).toBeGreaterThan(200)
  await page.getByTestId('topic-detail').locator('a[href^="/do/"]').last().click()
  await page.waitForURL(/\/do\//)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0) // DSA -> Do
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  // UAT J7: Do's Back returns to the screen it came from, where it was
  await page.getByTestId('do-back').click()
  await page.waitForURL(/\/dsa/)
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(200)
  await page.getByTestId('shell-nav-path').click() // the Board is retired (SHELL-21); Path is the new screen
  await page.waitForURL(/\/path$/)
  await expect(page.getByTestId('screen-path')).toHaveAttribute('data-ready', 'true')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0) // a new screen
  await page.goBack()
  await page.waitForURL(/\/dsa/)
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(200) // Back restores
  await ctx.close()
})

// TICKET-01: do-back returns to the previous screen in history. The contracts have no scroll clause for Path, so this asserts the
// destination and that the Path list is there again, not a scroll offset.
test('P2 (Path): a ticket opened from a Path row; do-back returns to /path with the list present', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 393, height: 700 })
  await page.getByTestId('shell-nav-path').click()
  await page.waitForURL(/\/path$/)
  await expect(page.getByTestId('screen-path')).toHaveAttribute('data-ready', 'true')
  const link = page.locator('[data-testid^="do-"][data-content="plan"]').first()
  const testid = (await link.getAttribute('data-testid'))!
  const id = testid.slice('do-'.length)
  const row = page.getByTestId(`row-${id}`)
  await row.hover() // the quiet Start shows on hover or focus (PATH-16)
  await page.getByTestId(`path-row-start-${id}`).click()
  await page.waitForURL(new RegExp(`/do/${encodeURIComponent(id)}$`))
  await expect(page.getByTestId('screen-do')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0) // a new screen opens at the top
  await page.getByTestId('do-back').click()
  await page.waitForURL(/\/path$/)
  await expect(page.getByTestId('screen-path')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId(`row-${id}`)).toBeVisible() // the list is back (the started ticket now sits in Doing)
  await expect(page.getByTestId('path-doing')).toBeVisible()
  await ctx.close()
})

test('J4 / J5 (P2): stepping a trace (across a case boundary too) never moves its controls, even scrolled to the bottom', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 1280, height: 1300 }) // the whole trace in view with the page at its bottom
  for (const [id, code, mode] of [['p743', GO_VF.vf01[1], 'Submit'], ['p91', P91_MEMO_TABLE, 'Run']] as const) {
    await page.goto(`/do/${id}`)
    await page.getByRole('textbox', { name: 'Code' }).fill(code)
    await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id && (r.lang ?? 'go') === 'go')?.source, { timeout: 5000 }).toBe(code)
    await page.getByRole('button', { name: mode, exact: true }).click()
    await expect(page.getByTestId('run-status')).toHaveText(/^Passed/, { timeout: 120_000 })
    const view = page.getByTestId('dp-view')
    await view.waitFor()
    // like the tester: the page scrolled to the bottom, the pointer resting on Previous step, clicking again and again
    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(300)
    const prev = view.locator('.dp-prev')
    const n = Number(((await view.getByTestId('dp-step-counter').textContent()) ?? '').match(/\/ (\d+)/)![1])
    const rectOf = (sel: string) => page.evaluate(q => { const r = document.querySelector(q)!.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as const }, sel)
    let [x, y] = await rectOf('.dp-prev')
    if (y < 0 || y > page.viewportSize()!.height - 20) { await prev.scrollIntoViewIfNeeded(); [x, y] = await rectOf('.dp-prev') }
    await page.mouse.move(x, y) // the pointer rests on the button
    await page.waitForTimeout(200)
    ;[x, y] = await rectOf('.dp-prev')
    const under = (px: number, py: number) => page.evaluate(([qx, qy]) => (document.elementFromPoint(qx, qy) as HTMLElement | null)?.closest('button')?.className ?? 'none', [px, py])
    for (let i = n; i > 1; i--) {
      expect(await under(x, y), `${id} prev at step ${i}`).toContain('dp-prev')
      await page.mouse.click(x, y)
    }
    await expect(view.getByTestId('dp-step-counter')).toHaveText(`Step 1 / ${n}`)
    const [nx, ny] = await rectOf('.dp-next')
    for (let i = 1; i < n; i++) {
      expect(await under(nx, ny), `${id} next at step ${i}`).toContain('dp-next')
      await page.mouse.click(nx, ny)
    }
  }
  await ctx.close()
})

test('J4 (P3): a failing plain run (no dojo/tk calls) says how to get the trace too', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const wrong = 'package main\n\nfunc numDecodings(s string) int {\n\treturn 0\n}\n'
  await page.goto('/do/p91')
  await page.getByRole('textbox', { name: 'Code' }).fill(wrong)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p91')?.source, { timeout: 5000 }).toBe(wrong)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/^Failed/, { timeout: 90_000 })
  await expect(page.getByTestId('trace-hint')).toHaveText('No trace yet: call tk.Table / tk.Set in your solution to see the DP picture.')
  await ctx.close()
})

test('J9 (P3): Settings speaks user language: no "planVersion", no "(SQLite)"', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/settings')
  await expect(page.getByTestId('storage-status')).toHaveText(/^Storage · .*dojo\.db$/)
  await expect(page.getByTestId('plan-version')).toHaveText(/^Plan version \S+$/)
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/planVersion|SQLite/)
  await ctx.close()
})

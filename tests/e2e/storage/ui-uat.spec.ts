import { chromium, expect, test, type Page } from '@playwright/test'
import { draftSprint1, openApp, reopen, rows, ticket } from './briefs-helpers'
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

test('J3 (P2): Pause keeps the Do timer and the study-session timer where they are; Resume continues from there', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p200')
  await page.getByTestId('do-timer-preset-25').click()
  const readout = page.getByTestId('timer-panel-readout')
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await page.waitForTimeout(1500)
  await page.getByTestId('timer-pause').click()
  await expect(page.getByTestId('timer-state')).toHaveText('paused')
  const at = await readout.textContent()
  expect(at).toMatch(/^24:5\d$/)
  await expect(page.getByTestId('do-timer-preset-25')).toHaveCount(0) // no reset to the presets
  await page.waitForTimeout(2500)
  await expect(readout).toHaveText(at!)
  await page.getByTestId('timer-resume').click()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect.poll(async () => await readout.textContent(), { timeout: 5000 }).not.toBe(at)
  // the study session
  await page.getByRole('button', { name: 'Retreat' }).click()
  await page.getByTestId('start-session').click()
  await page.getByTestId('plan-start').click()
  const clock = page.getByTestId('session-timer')
  await clock.waitFor()
  await page.waitForTimeout(1500)
  // UAT cu-4 P3-18: the panel has no Pause (D3.6); a running session is paused from its pill, on any other screen
  await expect(page.getByTestId('session-pause')).toHaveCount(0)
  const doUrl = page.url()
  await page.getByTestId('do-back').click()
  await page.getByTestId('session-pill-pause').click()
  await page.goto(doUrl)
  await expect(page.getByTestId('session-phase')).toHaveText('Focus · paused')
  const held = await clock.textContent()
  await page.waitForTimeout(2500)
  await expect(clock).toHaveText(held!)
  await page.getByTestId('session-resume').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Focus')
  await expect.poll(async () => await clock.textContent(), { timeout: 5000 }).not.toBe(held)
  await ctx.close()
})

const VERB: Record<string, string> = { watch: 'Watch', rebuild: 'Rebuild', build: 'Build', teachback: 'Teach-back' }
const ROLE: Record<string, string> = { watch: 'watch', rebuild: 'rebuild', build: 'build + break', teachback: 'teach-back' }
async function startTarget(page: Page) {
  await page.goto('/')
  const headline = (await page.getByTestId('now-headline').textContent()) ?? ''
  const eyebrow = (await page.getByTestId('now-eyebrow').textContent()) ?? ''
  await page.getByTestId('start-button').click()
  await page.waitForURL(/\/do\//)
  return { headline, eyebrow, id: decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!) }
}

test('J3 / J7 (P2): the NOW tile names exactly the card Start opens (after its role card is done, and after a split: the next part); a split card is not counted twice', async ({ browser }) => {
  const MONDAY = '2026-10-05T10:00:00+05:30' // AI · watch
  const { ctx, page } = await openApp(browser, srv, MONDAY)
  const ts = await rows(srv, 'tickets')
  const watch = ts.find(t => t.sprint === 1 && t.kind === 'stage' && t.session === 'watch')!
  // finish the role card in the app (a direct server write races the reload's local copy)
  await page.getByRole('button', { name: /This sprint/ }).click()
  await page.getByTestId('drawer-tasks').getByRole('checkbox', { name: `Done: ${watch.title}` }).check()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await expect.poll(async () => (await ticket(srv, watch.id)).status).toBe('done')
  let { headline, eyebrow, id } = await startTarget(page)
  const block = headline
  let target = (await rows(srv, 'tickets')).find(t => t.id === id)!
  expect(id).not.toBe(watch.id)
  expect(headline.startsWith(VERB[target.session] ?? '?'), `${headline} vs ${target.session}`).toBe(true)
  // UAT r2 J3: the eyebrow above it names the same card (not the rotation's "AI · watch")
  expect(eyebrow.endsWith(`· ${target.track === 'ai' ? 'AI' : 'Interview'} · ${ROLE[target.session]}`), eyebrow).toBe(true)
  // split the card Start opened; Start then opens its first part, and the tile names it
  await draftSprint1(page)
  await page.goto('/board')
  const before = { n: Number(await page.getByTestId('count-todo').textContent()), min: await page.locator('.col-min').first().textContent() }
  await page.goto(`/do/${id}`)
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.getByLabel('Parts').fill('2')
  const preview = await sp.getByTestId('split-preview').textContent()
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, id)).children?.length).toBe(2)
  const parent = await ticket(srv, id)
  const parts = await Promise.all(parent.children.map((k: string) => ticket(srv, k)))
  for (const p of parts) expect(preview).toContain(`${p.estMin} min`) // the preview is what was created
  ;({ headline, eyebrow, id } = await startTarget(page))
  expect(id).toBe(parent.children[0])
  target = await ticket(srv, id)
  expect(headline.startsWith(VERB[target.session] ?? '?')).toBe(true)
  // ruling 22 D1: both open parts stand in the card's place, so the slot's block is what it was before the split
  expect(headline).toBe(block)
  await page.goto('/board')
  const sum = parts.reduce((a: number, p: { estMin: number }) => a + p.estMin, 0)
  const parentMin = parent.brief?.minutes ?? parent.estMin
  await expect(page.getByTestId('count-todo')).toHaveText(String(before.n - 1 + 2))
  const m0 = Number(before.min!.match(/(\d+) min/)![1])
  await expect(page.locator('.col-min').first()).toHaveText(` · ${m0 - parentMin + sum} min`)
  await page.goto('/')
  // ruling 20 S4: the split card counts once, as itself; its parts are not counted
  const sprintTaskCount = (await rows(srv, 'tickets')).filter(t => t.sprint === 1 && !t.archived && ['task', 'stage', 'watch', 'read'].includes(t.kind) && !t.childOf).length
  await expect(page.getByTestId('drawer-tasks')).toContainText(`This sprint · ${sprintTaskCount} tasks`)
  await ctx.close()
})

test('P2 scroll: a new screen opens at the top (DSA -> Do, the Board); Back returns to where it was', async ({ browser }) => {
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
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Board' }).click()
  await page.waitForURL(/\/board$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0) // a new screen
  await page.goBack()
  await page.waitForURL(/\/dsa/)
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(200) // Back restores
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

test('J7 (P3): Move to sprint… counts in Undo, and Undo puts the card back', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/board')
  await expect(page.getByTestId('undo')).toHaveText('Undo (0)')
  await expect(page.getByTestId('undo')).toBeDisabled()
  await page.getByTestId('card-m1w1i1').getByRole('button', { name: 'Move to sprint…' }).click()
  await page.getByRole('menuitem', { name: 'Sprint 3', exact: true }).click()
  await expect(page.getByTestId('card-m1w1i1')).toHaveCount(0)
  await expect(page.getByTestId('undo')).toHaveText('Undo (1)')
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('card-m1w1i1')).toBeVisible()
  await expect(page.getByTestId('undo')).toHaveText('Undo (0)')
  await expect(page.getByTestId('undo')).toBeDisabled()
  await expect.poll(async () => (await ticket(srv, 'm1w1i1')).sprint).toBe(1)
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

test('J3 (P3): Progress shows no projected finish until there is a week of data', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv) // Tuesday of sprint 1
  await page.getByRole('button', { name: /This sprint/ }).click()
  await page.getByTestId('drawer-tasks').getByRole('checkbox', { name: /^Done: /, checked: false }).first().check()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await page.goto('/progress')
  await expect(page.getByTestId('pace-finish')).toHaveText('—')
  await ctx.close()
  const later = await reopen(browser, srv, '2026-10-13T10:00:00+05:30') // a week after the first finished card
  await later.page.goto('/progress')
  await expect(later.page.getByTestId('pace-finish')).toHaveText(/^S\d+$/)
  await later.ctx.close()
})

test('J7 (P3): Draft briefs keeps its progress in view after you leave the Board, then says it is done', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv, undefined, c => c.addInitScript(() => { localStorage.setItem('dojo-ai-fake-delay-ms', '400') }))
  await page.goto('/board')
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText(/^Drafting \d+ of \d+/)
  await expect(page.getByTestId('draft-indicator')).toHaveCount(0) // the Board shows it inline
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click()
  await page.waitForURL(/\/$/)
  const pill = page.getByTestId('draft-indicator')
  await expect(pill.getByRole('status')).toHaveText(/^Sprint 1 · Drafting \d+ of \d+/)
  await expect(pill.getByRole('status')).toHaveText(/^Drafted \d+ briefs for Sprint 1$/, { timeout: 60_000 })
  await pill.getByRole('button', { name: 'Dismiss' }).click()
  await expect(pill).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Done') // the same run, back on the Board
  await ctx.close()
})

test('J2 (P3): the nav row never moves when the More label or the save status changes width (real scrollbars)', async () => {
  const real = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const { ctx, page } = await openApp(real, srv)
  const xs = () => page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]')!
    return [...nav.querySelectorAll('a.tab'), nav.querySelector('[data-testid="more-button"]')!].map(e => Math.round(e.getBoundingClientRect().x))
  })
  await page.goto('/')
  await page.getByTestId('now-headline').waitFor()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  const home = await xs()
  for (const path of ['/settings', '/overview', '/progress', '/map', '/week']) {
    await page.goto(path)
    await page.getByRole('heading', { level: 1 }).first().waitFor()
    await expect(page.getByTestId('save-status')).toHaveText('Saved')
    expect(await xs(), path).toEqual(home)
  }
  await page.goto('/')
  await page.getByTestId('now-headline').waitFor()
  await page.getByRole('button', { name: /This sprint/ }).click()
  const box = (n: number) => page.getByTestId('drawer-tasks').getByRole('checkbox', { name: /^Done: / }).nth(n)
  await page.route('**/db/**', async r => { await new Promise(res => setTimeout(res, 1500)); await r.continue().catch(() => {}) })
  await box(0).check()
  await expect(page.getByTestId('save-status')).toHaveText('Saving…')
  expect(await xs(), 'Saving…').toEqual(home)
  await page.unroute('**/db/**')
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 })
  await page.route('**/db/**', r => r.abort())
  await box(1).check()
  await expect(page.getByTestId('save-status')).toHaveText('Not saved to disk')
  expect(await xs(), 'Not saved to disk').toEqual(home)
  await page.unroute('**/db/**')
  await ctx.close()
  await real.close()
})

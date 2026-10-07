import { expect, test, type Browser, type Locator } from '@playwright/test'
import { CLOCK, openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// The settings-progress-ref rerun on 48cae36 (reports/ui/settings-progress-ref/findings.md, Controller ruling 11).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

const css = (l: Locator, prop: string) => l.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
const PHONE = { width: 393, height: 852 }

async function freshContext(browser: Browser, writer: boolean, state: 'fail' | 'hold') {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(CLOCK.sprint1))
  let release = () => {}
  const held = new Promise<void>(r => { release = r })
  await page.route('**/db/state', async route => {
    if (state === 'fail') return route.fulfill({ status: 500, body: '{"error":"boom"}', contentType: 'application/json' })
    await held
    await route.continue().catch(() => {})
  })
  return { ctx, page, release, url: writer ? `/#writer=${srv.token()}` : '/' }
}

test('R7 / Q10: no local copy and /db/state answering 500 shows the error card, never onboarding (writer and read-only)', async ({ browser }) => {
  const { ctx } = await openApp(browser, srv) // the server is onboarded
  await ctx.close()
  for (const writer of [true, false]) {
    for (const path of ['', 'board', 'settings', 'progress']) {
      const f = await freshContext(browser, writer, 'fail')
      await f.page.goto(writer ? `/${path}#writer=${srv.token()}` : `/${path}`)
      const fatal = f.page.locator('.fatal')
      await expect(fatal, `${writer} ${path}`).toBeVisible({ timeout: 20_000 })
      await expect(fatal.getByRole('heading', { level: 1 })).toHaveText("Dojo couldn't start")
      await expect(fatal).toContainText('Reading the saved data from the Dojo server failed.')
      await expect(fatal.locator('ol li')).toHaveCount(3)
      expect(await css(fatal.locator('.fatal-msg'), 'font-size')).toBe('15px')
      await expect(f.page.getByText('Pick your start date')).toHaveCount(0)
      await f.ctx.close()
    }
  }
})

test('F7: the loading line is Space Mono 15', async ({ browser }) => {
  const { ctx } = await openApp(browser, srv)
  await ctx.close()
  const f = await freshContext(browser, false, 'hold')
  await f.page.goto('/settings')
  const loading = f.page.locator('p.loading')
  await expect(loading).toBeVisible({ timeout: 5000 })
  expect(await css(loading, 'font-size')).toBe('15px')
  expect(await css(loading, 'font-family')).toMatch(/Space Mono/)
  f.release()
  await f.ctx.close()
})

test('Phone sizes: DSA heat cells 20 drawn / 44 hit, ticks and links 44; bank cells 44; Settings inputs and Atlas search 44', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize(PHONE)
  await page.goto('/dsa?topic=2')
  const cell = page.getByTestId('cell-p200')
  const cb = (await cell.boundingBox())!
  expect(Math.round(cb.width)).toBeGreaterThanOrEqual(44)
  expect(await cell.evaluate(e => [getComputedStyle(e, '::before').width, getComputedStyle(e, '::before').height])).toEqual(['20px', '20px'])
  const edges = async (sel: string) => page.locator(sel).evaluateAll(els => els.slice(0, 6).flatMap(c => {
    c.scrollIntoView({ block: 'center' })
    const r = c.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    return [[cx - 22, cy], [cx + 22, cy], [cx, cy - 22], [cx, cy + 22]].filter(([x, y]) => document.elementFromPoint(x, y) !== c).map(() => (c as HTMLElement).dataset.testid)
  }))
  expect(await edges('button.heat-cell:not([disabled])')).toEqual([])
  const detail = page.getByTestId('topic-detail')
  const tick = detail.locator('.tick').first()
  expect(Math.round((await tick.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  expect(Math.round((await tick.boundingBox())!.width)).toBeGreaterThanOrEqual(44)
  expect(Math.round((await detail.locator('.trow').getByRole('link', { name: /LeetCode/ }).first().boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  await page.goto('/banks')
  const bc = page.locator('[data-testid^="bank-cell-"]').first()
  const bb = (await bc.boundingBox())!
  expect(Math.round(bb.width)).toBeGreaterThanOrEqual(44)
  expect(Math.round(bb.height)).toBeGreaterThanOrEqual(44)
  expect(await edges('[data-testid^="bank-cell-"]')).toEqual([])
  const btick = page.getByTestId('bank-item-tick').first()
  const tb = (await btick.boundingBox())!
  expect([Math.round(tb.width), Math.round(tb.height)]).toEqual([20, 20])
  expect(await css(btick, 'accent-color')).toBe('rgb(255, 138, 42)')
  for (const id of ['bank-item-link', 'bank-item-inplan']) expect(Math.round((await page.getByTestId(id).first().boundingBox())!.height), id).toBeGreaterThanOrEqual(44)
  await page.goto('/settings')
  for (const name of ['Start date', 'Core minutes per sprint']) {
    const input = page.getByRole(name === 'Start date' ? 'textbox' : 'spinbutton', { name })
    expect(Math.round((await input.boundingBox())!.height), name).toBeGreaterThanOrEqual(44)
  }
  await page.goto('/atlas')
  expect(Math.round((await page.getByRole('searchbox').first().boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  await page.setViewportSize({ width: 1280, height: 900 })
  expect(Math.round((await page.getByRole('searchbox').first().boundingBox())!.height)).toBe(36)
  await ctx.close()
})

test('Smaller items: designs-hint, radar labels inside, Reviews title gap, design session 2:1, read-only status warn', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/designs')
  const hint = page.getByTestId('designs-hint')
  expect(await css(hint, 'font-size')).toBe('15px')
  expect(await css(hint, 'font-family')).toMatch(/^"?Chivo/)
  for (const w of [800, 393]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/progress')
    await page.waitForTimeout(600)
    const out = await page.getByTestId('ev-design-radar-img').evaluate(fig => {
      const host = fig.querySelector('sr-chart')!
      const box = fig.getBoundingClientRect()
      const svg = host.shadowRoot!.querySelector('svg') as SVGSVGElement
      return [...svg.querySelectorAll('text')].filter(t => {
        const b = t.getBoundingClientRect()
        return b.left < box.left - 0.5 || b.right > box.right + 0.5 || b.top < box.top - 0.5 || b.bottom > box.bottom + 0.5
      }).map(t => t.textContent)
    })
    expect(out, `${w}`).toEqual([])
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/progress')
  const gap = await page.getByRole('region', { name: 'Reviews' }).evaluate(p => {
    const h = p.querySelector('.sr-panel-title')!.getBoundingClientRect()
    const next = (p.querySelector('.sr-panel-title')!.nextElementSibling as HTMLElement).getBoundingClientRect()
    return Math.round(next.top - h.bottom)
  })
  expect(gap).toBe(12)
  await page.goto('/designs/session/d-ratelimit')
  await page.getByRole('radio', { name: 'Solo' }).check()
  await page.getByRole('button', { name: 'Start · 45 min' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  const cols = await page.locator('.ds-body').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').map(parseFloat))
  expect(cols[0] / cols[1]).toBeGreaterThan(1.85)
  expect(cols[0] / cols[1]).toBeLessThan(2.15)
  await ctx.close()
  const ro = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const rp = await ro.newPage()
  await rp.goto('/')
  const status = rp.getByTestId('save-status')
  await expect(status).toBeVisible({ timeout: 15_000 })
  expect(await css(status, 'color')).toBe('rgb(255, 224, 90)')
  const saveHint = rp.getByTestId('save-hint')
  if (await saveHint.count()) expect(await css(saveHint, 'color')).toBe('rgb(255, 224, 90)') // Q18: every read-only status text
  await ro.close()
})

test('final rerun: the study-session head shows the stored title; AI stage-row buttons have scale padding', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const t = (await rows(srv, 'tickets')).find(x => x.id === 'p91')!
  const at = new Date('2026-10-05T09:00:00+05:30').getTime()
  const res = await fetch(`${srv.url}/db/ops`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': srv.token() },
    body: JSON.stringify({ clientId: 'e2e', ops: [{ opId: 'op-ss1', tbl: 'sessions', op: 'put', id: 'ss1', at: new Date().toISOString(), doc: { id: 'ss1', ticketId: 'p91', start: at, end: at + 25 * 60_000, minutes: 25, outcome: 'studied', xpDelta: 0, endLog: { done: 'x', stuckOn: '', nextStep: '' } } }] }),
  })
  expect(res.ok).toBe(true)
  await page.goto('/progress')
  await expect(page.getByTestId('study-session-ss1').locator('.study-row-head')).toContainText(` · ${t.title} · 25 min`)
  await page.goto('/ai')
  const btn = page.getByTestId('stage-row-1')
  const pads = await btn.evaluate(e => [getComputedStyle(e).paddingTop, getComputedStyle(e).paddingBottom])
  for (const p of pads) expect(['0px', '4px', '8px']).toContain(p)
  await ctx.close()
})

test('closing rerun: the Banks "Source ↗" link is a 44 x 44 tap target on phone', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const w of [560, 393, 375]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/banks?bank=neetcode150')
    const link = page.getByTestId('banks-source-link')
    await link.waitFor()
    const b = (await link.boundingBox())!
    expect(Math.round(b.width), `${w}`).toBeGreaterThanOrEqual(44)
    expect(Math.round(b.height), `${w}`).toBeGreaterThanOrEqual(44)
  }
  await ctx.close()
})

test('closing rerun Q28: on phone the error card keeps the 16 px side gutter', async ({ browser }) => {
  const { ctx } = await openApp(browser, srv)
  await ctx.close()
  const f = await freshContext(browser, false, 'fail')
  for (const w of [393, 375, 560]) {
    await f.page.setViewportSize({ width: w, height: 800 })
    await f.page.goto('/')
    const card = f.page.locator('.fatal')
    await card.waitFor({ timeout: 20_000 })
    const b = (await card.boundingBox())!
    expect(Math.round(b.x), `${w}`).toBe(16)
    expect(Math.round(w - (b.x + b.width)), `${w}`).toBe(16)
  }
  await f.ctx.close()
})


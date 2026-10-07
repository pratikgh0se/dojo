import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { IST, idbPatch, onboard } from './helpers'

// Live plan: Sprint 1 = Mon 2026-10-05; 6 tasks per sprint (4 stage + 2 interview).
const S1_TASKS = [
  'stage-00-setup-w1-watch', 'stage-00-setup-w1-rebuild', 'stage-00-setup-w1-build', 'stage-00-setup-w1-teachback',
  'm1w1i1', 'm1w1i2',
]
const plan = JSON.parse(readFileSync(new URL('../../public/data/plan.json', import.meta.url), 'utf8')) as {
  dsa_bank: { sprint: number; problems: { num: number }[] }[]
}
const flashes = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset.flashes ?? '0'))
const powerups = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset.powerups ?? '0'))
const attrJson = async (page: Page, testId: string) => JSON.parse((await page.getByTestId(testId).getAttribute('data')) ?? '{}')

async function at(page: Page, when: string) {
  await page.clock.setFixedTime(IST(when))
  await page.reload()
  await page.getByTestId('now-headline').waitFor()
}

test('NOW tile: Spar drains, survives reload, retreats, and powers up at the end', async ({ page }) => {
  await page.clock.install({ time: IST('2026-10-05T21:10:00') })
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('now-headline')).toHaveText('Watch · 50 min')
  await expect(page.getByTestId('open-link')).toContainText('Open · 3Blue1Brown calculus ↗')
  // Ruling Q1 (spec D4): Start ▸ is the accent primary; Open is a control-bevel secondary.
  await expect(page.getByTestId('start-button')).toHaveClass(/\bsr-btn-accent\b/)
  await expect(page.getByTestId('open-link')).not.toHaveClass(/\bsr-btn-accent\b/)

  await page.getByTestId('spar-25').click()
  await expect(page.getByTestId('now-readout')).toHaveText(/^2[45]:\d\d$/)
  await expect(page.getByTestId('now-timer-sub')).toHaveText('of 25 min · ends 21:35')
  await expect(page.getByTestId('spar-50')).toHaveCount(0)
  await expect(page.getByTestId('start-button')).toBeVisible()

  await page.clock.fastForward('05:00')
  await expect(page.getByTestId('now-readout')).toHaveText(/^(19|20):\d\d$/)
  const states = await page.getByTestId('now-blocks').locator('i').evaluateAll(els => els.map(e => e.getAttribute('data-state')))
  expect(states).toEqual(['empty', 'draining', 'full', 'full', 'full'])

  await page.reload()
  await expect(page.getByTestId('now-readout')).toHaveText(/^(19|20):\d\d$/)
  await page.getByRole('button', { name: 'Retreat' }).click()
  await expect(page.getByTestId('spar-50')).toBeVisible()

  await page.getByTestId('spar-25').click()
  const before = await flashes(page)
  await page.clock.fastForward('25:05')
  await expect(page.getByTestId('toast').filter({ hasText: 'Power up · 25 min' })).toBeVisible()
  expect(await flashes(page)).toBe(before + 1)
  await expect(page.locator('pom-stage')).toHaveAttribute('pose', 'powerup')
  await expect(page.getByTestId('spar-50')).toBeVisible()
})

test('tick from This sprint: flash, +10 xp · Saved, Pom powerup → training, Carrot 6/6 → 5/6', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-05T21:10:00'))
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('carrot-hp')).toHaveText('6/6')
  await expect(page.locator('pom-stage')).toHaveAttribute('pose', 'idle')

  await page.getByRole('button', { name: /This sprint · 6 tasks/ }).click()
  const beforePowerups = await powerups(page)
  await page.getByTestId('dig-tick-stage-00-setup-w1-watch').click()

  await expect(page.getByTestId('toast').filter({ hasText: '+10 xp · Saved' })).toBeVisible()
  expect(await flashes(page)).toBe(1)
  // pose=powerup only holds for the 1.8s window (POWERUP_MS), which races the assertion under
  // load; the counted fire on <html> is the same event without the timing flakiness (M3).
  expect(await powerups(page)).toBe(beforePowerups + 1)
  await expect(page.getByTestId('carrot-hp')).toHaveText('5/6')
  expect(await attrJson(page, 'carrot-hp-bar')).toEqual({ max: 6, value: 5 })
  await expect(page.locator('pom-stage')).toHaveAttribute('pose', 'training', { timeout: 4_000 })
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 4_000 })
})

test('Load check: Fits in S1, Heavy in S2, pace takes over once S1 has ticks', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-05T21:10:00'))
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('load-verdict')).toHaveText('Fits')
  await expect(page.getByTestId('load-text')).toHaveText('6 tasks due this sprint. Your pace appears here after the first sprint ends.')

  await at(page, '2026-10-19T21:10:00')
  await expect(page.getByTestId('load-verdict')).toHaveText('Heavy')
  await expect(page.getByTestId('load-text')).toHaveText(
    "12 tasks due before sprint 3 against a pace of about 6 per sprint. Pick the 6 least important and let them slide one sprint; the plan's rule is slide, never restart.",
  )
  await expect(page.getByTestId('load-row')).toHaveText(['Now · 14d left12', 'Sprint 36', 'Planned pace6'])

  await idbPatch(page, 'tickets', S1_TASKS.slice(0, 5), { status: 'done', doneAt: IST('2026-10-10T21:00:00').getTime(), xp: 10 })
  await at(page, '2026-10-19T21:10:00')
  await expect(page.getByTestId('load-verdict')).toHaveText('Heavy')
  await expect(page.getByTestId('load-text')).toContainText('7 tasks due before sprint 3 against a pace of about 5 per sprint. Pick the 2 least important')
  await expect(page.getByTestId('load-row').nth(2)).toHaveText('Your pace5')

  await idbPatch(page, 'tickets', S1_TASKS.slice(5), { status: 'done', doneAt: IST('2026-10-10T21:00:00').getTime(), xp: 10 })
  await at(page, '2026-10-19T21:10:00')
  await expect(page.getByTestId('load-verdict')).toHaveText('Fits')
  await expect(page.getByTestId('load-text')).toHaveText('6 tasks due before sprint 3; you have been clearing about 6 a sprint. Keep the rhythm.')
})

test('drawers open and close; Left behind in S2; DSA problems; design drawer only from S21', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-05T21:10:00'))
  await onboard(page, '2026-10-05')
  const tasksHead = page.getByRole('button', { name: /This sprint · 6 tasks/ })
  await expect(tasksHead).toHaveAttribute('aria-expanded', 'false')
  await tasksHead.click()
  await expect(tasksHead).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('drawer-tasks').locator('[data-testid^="dig-row-"]')).toHaveCount(6)
  await tasksHead.click()
  await expect(page.getByTestId('drawer-tasks').locator('[data-testid^="dig-row-"]')).toHaveCount(0)
  await expect(page.getByTestId('drawer-carry')).toHaveCount(0)
  await expect(page.getByTestId('drawer-design')).toHaveCount(0)

  await at(page, '2026-10-19T21:10:00')
  await page.getByRole('button', { name: /Left behind · 6/ }).click()
  await expect(page.getByTestId('dig-row-stage-00-setup-w1-watch')).toContainText('from sprint 1 · AI')
  await page.getByRole('button', { name: /DSA · Topological sort/ }).click()
  await expect(page.getByTestId('drawer-dsa').getByRole('link', { name: 'NeetCode ↗' })).toHaveCount(9)

  await at(page, '2027-07-12T21:10:00')
  await expect(page.getByRole('button', { name: /Thursday design/ })).toBeVisible()
})

test('milestone badges: 1 on the first tick, G when DSA sprints 1–4 are clear', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-05T21:10:00'))
  await onboard(page, '2026-10-05')
  for (const g of ['1', 'G', 'H', 'D', 'B', '½']) await expect(page.getByTestId(`badge-${g}`)).toHaveAttribute('data-on', 'false')
  await page.getByRole('button', { name: /This sprint · 6 tasks/ }).click()
  await page.getByTestId('dig-tick-m1w1i1').click()
  await expect(page.getByTestId('badge-1')).toHaveAttribute('data-on', 'true')
  await expect(page.getByTestId('badge-G')).toHaveAttribute('data-on', 'false')

  const graphIds = plan.dsa_bank.filter(w => w.sprint <= 4).flatMap(w => w.problems.map(p => `p${p.num}`))
  await idbPatch(page, 'tickets', graphIds, { status: 'done', doneAt: IST('2026-10-05T20:00:00').getTime(), xp: 10 })
  await at(page, '2026-10-05T21:10:00')
  await expect(page.getByTestId('badge-G')).toHaveAttribute('data-on', 'true')
})

test('consistency counts a 12-min solved session and ignores a 3-min give-up', async ({ page }) => {
  await page.clock.install({ time: IST('2026-10-05T21:10:00') })
  await onboard(page, '2026-10-05')
  const monday = async () => (await attrJson(page, 'consistency-cal')).weeks[7][1] // weeks run Sunday to Saturday: Monday is row 1, where the chart's M label is
  expect(await monday()).toBe(0)

  await page.getByTestId('start-button').click()
  await expect(page).toHaveURL(/\/do\/stage-00-setup-w1-watch$/)
  await page.getByRole('button', { name: 'Start 25' }).click()
  await page.clock.fastForward('12:00')
  await page.getByRole('button', { name: 'Solved ✓' }).click()
  await expect(page).toHaveURL(/\/board$/)
  await page.goto('/')
  await expect.poll(monday).toBe(1)
  await expect(page.getByTestId('cal-total')).toHaveText('1 logged')

  await page.getByTestId('start-button').click()
  await page.getByRole('button', { name: 'Start 25' }).click()
  await page.clock.fastForward('03:00')
  await page.getByRole('button', { name: 'Give up' }).click()
  await page.goto('/')
  await page.getByTestId('cal-total').waitFor()
  expect(await monday()).toBe(1)
  await expect(page.getByTestId('cal-total')).toHaveText('1 logged')
})

test('Pom renders from the vendored three.js; charts render; no CDN request', async ({ page }) => {
  const cdn: string[] = []
  page.on('request', r => { if (/unpkg\.com|jsdelivr\.net|cdnjs|esm\.sh|skypack/.test(r.url())) cdn.push(r.url()) })
  await page.clock.setFixedTime(IST('2026-10-05T21:10:00'))
  await onboard(page, '2026-10-05')
  await expect.poll(() => page.locator('pom-stage').evaluate(el => !!el.shadowRoot?.querySelector('canvas')), { timeout: 20_000 }).toBe(true)
  await expect(page.getByTestId('cal-cell')).toHaveCount(56) // the Consistency calendar is HTML (UAT cu-2p P3-2)
  for (const id of ['carrot-hp-bar', 'health-chart']) {
    await expect.poll(() => page.getByTestId(id).evaluate(el => !!el.shadowRoot?.querySelector('svg'))).toBe(true)
  }
  expect(cdn).toEqual([])
})

for (const when of ['2026-09-28T09:00:00', '2027-07-12T21:10:00']) {
  test(`no horizontal scroll at 560 (${when}) (Review Focus #3)`, async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 900 })
    await page.clock.setFixedTime(IST('2026-09-28T09:00:00'))
    await onboard(page, '2026-10-05')
    await at(page, when)
    await page.getByRole('button', { name: /This sprint/ }).click()
    const carry = page.getByRole('button', { name: /Left behind/ })
    if (await carry.count()) await carry.click()
    await page.getByRole('button', { name: /^DSA/ }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })
}

import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { IST, idbAll, onboard, serveLegacyPlan } from './helpers'
import { APPROACHES } from '../../src/content/approaches'

// R1 polish: before/after screenshots into docs/screenshots/polish-<item>-<tag>-<size>.png.
// Opt-in: POLISH_SHOTS=before|after npx playwright test polish-shots --project=chromium
const TAG = process.env.POLISH_SHOTS
const OUT = 'docs/screenshots'
test.skip(!TAG, 'screenshot capture only: set POLISH_SHOTS=before|after')
test.describe.configure({ timeout: 180_000 })

const SIZES = [{ w: 1280, h: 800, name: '1280x800' }, { w: 375, h: 667, name: '375' }]
type Row = { id: string; kind: string; status: string }

async function shot(page: Page, item: string, size: string) {
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: `${OUT}/polish-${item}-${TAG}-${size}.png` })
}
async function begin(page: Page, at = '2026-10-06T10:00:00', start = '2026-10-05', legacy = false) {
  if (legacy) await serveLegacyPlan(page)
  await page.clock.install({ time: IST(at) })
  await onboard(page, start)
}

for (const s of SIZES) {
  test.describe(`polish shots ${s.name}`, () => {
    test.use({ viewport: { width: s.w, height: s.h } })

    test('designs callout', async ({ page }) => {
      await begin(page, '2026-09-21T09:00:00', '2026-09-07', true)
      await page.goto('/designs')
      await expect(page.getByTestId('next-design-title')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await page.getByTestId('next-design-title').scrollIntoViewIfNeeded()
      await shot(page, 'designs-callout', s.name)
    })

    test('sup in the approach answer', async ({ page }) => {
      await begin(page)
      const todo = (await idbAll<Row>(page, 'tickets')).filter(t => t.kind === 'problem' && t.status === 'todo')
      const hit = todo.find(t => (APPROACHES[t.id] ?? []).some(a => a.complexity.includes('^')))
      test.skip(!hit, 'no todo problem with a power complexity in this plan')
      await page.goto(`/do/${hit!.id}`)
      await expect(page.getByTestId('screen-do')).toBeVisible()
      const more = page.getByTestId('dsa-approaches-more')
      if ((await more.getAttribute('open')) === null) await more.locator('summary').click()
      const sup = page.locator('sup').first()
      await sup.scrollIntoViewIfNeeded()
      await shot(page, 'sup', s.name)
      console.log(`SUP ${s.name} ${hit!.id} ${await sup.evaluate(e => getComputedStyle(e).fontSize)}`)
    })

    test('today link', async ({ page }) => {
      await begin(page)
      await expect(page.getByTestId('today-link')).toBeVisible()
      await shot(page, 'today-link', s.name)
      console.log(`LINK ${s.name} ${JSON.stringify(await page.getByTestId('today-link').boundingBox())}`)
    })

    test('pause and resume', async ({ page }) => {
      await begin(page)
      await page.getByTestId('start-button').click()
      await expect(page.getByTestId('timer-state')).toHaveText('running')
      const row = page.getByTestId('timer-pause').locator('..')
      const pw = (await page.getByTestId('timer-pause').boundingBox())!.width
      await shot(page, 'pause-resume-pause', s.name)
      await page.getByTestId('timer-pause').click()
      await expect(page.getByTestId('timer-resume')).toBeVisible()
      const rw = (await page.getByTestId('timer-resume').boundingBox())!.width
      await shot(page, 'pause-resume-resume', s.name)
      console.log(`PAUSE ${s.name} pause=${pw} resume=${rw}`)
      void row
    })

    test('pick rows', async ({ page }) => {
      await begin(page)
      await page.getByTestId('today-pick-else').click()
      await expect(page.getByTestId('today-pick-list')).toBeVisible()
      await page.getByTestId('today-pick-list').scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy(0, 120))
      await shot(page, 'pick-rows', s.name)
      console.log(`PICK ${s.name} ${JSON.stringify(await page.locator('.qc-pitem .qc-meta').evaluateAll(els => els.slice(0, 40).map(e => Math.round(e.getBoundingClientRect().height))))}`)
    })

    test('settings budget inputs', async ({ page }) => {
      await begin(page)
      await page.goto('/settings')
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-ready', 'true')
      await page.getByTestId('settings-budget-0').scrollIntoViewIfNeeded()
      await shot(page, 'budget', s.name)
      console.log(`BUDGET ${s.name} ${await page.getByTestId('settings-budget-0').evaluate(e => getComputedStyle(e).width)} scrollW=${await page.evaluate(() => document.documentElement.scrollWidth)}`)
    })

    test('focus mode rail', async ({ page }) => {
      await begin(page)
      await page.getByTestId('start-button').click()
      await expect(page.getByTestId('timer-state')).toHaveText('running')
      await page.keyboard.press('f')
      await expect(page.getByTestId('focus-screen')).toBeVisible()
      await shot(page, 'focus-rail', s.name)
    })
  })
}

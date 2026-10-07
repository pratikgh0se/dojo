import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, type Locator, type Page } from '@playwright/test'
import { onboard } from '../e2e/helpers'
import { parityBaseUrl } from '../../dojoPort'

// DSA labs parity: Dojo's Atlas matrix, player, Two-up, DSA warm-up and Do strip next to the Algorithm Atlas
// and Algorithm Lab prototypes, region by region, at 1280 and 560, dark theme (the lab prototypes are dark-only).
// `parity:labs` writes to test-results only; `parity:labs:update` (UPDATE_PARITY=1) also copies to docs.
const OUT = fileURLToPath(new URL('../../test-results/parity/labs/', import.meta.url))
const DOCS_OUT = fileURLToPath(new URL('../../docs/superpowers/parity/labs/', import.meta.url))
const PROTO_BASE = parityBaseUrl(process.env)
const ATLAS = `${PROTO_BASE}/lab/Algorithm%20Atlas.dc.html`
const LAB = `${PROTO_BASE}/lab/Algorithm%20Lab.dc.html`
const WIDTHS = [1280, 560] as const
const out = (name: string) => `${OUT}${name}`

test.describe.configure({ mode: 'serial' })
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))
test.afterAll(() => {
  if (process.env.UPDATE_PARITY !== '1') return
  mkdirSync(DOCS_OUT, { recursive: true })
  for (const name of readdirSync(OUT)) if (name.endsWith('.png')) copyFileSync(`${OUT}${name}`, `${DOCS_OUT}${name}`)
})

async function settle(page: Page) {
  await page
    .waitForFunction(() => [...document.querySelectorAll('sr-algo, sr-algo2, sr-chart')].every(c => !!c.shadowRoot?.querySelector('svg, .say')), undefined, { timeout: 15_000 })
    .catch(() => {
      test.info().annotations.push({ type: 'warning', description: 'a player did not render' })
      console.warn('settle: a player did not render')
    })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
}

async function shot(l: Locator, name: string) {
  await l.scrollIntoViewIfNeeded()
  await l.screenshot({ path: out(name) })
}

async function dojo(page: Page, w: number, path: string) {
  await page.setViewportSize({ width: w, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await onboard(page, '2026-10-05')
  await page.goto(path)
  await settle(page)
}

const walk = (page: Page, title: string) =>
  page.getByRole('list', { name: 'Walkthroughs', exact: true }).getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) })

async function side(page: Page, w: number, name: string, left: [string, string], right: [string, string]) {
  const b64 = (f: string) => `data:image/png;base64,${readFileSync(out(f)).toString('base64')}`
  await page.setViewportSize({ width: w * 2 + 48, height: 900 })
  await page.setContent(`<!doctype html><html><body style="margin:0;padding:16px;display:flex;gap:16px;align-items:flex-start;background:gray;font:12px monospace;color:white">
    <figure style="margin:0"><figcaption>PROTOTYPE · ${w}px · ${left[1]}</figcaption><img src="${b64(left[0])}"></figure>
    <figure style="margin:0"><figcaption>DOJO · ${w}px · ${right[1]}</figcaption><img src="${b64(right[0])}"></figure>
  </body></html>`)
  await page.screenshot({ path: out(name), fullPage: true })
}

for (const w of WIDTHS) {
  test(`prototype Atlas and Lab regions @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto(ATLAS)
    await page.getByText('THE MAP · 36 PATTERNS × 16 ATOMS').waitFor({ timeout: 30_000 })
    await settle(page)
    const sections = page.locator('section')
    await shot(sections.nth(0), `proto-map-${w}.png`)
    await shot(sections.nth(1), `proto-dp-${w}.png`)
    await shot(sections.nth(3).locator('sr-algo').first(), `proto-topo-${w}.png`)
    await page.goto(LAB)
    await page.getByText('SEE THE ALGORITHM MOVE').waitFor({ timeout: 30_000 })
    await settle(page)
    await shot(page.locator('section').nth(0), `proto-player-${w}.png`)
  })

  test(`dojo Atlas, DSA and Do regions @${w}`, async ({ page }) => {
    await dojo(page, w, '/atlas?pattern=dp-memo')
    await shot(page.getByTestId('atlas-matrix'), `dojo-map-${w}.png`)
    await page.screenshot({ path: out(`dojo-atlas-${w}.png`), fullPage: true })
    await walk(page, 'Memoization · fib(5)').getByRole('button', { name: 'Two-up', exact: true }).click()
    await settle(page)
    await shot(page.getByTestId('lab-two-up'), `dojo-twoup-${w}.png`)
    // The player region compares like with like against the prototype's full-width "THE PLAYER" only when its
    // own container is wide (contract §4.1, engine rule: side column stacks under 640px). The Atlas detail panel
    // (aside, beside the 36×16 matrix) is narrower than that even at 1280px page width (see labs.md addendum /
    // REMAINING.md), so capture Dijkstra from the DSA S4 warm-up instead, where the player has the full column
    // width and — at 1280 — lays out wide like the prototype.
    await page.goto('/dsa?topic=4')
    await settle(page)
    await page.getByTestId('lab-player').getByRole('button', { name: 'Predict', exact: true }).click()
    await settle(page)
    await shot(page.getByTestId('lab-player'), `dojo-player-${w}.png`)
    await page.goto('/dsa?topic=2')
    await settle(page)
    await shot(page.getByTestId('dsa-warmup'), `dojo-warmup-${w}.png`)
    await page.goto('/do/p743')
    const strip = page.getByTestId('dsa-approaches')
    await strip.getByRole('button', { name: 'Pick two', exact: true }).click()
    await strip.getByRole('button', { name: 'Bellman-Ford · O(V·E)', exact: true }).click()
    await strip.getByRole('button', { name: 'Dijkstra · O(E log V) · best', exact: true }).click()
    await settle(page)
    await shot(strip, `dojo-strip-${w}.png`)
  })

  test(`side by side @${w}`, async ({ page }) => {
    await side(page, w, `side-map-${w}.png`, [`proto-map-${w}.png`, 'Atlas 01 map'], [`dojo-map-${w}.png`, 'Atlas matrix (states)'])
    await side(page, w, `side-twoup-${w}.png`, [`proto-dp-${w}.png`, 'Atlas 02 memo vs tab'], [`dojo-twoup-${w}.png`, 'Two-up memo vs tab'])
    await side(page, w, `side-player-${w}.png`, [`proto-player-${w}.png`, 'Lab 01 player'], [`dojo-player-${w}.png`, 'Player (Dijkstra, predict)'])
    await side(page, w, `side-warmup-${w}.png`, [`proto-topo-${w}.png`, 'Atlas 04 topo sort'], [`dojo-warmup-${w}.png`, 'DSA S2 warm-up'])
  })
}

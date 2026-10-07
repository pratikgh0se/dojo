import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, type Page } from '@playwright/test'
import { parityBaseUrl } from '../../dojoPort'
import { IST, idbPatch, onboard } from '../e2e/helpers'
import { NO_PROTOTYPES, PROTOTYPES_PRESENT } from './prototypes'

// parity:ai writes here only; parity:ai:update (UPDATE_PARITY=1) also copies the PNGs into docs.
const OUT = fileURLToPath(new URL('../../test-results/parity/ai/', import.meta.url))
const DOCS_OUT = fileURLToPath(new URL('../../docs/superpowers/parity/ai/', import.meta.url))
const PROTO = `${parityBaseUrl(process.env)}/Infra%20to%20Research%20(quest).dc.html`
const WIDTHS = [1280, 560] as const
const REPO = 'https://github.com/example-user/forge'
const out = (name: string) => `${OUT}${name}`
// Swiftshader (software rendering, `--use-angle=swiftshader` in this repo's Playwright configs)
// refuses to capture a full-page screenshot taller than its max texture size (~8192px). The full
// /ai page (six new regions above the unchanged M5c content) runs past that at both widths, so the
// dojo capture uses the viewport height instead of `fullPage` once resized to the page's own
// scrollHeight (capped just under the limit) — full width, same top-of-page start, only the very
// bottom of the M5c "Working with AI" section can be cut off on a very tall render.
const MAX_CAPTURE_HEIGHT = 8000

test.skip(!PROTOTYPES_PRESENT, NO_PROTOTYPES)
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))
test.afterAll(() => {
  if (process.env.UPDATE_PARITY !== '1') return
  mkdirSync(DOCS_OUT, { recursive: true })
  for (const name of readdirSync(OUT)) if (name.endsWith('.png')) copyFileSync(`${OUT}${name}`, `${DOCS_OUT}${name}`)
})

async function settle(page: Page) {
  await page
    .waitForFunction(() => [...document.querySelectorAll('sr-chart')].every(c => !!c.shadowRoot?.querySelector('svg')), undefined, { timeout: 15_000 })
    .catch(() => test.info().annotations.push({ type: 'warning', description: 'chart SVG did not render' }))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
}

for (const w of WIDTHS) {
  test(`prototype AI @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('i2r-q-tab', 'ai')
      localStorage.setItem('i2r-theme', 'light')
    })
    await page.clock.setFixedTime(IST('2026-10-14T10:00:00'))
    await page.goto(PROTO)
    await page.getByText('Applied ladder · 12 rungs', { exact: false }).first().waitFor({ timeout: 30_000 })
    await settle(page)
    await page.screenshot({ path: out(`proto-${w}.png`), fullPage: true })
  })

  test(`dojo AI @${w}`, async ({ page }) => {
    const at = IST('2026-10-14T10:00:00').getTime()
    await page.setViewportSize({ width: w, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.clock.setFixedTime(IST('2026-10-14T10:00:00'))
    await onboard(page, '2026-10-05')
    await idbPatch(page, 'settings', ['main'], { theme: 'light' })
    await idbPatch(page, 'artifacts', ['art-stage-00'], {
      repo: REPO, commit: 'c0ffee1', status: 'measured', commitFound: true, grade: 4, gradedAt: at,
      gradeFeedback: ['[fake:grade] art-stage-00 runs, is hand-written, and is measured.'], gradeMissing: [],
      measures: [{ name: 'tokens/sec', value: 38, unit: 'tok/s', at, sprint: 1 }],
      statusAt: { 'not started': at, measured: at },
      statusLog: [{ status: 'not started', at }, { status: 'measured', at }],
    })
    await idbPatch(page, 'artifacts', ['art-stage-01'], {
      status: 'building', statusAt: { 'not started': at, building: at },
      statusLog: [{ status: 'not started', at }, { status: 'building', at }],
    })
    await page.goto('/ai')
    await page.getByRole('region', { name: 'Measures wall' }).waitFor()
    await settle(page)
    const full = await page.evaluate(() => document.documentElement.scrollHeight)
    if (full > MAX_CAPTURE_HEIGHT) {
      test.info().annotations.push({ type: 'warning', description: `page is ${full}px tall, capturing only the first ${MAX_CAPTURE_HEIGHT}px (swiftshader texture-size limit)` })
    }
    await page.setViewportSize({ width: w, height: Math.min(full, MAX_CAPTURE_HEIGHT) })
    await settle(page)
    await page.screenshot({ path: out(`dojo-${w}.png`) })
  })

  test(`side by side @${w}`, async ({ page }) => {
    const b64 = (f: string) => `data:image/png;base64,${readFileSync(out(f)).toString('base64')}`
    await page.setViewportSize({ width: w * 2 + 48, height: 900 })
    await page.setContent(`<!doctype html><html><body style="margin:0;padding:16px;display:flex;gap:16px;align-items:flex-start;background:gray;font:12px monospace;color:white">
      <figure style="margin:0"><figcaption>PROTOTYPE AI · ${w}px</figcaption><img src="${b64(`proto-${w}.png`)}"></figure>
      <figure style="margin:0"><figcaption>DOJO /ai · ${w}px · S1, 14 Oct 2026</figcaption><img src="${b64(`dojo-${w}.png`)}"></figure>
    </body></html>`)
    await page.screenshot({ path: out(`side-${w}.png`), fullPage: true })
  })
}

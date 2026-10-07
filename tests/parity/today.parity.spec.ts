import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, type Page } from '@playwright/test'
import { IST, idbPatch, onboard } from '../e2e/helpers'
import { parityBaseUrl } from '../../dojoPort'
import { NO_PROTOTYPES, PROTOTYPES_PRESENT } from './prototypes'

// `parity:today` writes here only — it never touches the committed docs copy, so it's safe to
// run any time without risking an accidental PNG diff (M6). `parity:today:update` (UPDATE_PARITY=1)
// additionally copies every PNG produced here into the docs directory once the run finishes.
const OUT = fileURLToPath(new URL('../../test-results/parity/today/', import.meta.url))
const DOCS_OUT = fileURLToPath(new URL('../../docs/superpowers/parity/today/', import.meta.url))
const PROTO = `${parityBaseUrl(process.env)}/Infra%20to%20Research%20(quest).dc.html`
const WIDTHS = [1280, 560] as const
const out = (name: string) => `${OUT}${name}`

test.skip(!PROTOTYPES_PRESENT, NO_PROTOTYPES)
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))
test.afterAll(() => {
  if (process.env.UPDATE_PARITY !== '1') return
  mkdirSync(DOCS_OUT, { recursive: true })
  for (const name of readdirSync(OUT)) {
    if (name.endsWith('.png')) copyFileSync(`${OUT}${name}`, `${DOCS_OUT}${name}`)
  }
})

async function settle(page: Page) {
  await page
    .waitForFunction(() => [...document.querySelectorAll('sr-chart')].every(c => !!c.shadowRoot?.querySelector('svg')), undefined, { timeout: 15_000 })
    .catch(() => {
      test.info().annotations.push({ type: 'warning', description: 'chart SVG did not render' })
      console.warn('settle: chart SVG did not render')
    })
  await page
    .waitForFunction(() => {
      const p = document.querySelector('pom-stage')
      return !p || !!p.shadowRoot?.querySelector('canvas')
    }, undefined, { timeout: 15_000 })
    .catch(() => {
      test.info().annotations.push({ type: 'warning', description: 'Pom canvas did not render' })
      console.warn('settle: Pom canvas did not render')
    })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
}

for (const w of WIDTHS) {
  test(`prototype Today @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.clock.setFixedTime(IST('2026-09-14T21:15:00'))
    await page.goto(PROTO)
    await page.getByText('Sprint by sprint', { exact: false }).first().waitFor({ timeout: 30_000 })
    await settle(page)
    await page.screenshot({ path: out(`proto-${w}.png`), fullPage: true })
  })

  test(`dojo Today @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.clock.setFixedTime(IST('2026-09-28T09:00:00'))
    await onboard(page, '2026-10-05')
    await idbPatch(page, 'settings', ['main'], { theme: 'light' })
    await page.reload()
    await page.getByTestId('now-eyebrow').waitFor()
    await settle(page)
    await page.screenshot({ path: out(`dojo-prestart-${w}.png`), fullPage: true })
    await page.clock.setFixedTime(IST('2026-10-12T21:15:00'))
    await page.reload()
    await page.getByTestId('now-eyebrow').waitFor()
    await settle(page)
    await page.screenshot({ path: out(`dojo-${w}.png`), fullPage: true })
  })

  test(`side by side @${w}`, async ({ page }) => {
    const b64 = (f: string) => `data:image/png;base64,${readFileSync(out(f)).toString('base64')}`
    await page.setViewportSize({ width: w * 2 + 48, height: 900 })
    await page.setContent(`<!doctype html><html><body style="margin:0;padding:16px;display:flex;gap:16px;align-items:flex-start;background:gray;font:12px monospace;color:white">
      <figure style="margin:0"><figcaption>PROTOTYPE · ${w}px · S1 day 8 (Mon)</figcaption><img src="${b64(`proto-${w}.png`)}"></figure>
      <figure style="margin:0"><figcaption>DOJO · ${w}px · S1 day 8 (Mon)</figcaption><img src="${b64(`dojo-${w}.png`)}"></figure>
    </body></html>`)
    await page.screenshot({ path: out(`side-${w}.png`), fullPage: true })
  })
}

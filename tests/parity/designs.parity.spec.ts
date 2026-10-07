import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, type Page } from '@playwright/test'
import { parityBaseUrl } from '../../dojoPort'
import { completeS1, resumeAndGo } from '../e2e/design-helpers'
import { IST, idbPatch, onboard } from '../e2e/helpers'
import { NO_PROTOTYPES, PROTOTYPES_PRESENT } from './prototypes'

// Writes only under test-results; `parity:designs:update` also copies the PNGs into docs (Task 17 commits them).
const OUT = fileURLToPath(new URL('../../test-results/parity/designs/', import.meta.url))
const DOCS_OUT = fileURLToPath(new URL('../../docs/superpowers/parity/designs/', import.meta.url))
const BASE = parityBaseUrl(process.env)
const PROTO = `${BASE}/Infra%20to%20Research%20(quest).dc.html`
const KIT = `${BASE}/lab/System%20Design%20Kit.dc.html`
const WIDTHS = [1280, 560] as const
const out = (name: string) => `${OUT}${name}`

type Shot = { name: string; widths: readonly number[]; dark?: boolean; prepare: (page: Page) => Promise<void> }

/** Dojo screenshots. Later tasks append entries (drawing, done, designs with evidence). */
const DOJO_SHOTS: Shot[] = [
  {
    name: 'dojo-designs', widths: WIDTHS,
    prepare: async page => { await page.goto('/designs'); await page.getByText('Tier ladder', { exact: false }).first().waitFor() },
  },
  {
    name: 'dojo-session-setup', widths: [1280], dark: true,
    prepare: async page => { await page.goto('/designs/session/d-ratelimit'); await page.locator('h1').first().waitFor() },
  },
  {
    name: 'dojo-session-drawing', widths: [1280], dark: true,
    prepare: async page => {
      await page.goto('/designs/session/d-ratelimit')
      await page.getByRole('button', { name: 'Start · 45 min' }).click()
      for (const k of ['browser', 'gateway', 'service', 'cache', 'sql', 'queue']) await page.getByRole('button', { name: `Add ${k}`, exact: true }).click()
    },
  },
  {
    name: 'dojo-session-done', widths: [1280], dark: true,
    prepare: async page => {
      await completeS1(page)
      // completeS1 leaves the clock frozen (see design-helpers' `freeze`); the completion flash
      // (Flash.tsx) removes itself via a real setTimeout, which a frozen clock never fires, so
      // the white overlay would otherwise still cover the page in the screenshot.
      await page.clock.runFor(500)
      await page.getByTestId('session-reference').getByRole('button', { name: 'Play flows' }).waitFor()
    },
  },
  {
    name: 'dojo-designs-evidence', widths: WIDTHS,
    prepare: async page => {
      await completeS1(page)
      await resumeAndGo(page, () => page.goto('/designs'))
      await page.getByRole('region', { name: 'Design evidence' }).waitFor()
    },
  },
]

/** [prototype file, dojo file, caption]; pairs whose files are missing are skipped. */
const PAIRS: [string, string, string][] = [
  ['proto-designs-1280.png', 'dojo-designs-1280.png', 'Designs tab · 1280'],
  ['proto-designs-560.png', 'dojo-designs-560.png', 'Designs tab · 560'],
  ['proto-kit-1280.png', 'dojo-session-setup-1280.png', 'Kit vs session setup · 1280'],
  ['proto-kit-1280.png', 'dojo-session-drawing-1280.png', 'Kit vs session canvas · 1280'],
  ['proto-kit-1280.png', 'dojo-session-done-1280.png', 'Kit vs done view · 1280'],
  ['proto-designs-1280.png', 'dojo-designs-evidence-1280.png', 'Designs tab with evidence · 1280'],
  ['proto-designs-560.png', 'dojo-designs-evidence-560.png', 'Designs tab with evidence · 560'],
]

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
    .waitForFunction(
      () => [...document.querySelectorAll('sr-chart, sr-diagram')].every(c => !!c.shadowRoot?.querySelector('svg')),
      undefined, { timeout: 15_000 },
    )
    .catch(() => test.info().annotations.push({ type: 'warning', description: 'engine SVG did not render' }))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
}

for (const w of WIDTHS) {
  test(`prototype Designs @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.clock.setFixedTime(IST('2026-10-11T10:00:00'))
    await page.goto(PROTO)
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: 'Designs' }).click()
    await page.getByText('Tier ladder', { exact: false }).first().waitFor({ timeout: 30_000 })
    await settle(page)
    await page.screenshot({ path: out(`proto-designs-${w}.png`), fullPage: true })
  })
}

test('prototype System Design Kit @1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(KIT)
  await page.getByText('SYSTEMS, DRAWN AS BLOCKS').waitFor({ timeout: 30_000 })
  await settle(page)
  await page.screenshot({ path: out('proto-kit-1280.png'), fullPage: true })
})

for (const shot of DOJO_SHOTS) {
  for (const w of shot.widths) {
    test(`dojo ${shot.name} @${w}`, async ({ page }) => {
      test.setTimeout(240_000)
      await page.setViewportSize({ width: w, height: 900 })
      await page.emulateMedia({ colorScheme: shot.dark ? 'dark' : 'light' })
      await page.clock.install({ time: IST('2026-10-11T10:00:00') })
      await onboard(page, '2026-10-05')
      await idbPatch(page, 'settings', ['main'], { theme: shot.dark ? 'dark' : 'light' })
      await shot.prepare(page)
      await settle(page)
      await page.screenshot({ path: out(`${shot.name}-${w}.png`), fullPage: true })
    })
  }
}

test('side by side', async ({ page }) => {
  const b64 = (f: string) => `data:image/png;base64,${readFileSync(out(f)).toString('base64')}`
  for (const [proto, dojo, caption] of PAIRS) {
    if (!existsSync(out(proto)) || !existsSync(out(dojo))) continue
    const w = caption.endsWith('560') ? 560 : 1280
    await page.setViewportSize({ width: w * 2 + 48, height: 900 })
    await page.setContent(`<!doctype html><html><body style="margin:0;padding:16px;display:flex;gap:16px;align-items:flex-start;background:gray;font:12px monospace;color:white">
      <figure style="margin:0"><figcaption>PROTOTYPE · ${caption}</figcaption><img src="${b64(proto)}"></figure>
      <figure style="margin:0"><figcaption>DOJO · ${caption}</figcaption><img src="${b64(dojo)}"></figure>
    </body></html>`)
    await page.screenshot({ path: out(`side-${dojo}`), fullPage: true })
  }
})

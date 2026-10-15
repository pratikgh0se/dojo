#!/usr/bin/env node
// Screenshots every frame of the approved R1 UX mockup sheet (ux-mockups/index.html), one PNG per frame, at 1:1 scale.
//   node scripts/r1-mockup-shots.mjs <path to ux-mockups/index.html> <outDir>
// Frame names follow the sheet order: shell-1, today-1 (desktop), today-2 (phone, 390), path-1, skills-1..3, review-1..2, do-1..2, design-1..4.
// The sheet loads its fonts from Google Fonts: offline, the layout is unchanged and only the glyph shapes differ.
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const [src, out] = process.argv.slice(2)
if (!src || !out) { console.error('usage: r1-mockup-shots.mjs <index.html> <outDir>'); process.exit(2) }
mkdirSync(out, { recursive: true })
const NAMES = {
  shell: ['shell-1'], today: ['today-1', 'today-2'], path: ['path-1'], skills: ['skills-1', 'skills-2', 'skills-3'],
  review: ['review-1', 'review-2'], do: ['do-1', 'do-2'], design: ['design-1', 'design-2', 'design-3', 'design-4'],
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } }) // wide enough that every frame scales at 1:1
await page.goto(pathToFileURL(resolve(src)).href, { waitUntil: 'load', timeout: 30_000 }).catch(e => console.log('goto:', e.message))
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {})
await page.waitForTimeout(1500)
const frames = await page.$$('.fit')
const seen = {}
for (const f of frames) {
  const sec = await f.evaluate(el => el.closest('section')?.id ?? 'x')
  const i = (seen[sec] = (seen[sec] ?? 0) + 1) - 1
  const name = NAMES[sec]?.[i] ?? `${sec}-${i + 1}`
  const inner = await f.$('.fit-in')
  await (inner ?? f).screenshot({ path: join(out, `${name}.png`) })
  const box = await (inner ?? f).boundingBox()
  console.log(`${name}.png ${Math.round(box.width)}x${Math.round(box.height)}`)
}
await browser.close()

import { expect, test } from '@playwright/test'
import { IST, onboard } from './helpers'

test('fonts are self-hosted: Chivo, Silkscreen and Space Mono load from the app origin, nothing from Google', async ({ page, request }) => {
  const origins = new Set<string>()
  page.on('request', r => { if (/^https?:/.test(r.url())) origins.add(new URL(r.url()).origin) })
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.goto('/')
  await page.getByTestId('screen-today').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')))].sort())
  expect(loaded).toEqual(['Chivo', 'Silkscreen', 'Space Mono'])
  expect([...origins].filter(o => o !== new URL(page.url()).origin)).toEqual([])
  for (const f of ['fonts.css', 'chivo-latin.woff2', 'OFL-Chivo.txt', 'OFL-Silkscreen.txt', 'OFL-SpaceMono.txt']) {
    expect((await request.get(`/fonts/${f}`)).status(), f).toBe(200)
  }
})

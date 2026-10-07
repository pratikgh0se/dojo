import { expect, test } from '@playwright/test'
import { IST, onboard } from './helpers'

test('Atlas, Banks and the design session route are reachable, and the lab engines are served', async ({ page, request }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.goto('/')
  await page.getByTestId('now-eyebrow').waitFor()

  await expect(page.locator('footer.keys-legend')).toContainText('a atlas · b banks')
  await page.keyboard.press('a')
  await expect(page).toHaveURL(/\/atlas$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible()
  await page.keyboard.press('b')
  await expect(page).toHaveURL(/\/banks$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Banks' })).toBeVisible()

  await page.goto('/designs/session/d-ratelimit')
  await expect(page.getByRole('heading', { level: 1, name: 'Distributed rate limiter and API gateway' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '‹ Back' })).toHaveAttribute('href', '/designs')

  for (const f of ['algo.js', 'algo2.js', 'diagram.js']) {
    const res = await request.get(`/engines/${f}`)
    expect(res.status(), f).toBe(200)
  }
})

test('fonts are self-hosted: Chivo, Silkscreen and Space Mono load from the app origin, nothing from Google', async ({ page, request }) => {
  const origins = new Set<string>()
  page.on('request', r => { if (/^https?:/.test(r.url())) origins.add(new URL(r.url()).origin) })
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.goto('/')
  await page.getByTestId('now-eyebrow').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')))].sort())
  expect(loaded).toEqual(['Chivo', 'Silkscreen', 'Space Mono'])
  expect([...origins].filter(o => o !== new URL(page.url()).origin)).toEqual([])
  for (const f of ['fonts.css', 'chivo-latin.woff2', 'OFL-Chivo.txt', 'OFL-Silkscreen.txt', 'OFL-SpaceMono.txt']) {
    expect((await request.get(`/fonts/${f}`)).status(), f).toBe(200)
  }
})

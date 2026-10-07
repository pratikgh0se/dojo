import { expect, test } from './fixtures'
import { idbCount } from './helpers'
import { begin, guard, resumeAndGo, RL, RL_DIVES, RL_TITLE, startSession, T0 } from './design-helpers'

const MIN = 60_000

test('D-4 unknown design', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.goto('/designs/session/d-nope')
  await expect(page.getByRole('heading', { name: 'Design not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Designs' }).click()
  await expect(page).toHaveURL(/\/designs$/)
  check()
})

test('D-1/D-3 setup, then start solo; no tab bar, no tab shortcuts', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.goto(`/designs/session/${RL}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(RL_TITLE)
  await expect(page.getByTestId('session-phase')).toHaveText('setup')
  for (const [i, q] of RL_DIVES.entries()) await expect(page.getByTestId(`session-dive-${i + 1}`)).toHaveText(q)
  await expect(page.getByTestId('session-setup').getByRole('link', { name: 'ByteByteGo YouTube (free)' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Solo' })).toBeChecked()
  await expect(page.getByRole('timer', { name: 'Time left' })).toHaveText('45:00')
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await page.keyboard.press('1')
  await expect(page).toHaveURL(new RegExp(`/designs/session/${RL}$`))
  await page.getByRole('button', { name: 'Start · 45 min' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  await expect(page.getByTestId('session-timer')).toHaveText('45:00')
  await expect(page.getByTestId('session-interviewer')).toHaveCount(0)
  await expect(page.getByTestId('session-dive-4')).toBeVisible()
  check()
})

test('D-5/D-6 countdown to the lock', async ({ page }) => {
  // Advancing a virtual clock ~35 real minutes still processes every 1 s `useNow` tick along the
  // way; under load from other processes on this machine that real CPU cost can run past
  // Playwright's default 30 s test timeout (same category of fix as design-interviewer.spec.ts's
  // D-36 45-minute-lock test).
  test.setTimeout(60_000)
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.clock.runFor(10 * MIN)
  // A small tolerance around the whole-minute boundary: the on-screen timer is a 1s poll
  // (useNow(1000)) whose own interval is phase-anchored to when SessionRail first mounted (during
  // setup, before the session existed), not to the session's start instant — so after a big
  // runFor jump the display can be up to one tick behind the exact elapsed time. The underlying
  // arithmetic (remainingMs/clockText) is pinned exactly, deterministically, in
  // design-session-rules.test.ts; this is a display-polling artifact, not a logic bug.
  await expect(page.getByTestId('session-timer')).toHaveText(/^(34:59|35:00|35:01)$/)
  await page.clock.runFor(34 * MIN + 59_000)
  await expect(page.getByTestId('session-timer')).toHaveText(/^(00:00|00:01|00:02)$/)
  await page.clock.runFor(2000)
  await expect(page.getByTestId('session-timer')).toHaveText('00:00')
  await expect(page.getByTestId('session-phase')).toHaveText('close')
  await expect(page.getByRole('status').filter({ hasText: 'Canvas locked at 45 minutes' })).toBeVisible()
  check()
})

test('D-8 end early through the dialog', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.clock.runFor(12 * MIN)
  await page.getByRole('button', { name: 'End drawing' }).click()
  await page.getByRole('dialog', { name: 'End drawing now?' }).getByRole('button', { name: 'Keep going' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  await page.getByRole('button', { name: 'End drawing' }).click()
  await page.getByRole('dialog', { name: 'End drawing now?' }).getByRole('button', { name: 'End drawing' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('close')
  await expect(page.getByTestId('session-timer')).toHaveText('33:00')
  await page.clock.runFor(MIN)
  await expect(page.getByTestId('session-timer')).toHaveText('33:00')
  check()
})

test('D-9 timer survives reload; a session left open locks on load', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.clock.runFor(10 * MIN)
  // resume() before the reload: a paused clock starves React's rAF-driven scheduler on the fresh
  // mount that a full navigation causes (see `resumeAndGo`).
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  await expect(page.getByTestId('session-timer')).toHaveText(/^(3[45]:\d\d)$/)
  await page.clock.setSystemTime(new Date(T0.getTime() + 46 * MIN))
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('close')
  await expect(page.getByTestId('session-timer')).toHaveText('00:00')
  check()
})

test('Review Focus #1: opened five hours later, locks at exactly 45 minutes', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.clock.setSystemTime(new Date(T0.getTime() + 5 * 60 * MIN))
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('close')
  await expect(page.getByTestId('session-timer')).toHaveText('00:00')
  await expect(page.getByRole('status').filter({ hasText: 'Canvas locked at 45 minutes' })).toBeVisible()
  check()
})

test('D-10 one open session per design', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.clock.runFor(MIN)
  await resumeAndGo(page, () => page.goto('/designs'))
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}`))
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  // Same session: the timer kept running (real time also passed while navigating).
  await expect(page.getByTestId('session-timer')).toHaveText(/^(4[0-4]):\d\d$/)
  await expect(page.getByTestId('session-setup')).toHaveCount(0)
  check()
})

test('D-11 discard returns to setup and records nothing', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.getByRole('button', { name: 'Discard session' }).click()
  await page.getByRole('dialog', { name: 'Discard this session?' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
  await page.getByRole('button', { name: 'Discard session' }).click()
  await page.getByRole('dialog', { name: 'Discard this session?' }).getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('setup')
  await expect(page.getByTestId('session-timer')).toHaveText('45:00')
  expect(await idbCount(page, 'designSessions')).toBe(0)
  check()
})

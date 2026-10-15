import { expect, test } from './fixtures'
import { idbCount } from './helpers'
import { begin, guard, resumeAndGo, RL, RL_DIVES, RL_TITLE, startSession, T0, openNotes } from './design-helpers'

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

test('D-1/D-3 setup, then start solo; no destination claims to be current on the session route', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.goto(`/designs/session/${RL}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(RL_TITLE)
  await expect(page.getByTestId('session-phase')).toHaveText('Setup')
  for (const [i, q] of RL_DIVES.entries()) await expect(page.getByTestId(`session-dive-${i + 1}`)).toHaveText(q)
  await expect(page.getByTestId('session-setup').getByRole('link', { name: 'ByteByteGo YouTube (free)' })).toBeVisible()
  await expect(page.getByTestId('design-mode-ai-partner')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('design-mode-skip-ai')).not.toBeChecked()
  await expect(page.getByRole('timer', { name: 'Time left' })).toHaveText('45:00')
  // SHELL-26: the rail is there, but a ticket or session route is no destination, so no item is current
  await expect(page.getByTestId('shell-rail')).toBeVisible()
  await expect(page.getByTestId('shell-rail').locator('[aria-current="page"]')).toHaveCount(0)
  await page.getByTestId('design-mode-skip-ai').check()
  await expect(page.getByTestId('session-setup-summary')).toContainText('Solo')
  await page.getByTestId('session-start').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await expect(page.getByTestId('session-timer')).toHaveText('45:00')
  await expect(page.getByTestId('session-interviewer')).toHaveCount(0)
  await page.getByTestId('session-tab-dives').click()
  await expect(page.getByTestId('session-dive-4')).toBeVisible()
  check()
})

test('D-1 SHELL-26: keys 1-4 navigate from the session page body, but never from the canvas or a text field', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.goto(`/designs/session/${RL}`)
  await expect(page.getByTestId('session-phase')).toHaveText('Setup')
  // focus on the page body: the destinations switch (SHELL-02), 2 then 6 here, with no session started by the key
  await page.keyboard.press('2')
  await expect(page).toHaveURL(/\/path$/)
  await page.goBack()
  await expect(page.getByTestId('session-phase')).toHaveText('Setup')
  await page.keyboard.press('6')
  await expect(page).toHaveURL(/\/review$/)
  await page.goBack()
  await page.getByTestId('design-mode-skip-ai').check()
  await page.getByTestId('session-start').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  // the canvas owns its keys (SHELL-02 / useGlobalKeys): focus on it, 1 and 3 (and 5) do nothing to the route
  await page.getByTestId('kit-canvas').focus()
  await page.keyboard.press('1')
  await page.keyboard.press('3')
  await expect(page).toHaveURL(new RegExp(`/designs/session/${RL}$`))
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  // a text field only types the character (SHELL-04)
  await openNotes(page)
  const field = page.getByTestId('notes-field-req-fn')
  await field.click()
  await page.keyboard.type('2 1')
  await expect(field).toHaveValue('2 1')
  await expect(page).toHaveURL(new RegExp(`/designs/session/${RL}$`))
  // and from the page body again 1 goes Today
  await field.blur()
  await page.locator('body').press('1')
  await expect(page).toHaveURL(/\/$/)
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
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
  await expect(page.getByRole('status').filter({ hasText: 'Canvas locked at 45 minutes' })).toBeVisible()
  check()
})

test('D-8 CLOSE · DESIGN ends the drawing at once (no dialog, R-F2)', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.clock.runFor(12 * MIN)
  await page.getByTestId('session-close-design').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
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
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await expect(page.getByTestId('session-timer')).toHaveText(/^(3[45]:\d\d)$/)
  await page.clock.setSystemTime(new Date(T0.getTime() + 46 * MIN))
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
  await expect(page.getByTestId('session-timer')).toHaveText('00:00')
  check()
})

test('Review Focus #1: opened five hours later, locks at exactly 45 minutes', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.clock.setSystemTime(new Date(T0.getTime() + 5 * 60 * MIN))
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
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
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  // Same session: the timer kept running (real time also passed while navigating).
  await expect(page.getByTestId('session-timer')).toHaveText(/^(4[0-4]):\d\d$/)
  await expect(page.getByTestId('session-setup')).toHaveCount(0)
  check()
})

test('D-12 a live session on ?new=1: Resume goes back to drawing; Discard leaves the setup ready to start (DESIGN-81)', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?new=1`))
  await expect(page.getByTestId('session-setup')).toBeVisible()
  await expect(page.getByTestId('session-live-note')).toContainText('A session is running on this design.')
  await expect(page.getByTestId('session-start')).toHaveCount(0)
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
  // GLOBAL-04/05/06 on the note at 375: no sideways scroll, 14 px floor, square corners; Discard is not the accent
  await page.setViewportSize({ width: 375, height: 667 })
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?new=1`))
  await expect(page.getByTestId('session-live-note')).toBeVisible()
  const m = await page.getByTestId('session-live-note').evaluate(el => ({
    wide: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    small: [el, ...el.querySelectorAll('*')].filter(e => parseFloat(getComputedStyle(e).fontSize) < 14).length,
    round: [...el.querySelectorAll('button')].filter(e => getComputedStyle(e).borderRadius !== '0px').length,
  }))
  expect(m).toEqual({ wide: false, small: 0, round: 0 })
  await expect(page.getByTestId('session-live-discard')).not.toHaveAttribute('data-accent', /.*/)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByTestId('session-live-resume').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await expect(page.getByTestId('session-live-note')).toHaveCount(0)
  expect(await idbCount(page, 'designSessions')).toBe(1)
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?new=1`))
  await page.getByTestId('session-live-discard').click()
  await page.getByTestId('session-discard-confirm').click()
  await expect(page.getByTestId('session-live-note')).toHaveCount(0)
  await expect(page.getByTestId('session-start')).toBeVisible()
  expect(await idbCount(page, 'designSessions')).toBe(0)
  await page.getByTestId('session-start').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  expect(await idbCount(page, 'designSessions')).toBe(1)
  check()
})

test('D-11 discard returns to setup and records nothing', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await page.getByTestId('session-discard').click()
  await page.getByTestId('session-discard-cancel').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await page.getByTestId('session-discard').click()
  await page.getByTestId('session-discard-confirm').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Setup')
  await expect(page.getByTestId('session-timer')).toHaveText('45:00')
  expect(await idbCount(page, 'designSessions')).toBe(0)
  check()
})

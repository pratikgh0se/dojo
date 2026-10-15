import { expect, test } from './fixtures'
import { addKind, begin, drawS1, endDrawing, fillClose, guard, resumeAndGo, RL, scoreS1, startSession } from './design-helpers'

// DESIGN-81 (design-session-v2.md): `/designs/session/<id>?new=1` always shows the setup screen: with a finished session on the design and
// with an open design_rubric redo on it, whether it is reached by a page load or by a move inside the app.
test('DESIGN-81: ?new=1 shows setup after a finished session with a rubric under 14, from the done view, Designs and a reload', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo', RL)
  await drawS1(page)
  await page.clock.runFor(12 * 60_000)
  await endDrawing(page)
  await fillClose(page, 'Where state lives: local, Redis, or gossip; what happens on partition')
  await scoreS1(page)
  await page.getByRole('spinbutton', { name: 'Rubric (0–20)' }).fill('5')
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  await expect(page.getByTestId('session-summary')).toBeVisible()

  // the done view's own door to a new session: setup, no summary
  await page.getByTestId('session-new').click()
  await expect(page).toHaveURL(/\?new=1$/)
  await expect(page.getByTestId('session-start')).toBeVisible()
  await expect(page.getByTestId('session-summary')).toHaveCount(0)

  // a page load of the same route
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?new=1`))
  await expect(page.getByTestId('session-start')).toBeVisible()
  await expect(page.getByTestId('session-summary')).toHaveCount(0)

  // the plain route, with no live session, is the newest finished session's done view
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}`))
  await expect(page.getByTestId('session-summary')).toBeVisible()

  // the Designs screen's "Start redesign" link (a move inside the app) lands on setup too
  await page.goto('/designs')
  const link = page.getByRole('link', { name: /Start redesign/ }).first()
  if (await link.count()) {
    await link.click()
    await expect(page.getByTestId('session-start')).toBeVisible()
    await expect(page.getByTestId('session-summary')).toHaveCount(0)
  }

  // setup from `?new=1`, Start, and the route holds the live session; back to ?new=1 is setup again
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?new=1`))
  await page.getByTestId('design-mode-skip-ai').check()
  await page.getByTestId('session-start').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await addKind(page, 'gateway')
  await page.goBack()
  await page.goForward()
  await expect(page.getByTestId('session-summary')).toHaveCount(0)
  check()
})

test('DESIGN-81 (AI partner): ?new=1 shows setup after an AI-graded session, in the app and on a load', async ({ page }) => {
  test.setTimeout(120_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer', RL)
  await drawS1(page)
  await endDrawing(page)
  await fillClose(page, 'Where state lives: local, Redis, or gossip; what happens on partition')
  await expect(page.getByTestId('session-grade')).toBeVisible()
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
  await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
  await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  await expect(page.getByTestId('session-summary')).toBeVisible()
  await page.getByTestId('session-new').click()
  await expect(page.getByTestId('session-start')).toBeVisible()
  await expect(page.getByTestId('session-summary')).toHaveCount(0)
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?new=1`))
  await expect(page.getByTestId('session-start')).toBeVisible()
  await expect(page.getByTestId('session-summary')).toHaveCount(0)
  check()
})

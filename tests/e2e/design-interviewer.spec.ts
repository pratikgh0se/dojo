import { expect, test, type Page } from '@playwright/test'
import { begin, drawS1, endDrawing, fillClose, guard, pick, resumeAndGo, RL, RL_DIVES, startSession } from './design-helpers'

const msgs = (page: Page) => page.getByTestId('session-msg')
async function answer(page: Page, text: string) {
  const n = await msgs(page).count()
  await page.getByRole('textbox', { name: 'Your answer' }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(msgs(page)).toHaveCount(n + 2)
}

test('D-32/D-33 turn-taking through all four deep dives; D-34 no double send', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  await expect(page.getByTestId('session-interviewer')).toBeVisible()
  await expect(msgs(page)).toHaveCount(1)
  await expect(msgs(page).first()).toHaveAttribute('data-from', 'interviewer')
  await expect(msgs(page).first()).toHaveText(/^\[fake:interview\].*d-ratelimit/)
  await expect(page.getByTestId('session-interview-status')).toHaveText('Requirements')
  await page.getByRole('button', { name: 'Add gateway', exact: true }).click()
  await expect(page.getByTestId('kit-node-gateway-1')).toBeVisible()

  await page.getByRole('textbox', { name: 'Your answer' }).fill('   ')
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Your answer' }).fill('QPS 10k, 1M tenants')
  await page.getByRole('button', { name: 'Send' }).dblclick()
  await expect(msgs(page)).toHaveCount(3)
  await expect(msgs(page).nth(1)).toHaveAttribute('data-from', 'you')
  await expect(msgs(page).nth(1)).toHaveText('QPS 10k, 1M tenants')
  await expect(msgs(page).nth(2)).toHaveText(/^\[fake:interview\].*d-ratelimit/)
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeFocused()
  await expect(page.getByTestId('session-dive-1')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId('session-interview-status')).toHaveText('Deep dive 1 of 4')
  for (let i = 2; i <= 9; i++) {
    await answer(page, `answer ${i}`)
    const dive = Math.ceil(i / 2)
    if (i < 9) {
      await expect(page.getByTestId(`session-dive-${dive}`)).toHaveAttribute('aria-current', 'step')
      await expect(page.getByTestId('session-interview-status')).toHaveText(`Deep dive ${dive} of 4`)
    }
  }
  await expect(page.locator('[data-testid="session-msg"][data-from="you"]')).toHaveCount(9)
  await expect(page.locator('[data-testid="session-msg"][data-from="interviewer"]')).toHaveCount(10)
  await expect(page.getByTestId('session-interview-status')).toHaveText('Interview complete · 4 of 4 deep dives')
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeDisabled()
  check()
})

test('D-35 transcript survives reload without re-asking; D-36 lock stops it', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  for (const a of ['a1', 'a2', 'a3']) await answer(page, a)
  const before = await msgs(page).allTextContents()
  await page.clock.runFor(1000)
  await resumeAndGo(page, () => page.reload())
  await expect(msgs(page)).toHaveCount(7)
  expect(await msgs(page).allTextContents()).toEqual(before)
  await endDrawing(page)
  await expect(page.getByTestId('session-interview-status')).toHaveText('Interview stopped')
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeDisabled()
  await expect(page.getByTestId('session-close')).toBeVisible()
  check()
})

test('D-36 the 45-minute lock stops the interview', async ({ page }) => {
  // Advancing a virtual clock 45 real minutes still processes every 1 s `useNow` tick along the
  // way; that real CPU cost runs close to Playwright's default 30 s test timeout on this machine.
  test.setTimeout(60_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  await page.clock.runFor(45 * 60_000)
  await expect(page.getByTestId('session-interview-status')).toHaveText('Interview stopped at 45 minutes')
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeDisabled()
  check()
})

test('D-37/D-38 interviewer grade prefills the score form (data set S2), stored for the Done view', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  await drawS1(page)
  for (let i = 1; i <= 9; i++) await answer(page, `answer ${i}`)
  await endDrawing(page)
  await fillClose(page, RL_DIVES[0])
  const score = page.getByTestId('session-score')
  const checked = async (group: string) => {
    const radios = score.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio')
    for (let v = 0; v < 3; v++) if (await radios.nth(v).isChecked()) return v
    return -1
  }
  await expect(page.getByTestId('session-grade')).toBeVisible()
  expect(await Promise.all(RL_DIVES.map(q => checked(q)))).toEqual([1, 1, 2, 1])
  expect(await Promise.all(['Load', 'Data', 'Consistency', 'Failure', 'Latency', 'Cost', 'Evolution'].map(l => checked(l)))).toEqual([2, 1, 1, 1, 1, 0, 1])
  await expect(score.getByRole('spinbutton', { name: 'Rubric (0–20)' })).toHaveValue('15')
  await expect(page.getByTestId('session-grade').getByRole('listitem')).toHaveCount(5)
  await expect(page.getByTestId('session-grade')).toContainText('One thing to study: [fake:interview] d-ratelimit')
  await pick(page, 'Cost', 1)
  await pick(page, 'Cost', 0)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
  await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
  await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
  await page.getByRole('button', { name: 'Complete session' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('done')
  await expect(page.getByTestId('session-summary')).toContainText(/Interviewer · \d+ min · rubric 15 \/ 20/)
  await expect(page.getByTestId('session-redesign')).toHaveCount(0)
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('done')
  await expect(page.getByText('Transcript', { exact: true })).toBeVisible()
  await expect(msgs(page)).toHaveCount(19)
  await expect(page).toHaveURL(new RegExp(`/designs/session/${RL}\\?session=`))
  check()
})

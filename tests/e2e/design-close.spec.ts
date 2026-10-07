import { expect, test } from '@playwright/test'
import { begin, completeS1, drawS1, endDrawing, fillClose, guard, pick, resumeAndGo, RL_DIVES, startSession } from './design-helpers'

const Q = [
  'What was the hardest trade-off and which side did you take?',
  'What breaks first at 10× load, and what would you change?',
  'Where is the data, who owns it, and what is eventually consistent?',
  'Which deep dive could you not answer without notes?',
  'One thing you would read next.',
]

test('D-24/D-25 close questions, gating and reload', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await endDrawing(page)
  const f = page.getByTestId('session-close')
  await expect(f).toBeVisible()
  for (const q of Q) await expect(f.getByText(q, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next: score' })).toBeDisabled()
  await f.getByRole('textbox', { name: 'Chose' }).fill('sliding window counter in Redis')
  await f.getByRole('textbox', { name: Q[1] }).fill('Redis hot key')
  await page.clock.runFor(1000)
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('close')
  await expect(page.getByTestId('kit-canvas')).toHaveAttribute('data-locked', 'true')
  await expect(page.getByTestId('session-close').getByRole('textbox', { name: 'Chose' })).toHaveValue('sliding window counter in Redis')
  await expect(page.getByTestId('session-close').getByRole('textbox', { name: Q[1] })).toHaveValue('Redis hot key')
  const q4 = page.getByRole('radiogroup', { name: Q[3] })
  await expect(q4.getByRole('radio')).toHaveCount(5)
  await expect(q4.getByRole('radio', { name: 'None, I answered all four' })).toBeVisible()
  check()
})

test('D-26/D-27 Q4 caps a dive, Q1 becomes trade-off 1; D-29 shape', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await endDrawing(page)
  await fillClose(page, RL_DIVES[1])
  const score = page.getByTestId('session-score')
  await expect(score.getByRole('radiogroup', { name: RL_DIVES[1], exact: true }).getByRole('radio', { name: '2', exact: true })).toBeDisabled()
  const row1 = page.getByTestId('session-tradeoff-row-1')
  await expect(row1.getByRole('textbox', { name: 'Chose' })).toHaveValue('sliding window counter in Redis')
  await expect(row1.getByRole('textbox', { name: 'Over' })).toHaveValue('token bucket per node')
  await expect(row1.getByRole('textbox', { name: 'Because' })).toHaveValue('global limit needs shared state; 2 ms Redis RTT is fine')
  for (const q of RL_DIVES) {
    const g = score.getByRole('radiogroup', { name: q, exact: true })
    await expect(g.getByRole('radio', { name: '0', exact: true })).toHaveAccessibleDescription('blank')
    await expect(g.getByRole('radio', { name: '1', exact: true })).toHaveAccessibleDescription('hand-wave')
    await expect(g.getByRole('radio', { name: '2', exact: true })).toHaveAccessibleDescription('trade-off with a number or failure mode')
  }
  for (const l of ['Load', 'Data', 'Consistency', 'Failure', 'Latency', 'Cost', 'Evolution']) {
    await expect(score.getByRole('radiogroup', { name: l, exact: true }).getByRole('radio')).toHaveCount(3)
  }
  const rubric = score.getByRole('spinbutton', { name: 'Rubric (0–20)' })
  await rubric.fill('21')
  await expect(rubric).toHaveAttribute('aria-invalid', 'true')
  await rubric.fill('12.5')
  await expect(rubric).toHaveAttribute('aria-invalid', 'true')
  await rubric.fill('12')
  await expect(rubric).not.toHaveAttribute('aria-invalid', 'true')
  await expect(score).toContainText('Requirements and numbers (4) · API and data model (3) · High-level design that meets the numbers (4) · Two deep dives with real trade-offs (6) · Failure modes and operations (3)')
  await pick(page, RL_DIVES[0], 2)
  await expect(page.getByRole('button', { name: 'Complete session' })).toBeDisabled()
  check()
})

test('D-31/D-45 solo S1 completes with +20 xp and queues a redesign', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await completeS1(page)
  await expect(page.getByTestId('toast').filter({ hasText: '+20 xp · Saved' })).toBeVisible()
  const summary = page.getByTestId('session-summary')
  await expect(summary).toContainText('Solo · 12 min · rubric 12 / 20')
  await expect(summary).toContainText('2 · 1 · 2 · 0')
  await expect(summary).toContainText('Load 2 · Data 1 · Consistency 1 · Failure 0 · Latency 2 · Cost 1 · Evolution 1')
  await expect(page.getByTestId('session-redesign')).toHaveText('Redesign due 2026-11-10')
  await expect(page).toHaveURL(/\/designs\/session\/d-ratelimit\?session=/)
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('done')
  check()
})

test('no redesign at rubric 14 without a zero (D-45 boundary)', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page)
  await drawS1(page)
  await endDrawing(page)
  await fillClose(page, 'None, I answered all four')
  for (const q of RL_DIVES) await pick(page, q, 1)
  for (const l of ['Load', 'Data', 'Consistency', 'Failure', 'Latency', 'Cost', 'Evolution']) await pick(page, l, 1)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('a')
  await row2.getByRole('textbox', { name: 'Over' }).fill('b')
  await row2.getByRole('textbox', { name: 'Because' }).fill('c')
  await page.getByRole('spinbutton', { name: 'Rubric (0–20)' }).fill('14')
  await page.getByRole('button', { name: 'Complete session' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('done')
  await expect(page.getByTestId('session-redesign')).toHaveCount(0)
  check()
})

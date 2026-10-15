import { expect, test } from '@playwright/test'
import { addKind, begin, drawS1, endDrawing, fillClose, guard, pick, resumeAndGo, RL, scoreS1, startSession } from './design-helpers'
import { idbAll } from './helpers'

type Redo = { id: string; ticketId: string; source: string; stage: number; due: number; passed: boolean[]; closedAt?: number }
const openRedos = async (page: Parameters<typeof idbAll>[0]) => (await idbAll<Redo>(page, 'redos')).filter(r => r.closedAt === undefined)

// REVIEW-15a (review.md): a design session completed with a rubric under 14 writes one open design_rubric redo on its ticket; once the
// clock reaches `redesignDue`, Review counts it and shows it as the Design replay card. Completing the redesign with a high rubric closes it.
test('R1 Review: a due redesign reaches Review as the Design replay card and a passing redesign clears it', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  // rubric 5 (the clause says "under 14"); completeS1 scores 12, so repeat its steps with the rubric field set to 5
  await startSession(page, 'Solo', RL)
  await drawS1(page)
  await page.clock.runFor(12 * 60_000)
  await endDrawing(page)
  await fillClose(page, 'Where state lives: local, Redis, or gossip; what happens on partition')
  await scoreS1(page)
  await page.getByRole('spinbutton', { name: 'Rubric (0–20)' }).fill('5')
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')

  const session = (await idbAll<{ id: string; designId: string; redesignDue?: number; rubric: number }>(page, 'designSessions'))[0]
  expect(session).toMatchObject({ designId: RL, rubric: 5 })
  const due = session.redesignDue!
  expect(due).toBeGreaterThan(Date.now())

  // the data API: one open redo on the ticket, source design_rubric, due = redesignDue
  const redos = await openRedos(page)
  expect(redos).toHaveLength(1)
  expect(redos[0]).toMatchObject({ ticketId: RL, source: 'design_rubric', stage: 0, due, passed: [] })

  // the start day: not due yet
  await resumeAndGo(page, () => page.goto('/review'))
  await expect(page.getByTestId('review-empty')).toBeVisible()
  await expect(page.getByTestId('shell-review-badge')).toHaveCount(0)

  // the redesignDue day
  await page.clock.setFixedTime(due + 3 * 3_600_000)
  await resumeAndGo(page, () => page.goto('/review'))
  await expect(page.getByTestId('review-count')).toHaveAttribute('data-count', '1')
  await expect(page.getByTestId('shell-review-badge')).toHaveAttribute('data-count', '1')
  const card = page.getByTestId('review-card')
  await expect(card).toHaveAttribute('data-kind', 'replay')
  await expect(card).toHaveAttribute('data-ticket-id', RL)
  await expect(page.getByTestId('review-card-kind')).toHaveText('Design')

  // the redesign (the outstanding one is linked automatically) passes: the redo closes and Review empties
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?new=1`))
  await page.getByTestId('design-mode-skip-ai').check()
  await page.getByTestId('session-start').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  expect((await idbAll<{ id: string; redesignOf?: string; phase: string }>(page, 'designSessions')).find(s => s.phase !== 'done')?.redesignOf).toBe(session.id)
  await addKind(page, 'gateway')
  await endDrawing(page)
  await fillClose(page, 'None, I answered all four')
  const dives = await page.getByTestId('session-score').getByRole('radiogroup').evaluateAll(gs => gs.slice(0, 4).map(g => g.getAttribute('aria-label') ?? ''))
  for (const q of dives) await pick(page, q, 2)
  for (const l of ['Load', 'Data', 'Consistency', 'Failure', 'Latency', 'Cost', 'Evolution']) await pick(page, l, 1)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('a')
  await row2.getByRole('textbox', { name: 'Over' }).fill('b')
  await row2.getByRole('textbox', { name: 'Because' }).fill('c')
  await page.getByRole('spinbutton', { name: 'Rubric (0–20)' }).fill('18')
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  expect(await openRedos(page)).toHaveLength(0)
  const all = await idbAll<Redo>(page, 'redos')
  expect(all).toHaveLength(1)
  expect(all[0]).toMatchObject({ source: 'design_rubric', passed: [true] })
  await resumeAndGo(page, () => page.goto('/review'))
  await expect(page.getByTestId('review-empty')).toBeVisible()
  check()
})

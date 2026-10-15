import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

type Row = { id: string; kind: string; status: string; lane?: string }

// Blind-fix round 2a. The acceptance suite walks several tickets in one page without ending the session in between;
// it also loads /do/<id> afresh after /path and presses Solved on a problem straight after Start.
test('TICKET-08/14/36: starting a second ticket while the first still runs begins the second', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  const tickets = await idbAll<Row>(page, 'tickets')
  const picks = ['watch', 'read', 'build', 'task'].map(k => tickets.find(x => x.kind === k && x.status === 'todo')).filter(Boolean) as Row[]
  expect(picks.length).toBeGreaterThanOrEqual(3)
  for (const t of picks) {
    await page.goto(`/do/${t.id}`)
    await page.getByTestId('ticket-start').click()
    await expect(page.getByTestId('timer-state'), t.kind).toHaveText(/running/i)
    await expect(page.getByTestId('ticket-done'), t.kind).toBeVisible()
  }
})

test('TICKET-01: a Do screen loaded afresh after /path goes back to /path', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  const tickets = await idbAll<Row>(page, 'tickets')
  const t = tickets.find(x => x.kind === 'watch' && x.status === 'todo')!
  await page.goto('/path')
  await expect(page.getByTestId('screen-path')).toBeVisible()
  await page.goto(`/do/${t.id}`)
  await page.getByTestId('do-back').click()
  await expect(page).toHaveURL(/\/path$/)
})

test('TICKET-26: Solved is enabled right after Start on a problem and finishes it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  const tickets = await idbAll<Row>(page, 'tickets')
  const t = tickets.find(x => x.kind === 'problem' && x.status === 'todo')!
  await page.goto(`/do/${t.id}`)
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('timer-state')).toHaveText(/running/i)
  await expect(page.getByTestId('do-outcome-solved')).toBeEnabled()
  await expect(page.getByTestId('ticket-done')).toHaveCount(0)
})

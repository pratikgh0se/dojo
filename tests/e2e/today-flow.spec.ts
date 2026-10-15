import { expect, test } from './fixtures'
import { IST, idbAll, onboard } from './helpers'

type Row = { id: string; status: string; xp?: number; doneAt?: string }

// R1 Today (TODAY-24, TICKET-03, TICKET-10): start the quest, finish it with Done, and the data shows one finished ticket and one session.
// Runs in the default project on Dexie and in `real` against dojo-server (tests/e2e/real/subset.ts).
test('R1 Today: Start opens the quest ticket, Done finishes it, and the ticket, its XP and one session are stored', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  await page.getByTestId('start-button').click()
  await expect(page).toHaveURL(/\/do\/[^/?#]+$/)
  const id = decodeURIComponent(new URL(page.url()).pathname.split('/')[2])
  await expect.poll(async () => (await idbAll<Row>(page, 'tickets')).find(t => t.id === id)?.status).toBe('doing')
  await expect(page.getByTestId('ticket-start')).toHaveCount(0)

  await page.getByTestId('ticket-done').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await expect.poll(async () => (await idbAll<Row>(page, 'tickets')).find(t => t.id === id)?.status).toBe('done')
  const done = (await idbAll<Row>(page, 'tickets')).find(t => t.id === id)!
  expect(done.doneAt).toBeTruthy()
  expect(done.xp).toBeGreaterThan(0)
  const sessions = (await idbAll<{ ticketId: string }>(page, 'sessions')).filter(s => s.ticketId === id)
  expect(sessions).toHaveLength(1)

  // A reload on /do/<dotted id> must come back to the same finished ticket (dojo-server falls back to the app for it).
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/do/${id.replace(/[.]/g, '\\.')}$`))
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await page.getByTestId('do-back').click()
  await expect(page.getByTestId('screen-today')).toBeVisible()
})

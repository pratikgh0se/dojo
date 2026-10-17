import { expect, test } from './fixtures'
import { IST, idbAll, idbPatch, onboard } from './helpers'

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

// R3 TODAY-57: a DSA quest still shows the learner's path phase in the header (it used to be blank).
test('R3 Today: with a DSA ticket first, the header still names the path phase (TODAY-57)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-11-04T10:00:00'))
  await onboard(page, '2026-11-02')
  await idbPatch(page, 'tickets', ['m1w1i1'], { orderOverride: 0 })
  await page.reload()
  await page.locator('[data-testid="screen-today"][data-ready="true"]').waitFor()
  await expect(page.getByTestId('today-quest')).toHaveAttribute('data-ticket-id', 'm1w1i1')
  await expect(page.getByTestId('today-phase-line')).toHaveText(/^Phase 1 of 6 · \S/)
})

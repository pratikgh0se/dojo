import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard, serveLegacyPlan } from './helpers'

type Row = { id: string; status?: string; xp?: number; learnerNotes?: string }
type SessionRow = { ticketId: string; start: number; minutes: number; outcome: string; xpDelta: number }

// R1 (TICKET-03/04/10/13/14/17): Start from Today opens the ticket with its one timer already running, a reload keeps the clock and the
// typed notes, and Done is the single completion path (ticket, XP and one session row).
test('M3: Today → Start → Do (timer already running) → open the link → reload keeps it → notes → Done', async ({ page, context }) => {
  const start = IST('2026-09-21T21:10:00')
  await serveLegacyPlan(page)
  await context.route('https://example.com/**', route => route.fulfill({ status: 200, body: 'ok' }))
  await page.clock.setFixedTime(start)
  await onboard(page)

  await page.getByTestId('start-button').click()
  await expect(page).toHaveURL(/\/do\/m1w1t1$/)
  // TICKET-04: no start control and no "--:--" idle reading; the clock runs at the remembered 25 minutes
  await expect(page.getByTestId('ticket-start')).toHaveCount(0)
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('timer-readout')).toHaveText('25:00')

  // TICKET-14: the resource link opens in a new tab and leaves the timer running
  const link = page.getByTestId('ticket-link')
  await expect(link).toHaveAttribute('href', 'https://example.com/tour')
  await expect(link).toHaveAttribute('target', '_blank')
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
  await popup.close()
  await expect(page.getByTestId('timer-state')).toHaveText('running')

  await page.getByTestId('ticket-notes').fill('drew all 8 chapters; shear and rotation matrices by hand')
  await expect.poll(async () => (await idbAll<Row>(page, 'tickets')).find(t => t.id === 'm1w1t1')?.learnerNotes).toBe('drew all 8 chapters; shear and rotation matrices by hand')

  await page.clock.setFixedTime(new Date(start.getTime() + 5 * 60_000))
  await page.reload()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('timer-readout')).toHaveText('20:00')
  await expect(page.getByTestId('ticket-notes')).toHaveValue('drew all 8 chapters; shear and rotation matrices by hand')

  await page.getByTestId('ticket-done').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await expect(page.getByTestId('ticket-done')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.dataset.flashes)).toBe('1')

  const tickets = await idbAll<Row>(page, 'tickets')
  expect(tickets.find(t => t.id === 'm1w1t1')).toMatchObject({
    status: 'done', xp: 10, learnerNotes: 'drew all 8 chapters; shear and rotation matrices by hand',
  })
  const sessions = await idbAll<SessionRow>(page, 'sessions')
  expect(sessions).toHaveLength(1)
  expect(sessions[0]).toMatchObject({ ticketId: 'm1w1t1', start: start.getTime(), minutes: 5, xpDelta: 10 })

  await page.getByTestId('do-back').click()
  await expect(page.getByTestId('screen-today')).toBeVisible()
  await expect(page.getByTestId('xp-total')).toHaveAttribute('data-value', '10')
  await expect(page.getByTestId('shell-header').getByTestId('level')).toHaveAttribute('data-value', '1')
})

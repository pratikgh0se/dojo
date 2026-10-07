import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard, serveLegacyPlan } from './helpers'

type Row = { id: string; status?: string; xp?: number; proof?: { repo?: string; note?: string } }
type SessionRow = { ticketId: string; start: number; minutes: number; outcome: string; xpDelta: number }

test('M3: Today → Start → Do → Open starts timer → reload keeps it → Proof → Solved', async ({ page, context }) => {
  const start = IST('2026-09-21T21:10:00')
  await serveLegacyPlan(page)
  await context.route('https://www.3blue1brown.com/**', route => route.fulfill({ status: 200, body: 'ok' }))
  await page.clock.setFixedTime(start)
  await onboard(page)

  await page.getByTestId('start-button').click()
  await expect(page).toHaveURL(/\/do\/m1w2t1$/)
  await expect(page.getByTestId('timer-readout')).toHaveText('--:--')
  await expect(page.locator('header.topbar')).toHaveCount(0)

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('link', { name: 'Open ▸ 3Blue1Brown linear algebra' }).click(),
  ])
  await popup.close()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('timer-readout')).toHaveText('25:00')

  await page.getByLabel('Repo / commit URL').fill('https://github.com/example-user/la-notes')
  await page.getByLabel('Proof').fill('drew all 8 chapters; shear and rotation matrices by hand')

  await page.clock.setFixedTime(new Date(start.getTime() + 5 * 60_000))
  await page.reload()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('timer-readout')).toHaveText('20:00')
  await expect(page.getByLabel('Repo / commit URL')).toHaveValue('https://github.com/example-user/la-notes')

  await page.getByRole('button', { name: 'Solved ✓' }).click()
  await expect(page).toHaveURL(/\/board$/)
  await expect(page.getByTestId('toast').filter({ hasText: '+10 xp' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.flashes)).toBe('1')
  await expect(page.getByTestId('count-done')).toHaveText('1')

  const tickets = await idbAll<Row>(page, 'tickets')
  expect(tickets.find(t => t.id === 'm1w2t1')).toMatchObject({
    status: 'done', xp: 10, proof: { repo: 'https://github.com/example-user/la-notes', note: 'drew all 8 chapters; shear and rotation matrices by hand' },
  })
  const sessions = await idbAll<SessionRow>(page, 'sessions')
  expect(sessions).toHaveLength(1)
  expect(sessions[0]).toMatchObject({ ticketId: 'm1w2t1', start: start.getTime(), minutes: 5, outcome: 'solved', xpDelta: 10 })

  await page.getByRole('link', { name: 'Today' }).click()
  await expect(page.getByTestId('xp-total')).toHaveText('10 XP')
  await expect(page.getByTestId('level')).toHaveText('LV 1')
})

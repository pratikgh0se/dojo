import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

// The one new e2e against the live capstone plan.json (not the frozen fixture):
// onboarding on Sprint 1 Day 1 (Mon 2026-10-05) and stepping through the week
// picks the Stage 0 week-1 watch/rebuild/build tickets in turn.
type TicketRow = { id: string; text?: string }

test('capstone: Stage 0 week-1 rotation on the live plan (Sprint 1 = Mon 2026-10-05)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-05T09:00:00'))
  await onboard(page, '2026-10-05')

  await page.clock.setFixedTime(IST('2026-10-05T21:10:00'))
  await page.reload()
  await expect(page.getByTestId('now-eyebrow')).toContainText('SPRINT 1 · DAY 1 OF 14 · AI · watch')
  await expect(page.getByTestId('start-button')).toHaveAttribute('href', '/do/stage-00-setup-w1-watch')

  await page.clock.setFixedTime(IST('2026-10-07T21:10:00'))
  await page.reload()
  await expect(page.getByTestId('now-eyebrow')).toContainText('SPRINT 1 · DAY 3 OF 14 · AI · rebuild')
  await expect(page.getByTestId('start-button')).toHaveAttribute('href', '/do/stage-00-setup-w1-rebuild')

  await page.clock.setFixedTime(IST('2026-10-10T21:10:00'))
  await page.reload()
  await expect(page.getByTestId('now-eyebrow')).toContainText('SPRINT 1 · DAY 6 OF 14 · AI · build + break')
  await expect(page.getByTestId('start-button')).toHaveAttribute('href', '/do/stage-00-setup-w1-build')

  const tickets = await idbAll<TicketRow>(page, 'tickets')
  const buildTicket = tickets.find(t => t.id === 'stage-00-setup-w1-build')
  expect(buildTicket?.text).toContain('forge/labs/00-black-box')
})

import { expect, test, type Page } from './fixtures'
import { freeze } from './design-helpers'
import { IST, idbAll, onboard } from './helpers'

// TICKET-03 (ticket-view.md): after Start `timer-readout` reads 25:00 and counts down once per second. The 1 s interval that drives the readout
// used to be started when the page mounted, not at Start, so the first reading after Start repeated 25:00 a second late (flaky, then constant).
// The readout ticks on the session's own seconds (useSecondsNow anchored at the phase start), like the design session's countdown (DESIGN-06).
const T0 = IST('2026-10-06T21:10:00')

type Row = { id: string; kind: string; status: string }

async function openAndStart(page: Page, kind: 'watch' | 'problem') {
  await page.clock.install({ time: T0 })
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  const todo = (await idbAll<Row>(page, 'tickets')).filter(t => t.kind === kind && t.status === 'todo')
  await page.goto(`/do/${todo[0]!.id}`)
  await expect(page.getByTestId('screen-do')).toBeVisible()
  await expect(page.getByTestId('timer-state')).toHaveText('ready')
  // the page has been mounted for an arbitrary part of a second: the readout's interval must not depend on that
  await freeze(page)
  await page.clock.runFor(317)
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
}

for (const kind of ['watch', 'problem'] as const) {
  test(`TICKET-03: the ${kind} ticket's readout reads 25:00 at Start, then 24:59 one second later, then 24:58`, async ({ page }) => {
    await openAndStart(page, kind)
    const readout = page.getByTestId('timer-readout')
    await expect(readout).toHaveCount(1)
    await expect(readout).toHaveText('25:00')
    await page.clock.runFor(1000)
    await expect(readout).toHaveText('24:59')
    await page.clock.runFor(1000)
    await expect(readout).toHaveText('24:58')
    await page.clock.runFor(2000)
    await expect(readout).toHaveText('24:56')
  })
}

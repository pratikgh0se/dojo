import { expect, test } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

type Row = { id: string; kind: string; status: string }

// Review N4: on a not-started watch, read or build ticket the one START is on screen at 1280 x 800 without scrolling
// (it used to sit under the notes and the explain section, near y = 1300). TICKET-33: still exactly one start control.
test('N4: START is inside the first screen on a not-started watch, read and build ticket at 1280 x 800', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  const tickets = await idbAll<Row>(page, 'tickets')
  for (const kind of ['watch', 'read', 'build']) {
    const t = tickets.find(x => x.kind === kind && x.status === 'todo')
    expect(t, `a not-started ${kind} ticket in the plan`).toBeTruthy()
    await page.goto(`/do/${t!.id}`)
    const start = page.getByTestId('ticket-start')
    await expect(start, kind).toHaveCount(1)
    await expect(start, kind).toBeVisible()
    const box = (await start.boundingBox())!
    expect(box.y + box.height, `${kind}: START bottom, page not scrolled`).toBeLessThanOrEqual(800)
    expect(await page.evaluate(() => window.scrollY), kind).toBe(0)
    // the header card holds it, under the title
    const card = page.locator('.dk-card', { has: page.getByTestId('do-title') })
    await expect(card.getByTestId('ticket-start'), kind).toBeVisible()
  }
})

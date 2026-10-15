import { expect, test } from '@playwright/test'
import { begin, endDrawing, fillClose, guard, liveRow, pick, RL_DIVES, startSession } from './design-helpers'

// R1 F4: the partner card's notes box. The friend types notes beside the scores, one save keeps both, and the host reads them (score phase, done view).
const SHOTS = process.env.F4_SHOTS // a directory: set it to write the after screenshots
const NOTE = 'Asked about scale before drawing anything.\nGave a sum for ingest but not for reads.'

for (const vp of [{ name: '1280', width: 1280, height: 800 }, { name: '375', width: 375, height: 800 }]) {
  test(`F4 notes box: typed with the scores, saved together, read by the host in the score phase and the done view (${vp.name})`, async ({ page, context }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const check = guard(page)
    await context.addInitScript(() => { window.open = () => null }) // the card sits in the Partner tab
    await begin(page)
    await startSession(page, 'With someone')
    await page.getByTestId('session-tab-partner').click()
    await page.getByTestId('partner-open-window').click()
    const card = page.getByTestId('partner-card')
    await expect(card).toBeVisible()

    // the box: empty, with a counter and the hint, below the scoring sheet, nothing written on load
    const notes = card.getByTestId('partner-notes')
    await expect(notes).toHaveValue('')
    await expect(card.getByTestId('partner-notes-counter')).toHaveText('0 / 2000')
    await expect(card).toContainText('Your scores and notes reach the host when you save. No AI speaks in this mode.')
    expect((await liveRow(page)).partner).toEqual({})
    expect((await notes.boundingBox())!.height).toBeGreaterThanOrEqual(130)

    // typing notes alone sets Unsaved changes; the one accent saves scores and notes together
    await notes.fill(NOTE)
    await expect(card.getByTestId('partner-notes-counter')).toHaveText(`${NOTE.length} / 2000`)
    await expect(card.getByTestId('partner-status')).toHaveText('Unsaved changes')
    await card.getByTestId('partner-name').fill('Sam')
    for (const [n, v] of [[1, 3], [2, 3], [3, 3], [4, 3], [5, 2]]) await card.getByTestId(`partner-score-${n}-${v}`).check()
    await card.getByTestId('partner-score-dive-1-2').check()
    await card.getByTestId('partner-save').click()
    await expect(card.getByTestId('partner-status')).toHaveText('Saved')
    await expect.poll(async () => (await liveRow(page)).partner, { timeout: 2000 }).toMatchObject({
      name: 'Sam', notes: NOTE, scores: { perItem: [3, 3, 3, 3, 2], deepDives: [2, null, null, null] },
    })
    // no sideways scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width)
    if (SHOTS) await card.scrollIntoViewIfNeeded().then(() => page.screenshot({ path: `${SHOTS}/feat-f4-card-tab-${vp.name}.png`, fullPage: true }))

    // the card page (what the friend sees in its own window)
    const id = (await liveRow(page)).id
    await page.clock.resume()
    const win = await context.newPage()
    await win.setViewportSize({ width: vp.width, height: vp.height })
    await win.goto(`/#/partner/${id}`)
    await expect(win.getByTestId('partner-notes')).toHaveValue(NOTE)
    await expect(win.locator('[data-accent="primary"]')).toHaveCount(1)
    expect(await win.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width)
    if (vp.width >= 1100) { // DESIGN-108: in the right column, below the last score row, right of the prompt
      const [n, t, pr, s5] = await Promise.all(['partner-notes', 'partner-total', 'partner-prompt', 'partner-score-5'].map(id => win.getByTestId(id).boundingBox()))
      expect(n!.y).toBeGreaterThan(t!.y + t!.height - 1)
      expect(n!.y).toBeGreaterThan(s5!.y)
      expect(n!.x).toBeGreaterThanOrEqual(pr!.x + pr!.width)
    }
    await win.getByTestId('partner-notes').fill('q'.repeat(2500))
    await expect(win.getByTestId('partner-notes-counter')).toHaveText('2000 / 2000')
    await win.getByTestId('partner-notes').fill(NOTE) // back to the saved text, unsaved
    if (SHOTS) await win.screenshot({ path: `${SHOTS}/feat-f4-card-${vp.name}.png`, fullPage: true })
    await win.close()

    // the host: score phase shows the notes read-only under the prefilled line
    await endDrawing(page)
    await fillClose(page, RL_DIVES[3])
    const shown = page.getByTestId('session-partner-notes')
    await expect(shown).toBeVisible()
    await expect(shown).toContainText("Your partner's notes")
    await expect(page.getByTestId('session-partner-notes-text')).toContainText('Asked about scale before drawing anything.')
    await expect(shown).toContainText('Asked about scale before drawing anything.')
    await expect(shown).toContainText('Gave a sum for ingest but not for reads.')
    await expect(shown.locator('input, textarea')).toHaveCount(0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/feat-f4-score-${vp.name}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width)

    // the done view
    for (const [i, v] of [1, 2, 1].entries()) await page.getByTestId(`session-dive-score-${i + 2}-${v}`).check()
    for (const [name, v] of Object.entries({ Load: 2, Data: 1, Consistency: 1, Failure: 0, Latency: 2, Cost: 1, Evolution: 1 })) await pick(page, name, v as 0 | 1 | 2)
    const row2 = page.getByTestId('session-tradeoff-row-2')
    await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
    await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
    await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
    await page.getByTestId('session-complete').click()
    await expect(page.getByTestId('session-phase')).toHaveText('Done')
    const done = page.getByTestId('session-partner-notes')
    await expect(done).toBeVisible()
    await expect(done).toContainText("Your partner's notes")
    await expect(page.getByTestId('session-partner-notes-text')).toContainText('Gave a sum for ingest but not for reads.')
    await expect(page.getByTestId('session-grade')).toContainText('Scored by your partner, Sam')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/feat-f4-done-${vp.name}.png`, fullPage: true })

    // DESIGN-114: the same page sent to the card route (a hash-only change) shows the finished card, read-only, with the saved note
    const sessionId = (await liveRow(page)).id as string
    await page.evaluate(sid => { window.location.hash = `#/partner/${sid}` }, sessionId)
    await expect(page.getByTestId('partner-card')).toBeVisible()
    await expect(page.getByTestId('partner-notes')).toBeDisabled()
    await expect(page.getByTestId('partner-notes')).toHaveValue(NOTE)
    await expect(page.getByTestId('partner-notes-counter')).toHaveText(`${NOTE.length} / 2000`)
    await expect(page.getByTestId('partner-card')).toContainText('This session is finished.')
    check()
  })
}

test('F4 an empty note: Save works, and the host sees no notes block anywhere', async ({ page, context }) => {
  test.setTimeout(90_000)
  const check = guard(page)
  await context.addInitScript(() => { window.open = () => null })
  await begin(page)
  await startSession(page, 'With someone')
  await page.getByTestId('session-tab-partner').click()
  await page.getByTestId('partner-open-window').click()
  const card = page.getByTestId('partner-card')
  for (const [n, v] of [[1, 3], [2, 3], [3, 3], [4, 3], [5, 2]]) await card.getByTestId(`partner-score-${n}-${v}`).check()
  await card.getByTestId('partner-save').click()
  await expect(card.getByTestId('partner-status')).toHaveText('Saved')
  expect((await liveRow(page)).partner).not.toHaveProperty('notes')
  await endDrawing(page)
  await fillClose(page, RL_DIVES[3])
  await expect(page.getByTestId('session-score-prefilled')).toBeVisible()
  await expect(page.getByTestId('session-partner-notes')).toHaveCount(0)
  check()
})

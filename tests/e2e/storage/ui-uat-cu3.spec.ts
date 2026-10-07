import { expect, test, type Page } from '@playwright/test'
import { draftSprint1, openApp, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-3 (dojo-acceptance/reports/uat/cu-3.md, 96c58d5) that need a drafted brief or a
// split card, so they run against the real server: P3-1 Draft briefs with nothing to draft, P3-5 the Done counts, P3-8 the
// select arrows in Edit brief.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

const briefCalls = async () => (await rows(srv, 'aiLog')).filter(r => r.job === 'brief').length

test('cu-3 P3-1: Draft briefs with every card already briefed says so, asks the AI nothing and has no "×"', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  await expect(page.getByTestId('brief-dismiss')).toBeVisible() // a real result is dismissable
  await page.getByTestId('brief-dismiss').click()
  const calls = await briefCalls()
  expect(calls).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Every card in Sprint 1 already has a brief')
  await expect(page.getByTestId('brief-dismiss')).toHaveCount(0)
  await expect(page.getByTestId('brief-failed')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Draft briefs for Sprint 1' })).toBeEnabled()
  await page.waitForTimeout(500)
  expect(await briefCalls()).toBe(calls)
  // it is a note, not a result: it is not there after a reload
  await page.reload()
  await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('brief-progress')).toHaveCount(0)
  await ctx.close()
})

test('cu-3 P3-8: Edit brief\'s "Day type" and "Deliverable kind" selects draw their arrow, like every select', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  for (const name of ['Day type', 'Deliverable kind']) {
    const sel = ed.getByRole('combobox', { name })
    await expect(sel).toBeVisible()
    const s = await sel.evaluate(e => { const c = getComputedStyle(e); return { image: c.backgroundImage, right: c.paddingRight, color: c.backgroundColor } })
    expect(s.image, `${name} arrow`).toContain('linear-gradient')
    expect(s.right, `${name} room for the arrow`).toBe('24px')
    expect(s.color).toBe('rgb(15, 17, 28)') // the well fill stays
    // and it is on screen: the select's right edge differs from the same select with its arrow taken away
    await sel.scrollIntoViewIfNeeded()
    const box = (await sel.boundingBox())!
    const clip = { x: box.x + box.width - 22, y: box.y + 4, width: 16, height: box.height - 8 }
    const withArrow = await page.screenshot({ clip })
    await sel.evaluate(e => { (e as HTMLElement).style.backgroundImage = 'none' })
    const without = await page.screenshot({ clip })
    expect(withArrow.equals(without), `${name}: the arrow is drawn`).toBe(false)
  }
  await ctx.close()
})

/** p200 with a drafted brief cut to 35 min, then split in three (the r4 card). */
async function splitP200(page: Page) {
  await draftSprint1(page)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  await ed.getByRole('spinbutton', { name: 'Minutes' }).fill('35')
  await ed.getByRole('button', { name: 'Save' }).click()
  await expect(ed).toBeHidden()
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).children?.length).toBe(3)
}

test('cu-3 P3-5 / ruling 20 S4: the Board Done header counts the cards listed (parts included); Week and Progress count the problem once', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await splitP200(page)
  const board = async () => {
    await page.goto('/board')
    await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
  }
  const done = page.getByTestId('col-done')
  // two of three parts done: two part cards are listed in Done (cu-r1b F-B2: Done 2), the group line says 2 of 3
  for (const k of ['p200~1', 'p200~2']) {
    await page.goto(`/do/${k}`)
    await page.getByTestId('do-outcome-solved').click()
    await expect.poll(async () => (await ticket(srv, k)).status).toBe('done')
  }
  await board()
  await expect(done.locator('article.card')).toHaveCount(2)
  await expect(page.getByTestId('count-done')).toHaveText('2')
  await expect(page.getByTestId('group-p200')).toHaveText('200 · Number of Islands · split · 2 of 3 done')
  await expect(page.getByTestId('count-todo')).toHaveText('16') // the other 15 cards and the part still open
  // all three: Done 3, the three listed parts, while Week and Progress say 1 problem
  await page.goto('/do/p200~3')
  await page.getByTestId('do-outcome-solved').click()
  await expect.poll(async () => (await ticket(srv, 'p200')).status).toBe('done')
  await board()
  await expect(done.locator('article.card')).toHaveCount(3)
  await expect(page.getByTestId('count-done')).toHaveText('3')
  await page.goto('/week')
  await expect(page.getByTestId('day-meta-Tue')).toContainText('1 done')
  await page.goto('/progress')
  await expect(page.getByTestId('ring-all-count')).toHaveText(/^1\//)
  await expect(page.getByTestId('ring-dsa-count')).toHaveText(/^1\//)
  await expect(page.getByTestId('ev-dsa-solved-value')).toHaveText('1')
  await ctx.close()
})

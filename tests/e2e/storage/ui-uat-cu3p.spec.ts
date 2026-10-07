import { expect, test } from '@playwright/test'
import { draftSprint1, learningCard, openApp, putTicket, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-3p (dojo-acceptance/reports/uat/cu-3p.md, fea93d3) and ruling 25 that need a
// drafted brief or a split card, so they run against the real server (fake AI).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

const briefCalls = async () => (await rows(srv, 'aiLog')).filter(r => r.job === 'brief').length

test('cu-3p P2-4 / R3: Draft briefs leaves a split card and its parts alone: no new brief, the minutes still add up', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  await page.getByTestId('brief-dismiss').click()
  // split a briefed card into three sessions
  await page.goto('/do/m1w1i2')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const dialog = page.getByRole('dialog', { name: 'Split into sessions' })
  await dialog.getByRole('spinbutton', { name: 'Parts' }).fill('3')
  await dialog.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await rows(srv, 'tickets')).filter(t => t.childOf === 'm1w1i2').length).toBe(3)
  const parentBefore = await ticket(srv, 'm1w1i2')
  const partsBefore = (await rows(srv, 'tickets')).filter(t => t.childOf === 'm1w1i2').sort((a, b) => a.order - b.order)
  const minutes = partsBefore.map(p => p.estMin)
  expect(minutes.reduce((a, m) => a + m, 0)).toBe(parentBefore.brief.minutes) // the parts add up to the card

  // a card with no brief appears in the sprint: the run drafts that one, and only that one
  await putTicket(srv, learningCard('w-new', 'A new reading'))
  await page.goto('/board')
  await page.reload()
  await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
  const calls = await briefCalls()
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await page.getByTestId('brief-progress').filter({ hasText: /^Done$/ }).waitFor({ timeout: 60_000 })
  expect(await briefCalls()).toBe(calls + 1)
  expect((await ticket(srv, 'w-new')).brief?.status).toBe('draft')
  const partsAfter = (await rows(srv, 'tickets')).filter(t => t.childOf === 'm1w1i2').sort((a, b) => a.order - b.order)
  expect(partsAfter.map(p => p.brief)).toEqual([undefined, undefined, undefined])
  expect(partsAfter.map(p => p.estMin)).toEqual(minutes)
  expect((await ticket(srv, 'm1w1i2')).brief).toEqual(parentBefore.brief)
  // the Board shows each part with the minutes it had, and a part's Do page carries one brief, the parent's
  for (const [i, p] of partsAfter.entries()) {
    await expect(page.getByTestId(`card-${p.id}`)).toContainText(`${minutes[i]} min`)
  }
  await page.goto(`/do/${partsAfter[1].id}`)
  await expect(page.getByTestId('card-brief')).toHaveCount(1)
  await expect(page.getByTestId('card-brief')).toContainText('Part 2 of 3')

  // nothing else to draft: the parts alone are not a reason to ask the AI
  await page.goto('/board')
  const done = await briefCalls()
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Every card in Sprint 1 already has a brief')
  await page.waitForTimeout(500)
  expect(await briefCalls()).toBe(done)
  await ctx.close()
})

import { expect, test } from '@playwright/test'
import { learningCard, openApp, putTicket, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the computer-use UAT lane cu-2 (dojo-acceptance/reports/uat/cu-2.md, 96c58d5), to controller ruling 24
// (ui-foundation.md), the ones that need the real dojo-server: S1 a running session survives a reload (and a quit) with
// the pill, S3 the focus minutes on the disk are the ones every screen shows, P3-10 the check dialog's question labels.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

test('S1: a reload during a running session keeps the pill, the NOW tile and the right time, against the real server', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  await dlg.getByLabel('This session I will').fill('after a reload')
  await dlg.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByTestId('session-timer')).toBeVisible()
  await page.getByTestId('do-back').click() // leave Do (a direct visit has no earlier screen, so Back lands on the Board)
  await page.goto('/') // Today, with the session on its NOW card
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('session-pill')).toBeVisible()
  await expect(page.getByTestId('now-session')).toBeVisible()
  await expect(page.getByTestId('spar-25')).toHaveCount(0)
  const before = await page.getByTestId('session-pill-time').textContent()
  await page.reload()
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('session-pill')).toBeVisible()
  await expect(page.getByTestId('now-session')).toBeVisible()
  await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus')
  const secs = (s: string | null) => Number(s!.slice(0, 2)) * 60 + Number(s!.slice(3, 5))
  expect(Math.abs(secs(await page.getByTestId('session-pill-time').textContent()) - secs(before))).toBeLessThanOrEqual(5)
  // other screens, after the reload
  await page.goto('/board')
  await expect(page.getByTestId('session-pill')).toBeVisible()
  await page.goto('/progress')
  await expect(page.getByTestId('session-pill')).toBeVisible()
  // End from the pill's card ends it for good: the row is on the disk, the pill is gone after another reload
  await page.getByTestId('session-pill-link').click()
  await page.getByRole('button', { name: 'End session' }).click()
  const end = page.getByRole('dialog', { name: 'End session' })
  await end.getByRole('textbox', { name: 'Done' }).fill('survived')
  await end.getByRole('button', { name: 'Save' }).click()
  await expect(end).toBeHidden()
  await expect.poll(async () => (await rows(srv, 'sessions')).filter(s => s.outcome === 'studied').length).toBe(1)
  await page.reload()
  await expect(page.getByTestId('session-pill')).toHaveCount(0)
  await ctx.close()
})

test('P3-10: a check question reads the same, in words or by choice (one font, one case)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await putTicket(srv, {
    ...learningCard('w-q', 'Hash maps'),
    brief: {
      goal: 'g', steps: [{ text: 's' }], minutes: 50, dayType: 'focus', learn: [], outcome: 'o', deliverable: { kind: 'note', prompt: 'p' },
      questions: [
        { id: 'q1', kind: 'open', q: 'Explain hash maps in your own words', keyIdeas: ['buckets'] },
        { id: 'q2', kind: 'mcq', q: 'Which of these is a hash map?', choices: ['Hash maps', 'Not hash maps'], correct: 0 },
      ],
      status: 'approved', source: 'ai',
    },
  })
  await page.reload()
  await page.goto('/do/w-q')
  await page.getByTestId('card-brief').getByRole('button', { name: 'Mark done' }).click()
  const dlg = page.getByRole('dialog', { name: 'Check your understanding' })
  await expect(dlg).toBeVisible()
  const style = (loc: ReturnType<typeof dlg.locator>) => loc.evaluate(e => {
    const c = getComputedStyle(e)
    return { family: c.fontFamily.split(',')[0].trim(), size: c.fontSize, weight: c.fontWeight, transform: c.textTransform, color: c.color }
  })
  const open = await style(dlg.locator('label[for="ck-q1"]'))
  const choice = await style(dlg.locator('legend'))
  expect(choice).toEqual(open)
  expect(open.transform).toBe('none')
  // and the "Answer every question first" error goes the moment an answer is typed
  await dlg.getByRole('button', { name: 'Check answers' }).click()
  await expect(dlg.getByRole('alert')).toHaveText('Answer every question first')
  await dlg.getByRole('textbox').fill('buckets')
  await expect(dlg.getByRole('alert')).toHaveCount(0)
  await ctx.close()
})

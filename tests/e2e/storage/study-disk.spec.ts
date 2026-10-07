import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { IST } from '../helpers'
import { ServerHarness } from './harness'

// Contract UX addendum 2: a focus block is saved to disk the moment it ends (another tab or a fresh
// context sees the new focus-today total before the session ends), and an ended session's end log
// is on the session row and survives a server restart.
test.describe.configure({ mode: 'serial' })

const NOW = IST('2026-10-06T21:10:00')
let srv: ServerHarness
let contexts: BrowserContext[] = []

test.beforeEach(async () => {
  srv = new ServerHarness()
  await srv.start()
})
test.afterEach(async () => {
  for (const c of contexts) await c.close()
  contexts = []
  await srv.dispose()
})

async function newPage(browser: Browser, install = false): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  contexts.push(ctx)
  await srv.makeWriter(ctx)
  const page = await ctx.newPage()
  if (install) await page.clock.install({ time: NOW })
  else await page.clock.setFixedTime(new Date(NOW.getTime() + 26 * 60_000))
  return page
}
type State = { tables: { events?: { t: string; id: string; minutes?: number }[]; sessions?: { outcome: string; xpDelta: number; endLog?: Record<string, string>; ticketId: string }[] } }
const state = async (): Promise<State> => (await fetch(`${srv.url}/db/state`)).json() as Promise<State>

test('UX addendum 2: the focus event reaches the disk at the block end; the end log survives a restart', async ({ browser }) => {
  const page = await newPage(browser, true)
  await page.goto('/')
  await page.getByLabel('Start date').fill('2026-10-05')
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await page.getByTestId('now-eyebrow').waitFor()
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  await dlg.getByLabel('This session I will').fill('disk test')
  await dlg.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByTestId('session-timer')).toBeVisible()
  await page.clock.fastForward('25:00')
  await expect(page.getByTestId('session-phase')).toHaveText('Break')

  // the session is still open, and the disk already has the block
  await expect.poll(async () => ((await state()).tables.events ?? []).filter(e => e.t === 'focus').map(e => e.minutes)).toEqual([25])

  // a fresh writer context sees the total without the session ending
  const other = await newPage(browser)
  await other.goto('/')
  await expect(other.getByTestId('focus-today')).toHaveText('25 min')

  await page.getByRole('dialog', { name: 'Stuck?' }).getByRole('button', { name: "I'm fine" }).click()
  await page.getByRole('button', { name: 'End session' }).click()
  const end = page.getByRole('dialog', { name: 'End session' })
  await end.getByRole('textbox', { name: 'Done' }).fill('the loop')
  await end.getByRole('textbox', { name: 'Next step' }).fill('edge cases')
  await end.getByRole('button', { name: 'Save' }).click()
  await expect(end).toBeHidden()
  await expect.poll(async () => (await state()).tables.sessions?.length ?? 0).toBe(1)
  const row = (await state()).tables.sessions![0]
  expect(row).toMatchObject({ ticketId: 'p200', outcome: 'studied', xpDelta: 0, endLog: { done: 'the loop', stuckOn: '', nextStep: 'edge cases' } })

  await srv.restart()
  const fresh = await newPage(browser)
  await fresh.goto('/progress')
  await expect(fresh.locator('[data-testid^="study-session-"]')).toContainText('Next step: edge cases')
  await fresh.goto('/')
  await expect(fresh.getByTestId('focus-today')).toHaveText('25 min')
})

test('UX-15: in a browser without the writer token Start session is refused with the Read-only toast', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  contexts.push(ctx)
  const writer = await newPage(browser, true)
  await writer.goto('/')
  await writer.getByLabel('Start date').fill('2026-10-05')
  await writer.getByRole('button', { name: 'Start the plan ▸' }).click()
  await writer.getByTestId('now-eyebrow').waitFor()
  // the writer's onboarding must be on disk before a read-only browser can show its cards
  await expect.poll(async () => ((await state()).tables as { tickets?: unknown[] }).tickets?.length ?? 0).toBeGreaterThan(0)
  const ro = await ctx.newPage()
  await ro.clock.install({ time: NOW })
  await ro.goto('/do/p200')
  await ro.getByRole('button', { name: 'Start session' }).click()
  await expect(ro.getByTestId('toast')).toContainText('Read-only')
  await expect(ro.getByRole('dialog', { name: 'Plan this session' })).toHaveCount(0)
})

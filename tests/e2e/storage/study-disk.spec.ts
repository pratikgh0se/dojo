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

test('UX-15: in a browser without the writer token Start is refused (disabled, Read-only banner, nothing written)', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  contexts.push(ctx)
  const writer = await newPage(browser, true)
  await writer.goto('/')
  await writer.getByLabel('Start date').fill('2026-10-05')
  await writer.getByRole('button', { name: 'START · PLAN' }).click()
  await writer.getByTestId('screen-today').waitFor()
  // the writer's onboarding must be on disk before a read-only browser can show its cards
  await expect.poll(async () => ((await state()).tables as { tickets?: unknown[] }).tickets?.length ?? 0).toBeGreaterThan(0)
  const ro = await ctx.newPage()
  await ro.clock.install({ time: NOW })
  await ro.goto('/do/p200')
  // R1 (SHELL-23): the retired "Start session" is the ticket's one START; a read-only browser has it disabled, shows the banner, and writes nothing
  const ops0 = ((await (await fetch(`${srv.url}/db/health`)).json()) as { ops: number }).ops
  await expect(ro.getByTestId('readonly-banner')).toBeVisible()
  await expect(ro.getByTestId('ticket-start')).toBeDisabled()
  await ro.keyboard.press('Enter')
  await expect(ro.getByTestId('ticket-start')).toBeVisible() // Enter did not start it
  expect(((await (await fetch(`${srv.url}/db/health`)).json()) as { ops: number }).ops).toBe(ops0)
})

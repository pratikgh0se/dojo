import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { ServerHarness } from './harness'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const CLOCK = {
  sprint1: '2026-10-06T10:00:00+05:30', // Tuesday, sprint 1 (starts Mon 2026-10-05)
  thursday: '2026-10-08T10:00:00+05:30',
  sprint2: '2026-10-20T10:00:00+05:30',
}

export async function tables(srv: ServerHarness): Promise<Record<string, Row[]>> {
  return ((await (await fetch(`${srv.url}/db/state`)).json()) as { tables: Record<string, Row[]> }).tables
}
/** Rows of a table as plain docs (the disk state wraps app rows as they were written). */
export async function rows(srv: ServerHarness, table: string): Promise<Row[]> {
  return (await tables(srv))[table] ?? []
}
export async function ticket(srv: ServerHarness, id: string): Promise<Row> {
  const t = (await rows(srv, 'tickets')).find(x => x.id === id)
  if (!t) throw new Error(`no ticket ${id}`)
  return t
}

/** A writer context on a fresh server, onboarded (start date 2026-10-05) with the clock at `at`. */
export async function openApp(browser: Browser, srv: ServerHarness, at = CLOCK.sprint1, init?: (ctx: BrowserContext) => Promise<unknown>) {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } })
  await init?.(ctx)
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(at))
  await page.goto(`/#writer=${srv.token()}`)
  const date = page.getByRole('textbox', { name: 'Start date' })
  await date.fill('2026-10-05')
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await date.waitFor({ state: 'hidden' })
  await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  return { ctx, page }
}

/** Opens a fresh context as the writer (a restarted browser) and waits for the app. */
export async function reopen(browser: Browser, srv: ServerHarness, at = CLOCK.sprint1) {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(at))
  await page.goto(`/#writer=${srv.token()}`)
  await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  return { ctx, page }
}

/** Adds a ticket the plan does not have (a learning card, say) straight into the disk database, as the writer. */
export async function putTicket(srv: ServerHarness, doc: Row) {
  const res = await fetch(`${srv.url}/db/ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': srv.token() },
    body: JSON.stringify({ clientId: 'e2e', ops: [{ opId: randomUUID(), tbl: 'tickets', op: 'put', id: doc.id, doc, at: new Date().toISOString() }] }),
  })
  if (!res.ok) throw new Error(`putTicket failed: ${res.status}`)
}

/** A learning card the plan does not carry (origin "mine" so plan reconcile leaves it alone). */
export const learningCard = (id: string, title: string, sprint = 1): Row => ({
  id, origin: 'mine', track: 'interview', kind: 'watch', title, links: [], estMin: 50, plannedSprint: sprint, sprint,
  status: 'todo', slidFrom: [], xp: 0, archived: false, order: 900,
})

export async function draftSprint1(page: Page) {
  await page.goto('/board')
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await page.getByTestId('brief-progress').filter({ hasText: /^Done$/ }).waitFor({ timeout: 60_000 })
}

export async function xpTotal(page: Page): Promise<number> {
  await page.goto('/')
  return Number(((await page.getByTestId('xp-total').innerText()) || '0').replace(/[^\d]/g, ''))
}

export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

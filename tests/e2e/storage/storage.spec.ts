import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { IST } from '../helpers'
import { ServerHarness } from './harness'

test.describe.configure({ mode: 'serial' })

// Live plan: sprint 1 starts Mon 2026-10-05. The spec's writes are real work: start the Today quest and finish it (TODAY-24, TICKET-10).
const NOW = IST('2026-10-05T21:10:00')
let srv: ServerHarness
// Every test reuses the same port, so a page left open by an earlier test would keep syncing (and,
// meeting a database it never adopted, merge its data into this test's). Close them all.
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

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  contexts.push(ctx)
  await srv.makeWriter(ctx)
  const page = await ctx.newPage()
  await page.clock.setFixedTime(NOW)
  return page
}
async function onboard(page: Page) {
  await page.goto('/')
  await page.getByLabel('Start date').fill('2026-10-05')
  await page.getByRole('button', { name: 'START · PLAN' }).click()
  await page.getByTestId('screen-today').waitFor()
}
const status = (page: Page) => page.getByTestId('save-status')
/**
 * Starts the Today quest (`start-button`, TODAY-24) and finishes it with `ticket-done` (TICKET-10); the page stays on `/do/<id>`. Returns the ticket id.
 */
async function finishQuest(page: Page): Promise<string> {
  const id = await startQuest(page)
  return finishStarted(page, id)
}
/** Today's Start: opens the quest's ticket page (its lazy chunk loads now). Returns the ticket id. */
async function startQuest(page: Page): Promise<string> {
  await page.getByTestId('start-button').click()
  await page.waitForURL(/\/do\/[^/?#]+/)
  return decodeURIComponent(new URL(page.url()).pathname.split('/')[2])
}
async function finishStarted(page: Page, id: string): Promise<string> {
  await page.getByTestId('ticket-done').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  return id
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return (await fetch(`${srv.url}${path}`, init)).json() as Promise<T>
}
async function doneIds(): Promise<string[]> {
  const st = await api<{ tables: { tickets?: { id: string; status: string }[] } }>('/db/state')
  return (st.tables.tickets ?? []).filter(t => t.status === 'done').map(t => t.id)
}

test('ST-01/05/09: health, append-only history, security, writes need the token', async ({ browser }) => {
  const h = await api<{ ok: boolean; dbPath: string; ops: number }>('/db/health')
  expect(h.ok).toBe(true)
  expect(h.dbPath.startsWith(srv.home)).toBe(true)

  const page = await newPage(browser)
  await onboard(page)
  const ops0 = (await api<{ ops: number }>('/db/health')).ops
  await finishQuest(page) // start, then done: two writes
  await expect(status(page)).toHaveText('Saved')
  await expect.poll(async () => (await api<{ ops: number }>('/db/health')).ops).toBeGreaterThanOrEqual(ops0 + 2)
  const ops1 = (await api<{ ops: number }>('/db/health')).ops
  await page.reload() // a real reload on /do/<dotted id>: the disk server answers it with the app
  await expect(page).toHaveURL(/\/do\/[^/?#]+$/)
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await expect(status(page)).toHaveText('Saved')
  expect((await api<{ ops: number }>('/db/health')).ops).toBeGreaterThanOrEqual(ops1)

  const json = { 'Content-Type': 'application/json' }
  // Addendum 3 (ST-12 step 4): a write without the writer token is refused.
  const refused = await fetch(`${srv.url}/db/ops`, { method: 'POST', headers: json, body: JSON.stringify({ clientId: 'x', ops: [] }) })
  expect(refused.status).toBe(403)
  expect((await refused.json()).error.code).toBe('not_writer')
  expect((await fetch(`${srv.url}/db/ops`, { method: 'POST', headers: { ...json, Origin: 'https://evil.example' }, body: '{}' })).status).toBe(403)
  expect((await fetch(`${srv.url}/db/ops`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
})

test('ST-02: survives a server restart and a wiped browser', async ({ browser }) => {
  const page = await newPage(browser)
  await onboard(page)
  const id = await finishQuest(page)
  await expect(status(page)).toHaveText('Saved')
  await expect.poll(doneIds).toEqual([id]) // on disk before the server goes down
  await srv.restart()

  const fresh = await newPage(browser) // empty storage
  await fresh.goto('/')
  await expect(fresh.getByLabel('Start date')).toHaveCount(0) // onboarding skipped: the start date was restored
  await expect(fresh.getByTestId('screen-today')).toBeVisible()
  expect(await doneIds()).toEqual([id])
  await expect(status(fresh)).toHaveText('Saved')
})

test('ST-03: offline shows "Not saved to disk", writes land when the server returns', async ({ browser }) => {
  const page = await newPage(browser)
  await onboard(page)
  await expect(status(page)).toHaveText('Saved')
  // the ticket page's lazy chunk is fetched from the server, so open it while the server is up, then lose the server before Done
  const id = await startQuest(page)
  await expect(status(page)).toHaveText('Saved')
  await srv.stop()
  await finishStarted(page, id)
  await expect(status(page)).toHaveText('Not saved to disk', { timeout: 5000 })
  await srv.start()
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 })
  await expect.poll(doneIds).toEqual([id])
  const fresh = await newPage(browser)
  await fresh.goto('/')
  await expect(fresh.getByTestId('screen-today')).toBeVisible()
  expect(await doneIds()).toEqual([id])
})

test('first run with the server down: the error card, never onboarding (R7, ruling 11 Q10); once it answers, the fresh start', async ({ browser }) => {
  const page = await newPage(browser)
  await page.route('**/db/**', r => r.abort()) // the server is not running and this browser has no local copy
  await page.goto('/')
  await expect(page.locator('.fatal').getByRole('heading', { level: 1 })).toHaveText("Dojo couldn't start")
  await expect(page.getByLabel('Start date')).toHaveCount(0)

  await page.unroute('**/db/**') // "the server starts": it is empty
  await onboard(page)
  await finishQuest(page)
  await expect(status(page)).toHaveText('Saved')
  await expect.poll(async () => (await doneIds()).length).toBe(1)
})

test('ST-07/08/10: backups region, restore with a pre-restore file, export (db:export-pg against the scratch home)', async ({ browser }) => {
  const page = await newPage(browser)
  await onboard(page)
  const idA = await finishQuest(page)
  await expect(status(page)).toHaveText('Saved')
  await expect.poll(doneIds).toEqual([idA])
  const idsWithA = await doneIds()

  // ST-07: Settings has a Backups region listing today's automatic backup; Back up now adds a manual one
  await page.goto('/settings')
  const region = page.getByRole('region', { name: 'Backups' })
  const today = new Date()
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  await expect(region.getByRole('listitem').filter({ hasText: `dojo-${ymd}.db` })).toBeVisible()
  await region.getByRole('button', { name: 'Back up now' }).click()
  await expect(region.getByRole('listitem')).toHaveCount(2)
  const manual = (await api<{ backups: { file: string }[] }>('/db/backups')).backups.find(x => /-\d{6}\.db$/.test(x.file))!
  expect(manual).toBeTruthy()

  // a second ticket is finished after the manual backup
  await page.goto('/')
  await page.getByTestId('screen-today').waitFor()
  const idB = await finishQuest(page)
  expect(idB).not.toBe(idA)
  await expect(status(page)).toHaveText('Saved')
  await expect.poll(doneIds).toHaveLength(2)

  // ST-08: restore the manual backup; a pre-restore file appears; after the reload only the first ticket is done
  await page.goto('/settings')
  await region.getByRole('listitem').filter({ hasText: manual.file }).getByRole('button', { name: 'Restore' }).click()
  await Promise.all([
    page.waitForEvent('load'), // Settings reloads the page after the swap so the app re-hydrates
    page.getByRole('dialog', { name: 'Restore this backup?' }).getByRole('button', { name: 'Restore' }).click(),
  ])
  await expect.poll(async () => (await api<{ backups: { file: string }[] }>('/db/backups')).backups.some(x => x.file.startsWith('pre-restore-'))).toBe(true)
  await page.goto('/')
  await page.getByTestId('screen-today').waitFor()
  await expect.poll(doneIds).toEqual(idsWithA)

  // ST-10: `npm run db:export-pg` against this scratch home (never ~/Dojo) writes the Postgres dump
  const out = execFileSync('npm', ['run', '--silent', 'db:export-pg'], { env: { ...process.env, DOJO_HOME: srv.home }, cwd: fileURLToPath(new URL('../../../', import.meta.url)) }).toString()
  expect(out).toContain('wrote')
  expect(out).toContain(join(srv.home, 'export'))
  const file = readdirSync(join(srv.home, 'export')).find(f => f.endsWith('.sql'))!
  const sql = readFileSync(join(srv.home, 'export', file), 'utf8')
  expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS dojo')
  expect(sql).toContain('jsonb')
  expect(sql).toContain(`'${idsWithA[0]}'`)
})

test('ST-12: a browser without the writer token is a read-only view', async ({ browser }) => {
  const writer = await newPage(browser)
  await onboard(writer)
  const id = await finishQuest(writer)
  await expect.poll(doneIds).toEqual([id]) // on disk (the status can read Saved before the flush starts)

  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' }) // no token
  contexts.push(ctx)
  const view = await ctx.newPage()
  await view.clock.setFixedTime(NOW)
  await view.goto('/')
  await expect(view.getByTestId('readonly-banner')).toHaveText('Read-only: open Dojo from the Dojo app to make changes')
  // the view shows the writer's data, and the next quest's Start is disabled (SHELL-23)
  await view.getByTestId('screen-today').waitFor()
  await expect(view.getByTestId('start-button')).toBeDisabled()
  const ops0 = (await api<{ ops: number }>('/db/health')).ops
  const state0 = JSON.stringify(await api('/db/state'))
  await view.keyboard.press('Enter') // Enter on the body starts the quest (TODAY-23); read-only does nothing
  await expect(view).toHaveURL(/\/$/)
  // R1 (SHELL-23): a control that would write is disabled, so the old Read-only toast on a click is gone; the Settings backup button is one
  await view.goto('/settings')
  await expect(view.getByRole('region', { name: 'Backups' }).getByRole('button', { name: 'Back up now' })).toBeDisabled()
  expect((await api<{ ops: number }>('/db/health')).ops).toBe(ops0)
  expect(JSON.stringify(await api('/db/state'))).toBe(state0)
  await expect(writer.getByTestId('readonly-banner')).toHaveCount(0)
})

test('Addendum 7: a read-only browser on onboarding shows the banner and refuses "START · PLAN"', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' }) // no token
  contexts.push(ctx)
  const page = await ctx.newPage()
  await page.clock.setFixedTime(NOW)
  await page.goto('/')
  await expect(page.getByLabel('Start date')).toBeVisible()
  await expect(page.getByTestId('readonly-banner')).toHaveText('Read-only: open Dojo from the Dojo app to make changes')
  await page.getByLabel('Start date').fill('2026-10-05')
  await page.getByRole('button', { name: 'START · PLAN' }).click()
  await expect(page.getByTestId('toast').filter({ hasText: /^Read-only/ })).toBeVisible()
  await expect(page.getByLabel('Start date')).toBeVisible()
  expect((await api<{ ops: number; docs: number }>('/db/health'))).toMatchObject({ ops: 0, docs: 0 })
})

test('Addendum 8: an idle writer makes no writes after onboarding', async ({ browser }) => {
  const page = await newPage(browser)
  await onboard(page)
  await expect(status(page)).toHaveText('Saved')
  await expect.poll(async () => (await api<{ ops: number }>('/db/health')).ops).toBeGreaterThan(0)
  const ops0 = (await api<{ ops: number }>('/db/health')).ops
  await page.waitForTimeout(5000)
  expect((await api<{ ops: number }>('/db/health')).ops).toBe(ops0)
})

test('Addenda 8/9: read-only Settings shows the banner; Back up now and Restore are disabled, with no dialog', async ({ browser }) => {
  const writer = await newPage(browser)
  await onboard(writer)
  await expect(status(writer)).toHaveText('Saved')
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' }) // no token
  contexts.push(ctx)
  const page = await ctx.newPage()
  await page.clock.setFixedTime(NOW)
  await page.goto('/settings')
  await expect(page.getByTestId('readonly-banner')).toBeVisible()
  const region = page.getByRole('region', { name: 'Backups' })
  const backups0 = (await api<{ backups: unknown[] }>('/db/backups')).backups.length
  // R1 (SHELL-23): the write controls are disabled in a read-only browser (they used to toast on a click), so nothing opens and nothing is written
  await expect(region.getByRole('button', { name: 'Back up now' })).toBeDisabled()
  await expect(region.getByRole('listitem').first().getByRole('button', { name: 'Restore', exact: true })).toBeDisabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await api<{ backups: unknown[] }>('/db/backups')).backups.length).toBe(backups0)
})

test('ruling 16 Q22: while the server is unreachable, background retries never flip "Not saved to disk" back to "Saving…"', async ({ browser }) => {
  const page = await newPage(browser)
  await onboard(page)
  await expect(status(page)).toHaveText('Saved')
  // an unreachable server that takes a moment to fail each request (a connect timeout), as the tester saw
  await page.route('**/db/**', async r => { await new Promise(res => setTimeout(res, 300)); await r.abort().catch(() => {}) })
  await finishQuest(page)
  await expect(status(page)).toHaveText('Not saved to disk')
  // sample every frame across several retries (500 ms, 1 s, 2 s backoff)
  const seen = await page.evaluate(() => new Promise<string[]>(resolve => {
    const out = new Set<string>()
    const end = performance.now() + 4000
    const frame = () => {
      out.add(document.querySelector('[data-testid="save-status"]')?.textContent ?? '(none)')
      if (performance.now() < end) requestAnimationFrame(frame)
      else resolve([...out])
    }
    requestAnimationFrame(frame)
  }))
  expect(seen).toEqual(['Not saved to disk'])
  await page.unroute('**/db/**')
  await expect(status(page)).toHaveText('Saved', { timeout: 15_000 })
})

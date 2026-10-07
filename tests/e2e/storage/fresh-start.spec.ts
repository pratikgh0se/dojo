import { expect, test, type BrowserContext } from '@playwright/test'
import { IST } from '../helpers'
import { ServerHarness } from './harness'

// Addendum 3 (single writer, fresh start). ~/Dojo starts empty; nothing is imported from any existing
// browser data. The writer keeps its working copy in its own IndexedDB database, so an old pre-v2
// 'dojo' database in the same profile is neither imported nor touched.
let srv: ServerHarness
let ctx: BrowserContext | null = null
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await ctx?.close(); ctx = null; await srv.dispose() })

test('ST-13: a fresh DOJO_HOME shows onboarding; the start date lands on disk; old browser data is left alone', async ({ browser }) => {
  ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(IST('2026-10-05T21:10:00'))

  // An old (pre-v2) Dojo database in this profile, at Dexie's v2 (IDB version 20).
  await page.route('**/seed-old', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>old</title>' }))
  await page.goto('/seed-old')
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('dojo', 20)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('tickets', { keyPath: 'id' })
      req.result.createObjectStore('settings', { keyPath: 'id' })
    }
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const tx = req.result.transaction(['tickets', 'settings'], 'readwrite')
      tx.objectStore('tickets').put({ id: 'm1w1i1', status: 'done', title: 'old tick' })
      tx.objectStore('settings').put({ id: 'main', startDate: '2026-09-07' })
      tx.oncomplete = () => { req.result.close(); resolve() }
    }
  }))
  await page.unroute('**/seed-old')

  // The writer session (the launcher's URL).
  await page.goto(`/#writer=${srv.token()}`)
  const date = page.getByLabel('Start date')
  await expect(date).toBeVisible() // onboarding: the old start date was not imported
  await date.fill('2026-10-05')
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await page.getByTestId('now-eyebrow').waitFor()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await expect.poll(async () => {
    const st = await (await fetch(`${srv.url}/db/state`)).json() as { tables: { settings?: { id: string; startDate: string }[] } }
    return st.tables.settings?.find(s => s.id === 'main')?.startDate
  }).toBe('2026-10-05')
  const st = await (await fetch(`${srv.url}/db/state`)).json() as { tables: { tickets: { id: string; status: string }[] } }
  expect(st.tables.tickets.find(t => t.id === 'm1w1i1')?.status).not.toBe('done')

  // The old database is exactly as it was.
  const old = await page.evaluate(() => new Promise<{ version: number; ticket: unknown; settings: unknown }>((resolve, reject) => {
    const req = indexedDB.open('dojo')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const idb = req.result
      const tx = idb.transaction(['tickets', 'settings'])
      const t = tx.objectStore('tickets').get('m1w1i1')
      const s = tx.objectStore('settings').get('main')
      tx.oncomplete = () => { const out = { version: idb.version, ticket: t.result, settings: s.result }; idb.close(); resolve(out) }
    }
  }))
  expect(old).toEqual({ version: 20, ticket: { id: 'm1w1i1', status: 'done', title: 'old tick' }, settings: { id: 'main', startDate: '2026-09-07' } })
})

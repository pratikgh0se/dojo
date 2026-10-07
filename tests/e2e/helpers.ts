import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

export const IST = (s: string): Date => new Date(`${s}+05:30`)

const LEGACY_PLAN_PATH = new URL('../fixtures/plan.legacy-2026-09-05.json', import.meta.url)

/**
 * Frozen pre-forge plan (planVersion '2026-09-05', 533 tickets), the one these
 * specs were written against. Routes /data/plan.json to it so mechanics tests
 * (drag, timers, XP, undo, …) keep testing behavior rather than today's live
 * capstone plan content.
 */
export async function serveLegacyPlan(page: Page): Promise<void> {
  const body = readFileSync(LEGACY_PLAN_PATH, 'utf8')
  await page.route('**/data/plan.json', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  )
}

/** The app's IndexedDB database: 'dojo-disk' for the disk-sync writer (Addendum 3), else Dexie-only 'dojo'. */
export async function appDbName(page: Page): Promise<string> {
  return page.evaluate(async () => ((await indexedDB.databases()).some(d => d.name === 'dojo-disk') ? 'dojo-disk' : 'dojo'))
}

export async function idbCount(page: Page, store: string): Promise<number> {
  const dbName = await appDbName(page)
  return page.evaluate(
    ({ storeName, dbName }) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const idb = req.result
          if (!idb.objectStoreNames.contains(storeName)) {
            idb.close()
            resolve(0)
            return
          }
          const c = idb.transaction(storeName, 'readonly').objectStore(storeName).count()
          c.onsuccess = () => { idb.close(); resolve(c.result) }
          c.onerror = () => { idb.close(); reject(c.error) }
        }
      }),
    { storeName: store, dbName },
  )
}

export async function idbAll<T>(page: Page, store: string): Promise<T[]> {
  const dbName = await appDbName(page)
  return page.evaluate(
    ({ storeName, dbName }) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const idb = req.result
          if (!idb.objectStoreNames.contains(storeName)) {
            idb.close()
            resolve([])
            return
          }
          const g = idb.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          g.onsuccess = () => { idb.close(); resolve(g.result as T[]) }
          g.onerror = () => { idb.close(); reject(g.error) }
        }
      }),
    { storeName: store, dbName },
  )
}

export async function idbPatch(page: Page, store: string, ids: string[], patch: Record<string, unknown>): Promise<void> {
  const dbName = await appDbName(page)
  await page.evaluate(
    ({ storeName, keys, changes, dbName }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const idb = req.result
          const tx = idb.transaction(storeName, 'readwrite')
          const os = tx.objectStore(storeName)
          for (const k of keys) {
            const g = os.get(k)
            g.onsuccess = () => { if (g.result) os.put({ ...g.result, ...changes }) }
          }
          tx.oncomplete = () => { idb.close(); resolve() }
          tx.onerror = () => { idb.close(); reject(tx.error) }
        }
      }),
    { storeName: store, keys: ids, changes: patch, dbName },
  )
}

export async function onboard(page: Page, startDate = '2026-09-07'): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Start date').fill(startDate)
  await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  await page.getByTestId('now-eyebrow').waitFor()
}

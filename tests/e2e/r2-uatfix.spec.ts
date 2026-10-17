import { expect, test, type Page } from '@playwright/test'
import { IST, appDbName, idbAll, idbPatch, onboard } from './helpers'

// R2 UAT fix round: layout and focus defects found by the UAT, in a real browser. Rules are in tests/unit.
type Row = { id: string; kind: string; status: string }

async function idbPut(page: Page, store: string, row: Record<string, unknown>): Promise<void> {
  const dbName = await appDbName(page)
  await page.evaluate(
    ({ store, row, dbName }) => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(store, 'readwrite')
        tx.objectStore(store).put(row)
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
      }
    }),
    { store, row, dbName },
  )
}

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function mockLab(page: Page, ticketId: string) {
  await page.route('**/labs/info**', r => r.fulfill({
    json: {
      ok: true, title: 'Tiny lab', path: 'labs/t-lab', repo: 'ai-platform-lab', version: 1, timeoutSec: 3, tickets: [ticketId], closingTicket: ticketId,
      milestones: [{ ticket: ticketId, checkIds: ['c1'] }], rubric: [{ id: 'r1', text: 'The bound is tested.' }],
    },
  }))
}

test('UAT B J5.4: a stored review with long code and text wraps inside the ticket column (no sideways scroll at 1280)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.clock.setFixedTime(IST('2026-11-04T10:00:00'))
  await onboard(page, '2026-11-02')
  const t = (await idbAll<Row>(page, 'tickets')).find(x => x.id === 'ai.b1.build')!
  await mockLab(page, t.id)
  const long = 'def throughput(tokens, seconds): return sum(tokens[i] * weights[i] for i in range(len(tokens))) / max(seconds, 1e-9)  # ' + 'x'.repeat(160)
  await idbPut(page, 'labReviews', {
    id: 'rev-b1-tokensim-1', labId: 'b1-tokensim', at: IST('2026-11-04T09:00:00').getTime(), percent: 86, passed: true, summary: 'Solid work. ' + 'longword'.repeat(40),
    items: [{ id: 'r1', score: 3, evidence: [{ file: 'WRITEUP.md', line: 4, quote: long }], stronger: 'Add a test for the empty input. ' + 'abc/def/'.repeat(60) }],
  })
  await page.goto(`/do/${t.id}`)
  await expect(page.getByTestId('ticket-review-badge')).toBeVisible()
  expect(await overflowX(page)).toBeLessThanOrEqual(0)
  const col = await page.evaluate(() => {
    const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
    return { reviewer: r('ticket-reviewer').right, block: r('ticket-lab-block').right, main: document.querySelector('main')!.getBoundingClientRect().right }
  })
  expect(col.reviewer).toBeLessThanOrEqual(col.main + 1)
  expect(col.block).toBeLessThanOrEqual(col.main + 1)
})

test('UAT B J6.6: on a phone, nothing in an opened node row ends up under the fixed next-ticket panel', async ({ page }) => {
  // SKILLS-37: the row now holds the whole read-only ticket list, so it is taller than the viewport by design (no cap, no inner scroll).
  // The guard is that nothing important hides under the fixed panel: (a) the row header and Start clear it once the row opens,
  // (b) scrolled to the end of the page, the last ticket row of the node clears it.
  await page.setViewportSize({ width: 375, height: 667 })
  await page.clock.setFixedTime(IST('2026-11-04T10:00:00'))
  await onboard(page, '2026-11-02')
  await page.goto('/skills/area/llm')
  const row = page.getByTestId('skills-row-B1')
  await row.scrollIntoViewIfNeeded()
  await page.evaluate(() => { const t = document.querySelector('[data-testid="skills-row-B1"] .sk-line')!.getBoundingClientRect().top; window.scrollBy(0, t - 380) })
  await row.locator('.sk-line').click()
  await expect(row.locator('.sk-more')).toBeVisible()
  const geo = () => page.evaluate(() => {
    const top = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
    const last = [...document.querySelectorAll('[data-testid="skills-row-B1"] [data-testid^="skills-node-ticket-"][data-status]')].pop()!
    return {
      panelTop: top('[data-testid="skills-next-panel"]').top,
      headBottom: top('[data-testid="skills-row-B1"] .sk-line').bottom,
      headTop: top('[data-testid="skills-row-B1"] .sk-line').top,
      startBottom: top('[data-testid="skills-row-B1"] [data-testid="skills-node-start"]').bottom,
      lastBottom: last.getBoundingClientRect().bottom,
    }
  })
  const a = await geo()
  expect(a.headTop).toBeGreaterThanOrEqual(0)
  expect(a.headBottom).toBeLessThanOrEqual(a.panelTop)
  expect(a.startBottom).toBeLessThanOrEqual(a.panelTop)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const b = await geo()
  expect(b.lastBottom).toBeLessThanOrEqual(b.panelTop)
})

test('UAT A J10.4: the Journal week heading never breaks inside a date on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.clock.setFixedTime(IST('2026-10-16T10:00:00'))
  await onboard(page, '2026-10-05')
  await page.goto('/journal?view=week')
  await expect(page.getByTestId('journal-week-heading')).toContainText('2026-W42')
  const broken: string[] = []
  for (let w = 320; w <= 430; w += 5) {
  await page.setViewportSize({ width: w, height: 667 })
  broken.push(...await page.evaluate(() => {
    const h = document.querySelector('[data-testid="journal-week-heading"]')!
    const out: string[] = []
    const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      for (const m of (n.textContent ?? '').matchAll(/\d{4}-(?:W\d\d|\d\d-\d\d)/g)) {
        const r = document.createRange(); r.setStart(n, m.index!); r.setEnd(n, m.index! + m[0].length)
        if (new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1) out.push(m[0])
      }
    }
    return out
  }))
  }
  expect(broken).toEqual([])
})

test('UAT A J11.7: a Board card title breaks between words, not inside "Interpretability", in the narrowest column at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.clock.setFixedTime(IST('2026-11-04T10:00:00'))
  await onboard(page, '2026-11-02')
  await page.goto('/board')
  const first = page.locator('[data-testid^="kanban-open-"]').first()
  await expect(first).toBeVisible()
  const firstId = (await first.getAttribute('data-testid'))!.replace('kanban-open-', '')
  const base = (await idbAll<Row>(page, 'tickets')).find(x => x.id === firstId)!
  const id = 'mine-uat-j117'
  await idbPut(page, 'tickets', { ...base, id, title: 'Read Interpretability Basics and the first chapters', origin: 'mine', status: 'todo', archived: false })
  await page.reload()
  const title = page.getByTestId(`kanban-open-${id}`)
  await expect(title).toHaveText('Read Interpretability Basics and the first chapters')
  const lines = await title.evaluate(el => {
    const t = el.firstChild!
    const i = t.textContent!.indexOf('Interpretability')
    const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 'Interpretability'.length)
    return { lines: new Set([...r.getClientRects()].map(x => Math.round(x.top))).size, card: el.closest('li')!.getBoundingClientRect().width }
  })
  if (process.env.R2_SHOTS_DIR) await page.getByTestId('screen-board').screenshot({ path: `${process.env.R2_SHOTS_DIR}/uatfix-board-1280.png` })
  expect(lines.lines).toBe(1)
})

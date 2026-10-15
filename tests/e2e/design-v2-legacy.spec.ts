import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type Browser } from '@playwright/test'
import { openNotes } from './design-helpers'
import { CLOCK, openApp, reopen, rows } from './storage/briefs-helpers'
import { ServerHarness } from './storage/harness'

// Design session v2, old `interviewer` sessions end to end (DESIGN-75 to 79, Review Focus 1) against dojo-server with disk sync on:
// the sessions are put into the server's database as a restored backup would leave them, then opened by a writer browser and by a read-only one.
// Needs its own server: run with DOJO_STORAGE_PORT inside the port window (the harness default is DOJO_PORT + 100).
const fixture = JSON.parse(readFileSync(new URL('../fixtures/design-session.legacy-interviewer.json', import.meta.url), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const MIN = 60_000
const NOW = new Date(CLOCK.sprint1).getTime()
const clone = <V,>(v: V): V => JSON.parse(JSON.stringify(v))

/** S_OLD_DONE: the fixture as stored (finished, mode "interviewer", no reference). */
const S_OLD_DONE = clone(fixture) as { id: string } & Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
/** S_OLD_LIVE: the same drawing in progress, started five minutes before the clock, canvas without `zones`/`flows`/`notes`, chat kept. */
const S_OLD_LIVE = (() => {
  const live = {} as { id: string } & Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const canvas = clone(fixture.canvas)
  delete canvas.zones
  delete canvas.flows
  Object.assign(live, {
    ...clone(fixture), id: 'ds-legacy-live', phase: 'drawing', at: NOW - 5 * MIN, minutes: 0, rubric: null, tradeoffs: [], lenses: {}, canvas,
    close: { tradeoff: { chose: '', over: '', because: '' }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: null, readNext: '' },
    deepDives: fixture.deepDives.map((d: { q: string }) => ({ q: d.q, answered: null })),
    interview: { messages: clone(fixture.interview.messages) },
  })
  delete live.endedAt
  delete live.lockedAt
  delete live.rubricBy
  return live
})()

let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 120_000 })

const api = async <T,>(path: string): Promise<T> => (await fetch(`${srv.url}${path}`)).json() as Promise<T>
const ops = async () => (await api<{ ops: number }>('/db/health')).ops
async function putSessions(docs: { id: string }[]) {
  const res = await fetch(`${srv.url}/db/ops`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': srv.token() },
    body: JSON.stringify({ clientId: 'e2e-legacy', ops: docs.map(doc => ({ opId: randomUUID(), tbl: 'designSessions', op: 'put', id: doc.id, doc, at: new Date().toISOString() })) }),
  })
  expect(res.ok, 'the legacy sessions were put').toBe(true)
}
/** A writer browser onboarded on a fresh server, the legacy sessions put in, and a new writer browser opened on it (a restart after a restore). */
async function withLegacy(browser: Browser, docs: { id: string }[]) {
  const first = await openApp(browser, srv)
  await first.ctx.close()
  await putSessions(docs)
  return reopen(browser, srv)
}
const goClient = (page: import('@playwright/test').Page, path: string) =>
  page.evaluate(p => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }, path)

test('DESIGN-75 an old finished session opens as Solo · AI partner with its chat; its stored drawing is untouched', async ({ browser }) => {
  const { ctx, page } = await withLegacy(browser, [S_OLD_DONE])
  await page.goto(`/designs/session/d-method?session=${S_OLD_DONE.id}`)
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  await expect(page.getByTestId('session-summary')).toContainText('Solo · AI partner')
  await expect(page.getByTestId('session-msg')).toHaveCount(fixture.interview.messages.length)
  await expect(page.getByTestId('session-msg').first()).toHaveAttribute('data-from', 'ai')
  await page.waitForTimeout(3000) // the reference is drawn and stored once; the canvas never changes
  const row = (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_DONE.id)!
  expect(row.canvas.nodes).toEqual(fixture.canvas.nodes)
  expect(row.canvas.links).toEqual(fixture.canvas.links)
  expect(row.rubric).toBe(fixture.rubric)
  expect(row.interview.messages).toEqual(fixture.interview.messages)
  await ctx.close()
})

test('DESIGN-76/78 an old session in progress loads as an AI partner session and opening it, then leaving it 5 seconds, writes nothing', async ({ browser }) => {
  const { ctx, page } = await withLegacy(browser, [S_OLD_LIVE])
  await expect(page.getByTestId('save-status').filter({ hasText: 'Saved' })).toBeVisible()
  const before = (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_LIVE.id)!
  expect(Object.keys(before.canvas)).not.toContain('notes')
  expect(Object.keys(before.canvas)).not.toContain('zones')
  const ops0 = await ops()
  await goClient(page, '/designs/session/d-method') // an in-app visit: no reload of the app, so nothing else writes
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  // DESIGN-76
  await expect(page.getByTestId('kit-count')).toHaveText('3 nodes · 2 links')
  await expect(page.getByTestId('session-msg')).toHaveCount(S_OLD_LIVE.interview.messages.length)
  await expect(page.getByTestId('session-tab-partner')).toBeVisible()
  const sections = page.locator('[data-testid^="notes-section-"]:not([data-testid$="-title"]):not([data-testid$="-toggle"]):not([data-testid$="-count"])')
  await expect(sections).toHaveCount(6)
  for (const f of ['req-fn', 'req-nfr', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']) await expect(page.getByTestId(`notes-field-${f}`)).toHaveValue('')
  await expect(page.getByTestId('schema-count-tables')).toHaveText('0 of 12 tables')
  await expect(page.getByTestId('kit-count-notes')).toHaveText('0 of 20 notes')
  await expect(page.getByTestId('kit-count-frames')).toHaveText('0 of 8 frames')
  // DESIGN-78: untouched for 5 seconds
  await page.waitForTimeout(5000)
  expect(await ops(), 'GET /db/health ops').toBe(ops0)
  const after = (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_LIVE.id)!
  expect(Object.keys(after.canvas).sort()).toEqual(Object.keys(before.canvas).sort())
  expect(after).toEqual(before)
  await expect(page.getByTestId('session-ai-error')).toHaveCount(0)
  // DESIGN-76: a canvas note, a frame and a schema table can be added
  await page.getByTestId('kit-add-note').click()
  await page.getByTestId('kit-note-text-note-1').fill('legacy note')
  await page.getByTestId('kit-add-frame').click()
  await openNotes(page)
  await page.getByTestId('schema-add-table').click()
  await expect(page.getByTestId('kit-count-notes')).toHaveText('1 of 20 notes')
  await expect(page.getByTestId('kit-count-frames')).toHaveText('1 of 8 frames')
  await expect(page.getByTestId('schema-count-tables')).toHaveText('1 of 12 tables')
  await expect.poll(async () => {
    const r = (await rows(srv, 'designSessions')).find(x => x.id === S_OLD_LIVE.id)!
    return [r.canvas.notes?.[0]?.text, r.canvas.zones?.length, r.notes?.schema?.length, r.canvas.nodes.length, r.canvas.links.length]
  }, { timeout: 15_000 }).toEqual(['legacy note', 1, 1, 3, 2])
  await ctx.close()
})

test('DESIGN-78 reloading an untouched old session in progress twice writes nothing and leaves no hand-over stash', async ({ browser }) => {
  const { ctx, page } = await withLegacy(browser, [S_OLD_LIVE])
  await page.goto('/designs/session/d-method')
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await expect(page.getByTestId('kit-count')).toHaveText('3 nodes · 2 links')
  await page.waitForTimeout(3000) // the first load has settled
  const before = (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_LIVE.id)!
  const ops0 = await ops()
  for (let i = 0; i < 2; i++) {
    await page.reload() // pagehide runs on the way out: an untouched session must not stash or write anything
    await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
    await expect(page.getByTestId('kit-count')).toHaveText('3 nodes · 2 links')
    await page.waitForTimeout(2500)
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dojo-design-pending:')))).toEqual([])
    expect(await ops(), `ops after reload ${i + 1}`).toBe(ops0)
  }
  const after = (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_LIVE.id)!
  expect(after).toEqual(before)
  await ctx.close()
})

test('DESIGN-77 an old session can be ended, closed, graded by the fake provider and completed; no error is shown', async ({ browser }) => {
  const { ctx, page } = await withLegacy(browser, [S_OLD_LIVE])
  await page.goto('/designs/session/d-method')
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await page.getByTestId('session-close-design').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
  await page.getByTestId('session-close-chose').fill('sliding window counter')
  await page.getByTestId('session-close-over').fill('token bucket')
  await page.getByTestId('session-close-because').fill('shared state is fine')
  await page.getByTestId('session-close-answer-2').fill('the shared store; shard it')
  await page.getByTestId('session-close-answer-3').fill('the store owns counters')
  await page.getByTestId('session-close-q4-none').check()
  await page.getByTestId('session-close-answer-5').fill('a rate limiter blog post')
  await page.getByTestId('session-close-next').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Score')
  await expect(page.getByTestId('session-grade')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('session-ai-error')).toHaveCount(0)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
  await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
  await row2.getByRole('textbox', { name: 'Because' }).fill('uptime')
  await expect(page.getByTestId('session-complete')).toBeEnabled()
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  await expect(page.getByTestId('session-ai-error')).toHaveCount(0)
  await expect.poll(async () => (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_LIVE.id)?.phase, { timeout: 15_000 }).toBe('done')
  const done = (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_LIVE.id)!
  expect(typeof done.rubric).toBe('number')
  expect(done.rubric).toBeGreaterThanOrEqual(0)
  expect(done.rubric).toBeLessThanOrEqual(20)
  expect(['model', 'self']).toContain(done.rubricBy)
  expect(done.interview.messages.length).toBe(S_OLD_LIVE.interview.messages.length)
  await ctx.close()
})

test('DESIGN-79 a read-only browser (no writer token) shows the old session as Solo · AI partner while the stored mode stays "interviewer"; it changes nothing', async ({ browser }) => {
  const first = await openApp(browser, srv)
  await first.ctx.close()
  await putSessions([S_OLD_DONE]) // no writer browser opens afterwards, so nothing has migrated the row
  const ops0 = await ops()
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata', viewport: { width: 1280, height: 900 } }) // no token
  const page = await ctx.newPage()
  await page.clock.setSystemTime(new Date(CLOCK.sprint1))
  await page.goto(`/designs/session/d-method?session=${S_OLD_DONE.id}`)
  await expect(page.getByTestId('readonly-banner')).toBeVisible()
  await expect(page.getByTestId('session-summary')).toContainText('Solo · AI partner')
  await expect(page.getByTestId('session-msg')).toHaveCount(fixture.interview.messages.length)
  await page.waitForTimeout(3000)
  const row = (await rows(srv, 'designSessions')).find(r => r.id === S_OLD_DONE.id)!
  expect(row.mode).toBe('interviewer')
  expect(row).toEqual(S_OLD_DONE) // not even a reference was written
  expect(await ops()).toBe(ops0)
  await expect(page.getByTestId('session-ai-error')).toHaveCount(0)
  await ctx.close()
})

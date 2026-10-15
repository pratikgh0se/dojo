import { randomUUID } from 'node:crypto'
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
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
  await page.getByRole('button', { name: 'START · PLAN' }).click()
  await date.waitFor({ state: 'hidden' })
  await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  return { ctx, page }
}

/** Client-side navigation to `path`: dojo-server answers a direct load of `/do/<id>` with 404 when the id has a dot (plan ids like `ai.l1.learn`). */
export const goClient = (page: Page, path: string) =>
  page.evaluate(p => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }, path)

/** TICKET-31: the Approaches chips and "Pick two" sit behind the one closed `dsa-approaches-more` disclosure; opens it (once) and returns the strip. */
export async function openApproaches(page: Page): Promise<Locator> {
  const strip = page.getByTestId('dsa-approaches')
  const more = strip.getByTestId('dsa-approaches-more')
  if ((await more.getAttribute('open')) === null) await more.locator('summary').click()
  await expect(more).toHaveAttribute('open', '')
  return strip
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

/** Puts one row of any table straight into the disk database, as the writer. */
export async function putRow(srv: ServerHarness, tbl: string, doc: Row) {
  const res = await fetch(`${srv.url}/db/ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': srv.token() },
    body: JSON.stringify({ clientId: 'e2e', ops: [{ opId: randomUUID(), tbl, op: 'put', id: doc.id, doc, at: new Date().toISOString() }] }),
  })
  if (!res.ok) throw new Error(`put ${tbl} failed: ${res.status}`)
}

/** Adds a ticket the plan does not have (a learning card, say) straight into the disk database, as the writer. */
export const putTicket = (srv: ServerHarness, doc: Row) => putRow(srv, 'tickets', doc)

/** A learning card the plan does not carry (origin "mine" so plan reconcile leaves it alone). */
export const learningCard = (id: string, title: string, sprint = 1): Row => ({
  id, origin: 'mine', track: 'interview', kind: 'watch', title, links: [], estMin: 50, plannedSprint: sprint, sprint,
  status: 'todo', slidFrom: [], xp: 0, archived: false, order: 900,
})

/** A learning card (kind watch: never drafted) together with an inline brief shaped like the fake AI's answers brief: two steps, an answers deliverable, two check questions. */
export const learningCardWithBrief = (id: string, title: string, sprint = 1): Row => ({
  ...learningCard(id, title, sprint),
  brief: {
    goal: `Understand ${title}`,
    steps: [
      { text: `Open the material for ${title}`, url: `https://example.com/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` },
      { text: 'Write three sentences on what you learned' },
    ],
    minutes: 60, dayType: 'focus',
    learn: [`Key idea of ${title}`], outcome: `You can explain ${title} in your own words`,
    deliverable: { kind: 'answers', prompt: 'Answer the questions' },
    questions: [
      { id: 'q1', kind: 'open', q: `Explain ${title} in your own words`, keyIdeas: [title] },
      { id: 'q2', kind: 'mcq', q: `Which is ${title}?`, choices: [title, `Not ${title}`], correct: 0 },
    ],
    status: 'draft', source: 'ai',
  },
})

export async function xpTotal(page: Page): Promise<number> {
  await page.goto('/')
  return Number(((await page.getByTestId('xp-total').innerText()) || '0').replace(/[^\d]/g, ''))
}

export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

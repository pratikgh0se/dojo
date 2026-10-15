import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ServerHarness } from './harness'
import { CLOCK, learningCard, openApp, putRow, putTicket, rows, ticket } from './briefs-helpers'

// Dojo v2 part 3, end to end on the real server (fake AI): the BR clauses of contracts/briefs.md that survive R1.
// R1 (ticket-view.md TICKET-12, README "Retired hooks"): the ticket view keeps the brief CARD, read-only, for tickets that carry a brief;
// its Edit / Approve / Check links / Mark done actions and the learning-card check dialog are gone (watch and read tickets use the
// explain[] answer-first gate, TICKET-15). Roll-over and the sprint drawers are retired too.
let srv: ServerHarness
const ctxs: BrowserContext[] = []
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => {
  for (const c of ctxs.splice(0)) await c.close()
  await srv.dispose()
})
const app = async (browser: Parameters<typeof openApp>[0], at?: string, init?: Parameters<typeof openApp>[3]) => {
  const r = await openApp(browser, srv, at, init)
  ctxs.push(r.ctx)
  return r
}
// Only problem, design and task tickets are drafted (spec 3.2); watch, read, build, writeup, ritual and stage tickets use their own text.
const draftable = (t: Record<string, any>) => ['problem', 'design', 'task'].includes(t.kind) // eslint-disable-line @typescript-eslint/no-explicit-any
const xp = async (page: Page) => Number(await page.getByTestId('xp-total').getAttribute('data-value'))

/** Puts a brief on an existing plan ticket (the ticket view keeps the read-only brief card for problem tickets that carry one). */
async function withBrief(id: string, brief: Record<string, unknown>) {
  const t = await ticket(srv, id)
  await putTicket(srv, { ...t, brief })
}
const problemBrief = (extra: Record<string, unknown> = {}) => ({
  goal: 'Solve Number of Islands with a flood fill',
  steps: [
    { text: 'Read the statement and sketch the grid', url: 'https://example.com/islands-ok' },
    { text: 'Write the flood fill', url: 'https://example.com/islands-gone' },
    { text: 'Run the tests' },
  ],
  minutes: 45, dayType: 'focus',
  learn: ['Flood fill on a grid'], outcome: 'You can explain why each cell is visited once',
  deliverable: { kind: 'text', prompt: 'Paste the final solution and its complexity' },
  questions: [], status: 'draft', source: 'ai',
  ...extra,
})

test('BR-01/BR-04/BR-14 the brief card stays on the ticket view of a problem that carries a brief: goal, steps, minutes, outcome, deliverable, status and stored link verdicts; read-only (no Edit, Approve, Check links or Mark done)', async ({ browser }) => {
  const { page } = await app(browser)
  expect(draftable(await ticket(srv, 'p200'))).toBe(true)
  await withBrief('p200', problemBrief({
    linkCheck: [
      { url: 'https://example.com/islands-ok', ok: true, status: 200 },
      { url: 'https://example.com/islands-gone', ok: false, status: 404 },
    ],
  }))
  await page.reload()
  await page.goto('/do/p200')
  const card = page.getByTestId('card-brief')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('brief-status')).toHaveText('Draft')
  await expect(card).toContainText('AI draft')
  await expect(card.getByTestId('brief-goal')).toHaveText('Solve Number of Islands with a flood fill')
  await expect(card.getByRole('listitem').filter({ hasText: 'Write the flood fill' })).toBeVisible()
  await expect(card.getByRole('link', { name: 'https://example.com/islands-ok' })).toHaveAttribute('href', 'https://example.com/islands-ok')
  await expect(card).toContainText('45 min')
  await expect(card).toContainText('You can explain why each cell is visited once')
  await expect(card.getByTestId('brief-deliverable')).toHaveText('Paste the final solution and its complexity')
  await expect(card.getByTestId('link-ok')).toHaveCount(1)
  await expect(card.getByTestId('link-broken')).toHaveText('broken link (404)')
  await expect(page.getByTestId('no-brief')).toHaveCount(0)
  // TICKET-12: the ticket has one completion path, so the card carries no second one and no editing controls
  for (const name of ['Edit brief', 'Approve', 'Check links', 'Mark done']) await expect(card.getByRole('button', { name })).toHaveCount(0)
  await expect(card.getByTestId('check-attempts')).toHaveCount(0)
})

test("BR-03/BR-06 a refused link reads \"can't verify\" (not broken), and a stored learning-check attempt is listed on the card with its answer and correction", async ({ browser }) => {
  const { page } = await app(browser)
  await withBrief('p200', problemBrief({
    linkCheck: [{ url: 'https://example.com/islands-gone', ok: false, status: 403 }],
    questions: [{ id: 'q1', kind: 'open', q: 'Why is each cell visited once?', keyIdeas: ['visited set'] }],
  }))
  await putRow(srv, 'checkAttempts', {
    id: 'att-1', ticketId: 'p200', at: Date.parse(CLOCK.sprint1), passed: false,
    answers: [{ id: 'q1', answer: 'no idea' }],
    feedback: [{ id: 'q1', verdict: 'fail', correction: 'Mention the visited set', pointer: 'Step 2' }],
  })
  await page.reload()
  await page.goto('/do/p200')
  const card = page.getByTestId('card-brief')
  await expect(card.getByTestId('link-unverified')).toHaveText("can't verify (403)")
  await expect(card.getByTestId('link-broken')).toHaveCount(0)
  await expect(card.getByTestId('link-ok')).toHaveCount(0)
  await expect(page.getByTestId('check-attempt')).toHaveCount(1)
  await expect(page.getByTestId('check-attempt')).toContainText('Attempt 1 · 0 of 1 right')
  await expect(page.getByTestId('check-attempt')).toContainText('no idea')
  await expect(page.getByTestId('check-attempt')).toContainText('Mention the visited set (Step 2)')
})

test('BR-02 a problem ticket without a brief shows the no-brief note and no brief card; an approved brief reads Approved; a watch ticket gets neither note nor card', async ({ browser }) => {
  const { page } = await app(browser)
  await page.goto('/do/p200')
  await expect(page.getByTestId('no-brief')).toHaveText(/No brief for this ticket yet\./)
  await expect(page.getByTestId('card-brief')).toHaveCount(0)
  await withBrief('p200', problemBrief({ status: 'approved', source: 'edited' }))
  await page.reload()
  await page.goto('/do/p200')
  await expect(page.getByTestId('brief-status')).toHaveText('Approved')
  await expect(page.getByTestId('card-brief')).toContainText('Edited by you')
  await expect(page.getByTestId('no-brief')).toHaveCount(0)
  // watch tickets are not drafted (Task 20): the explain[] answer-first gate is their path, and their ticket view says nothing about briefs
  await putTicket(srv, learningCard('w-hash', 'Hash maps'))
  await page.reload()
  await page.goto('/do/w-hash')
  await expect(page.getByTestId('ticket-start')).toBeVisible()
  await expect(page.getByTestId('no-brief')).toHaveCount(0)
  await expect(page.getByTestId('card-brief')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(0)
})

test('BR-10 no automatic roll-over: two weeks later unfinished tickets keep their sprint and nothing is rolled; xp unchanged', async ({ browser }) => {
  const { page } = await app(browser)
  await page.goto('/')
  await page.getByTestId('start-button').click()
  await page.waitForURL(/\/do\/[^/?#]+/)
  await page.getByTestId('ticket-done').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await page.getByTestId('do-back').click()
  await page.getByTestId('screen-today').waitFor()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  const xp0 = await xp(page)
  expect(xp0).toBeGreaterThan(0)
  const before = (await rows(srv, 'tickets')).filter(t => t.sprint === 1 && !t.archived && t.status !== 'done').map(t => t.id)
  expect(before.length).toBeGreaterThan(0)
  await page.clock.setSystemTime(new Date(CLOCK.sprint2))
  await page.reload()
  await page.getByTestId('screen-today').waitFor()
  await page.waitForTimeout(1500) // long enough for the old app-open roll-over to have run
  await expect(page.getByTestId('rolled-note')).toHaveCount(0)
  const after = await rows(srv, 'tickets')
  expect(after.filter(t => t.rolledFrom?.includes(1))).toHaveLength(0)
  for (const id of before) expect(after.find(t => t.id === id)).toMatchObject({ sprint: 1 })
  expect(await xp(page)).toBe(xp0)
})

test('BR-16 the link check answers private targets ok:false, status 0, and sends nothing', async ({ browser }) => {
  await app(browser)
  const res = await fetch(`${srv.url}/tools/linkcheck`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': srv.token() },
    body: JSON.stringify({ urls: ['http://192.168.1.1/', 'http://[::ffff:192.168.1.1]/'] }),
  })
  expect(res.status).toBe(200)
  expect(((await res.json()) as { results: unknown[] }).results).toEqual([
    { url: 'http://192.168.1.1/', ok: false, status: 0 }, { url: 'http://[::ffff:192.168.1.1]/', ok: false, status: 0 },
  ])
})

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type BrowserContext } from '@playwright/test'
import { ServerHarness } from './harness'
import { CLOCK, draftSprint1, learningCard, localDay, openApp, putTicket, reopen, rows, ticket, xpTotal } from './briefs-helpers'

// Dojo v2 part 3, end to end on the real server (fake AI): BR-01 to BR-15 of contracts/briefs.md.
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
const sprint1 = async () => (await rows(srv, 'tickets')).filter(t => t.sprint === 1 && !t.archived)
const STAGE = 'stage-00-setup-w1-watch'

test('BR-01 draft briefs for Sprint 1: every Sprint 1 ticket gets a draft', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  const ts = await sprint1()
  expect(ts.length).toBeGreaterThan(5)
  expect(ts.every(t => t.brief?.status === 'draft' && t.brief.source === 'ai')).toBe(true)
  expect((await rows(srv, 'tickets')).filter(t => t.sprint !== 1).some(t => t.brief)).toBe(false)
})

test('BR-02 the Do screen shows the brief in full', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  const t = await ticket(srv, 'm1w1i1')
  await page.goto('/do/m1w1i1')
  const card = page.getByTestId('card-brief')
  await expect(card).toContainText(`Understand ${t.title}`)
  const steps = card.locator('ol > li')
  await expect(steps).toHaveCount(2)
  await expect(steps.nth(0)).toContainText(`Open the material for ${t.title}`)
  const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  await expect(steps.nth(0).locator('a')).toHaveAttribute('href', `https://example.com/${slug}`)
  await expect(card).toContainText('60 min')
  await expect(card).toContainText("What you'll learn")
  await expect(card).toContainText(`Key idea of ${t.title}`)
  await expect(card).toContainText(`You can explain ${t.title} in your own words`)
  await expect(card).toContainText('Paste your code, typed by hand')
})

test('BR-03 edit and approve; the change survives a restart in a fresh writer context', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  await page.goto('/do/m1w1i1')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit brief' })
  await dialog.getByRole('textbox', { name: 'Goal' }).fill('My own goal')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('card-brief')).toContainText('My own goal')
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByTestId('brief-status')).toHaveText('Approved')
  await expect.poll(async () => (await ticket(srv, 'm1w1i1')).brief).toMatchObject({ goal: 'My own goal', status: 'approved', source: 'edited' })
  await srv.restart()
  const fresh = await reopen(browser, srv)
  ctxs.push(fresh.ctx)
  await fresh.page.goto('/do/m1w1i1')
  await expect(fresh.page.getByTestId('card-brief')).toContainText('My own goal')
  expect((await ticket(srv, 'm1w1i1')).brief).toMatchObject({ goal: 'My own goal', status: 'approved', source: 'edited' })
})

test('BR-04 link check marks the 404 link broken and the 200 link ok; the route needs the writer token', async ({ browser }) => {
  const target = http.createServer((req, res) => { res.writeHead(req.url === '/gone' ? 404 : 200); res.end('x') })
  await new Promise<void>(r => target.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`
  try {
    const { page } = await app(browser)
    await draftSprint1(page)
    await page.goto('/do/m1w1i1')
    await page.getByRole('button', { name: 'Edit brief' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit brief' })
    await dialog.getByRole('textbox', { name: 'Step 1 link' }).fill(`${base}/fine`)
    await dialog.getByRole('textbox', { name: 'Step 2 link' }).fill(`${base}/gone`)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Check links' }).click()
    const steps = page.getByTestId('card-brief').locator('ol > li')
    await expect(steps.nth(0).getByTestId('link-ok')).toBeVisible()
    await expect(steps.nth(1).getByTestId('link-broken')).toBeVisible()
    await expect.poll(async () => (await ticket(srv, 'm1w1i1')).brief.linkCheck).toEqual([
      { url: `${base}/fine`, ok: true, status: 200 }, { url: `${base}/gone`, ok: false, status: 404 },
    ])
    const noToken = await fetch(`${srv.url}/tools/linkcheck`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: [`${base}/fine`] }) })
    expect(noToken.status).toBe(403)
    expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe('not_writer')
  } finally {
    target.closeAllConnections()
    await new Promise(r => target.close(r))
  }
})

async function learning(page: import('@playwright/test').Page, id: string, title: string) {
  await putTicket(srv, learningCard(id, title))
  await page.reload()
  await draftSprint1(page)
  await page.goto(`/do/${id}`)
}

test('BR-05 learning check pass finishes the card and raises xp', async ({ browser }) => {
  const { page } = await app(browser)
  await learning(page, 'w-hash', 'Hash maps')
  const before = await xpTotal(page)
  await page.goto('/do/w-hash')
  await page.getByRole('button', { name: 'Mark done' }).click()
  const dialog = page.getByRole('dialog', { name: 'Check your understanding' })
  await dialog.getByRole('textbox', { name: 'Explain Hash maps in your own words' }).fill('I can explain how hash maps work')
  await dialog.getByRole('radiogroup', { name: 'Which is Hash maps?' }).getByRole('radio', { name: 'Hash maps', exact: true }).check()
  await dialog.getByRole('button', { name: 'Check answers' }).click()
  await expect(dialog.getByText('Passed')).toBeVisible()
  await expect.poll(async () => (await ticket(srv, 'w-hash')).status).toBe('done')
  expect(await xpTotal(page)).toBe(before + 10)
})

test('BR-06 learning check fail: correction shown, card open, one redo in 3 days, attempt stored and listed', async ({ browser }) => {
  const { page } = await app(browser)
  await learning(page, 'w-hash', 'Hash maps')
  await page.getByRole('button', { name: 'Mark done' }).click()
  const dialog = page.getByRole('dialog', { name: 'Check your understanding' })
  await dialog.getByRole('textbox', { name: 'Explain Hash maps in your own words' }).fill('no idea')
  await dialog.getByRole('radiogroup', { name: 'Which is Hash maps?' }).getByRole('radio', { name: 'Hash maps', exact: true }).check()
  await dialog.getByRole('button', { name: 'Check answers' }).click()
  await expect(dialog.getByText('Not yet')).toBeVisible()
  await expect(dialog).toContainText('Mention Hash maps')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect((await ticket(srv, 'w-hash')).status).toBe('todo')
  const redos = (await rows(srv, 'redos')).filter(r => r.ticketId === 'w-hash')
  expect(redos).toHaveLength(1)
  expect(redos[0].due).toBe(localDay(new Date(new Date(CLOCK.sprint1).getTime() + 3 * 86_400_000)))
  const attempts = (await rows(srv, 'checkAttempts')).filter(a => a.ticketId === 'w-hash')
  expect(attempts).toHaveLength(1)
  expect(attempts[0]).toMatchObject({ passed: false, answers: [{ id: 'q1', answer: 'no idea' }, { id: 'q2', choice: 0 }] })
  expect(attempts[0].feedback[0]).toMatchObject({ id: 'q1', verdict: 'fail', correction: 'Mention Hash maps', pointer: 'Step 1' })
  await expect(page.getByTestId('check-attempt')).toHaveCount(1)
  await expect(page.getByTestId('check-attempt')).toContainText('no idea')
})

test('BR-07 build card: Mark done asks for the deliverable, stores it and finishes the card', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  await page.goto('/do/m1w1i2')
  await page.getByRole('button', { name: 'Mark done' }).click()
  const dialog = page.getByRole('dialog', { name: 'Deliverable' })
  await expect(dialog).toContainText('Paste your code, typed by hand')
  await dialog.getByRole('textbox').fill('def bfs(g): return sorted(g)')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('card-brief')).toContainText('def bfs(g): return sorted(g)')
  await expect.poll(async () => (await ticket(srv, 'm1w1i2')).status).toBe('done')
  expect((await ticket(srv, 'm1w1i2')).deliverable).toMatchObject({ text: 'def bfs(g): return sorted(g)', kind: 'code' })
})

test('BR-08 split a big item into 3 sessions; the parent is done only when all 3 are', async ({ browser }) => {
  const { page } = await app(browser)
  // ruling 10 Q20 / 18 F8: Split shows only on a briefed ticket; m1w1i2 is a build card (no check owed by the parent)
  await draftSprint1(page)
  await page.goto('/do/m1w1i2')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const dialog = page.getByRole('dialog', { name: 'Split into sessions' })
  await dialog.getByRole('spinbutton', { name: 'Parts' }).fill('3')
  await dialog.getByRole('button', { name: 'Split' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await rows(srv, 'tickets')).filter(t => t.origin === 'm1w1i2').length).toBe(3)
  const kids = (await rows(srv, 'tickets')).filter(t => t.origin === 'm1w1i2')
  expect(kids.every(k => k.sprint === 1 && k.childOf === 'm1w1i2')).toBe(true)
  for (const [i, k] of kids.entries()) {
    await page.goto(`/do/${k.id}`)
    await page.getByTestId('do-outcome-solved').click()
    await expect.poll(async () => (await ticket(srv, k.id)).status).toBe('done')
    expect((await ticket(srv, 'm1w1i2')).status).toBe(i < 2 ? 'todo' : 'done')
  }
  await expect.poll(async () => (await ticket(srv, 'm1w1i2')).status).toBe('done')
})

test('BR-09 budget default, Today load minutes, and Thursday suggests light cards', async ({ browser }) => {
  const { page } = await app(browser)
  await page.goto('/settings')
  await expect(page.getByRole('spinbutton', { name: 'Core minutes per sprint' })).toHaveValue('1440')
  await draftSprint1(page)
  await page.goto('/')
  const ts = await sprint1()
  const hours = ts.reduce((a, t) => a + t.brief.minutes, 0) / 60
  await expect(page.getByTestId('load-minutes')).toHaveText(`${Number.isInteger(hours) ? hours : hours.toFixed(1)} h / 24 h`)
  await page.goto('/do/m1w1i2')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  await page.getByRole('dialog', { name: 'Edit brief' }).getByLabel('Day type').selectOption('light')
  await page.getByRole('dialog', { name: 'Edit brief' }).getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await ticket(srv, 'm1w1i2')).brief.dayType).toBe('light')
  await page.clock.setSystemTime(new Date(CLOCK.thursday))
  await page.goto('/')
  const links = page.getByTestId('suggested').locator('[data-testid^="do-"]')
  await expect(links).toHaveCount(1)
  await expect(links.first()).toHaveAttribute('data-testid', 'do-m1w1i2')
})

test('BR-10 roll-over: past the end of sprint 1 unfinished cards move to sprint 2; xp unchanged', async ({ browser }) => {
  const { page } = await app(browser)
  await page.goto('/')
  await page.getByRole('button', { name: /This sprint/ }).click()
  await page.getByTestId('drawer-tasks').getByRole('checkbox', { name: /^Done: /, checked: false }).first().check()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  const xp = await xpTotal(page)
  expect(xp).toBeGreaterThan(0)
  const unfinished = (await sprint1()).filter(t => t.status !== 'done').map(t => t.id)
  await page.clock.setSystemTime(new Date(CLOCK.sprint2))
  await page.reload()
  await expect(page.getByTestId('rolled-note')).toHaveText(`${unfinished.length} cards rolled from Sprint 1`)
  await expect.poll(async () => (await rows(srv, 'tickets')).filter(t => t.rolledFrom?.includes(1)).length).toBe(unfinished.length)
  const after = await rows(srv, 'tickets')
  for (const id of unfinished) expect(after.find(t => t.id === id)).toMatchObject({ sprint: 2, rolledFrom: [1] })
  expect(await xpTotal(page)).toBe(xp)
})

test('BR-11 rebalance: proposal lists moves, pinned cards stay, unchecked moves stay, accept fits the budget', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  await page.goto('/settings')
  const budget = page.getByRole('spinbutton', { name: 'Core minutes per sprint' })
  await budget.fill('120')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await page.goto('/board')
  const ts = (await sprint1()).sort((a, b) => a.order - b.order)
  const last = ts[ts.length - 1]
  await page.getByTestId(`card-${last.id}`).getByRole('button', { name: 'Pin' }).click()
  await expect.poll(async () => (await ticket(srv, last.id)).pinned).toBe(true)
  await page.getByRole('button', { name: 'Rebalance?' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Rebalance?' })
  await expect(dialog.getByTestId(`rebalance-move-${last.id}`)).toHaveCount(0)
  const boxes = dialog.locator('[data-testid^="rebalance-move-"]')
  const n = await boxes.count()
  expect(n).toBe(ts.length - 2) // 120 minutes holds two 60-minute cards
  const keep = ts[ts.length - 2] // the latest movable card
  await dialog.getByTestId(`rebalance-move-${keep.id}`).uncheck()
  await dialog.getByRole('button', { name: 'Accept' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await sprint1()).length).toBe(3) // 2 within budget + the unchecked one
  const after = await rows(srv, 'tickets')
  expect(after.find(t => t.id === last.id)!.sprint).toBe(1)
  expect(after.find(t => t.id === keep.id)!.sprint).toBe(1)
  const moved = after.filter(t => t.sprint === 2 && ts.some(x => x.id === t.id))
  expect(moved).toHaveLength(n - 1)
})

test('BR-11b accepting the whole proposal brings the sprint within budget', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  await page.goto('/settings')
  await page.getByRole('spinbutton', { name: 'Core minutes per sprint' }).fill('120')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await page.goto('/board')
  await page.getByRole('button', { name: 'Rebalance?' }).first().click()
  await page.getByRole('dialog', { name: 'Rebalance?' }).getByRole('button', { name: 'Accept' }).click()
  await expect.poll(async () => (await sprint1()).reduce((a, t) => a + t.brief.minutes, 0)).toBeLessThanOrEqual(120)
  await expect(page.getByRole('button', { name: 'Rebalance?' })).toHaveCount(0)
})

test('BR-12 Move to sprint… moves a card, on the Board and on disk', async ({ browser }) => {
  const { page } = await app(browser)
  await page.goto('/board')
  await page.getByTestId('card-m1w1i1').getByRole('button', { name: 'Move to sprint…' }).click()
  await page.getByRole('menuitem', { name: 'Sprint 3', exact: true }).click()
  await expect(page.getByTestId('card-m1w1i1')).toHaveCount(0)
  await page.getByTestId('strip-3').click()
  await expect(page.getByTestId('card-m1w1i1')).toBeVisible()
  await expect.poll(async () => (await ticket(srv, 'm1w1i1')).sprint).toBe(3)
})

test('BR-13 sprint review: numbers from code, fake prose, stored across a restart', async ({ browser }) => {
  const { page } = await app(browser)
  await page.goto('/')
  await page.getByRole('button', { name: /This sprint/ }).click()
  await page.getByTestId('drawer-tasks').getByRole('checkbox', { name: /^Done: /, checked: false }).first().check()
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  const planned = (await sprint1()).length
  await page.goto('/progress')
  const reviews = page.getByRole('region', { name: 'Reviews' })
  await reviews.getByRole('button', { name: 'Build review' }).click()
  await expect(reviews.getByTestId('rv-done')).toHaveText('1')
  await expect(reviews.getByTestId('rv-days')).toHaveText('1 day')
  await expect(reviews.getByTestId('rv-slipped')).toHaveText('0')
  await expect(reviews).toContainText(`Review for Sprint 1: 1/${planned} cards done.`)
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await srv.restart()
  const fresh = await reopen(browser, srv)
  ctxs.push(fresh.ctx)
  await fresh.page.goto('/progress')
  const again = fresh.page.getByRole('region', { name: 'Reviews' })
  await expect(again).toContainText(`Review for Sprint 1: 1/${planned} cards done.`)
  await expect(again.getByTestId('rv-done')).toHaveText('1')
})

test('BR-14 an AI failure for one ticket: the AI error line shows, that ticket has no brief, the rest do', async ({ browser }) => {
  const { page } = await app(browser, CLOCK.sprint1, ctx => ctx.addInitScript(() => { localStorage.setItem('dojo-ai-fake-fail', 'brief@m1w1i1') }))
  await page.goto('/board')
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Done', { timeout: 60_000 })
  await expect(page.getByTestId('ai-error')).toBeVisible()
  await expect(page.getByTestId('ai-error-detail')).toHaveText('claude_failed: fake brief unavailable')
  await expect(page.getByTestId('ai-error')).toContainText('The AI helper failed.')
  const ts = await sprint1()
  expect(ts.find(t => t.id === 'm1w1i1')!.brief).toBeUndefined()
  expect(ts.filter(t => t.id !== 'm1w1i1').every(t => t.brief?.status === 'draft')).toBe(true)
})

test('BR-15 no forge code: forge briefs are typed-by-hand code with no fenced block (a teach-back is an explanation, UAT cu-5 P2-2)', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  const forge = (await sprint1()).filter(t => t.track === 'ai' && t.kind === 'stage' && t.session !== 'watch')
  expect(forge.length).toBeGreaterThanOrEqual(3) // build, rebuild and teach-back stages; the watch stage is a learning card
  expect(forge.some(t => t.session === 'teachback')).toBe(true)
  for (const t of forge) {
    if (t.session === 'teachback') {
      // sketch it or explain it in writing: there is no code to type, so nothing asks for it
      expect(t.brief.deliverable).toEqual({ kind: 'explanation', prompt: 'Explain it in your own words' })
    } else {
      expect(t.brief.deliverable.kind).toBe('code')
      expect(t.brief.deliverable.prompt).toContain('typed by hand')
    }
    expect(JSON.stringify(t.brief.steps)).not.toContain('```')
  }
  await page.goto('/do/stage-00-setup-w1-build')
  await expect(page.getByTestId('card-brief')).toContainText('typed by hand')
  const tb = forge.find(t => t.session === 'teachback')!
  await page.goto(`/do/${tb.id}`)
  await expect(page.getByTestId('brief-deliverable')).toHaveText('Explain it in your own words')
  await expect(page.getByTestId('card-brief')).not.toContainText('typed by hand')
})

test('Addendum 3: Solved on Do and the Board Done button open the check for a briefed learning card', async ({ browser }) => {
  const { page } = await app(browser)
  await learning(page, 'w-hash', 'Hash maps')
  await page.getByTestId('do-outcome-solved').click()
  await expect(page.getByRole('dialog', { name: 'Check your understanding' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/board')
  await page.getByTestId('card-w-hash').hover()
  await page.getByTestId('card-w-hash').getByRole('button', { name: 'Done ✓' }).click()
  await expect(page.getByRole('dialog', { name: 'Check your understanding' })).toBeVisible()
  expect((await ticket(srv, 'w-hash')).status).toBe('todo')
  expect((await rows(srv, 'checkAttempts')).length).toBe(0)
})

test('Addendum 3: an ended sprint gets its review automatically on the next app open', async ({ browser }) => {
  const { page } = await app(browser)
  const planned = (await sprint1()).length
  await page.clock.setSystemTime(new Date(CLOCK.sprint2))
  await page.reload()
  await expect.poll(async () => (await rows(srv, 'reviews')).map(r => r.sprint)).toEqual([1])
  const r = (await rows(srv, 'reviews'))[0]
  expect(r.prose).toBe(`Review for Sprint 1: 0/${planned} cards done.`)
  expect(r.kind).toBe('auto')
  await page.goto('/progress')
  await expect(page.getByRole('region', { name: 'Reviews' })).toContainText(`Review for Sprint 1: 0/${planned} cards done.`)
})

test('Addendum 4: a stage whose session is watch is a learning card (answers and the check); build stages stay code', async ({ browser }) => {
  const { page } = await app(browser)
  await draftSprint1(page)
  const watch = await ticket(srv, STAGE)
  expect(watch.brief.deliverable.kind).toBe('answers')
  expect(watch.brief.questions.length).toBe(2)
  expect((await ticket(srv, 'stage-00-setup-w1-build')).brief.deliverable.kind).toBe('code')
  await page.goto(`/do/${STAGE}`)
  await page.getByRole('button', { name: 'Mark done' }).click()
  await expect(page.getByRole('dialog', { name: 'Check your understanding' })).toBeVisible()
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

for (const variant of ['invalid', 'forge-code']) {
  test(`BR-20 the fake variant ${variant} is refused and saves nothing`, async ({ browser }) => {
    const { page } = await app(browser, CLOCK.sprint1, ctx => ctx.addInitScript(v => { localStorage.setItem('dojo:fake-ai-brief', v) }, variant))
    await page.goto('/board')
    await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
    // UAT r3 P2: a run that drafted nothing (every card refused) is Failed, not Done
    await expect(page.getByTestId('brief-progress')).toHaveText(variant === 'invalid' ? 'Failed' : 'Done', { timeout: 60_000 })
    if (variant === 'invalid') await expect(page.getByTestId('brief-failed')).toHaveText(/^None of the \d+ cards could be drafted\.$/)
    await expect(page.getByTestId('ai-error')).toBeVisible()
    const ts = await sprint1()
    const refused = variant === 'invalid' ? ts : ts.filter(t => t.track === 'ai' && t.kind === 'stage' && t.session !== 'watch')
    expect(refused.length).toBeGreaterThan(0)
    expect(refused.every(t => t.brief === undefined)).toBe(true)
  })
}

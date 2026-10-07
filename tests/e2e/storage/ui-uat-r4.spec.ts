import { expect, test, type Page } from '@playwright/test'
import { draftSprint1, openApp, rows, ticket } from './briefs-helpers'
import { ServerHarness } from './harness'

// Findings of the code-blind Electron UAT run 4 (dojo-acceptance/reports/uat/dojo-electron-r4.md, b7a371e), to
// controller ruling 20 (ui-foundation.md): split minutes, the split dialog, parts that inherit, units, Undo.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 240_000 })

/** p200 with a drafted brief cut to 35 min (the r4 card), through Edit brief. */
async function p200At35(page: Page) {
  await draftSprint1(page)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  await ed.getByRole('spinbutton', { name: 'Minutes' }).fill('35')
  await ed.getByRole('button', { name: 'Save' }).click()
  await expect(ed).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).brief?.minutes).toBe(35)
}

async function splitP200(page: Page, parts = 3) {
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.getByRole('spinbutton', { name: 'Parts' }).fill(String(parts))
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).children?.length).toBe(parts)
}

test('r4 P2 #3 / ruling 20 S1 S2: the dialog states exactly what Split creates; parts sum to the card; Parts 2 to ⌊min/10⌋', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await p200At35(page)
  await page.goto('/board')
  const before = await page.locator('.col-min').first().textContent()
  const beforeCount = Number(await page.getByTestId('count-todo').textContent())
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  const parts = sp.getByRole('spinbutton', { name: 'Parts' })
  await expect(parts).toHaveAttribute('min', '2')
  await expect(parts).toHaveAttribute('max', '3') // ⌊35/10⌋: every part at least 10 min
  await expect(parts).toHaveValue('3')
  const body = sp.getByTestId('split-preview')
  await expect(body).toHaveText('Cut this card into 3 sessions (12, 12 and 11 min). Each session is its own card in the same sprint; this card is done when all of them are.')
  await expect(sp).not.toContainText('45 to 90')
  await expect(sp.getByTestId('split-suggested')).toHaveCount(0) // under 90 min: no 45–90 advice
  await parts.fill('2')
  await expect(body).toHaveText(/^Cut this card into 2 sessions \(18 and 17 min\)\./)
  await parts.fill('4')
  await expect(sp.getByTestId('split-error')).toHaveText('Split into 2 to 3 parts')
  await parts.fill('3')
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await expect.poll(async () => (await ticket(srv, 'p200')).children?.length).toBe(3)
  const kids = (await rows(srv, 'tickets')).filter(t => t.childOf === 'p200').sort((a, b) => a.id.localeCompare(b.id))
  expect(kids.map(k => k.estMin)).toEqual([12, 12, 11])
  // the Board's minutes don't move: the parent's 35 out, the parts' 35 in
  await page.goto('/board')
  await expect(page.locator('.col-min').first()).toHaveText(before!)
  // ruling 20 S4: the column counts the cards it lists; the split card is an uncounted group line above its parts
  const todo = page.getByTestId('col-todo')
  await expect(todo.getByTestId('group-p200')).toHaveText('200 · Number of Islands · split · 0 of 3 done')
  await expect(todo.getByTestId('card-p200')).toHaveCount(0)
  await expect(page.getByTestId('count-todo')).toHaveText(String(await todo.locator('article.card').count()))
  expect(Number(await page.getByTestId('count-todo').textContent())).toBe(beforeCount + 2)
  await expect(page.locator('.debt-lead')).toHaveText('Plan items this sprint:')
  // an already-split card doesn't offer Split again (no refusal toast)
  await page.goto('/do/p200')
  await expect(page.getByTestId('split-sessions')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Split into sessions' })).toHaveCount(0)
  await ctx.close()
})

test('ruling 20 S2: a card of 90 min or more gets the 45–90 advice; under 20 min, no Split', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  for (const [min, shown] of [[120, true], [19, false]] as const) {
    await page.goto('/do/p200')
    await page.getByRole('button', { name: 'Edit brief' }).click()
    const ed = page.getByRole('dialog', { name: 'Edit brief' })
    await ed.getByRole('spinbutton', { name: 'Minutes' }).fill(String(min))
    await ed.getByRole('button', { name: 'Save' }).click()
    await expect(ed).toBeHidden()
    await expect(page.getByRole('button', { name: 'Split into sessions' })).toHaveCount(shown ? 1 : 0)
    if (!shown) continue
    await page.getByRole('button', { name: 'Split into sessions' }).click()
    const sp = page.getByRole('dialog', { name: 'Split into sessions' })
    await expect(sp.getByTestId('split-suggested')).toHaveText('Suggested: 2 parts (about 45–90 min each)')
    await expect(sp.getByRole('spinbutton', { name: 'Parts' })).toHaveAttribute('max', '8')
    await sp.getByRole('button', { name: 'Cancel' }).click()
  }
  await ctx.close()
})

test('r4 P1 #1, P2 #2 #4 / ruling 20 S3 S4 S5: Today names one part; a part shows its parent\'s brief; one solve counts once', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await p200At35(page)
  await splitP200(page, 3)
  // S5 (as amended by ruling 22 D1): NOW names part 1 first, the parts stand in 200's place, 695 stays in the slot
  await page.goto('/')
  await expect(page.getByTestId('now-headline')).toHaveText('Code · 2 × 25 min')
  await expect(page.getByTestId('now-text')).toHaveText(
    'Two timed problems in four sessions, no agent: 200 · Number of Islands — part 1 of 3 · 12 min, part 2 of 3 · 12 min, part 3 of 3 · 11 min · 695 Max Area of Island',
  )
  await page.getByTestId('start-button').click()
  await page.waitForURL(/\/do\/p200~1$/)
  // S3: the part shows the parent's brief with its place, the parent's approaches and label, never "No brief yet"
  const brief = page.getByTestId('card-brief')
  await expect(brief).toBeVisible()
  await expect(brief.getByTestId('brief-part')).toContainText('Part 1 of 3 · 12 min')
  await expect(brief.getByTestId('brief-goal')).toHaveText(/Number of Islands/)
  await expect(page.getByText('No brief yet', { exact: false })).toHaveCount(0)
  const chips = page.locator('.st-chips')
  await expect(chips).toContainText('LC 200')
  await expect(chips).not.toContainText('200~1')
  await expect(chips).toContainText('Medium')
  await expect(page.getByText('No approaches listed yet')).toHaveCount(0)
  await expect(page.getByTestId('dsa-approaches')).toContainText('Union-find')
  await expect(page.getByRole('button', { name: 'Split into sessions' })).toHaveCount(0)
  // solve all three parts
  for (const k of ['p200~1', 'p200~2', 'p200~3']) {
    await page.goto(`/do/${k}`)
    await page.getByTestId('do-outcome-solved').click()
    await expect.poll(async () => (await ticket(srv, k)).status).toBe('done')
  }
  await expect.poll(async () => (await ticket(srv, 'p200')).status).toBe('done')
  await page.goto('/board')
  const done = page.getByTestId('col-done')
  await expect(done.getByTestId('group-p200')).toHaveText('200 · Number of Islands · split · 3 of 3 done')
  // ruling 20 S4 (UAT cu-r1b F-B2): the Done header counts the cards listed under it: the three parts (Week and Progress count the problem once)
  await expect(page.getByTestId('count-done')).toHaveText('3')
  await expect(done.locator('article.card')).toHaveCount(3)
  // S4: one problem, solved once, everywhere
  await page.goto('/progress')
  await expect(page.getByTestId('ev-dsa-solved-value')).toHaveText('1')
  await expect(page.getByTestId('ring-dsa-count')).toHaveText(/^1\//)
  await expect(page.getByTestId('ring-all-count')).toHaveText(/^1\//)
  await page.goto('/dsa')
  await expect(page.getByTestId('dsa-solved')).toContainText('1/169')
  await ctx.close()
})

test('r4 P3 #6 #7 / ruling 20 S6: Undo is per session, names its action, and takes back a split while no part has started', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await p200At35(page)
  await page.goto('/board')
  const undo = page.getByTestId('undo')
  await expect(undo).toHaveText('Undo (0)')
  await expect(undo).toHaveAttribute('data-tip', 'Nothing to undo')
  const m = (await ticket(srv, 'm1w1i1')).title as string
  await page.getByTestId('card-m1w1i1').getByRole('button', { name: 'Move to sprint…' }).click()
  await page.getByRole('menuitem', { name: 'Sprint 3', exact: true }).click()
  await expect(undo).toHaveText('Undo (1)')
  await expect(undo).toHaveAttribute('data-tip', `Undo: move '${m}' to Sprint 3`)
  // a relaunch (a reload here) starts with an empty history: an older decision is never reverted silently
  await page.reload()
  await expect(page.getByTestId('undo')).toHaveText('Undo (0)')
  // split p200 from the Board (client-side, same session), come back, undo the split
  await page.getByTestId('card-p200').click()
  await page.waitForURL(/\/do\/p200$/)
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  const sp = page.getByRole('dialog', { name: 'Split into sessions' })
  await sp.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(sp).toBeHidden()
  await page.getByTestId('do-back').click()
  await page.waitForURL(/\/board$/)
  await expect(undo).toHaveText('Undo (1)')
  await expect(undo).toHaveAttribute('data-tip', "Undo: split '200 · Number of Islands' into 3 sessions")
  await undo.click()
  await expect(page.getByTestId('card-p200')).toBeVisible()
  await expect(page.getByTestId('group-p200')).toHaveCount(0)
  await expect.poll(async () => (await rows(srv, 'tickets')).filter(t => t.childOf === 'p200').length).toBe(0)
  expect((await ticket(srv, 'p200')).children ?? []).toEqual([])
  await expect(undo).toHaveText('Undo (0)')
  // split again and start a part: the split is no longer undoable
  await page.getByTestId('card-p200').click()
  await page.waitForURL(/\/do\/p200$/)
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  await page.getByRole('dialog', { name: 'Split into sessions' }).getByRole('button', { name: 'Split', exact: true }).click()
  await page.getByTestId('do-back').click()
  await page.waitForURL(/\/board$/)
  await expect(undo).toHaveText('Undo (1)')
  const part = page.getByTestId('card-p200~1')
  await part.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByTestId('col-doing').getByTestId('card-p200~1')).toBeVisible()
  // the column move is undoable; the split under it is not any more
  await expect(undo).toHaveText('Undo (1)')
  await expect(undo).toHaveAttribute('data-tip', "Undo: move '200 · Number of Islands · part 1 of 3' to Doing")
  await undo.click()
  await expect(page.getByTestId('col-todo').getByTestId('card-p200~1')).toBeVisible()
  await expect(undo).toHaveText('Undo (1)') // part 1 is back in Todo, unstarted: the split is undoable again
  await ctx.close()
})

test('r4 P3 #8 / ruling 20 S7: signed out, only the friendly line shows (raw detail behind Details); Do says drafting needs sign-in', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv, undefined, c => c.addInitScript(() => { localStorage.setItem('dojo-ai-fake-fail', 'brief:claude_signed_out') }))
  await page.goto('/board')
  await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
  await expect(page.getByTestId('brief-progress')).toHaveText('Failed')
  const err = page.getByTestId('ai-error')
  await expect(err).toContainText("Claude Code isn't signed in. Open Terminal, run claude, sign in, then try again.")
  await expect(page.getByTestId('ai-error-detail')).toBeHidden()
  await err.getByText('Details', { exact: true }).click()
  await expect(page.getByTestId('ai-error-detail')).toBeVisible()
  await expect(page.getByTestId('ai-error-detail')).toHaveText('claude_signed_out: fake brief unavailable')
  // a Do screen without a brief says what drafting needs, also after the Board's result is dismissed
  await page.getByTestId('brief-dismiss').click()
  await page.goto('/do/p200')
  await expect(page.getByTestId('no-brief')).toHaveText('No brief yet. Draft briefs for this sprint from the Board. Drafting needs Claude Code signed in.')
  await ctx.close()
})

test('r4 J9 (open since r3): at 375 the Do header title wraps to two lines instead of being cut', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const watch = (await rows(srv, 'tickets')).find(t => t.sprint === 1 && t.kind === 'stage' && t.session === 'watch')!
  await page.setViewportSize({ width: 375, height: 700 })
  await page.goto(`/do/${watch.id}`)
  const rail = page.locator('.do-rail-title')
  await expect(rail).toHaveText(watch.title)
  await expect(rail).toHaveAttribute('title', watch.title)
  // the whole title shows: nothing clipped, nothing wider than the page
  expect(await rail.evaluate(e => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await ctx.close()
})

test('r4 (open since r3): forge/… paths and *.md names in brief text are monospace file chips, as in statements', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await draftSprint1(page)
  await page.goto('/do/p200')
  await page.getByRole('button', { name: 'Edit brief' }).click()
  const ed = page.getByRole('dialog', { name: 'Edit brief' })
  await ed.getByRole('textbox', { name: 'Goal' }).fill('Open forge/stages/00-setup/redo.md and read it; log questions in QUESTIONS.md.')
  await ed.getByRole('button', { name: 'Save' }).click()
  await expect(ed).toBeHidden()
  const goal = page.getByTestId('brief-goal')
  await expect(goal.locator('code.file-ref')).toHaveText(['forge/stages/00-setup/redo.md', 'QUESTIONS.md'])
  expect(await goal.locator('code.file-ref').first().evaluate(e => getComputedStyle(e).fontFamily)).toMatch(/Space Mono|monospace/)
  await expect(goal).toHaveText('Open forge/stages/00-setup/redo.md and read it; log questions in QUESTIONS.md.')
  await ctx.close()
})

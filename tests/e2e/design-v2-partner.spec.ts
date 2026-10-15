import { expect, test, type Page } from '@playwright/test'
import { idbCount } from './helpers'
import { addKind, addKinds, begin, designRows, endDrawing, fillClose, guard, keyLink, liveRow, pick, putDesignSession, RL, RL_DIVES, RL_TITLE, startSession, T0, openNotes } from './design-helpers'

// Design session v2, the human partner: the card in a second window, the inline fallback, the card route, the digest and the scores (DESIGN-54 to 67).
const HEADINGS = [
  'DIAGRAM', 'CANVAS NOTES', 'REQUIREMENTS - FUNCTIONAL', 'REQUIREMENTS - NON-FUNCTIONAL', 'ASSUMPTIONS AND ESTIMATES', 'API', 'DATA MODEL', 'TRADE-OFFS', 'OPEN QUESTIONS',
]

/** The card route page for a session, opened as a new page of the same browser (same origin and database). */
async function openCardPage(page: Page, sessionId: string): Promise<Page> {
  await page.clock.resume() // a frozen clock starves the mount of a new page (see design-helpers `freeze`)
  const card = await page.context().newPage()
  await card.goto(`/#/partner/${sessionId}`)
  await expect(card.getByTestId('partner-card')).toBeVisible()
  return card
}

/** A score-phase step shared by the DESIGN-66/67 tests: dives 2 to 4, the lenses and a second trade-off, the way the host does after the partner scored dive 1. */
async function hostScores(page: Page, dives: [number, number, number]) {
  for (const [i, v] of dives.entries()) await page.getByTestId(`session-dive-score-${i + 2}-${v}`).check()
  const lenses = { Load: 2, Data: 1, Consistency: 1, Failure: 0, Latency: 2, Cost: 1, Evolution: 1 } as const
  for (const [name, v] of Object.entries(lenses)) await pick(page, name, v as 0 | 1 | 2)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
  await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
  await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
}

test('DESIGN-55/61/62/64/66/67 the card opens in a second page, follows the session live, its scores prefill the rubric, and confirming keeps them the partner\'s', async ({ page, context }) => {
  test.setTimeout(90_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'With someone')
  await page.getByTestId('session-tab-partner').click()
  await expect(page.getByTestId('partner-tab')).toBeVisible()
  await page.clock.resume()
  const [card] = await Promise.all([context.waitForEvent('page'), page.getByTestId('partner-open-window').click()])
  await card.waitForLoadState()
  const checkCard = guard(card)
  const sessionId = (await liveRow(page)).id
  await expect(card).toHaveURL(new RegExp(`/#/partner/${sessionId}$`))
  await expect(card.getByTestId('screen-partner')).toBeVisible()
  await expect(card.getByTestId('partner-card')).toBeVisible()
  // DESIGN-57: only the card, no shell
  await expect(card.locator('nav')).toHaveCount(0)
  await expect(card.getByTestId('shell-rail')).toHaveCount(0)
  await expect(card.getByTestId('shell-tabbar')).toHaveCount(0)
  // DESIGN-62: the digest holds no inputs, and the card has no canvas
  await expect(card.getByTestId('partner-digest').locator('input, textarea')).toHaveCount(0)
  await expect(card.getByTestId('kit-canvas')).toHaveCount(0)
  // DESIGN-61: a node and a notes box edited in the main window show up in the card within 3 seconds, no reload
  await addKind(page, 'gateway')
  await page.getByTestId('session-tab-notes').click()
  await openNotes(page)
  await page.getByTestId('notes-field-api').fill('POST /photos')
  await expect(card.getByTestId('partner-digest')).toContainText('- Gateway 1 [gateway]', { timeout: 3000 })
  await expect(card.getByTestId('partner-digest')).toContainText('POST /photos', { timeout: 3000 })
  // DESIGN-63/64: the sheet, the total, a name, one save
  await expect(card.getByTestId('partner-total')).toHaveText('0 of 20')
  await card.getByTestId('partner-name').fill('Sam')
  for (const [n, v] of [[1, 3], [2, 3], [3, 3], [4, 3], [5, 2]]) await card.getByTestId(`partner-score-${n}-${v}`).check()
  await expect(card.getByTestId('partner-total')).toHaveText('14 of 20')
  await card.getByTestId('partner-score-dive-1-2').check()
  await expect(card.getByTestId('partner-save')).toHaveText('SAVE · SCORES')
  await expect(card.locator('[data-accent="primary"]')).toHaveCount(1)
  await card.getByTestId('partner-save').click()
  await expect(card.getByTestId('partner-status')).toHaveText('Saved')
  await expect.poll(async () => (await liveRow(page)).partner, { timeout: 2000 }).toMatchObject({
    name: 'Sam', scores: { perItem: [3, 3, 3, 3, 2], deepDives: [2, null, null, null] },
  })
  expect(typeof (await liveRow(page)).partner!.at).toBe('number')
  // DESIGN-66: close, then the score form is prefilled from the partner; unscored dives stay blank
  await endDrawing(page)
  await fillClose(page, RL_DIVES[3]) // the dive the learner could not answer is the fourth: dive 1 may keep its 2
  await expect(page.getByTestId('session-score-prefilled')).toBeVisible()
  await expect(page.getByTestId('session-rubric')).toHaveValue('14')
  await expect(page.getByRole('spinbutton', { name: 'Rubric (0–20)' })).toHaveValue('14')
  await expect(page.getByTestId('session-dive-score-1-2')).toBeChecked()
  for (const n of [2, 3, 4]) for (const v of [0, 1, 2]) await expect(page.getByTestId(`session-dive-score-${n}-${v}`), `dive ${n} option ${v}`).not.toBeChecked()
  await expect(page.getByTestId('session-complete')).toBeDisabled()
  await hostScores(page, [1, 2, 1])
  // DESIGN-67: confirmed without edits
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  const done = await liveRow(page)
  expect(done).toMatchObject({ phase: 'done', rubric: 14, rubricBy: 'partner' })
  const dives = done.deepDives as { answered: number; by: string }[]
  expect(dives.map(d => d.by)).toEqual(['partner', 'self', 'self', 'self'])
  expect(dives.map(d => d.answered)).toEqual([2, 1, 2, 1])
  check()
  checkCard()
  await card.close()
})

test('DESIGN-67 an edit of the prefilled rubric makes it the host\'s own; a partner-scored dive stays the partner\'s', async ({ page }) => {
  test.setTimeout(60_000)
  const check = guard(page)
  await page.context().addInitScript(() => { window.open = () => null }) // the card sits in the Partner tab instead
  await begin(page)
  await startSession(page, 'With someone')
  await page.getByTestId('session-tab-partner').click()
  await page.getByTestId('partner-open-window').click()
  const card = page.getByTestId('partner-card')
  await expect(card).toBeVisible()
  for (const [n, v] of [[1, 4], [2, 3], [3, 3], [4, 2], [5, 2]]) await card.getByTestId(`partner-score-${n}-${v}`).check()
  await card.getByTestId('partner-score-dive-2-2').check()
  await card.getByTestId('partner-save').click()
  await expect(card.getByTestId('partner-status')).toHaveText('Saved')
  await endDrawing(page)
  await fillClose(page, RL_DIVES[3])
  await expect(page.getByTestId('session-rubric')).toHaveValue('14')
  await page.getByTestId('session-rubric').fill('13') // the host changes the partner's number
  await page.getByTestId('session-dive-score-1-1').check()
  await page.getByTestId('session-dive-score-3-1').check()
  await page.getByTestId('session-dive-score-4-0').check()
  const lenses = { Load: 2, Data: 1, Consistency: 1, Failure: 0, Latency: 2, Cost: 1, Evolution: 1 } as const
  for (const [name, v] of Object.entries(lenses)) await pick(page, name, v as 0 | 1 | 2)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('a')
  await row2.getByRole('textbox', { name: 'Over' }).fill('b')
  await row2.getByRole('textbox', { name: 'Because' }).fill('c')
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  const done = await liveRow(page)
  expect(done).toMatchObject({ rubric: 13, rubricBy: 'self' })
  const dives = done.deepDives as { answered: number; by: string }[]
  expect(dives[1]).toMatchObject({ answered: 2, by: 'partner' }) // untouched partner score
  expect(dives[0]).toMatchObject({ answered: 1, by: 'self' }) // edited by the host
  check()
})

test('DESIGN-56/65/74 a blocked window shows the same card in the Partner tab with one accent on the screen; a partial sheet saves with nulls; the toggle hides and shows', async ({ page, context }) => {
  const check = guard(page)
  await context.addInitScript(() => { window.open = () => null })
  await begin(page)
  await startSession(page, 'With someone')
  await page.getByTestId('session-tab-partner').click()
  await page.getByTestId('partner-open-window').click()
  const tab = page.getByTestId('partner-tab')
  await expect(tab.getByTestId('partner-card')).toBeVisible()
  await expect(page.getByTestId('partner-card')).toHaveCount(1)
  // the screen keeps its one accent button: the card's save is a normal control here
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
  await expect(page.locator('[data-accent="primary"]')).toHaveAttribute('data-testid', 'session-close-design')
  await expect(page.getByTestId('partner-save')).not.toHaveAttribute('data-accent', /.+/)
  await expect(page.getByTestId('partner-save')).toHaveText('SAVE · SCORES')
  // DESIGN-65: three rows, a save, nulls for the rest
  for (const [n, v] of [[1, 4], [3, 2], [5, 1]]) await page.getByTestId(`partner-score-${n}-${v}`).check()
  await expect(page.getByTestId('partner-total')).toHaveText('7 of 20')
  await page.getByTestId('partner-save').click()
  await expect(page.getByTestId('partner-status')).toHaveText('Saved')
  await expect.poll(async () => (await liveRow(page)).partner?.scores).toEqual({ perItem: [4, null, 2, null, 1], deepDives: [null, null, null, null] })
  // the toggle hides and shows it
  await page.getByTestId('partner-toggle').click()
  await expect(page.getByTestId('partner-card')).toHaveCount(0)
  await page.getByTestId('partner-toggle').click()
  await expect(page.getByTestId('partner-card')).toBeVisible()
  await expect(page.getByTestId('partner-status')).toHaveText('Saved')
  // no AI anywhere in the panel
  for (const id of ['session-hint', 'session-chat-input', 'ai-loader', 'ai-retry', 'session-ai-error']) await expect(page.getByTestId(id), id).toHaveCount(0)
  check()
})

test('DESIGN-57 an unknown card id shows one sentence inside screen-partner, with no shell and no key shortcuts', async ({ page, context }) => {
  const check = guard(page)
  await begin(page)
  // a hash-only navigation does not re-render the app: a fresh page reads the hash at its first render
  const p = await context.newPage()
  await p.goto('/#/partner/ds-none')
  const screen = p.getByTestId('screen-partner')
  await expect(screen).toBeVisible()
  await expect(screen.getByTestId('partner-missing')).toHaveText('That session was not found.')
  expect((await screen.innerText()).trim()).toBe('That session was not found.')
  await expect(p.getByTestId('partner-card')).toHaveCount(0)
  await expect(p.getByTestId('shell-rail')).toHaveCount(0)
  await expect(p.getByTestId('shell-tabbar')).toHaveCount(0)
  await expect(p.locator('nav')).toHaveCount(0)
  for (const k of ['1', '2', '3', '4']) await p.keyboard.press(k)
  await expect(p).toHaveURL(/#\/partner\/ds-none$/)
  await expect(screen.getByTestId('partner-missing')).toBeVisible()
  await p.close()
  // a session that is not a With someone session has no card either
  await startSession(page, 'Solo')
  const solo = await liveRow(page)
  const q = await context.newPage()
  await page.clock.resume()
  await q.goto(`/#/partner/${solo.id}`)
  await expect(q.getByTestId('screen-partner').getByTestId('partner-missing')).toHaveText('That session was not found.')
  await expect(q.getByTestId('partner-card')).toHaveCount(0)
  check()
})

test('DESIGN-58/63 the card: prompt, opening line, six follow-ups (four dives, two generic), asked boxes, the digest and a sheet of five rows and four dives', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'With someone')
  const sessionId = (await liveRow(page)).id
  const card = await openCardPage(page, sessionId)
  await expect(card.getByTestId('partner-prompt')).toHaveText(RL_TITLE)
  await expect(card.getByTestId('partner-opener')).toContainText(RL_TITLE)
  await expect(card.getByTestId('partner-card').getByText('0 of 6 asked')).toBeVisible()
  for (let n = 1; n <= 6; n++) {
    const q = card.getByTestId(`partner-question-${n}`)
    await expect(q).toBeVisible()
    if (n <= 4) {
      await expect(q).toContainText(RL_DIVES[n - 1])
      await expect(q).not.toHaveAttribute('data-generic', /.*/)
    } else await expect(q).toHaveAttribute('data-generic', 'true')
    await expect(card.getByTestId(`partner-asked-${n}`)).not.toBeChecked()
  }
  await expect(card.getByTestId('partner-question-7')).toHaveCount(0)
  await card.getByTestId('partner-asked-2').check()
  await expect(card.getByTestId('partner-card').getByText('1 of 6 asked')).toBeVisible()
  for (let n = 1; n <= 5; n++) {
    await expect(card.getByTestId(`partner-score-${n}`)).toHaveAttribute('role', 'radiogroup')
    for (let v = 0; v <= 4; v++) await expect(card.getByTestId(`partner-score-${n}-${v}`)).toBeVisible()
    await expect(card.getByTestId(`partner-score-${n}-5`)).toHaveCount(0)
  }
  for (let n = 1; n <= 4; n++) {
    for (let v = 0; v <= 2; v++) await expect(card.getByTestId(`partner-score-dive-${n}-${v}`)).toBeVisible()
    await expect(card.getByTestId(`partner-score-dive-${n}-3`)).toHaveCount(0)
  }
  await expect(card.getByTestId('partner-score-6')).toHaveCount(0)
  await expect(card.getByTestId('partner-total')).toHaveText('0 of 20')
  await card.getByTestId('partner-score-1-4').check()
  await expect(card.getByTestId('partner-total')).toHaveText('4 of 20')
  await card.getByTestId('partner-score-2-1').check()
  await card.getByTestId('partner-score-1-2').check()
  await expect(card.getByTestId('partner-total')).toHaveText('3 of 20')
  // the digest of a new session: every heading, nothing written
  const digest = await card.getByTestId('partner-digest').textContent()
  expect(digest).toBe(HEADINGS.map(h => `${h}\nnot written`).join('\n\n'))
  expect(await card.getByTestId('partner-digest').locator('input, textarea').count()).toBe(0)
  check()
})

test('DESIGN-59 the digest lists every node with its kind, the link, the custom box, the notes, the schema, then frames and canvas notes', async ({ page }) => {
  test.setTimeout(90_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'With someone')
  const sessionId = (await liveRow(page)).id
  // nodes "Client", "API gateway", "Postgres" (kinds browser, gateway, sql), a link, a custom box
  await addKinds(page, ['browser', 'gateway', 'sql'])
  const rename = async (id: string, label: string) => {
    await page.getByTestId(`kit-node-${id}`).click()
    await page.getByTestId('kit-node-label').fill(label)
    await expect(page.getByTestId(`kit-node-${id}`)).toHaveAccessibleName(`${label} · ${id.replace(/-\d+$/, '')}`)
  }
  await rename('browser-1', 'Client')
  await rename('gateway-1', 'API gateway')
  await rename('sql-1', 'Postgres')
  await keyLink(page, 'browser-1', 'gateway-1')
  await page.getByTestId('kit-add-custom').click()
  await page.getByTestId('kit-custom-label').fill('Render engine')
  await page.getByTestId('kit-custom-sub').fill('Composites tiles')
  // notes only in Requirements (functional) and API; one schema table "layers" with one column doc_id uuid FK
  await openNotes(page)
  await page.getByTestId('notes-field-req-fn').fill('upload and view a document')
  await openNotes(page)
  await page.getByTestId('notes-field-api').fill('POST /photos')
  await openNotes(page)
  await page.getByTestId('schema-add-table').click()
  const tid = (await page.locator('[role="group"][data-testid^="schema-table-"]').getAttribute('data-testid'))!.replace('schema-table-', '')
  await openNotes(page)
  await page.getByTestId(`schema-table-name-${tid}`).fill('layers')
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${tid}`).click()
  await openNotes(page)
  await page.getByTestId(`schema-col-name-${tid}-1`).fill('doc_id')
  await openNotes(page)
  await page.getByTestId(`schema-col-type-${tid}-1`).fill('uuid')
  await openNotes(page)
  await page.getByTestId(`schema-col-key-${tid}-1`).selectOption('FK')
  const card = await openCardPage(page, sessionId)
  const digest = card.getByTestId('partner-digest')
  const expected = [
    'DIAGRAM', 'nodes:', '- Client [browser]', '- API gateway [gateway]', '- Postgres [sql]', '- Render engine [custom, drawn as process] - Composites tiles',
    'links:', '- Client -sync-> API gateway', 'frames:', '- none', '',
    'CANVAS NOTES', 'not written', '',
    'REQUIREMENTS - FUNCTIONAL', 'upload and view a document', '',
    'REQUIREMENTS - NON-FUNCTIONAL', 'not written', '',
    'ASSUMPTIONS AND ESTIMATES', 'not written', '',
    'API', 'POST /photos', '',
    'DATA MODEL', 'TABLE layers', '  doc_id uuid FK', '',
    'TRADE-OFFS', 'not written', '',
    'OPEN QUESTIONS', 'not written',
  ].join('\n')
  await expect(digest).toHaveText(expected, { timeout: 5000 })
  // a frame and a canvas note join in, live
  await page.getByTestId('kit-add-note').click()
  await page.getByTestId('kit-note-text-note-1').fill('Edits are small diffs')
  await page.getByTestId('kit-node-browser-1').click()
  await page.keyboard.press('g')
  await page.getByTestId('kit-frame-label-frame-1').fill('Write path')
  await page.getByTestId('kit-frame-kind-frame-1').selectOption('vpc')
  await expect(digest).toContainText('frames:\n- Write path (vpc): Client\n', { timeout: 5000 })
  await expect(digest).toContainText('CANVAS NOTES\n- Edits are small diffs\n')
  for (const h of HEADINGS) expect(await digest.textContent()).toContain(`${h}\n`)
  check()
})

test('DESIGN-60 a full session (S_CAPS) shows a clipped digest of at most 8,000 characters that ends with [clipped] and keeps every heading; its caps hold on the page', async ({ page }) => {
  test.setTimeout(60_000)
  const check = guard(page)
  await begin(page)
  const filler = (n: number) => `${'abcdefghi '.repeat(Math.ceil(n / 10))}`.slice(0, n)
  const tables = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i + 1}`, name: `table_${i + 1}`,
    cols: Array.from({ length: i === 0 ? 16 : 2 }, (_, c) => ({ name: `col_${c + 1}`, type: 'text', ...(c === 0 ? { key: 'PK' } : {}) })),
  }))
  const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `service-${i + 1}`, kind: 'service', label: `Service ${i + 1}`, x: 1 + i * 8, y: 1 }))
  const doc = {
    id: 'ds-caps', designId: RL, at: T0.getTime(), phase: 'drawing', minutes: 0, mode: 'human-partner', view: '2d',
    canvas: {
      layout: 'manual', nodes, links: [], flows: [],
      notes: Array.from({ length: 20 }, (_, i) => ({ id: `note-${i + 1}`, x: 1 + (i % 4) * 8, y: 22 + Math.floor(i / 4) * 3, text: `note ${i + 1}` })),
      zones: Array.from({ length: 8 }, (_, i) => ({ id: `frame-${i + 1}`, label: `Frame ${i + 1}`, kind: 'system', nodes: i === 0 ? ['service-1', 'ghost'] : [`service-${i + 1}`] })),
    },
    notes: { reqFn: filler(2000), reqNfr: filler(2000), assumptions: filler(2000), api: filler(2000), dataModel: filler(2000), tradeoffs: filler(2000), open: filler(2000), schema: tables },
    close: { tradeoff: { chose: '', over: '', because: '' }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: null, readNext: '' },
    deepDives: RL_DIVES.map(q => ({ q, answered: null })), tradeoffs: [], rubric: null, lenses: {},
  }
  await putDesignSession(page, doc)
  await page.goto(`/designs/session/${RL}`)
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  // caps on the page (DESIGN-22, 32, 35)
  await expect(page.getByTestId('schema-count-tables')).toHaveText('12 of 12 tables')
  await expect(page.getByTestId('schema-add-table')).toBeDisabled()
  await expect(page.getByTestId('schema-count-cols-s1')).toHaveText('16 of 16 columns')
  await expect(page.getByTestId('schema-add-col-s1')).toBeDisabled()
  await expect(page.getByTestId('kit-count-notes')).toHaveText('20 of 20 notes')
  await expect(page.getByTestId('kit-add-note')).toBeDisabled()
  await expect(page.getByTestId('kit-count-frames')).toHaveText('8 of 8 frames')
  await expect(page.getByTestId('kit-add-frame')).toBeDisabled()
  await expect(page.getByTestId('kit-add-table')).toBeDisabled()
  const card = await openCardPage(page, 'ds-caps')
  const text = (await card.getByTestId('partner-digest').textContent())!
  expect(text.length).toBeLessThanOrEqual(8000)
  expect(text.endsWith('[clipped]')).toBe(true)
  for (const h of HEADINGS) expect(text, h).toContain(`${h}\n`)
  check()
})

test('DESIGN-60 a small session is not clipped', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'With someone')
  await openNotes(page)
  await page.getByTestId('notes-field-api').fill('GET /x')
  const card = await openCardPage(page, (await liveRow(page)).id)
  await expect(card.getByTestId('partner-digest')).toContainText('GET /x')
  expect(await card.getByTestId('partner-digest').textContent()).not.toContain('[clipped]')
  check()
})

test('DESIGN-54 With someone uses no AI from start to done: aiLog unchanged, no chat, hint, loader, retry or grade control anywhere; the redo keeps the mode and shows the earlier diff', async ({ page }) => {
  test.setTimeout(120_000)
  const check = guard(page)
  await begin(page)
  const logBefore = await idbCount(page, 'aiLog')
  const countLog = () => idbCount(page, 'aiLog')
  const noAi = async () => {
    for (const id of ['session-hint', 'session-chat-input', 'ai-loader', 'ai-retry', 'session-ai-error', 'session-interviewer']) await expect(page.getByTestId(id), id).toHaveCount(0)
    // GLOBAL-10: `session-grade` exists on a finished With someone session (the partner's confirmed score, no AI); DESIGN-54 bars only a control that grades with the AI
    if ((await page.getByTestId('session-summary').count()) === 0) await expect(page.getByTestId('session-grade'), 'session-grade').toHaveCount(0)
    await expect(page.getByRole('button', { name: /grade.*AI|AI.*grade/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /grade.*AI|AI.*grade/i })).toHaveCount(0)
  }
  await startSession(page, 'With someone')
  await noAi()
  await openNotes(page)
  await page.getByTestId('notes-field-api').fill('GET /x')
  await addKind(page, 'gateway')
  await page.getByTestId('session-tab-partner').click()
  await noAi()
  await endDrawing(page)
  await noAi()
  await fillClose(page, RL_DIVES[0])
  await noAi()
  await expect(page.getByTestId('session-score-loading')).toHaveCount(0)
  // scored by the host alone: rubric 12 is under 14, so a redesign comes due
  for (const [i, v] of [1, 1, 2, 0].entries()) await page.getByTestId(`session-dive-score-${i + 1}-${v}`).check()
  const lenses = { Load: 2, Data: 1, Consistency: 1, Failure: 0, Latency: 2, Cost: 1, Evolution: 1 } as const
  for (const [name, v] of Object.entries(lenses)) await pick(page, name, v as 0 | 1 | 2)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
  await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
  await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
  await page.getByTestId('session-rubric').fill('12')
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
  await noAi()
  await expect(page.getByTestId('session-reference-none')).toBeVisible()
  await expect(page.getByTestId('session-reference-loading')).toHaveCount(0)
  await page.clock.runFor(3000) // give a stray AI call every chance to show itself
  await noAi()
  expect(await countLog()).toBe(logBefore)
  const done = await liveRow(page)
  expect(done).toMatchObject({ phase: 'done', mode: 'human-partner', rubric: 12 })
  // DESIGN-73: the redo, in the same mode, names the earlier session, notes empty, its diff beside the work
  await expect(page.getByTestId('session-redesign-due')).toBeVisible()
  await page.clock.resume() // a frozen clock starves a fresh mount (the new session's live queries); see design-helpers
  await page.getByTestId('session-redesign').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await expect(page.getByTestId('session-diff')).toBeVisible() // no reference was drawn: still shown, one sentence, no items
  await expect(page.getByTestId('session-diff-item')).toHaveCount(0)
  await expect(page.getByTestId('session-tab-partner')).toBeVisible()
  const fresh = await liveRow(page)
  expect(fresh).toMatchObject({ phase: 'drawing', mode: 'human-partner', redesignOf: done.id })
  expect(fresh.id).not.toBe(done.id)
  expect((await designRows(page))).toHaveLength(2)
  await expect(page.getByTestId('notes-field-api')).toHaveValue('')
  expect(await countLog()).toBe(logBefore)
  check()
})

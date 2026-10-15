import { expect, test, type Page } from '@playwright/test'
import { addKind, begin, designRows, endDrawing, fillClose, guard, liveRow, openNotes, resumeAndGo, RL_DIVES, startSession } from './design-helpers'

// Design session v2, the notes panel and the schema editor (DESIGN-09 to 22, Review Focus 2 and 5) on the fake provider.
const SECTION_IDS = ['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']
const HEADINGS = ['Requirements', 'Assumptions and estimates', 'API', 'Data model', 'Trade-offs', 'Open questions']
const FIELDS = ['req-fn', 'req-nfr', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']
const STORED_KEY: Record<string, string> = { 'req-fn': 'reqFn', 'req-nfr': 'reqNfr', assumptions: 'assumptions', api: 'api', 'data-model': 'dataModel', tradeoffs: 'tradeoffs', open: 'open' }
const SECTIONS = '[data-testid^="notes-section-"]:not([data-testid$="-title"]):not([data-testid$="-toggle"]):not([data-testid$="-count"])'
/** The schema table groups (role group + testid), not their name / remove controls that share the prefix. */
const TABLES = '[role="group"][data-testid^="schema-table-"]'

const tableIds = (page: Page) => page.locator(TABLES).evaluateAll(els => els.map(e => e.getAttribute('data-testid')!.replace('schema-table-', '')))

test('DESIGN-13 six sections in order, headings exact, boxes as the contract lists them', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  const ids = await page.locator(SECTIONS).evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
  expect(ids).toEqual(SECTION_IDS.map(i => `notes-section-${i}`))
  for (const [i, id] of SECTION_IDS.entries()) {
    const title = page.getByTestId(`notes-section-${id}-title`)
    expect(await title.innerText(), id).toBe(HEADINGS[i])
    expect(await title.textContent(), id).toBe(HEADINGS[i])
  }
  await openNotes(page) // the boxes of a closed section are not visible (DESIGN-86)
  const req = page.getByTestId('notes-section-requirements')
  await expect(req.getByLabel('Functional', { exact: true })).toHaveAttribute('data-testid', 'notes-field-req-fn')
  await expect(req.getByLabel('Non-functional', { exact: true })).toHaveAttribute('data-testid', 'notes-field-req-nfr')
  for (const [section, field] of [['assumptions', 'assumptions'], ['api', 'api'], ['tradeoffs', 'tradeoffs'], ['open', 'open']]) {
    await expect(page.getByTestId(`notes-section-${section}`).locator('textarea')).toHaveCount(1)
    await expect(page.getByTestId(`notes-section-${section}`).getByTestId(`notes-field-${field}`)).toBeVisible()
  }
  // Data model: the schema editor first, then one free-text box
  const dm = page.getByTestId('notes-section-data-model')
  await expect(dm.locator('textarea')).toHaveCount(1)
  await expect(dm.getByTestId('notes-field-data-model')).toBeVisible()
  const order = await dm.evaluate(el => {
    const editor = el.querySelector('[data-testid="schema-editor"]')!
    const box = el.querySelector('[data-testid="notes-field-data-model"]')!
    return editor.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING ? 'editor first' : 'box first'
  })
  expect(order).toBe('editor first')
  // all seven boxes are on the page and empty
  for (const f of FIELDS) await expect(page.getByTestId(`notes-field-${f}`)).toHaveValue('')
  check()
})

test('DESIGN-14 the 2,000-character cap holds in every box, the counter says so, typing more adds nothing', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  const url = page.url()
  await openNotes(page)
  for (const f of FIELDS) {
    const box = page.getByTestId(`notes-field-${f}`)
    await box.fill('x'.repeat(2500))
    await expect(box, f).toHaveValue('x'.repeat(2000))
    await expect(page.getByTestId(`notes-counter-${f}`), f).toHaveText('2000 / 2000')
    await box.press('End')
    await page.keyboard.type('more')
    await expect(box, `${f} stays at the cap`).toHaveValue('x'.repeat(2000))
  }
  expect(page.url()).toBe(url)
  // the cap is what is stored too
  await page.clock.runFor(1000)
  for (const f of FIELDS) {
    await expect.poll(async () => ((await liveRow(page)).notes as unknown as Record<string, string>)[STORED_KEY[f]]?.length, { message: f, timeout: 15_000 }).toBe(2000)
  }
  check()
})

test('DESIGN-15 autosave: the typed text is stored and the status reads Autosaved plus a relative time', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await expect(page.getByTestId('session-autosave')).toHaveText('Autosave on')
  await openNotes(page)
  await page.getByTestId('notes-field-assumptions').fill('RPS 20000')
  await page.clock.runFor(3000) // the tester waits 3 seconds
  await expect.poll(async () => (await liveRow(page)).notes?.assumptions).toBe('RPS 20000')
  await expect(page.getByTestId('session-autosave')).toHaveText(/^Autosaved .+/)
  await expect(page.getByTestId('session-autosave')).toHaveText(/^Autosaved (just now|\d+ seconds? ago|\d+ minutes? ago)$/)
  check()
})

test('DESIGN-16 a reload straight after a fill keeps the text, in the box and in the data', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await openNotes(page)
  await page.getByTestId('notes-field-assumptions').fill('RPS 20000')
  await openNotes(page)
  await page.getByTestId('notes-field-open').fill('what about offline?')
  // no waitFor, no runFor: straight into the reload
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('notes-field-open')).toHaveValue('what about offline?')
  await expect(page.getByTestId('notes-field-assumptions')).toHaveValue('RPS 20000')
  await expect.poll(async () => (await liveRow(page)).notes?.open, { timeout: 2000 }).toBe('what about offline?')
  expect((await liveRow(page)).notes?.assumptions).toBe('RPS 20000')
  check()
})

// Keystrokes injected back to back (pressSequentially with no delay) and an immediate reload: the notes writes are not
// debounced, so the last keystroke must already be on its way to IndexedDB when the page goes (pagehide issues the newest
// snapshot directly; the queue holds at most one running and one pending notes write).
test('DESIGN-16 keystrokes typed back to back (zero delay), then an immediate reload, are all kept in the box and in the data', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  const long = 'what about offline? the quick brown fox jumps.'.padEnd(52, '!')
  expect(long.length).toBeGreaterThanOrEqual(49)
  await openNotes(page)
  await page.getByTestId('notes-field-open').pressSequentially(long, { delay: 0 })
  await openNotes(page)
  await page.getByTestId('schema-add-table').click()
  const [tid] = await tableIds(page)
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${tid}`).click()
  await openNotes(page)
  await page.getByTestId(`schema-col-name-${tid}-1`).fill('')
  await openNotes(page)
  await page.getByTestId(`schema-col-name-${tid}-1`).pressSequentially('user_identifier_column_name', { delay: 0 })
  await openNotes(page)
  await page.getByTestId('notes-field-api').pressSequentially('GET /v1/items?cursor=abc', { delay: 0 })
  // no waitFor, no runFor: straight into the reload
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('notes-field-open')).toHaveValue(long)
  await expect(page.getByTestId('notes-field-api')).toHaveValue('GET /v1/items?cursor=abc')
  await expect(page.getByTestId(`schema-col-name-${tid}-1`)).toHaveValue('user_identifier_column_name')
  await expect.poll(async () => (await liveRow(page)).notes?.open, { timeout: 2000 }).toBe(long)
  expect((await liveRow(page)).notes?.api).toBe('GET /v1/items?cursor=abc')
  check()
})

test('DESIGN-17 ending the drawing locks the notes and the schema editor but keeps them readable beside Close, then Score', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await openNotes(page)
  await page.getByTestId('notes-field-api').fill('GET /x')
  await openNotes(page)
  await page.getByTestId('schema-add-table').click()
  const [tid] = await tableIds(page)
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${tid}`).click()
  await endDrawing(page)
  await expect(page.getByTestId('session-phase')).not.toHaveText('Drawing')
  await expect(page.getByTestId('session-tabs')).toHaveCount(0)
  await expect(page.getByTestId('session-close')).toBeVisible()
  const lockedPanel = async () => {
    await expect(page.getByTestId('notes-panel')).toBeVisible()
    for (const f of FIELDS) await expect(page.getByTestId(`notes-field-${f}`), f).toHaveAttribute('readonly', '')
    await expect(page.getByTestId('notes-field-api')).toHaveValue('GET /x')
    await expect(page.getByTestId('schema-add-table')).toBeDisabled()
    await expect(page.getByTestId(`schema-add-col-${tid}`)).toBeDisabled()
    await expect(page.getByTestId(`schema-table-name-${tid}`)).toHaveAttribute('readonly', '')
    await expect(page.getByTestId(`schema-col-name-${tid}-1`)).toHaveAttribute('readonly', '')
    await expect(page.getByTestId(`schema-col-key-${tid}-1`)).toBeDisabled()
    await expect(page.getByTestId(`schema-table-remove-${tid}`)).toBeDisabled()
    await expect(page.getByTestId('kit-canvas')).toHaveAttribute('data-locked', 'true')
    await expect(page.getByTestId('kit-add-note')).toBeDisabled()
    // text stays selectable (not a disabled control): typing changes nothing
    await openNotes(page)
    await page.getByTestId('notes-field-api').click()
    await page.keyboard.type('zzz')
    await expect(page.getByTestId('notes-field-api')).toHaveValue('GET /x')
  }
  await lockedPanel()
  await fillClose(page, RL_DIVES[0])
  await expect(page.getByTestId('session-score')).toBeVisible()
  await expect(page.getByTestId('session-tabs')).toHaveCount(0)
  await lockedPanel()
  check()
})

test('DESIGN-17 / Review Focus 5 the 45:00 lock does not lose the last keystrokes of the notes or the canvas', async ({ page }) => {
  test.setTimeout(90_000)
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await addKind(page, 'gateway')
  await openNotes(page)
  await page.getByTestId('notes-field-tradeoffs').fill('earlier text')
  await openNotes(page)
  await page.getByTestId('notes-field-open').pressSequentially('typed right before the lock')
  await addKind(page, 'cache') // the very last edit is a canvas one
  await page.clock.runFor(45 * 60_000)
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
  await expect(page.getByTestId('notes-field-open')).toHaveValue('typed right before the lock')
  await expect(page.getByTestId('notes-field-open')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('kit-count')).toHaveText('2 nodes · 0 links')
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-phase')).toHaveText('Close')
  await expect(page.getByTestId('notes-field-open')).toHaveValue('typed right before the lock')
  await expect(page.getByTestId('notes-field-tradeoffs')).toHaveValue('earlier text')
  await expect(page.getByTestId('kit-count')).toHaveText('2 nodes · 0 links')
  const row = await liveRow(page)
  expect(row.notes?.open).toBe('typed right before the lock')
  expect(row.canvas.nodes.map(n => n.kind)).toEqual(['gateway', 'cache'])
  check()
})

test('DESIGN-18 / Review Focus 2 shortcut letters just type: notes, a schema cell, a sticky, the chat and the frame label', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Interviewer')
  const keys = 'n c t g l ? 1 2 3 4'
  const url = page.url()
  // set up one of each target (a sticky, a frame, a schema table), then count what exists
  await page.getByTestId('kit-add-note').click()
  await page.getByTestId('kit-add-frame').click()
  await openNotes(page)
  await page.getByTestId('schema-add-table').click()
  const [tid] = await tableIds(page)
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${tid}`).click()
  const frameId = (await page.locator('[data-testid^="kit-frame-label-"]').first().getAttribute('data-testid'))!.replace('kit-frame-label-', '')
  const stickyId = (await page.locator('[data-testid^="kit-note-text-"]').first().getAttribute('data-testid'))!.replace('kit-note-text-', '')
  const snapshot = async () => ({
    count: await page.getByTestId('kit-count').innerText(),
    notes: await page.getByTestId('kit-count-notes').innerText(),
    frames: await page.getByTestId('kit-count-frames').innerText(),
    tables: await page.getByTestId('schema-count-tables').innerText(),
    tabs: await page.locator('[data-testid^="kit-node-"][data-node-id]').count(),
    stickies: await page.locator('[data-testid^="kit-note-text-"]').count(),
  })
  const before = await snapshot()
  expect(before).toMatchObject({ count: '0 nodes · 0 links', notes: '1 of 20 notes', frames: '1 of 8 frames', tables: '1 of 12 tables' })
  const targets: [string, import('@playwright/test').Locator][] = [
    ['notes box', page.getByTestId('notes-field-open')],
    ['second notes box', page.getByTestId('notes-field-req-fn')],
    ['schema cell', page.getByTestId(`schema-col-note-${tid}-1`)],
    ['schema type cell', page.getByTestId(`schema-col-type-${tid}-1`)],
    ['sticky', page.getByTestId(`kit-note-text-${stickyId}`)],
    ['frame label', page.getByTestId(`kit-frame-label-${frameId}`)],
  ]
  for (const [name, box] of targets) {
    await box.click()
    if (name === 'schema type cell') await box.fill('')
    else await box.press('End')
    const had = await box.inputValue()
    await page.keyboard.type(keys)
    expect(await box.inputValue(), name).toBe(name === 'schema type cell' ? keys : had + keys)
    expect(await snapshot(), `${name}: nothing was added`).toEqual(before)
    await expect(page.getByTestId('session-keys'), name).toHaveCount(0)
    await expect(page.getByTestId('shell-shortcuts'), name).toHaveCount(0)
    await expect(page.getByRole('dialog'), name).toHaveCount(0)
    expect(page.url(), name).toBe(url)
  }
  // the chat box of the AI partner: in view with the Notes tab selected, no tab to open
  const chat = page.getByTestId('session-chat-input')
  await chat.click()
  await page.keyboard.type(keys)
  await expect(chat).toHaveValue(keys)
  expect(await snapshot(), 'chat: nothing was added').toEqual(before)
  await expect(page.getByTestId('session-keys')).toHaveCount(0)
  await expect(page.getByTestId('shell-shortcuts')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(page.url()).toBe(url)
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  check()
})

test('DESIGN-19/20/21 schema editor: add a table, add and fill a column, remove a column, then the table', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await openNotes(page)
  await page.getByTestId('schema-add-table').click()
  await openNotes(page)
  await page.getByTestId('schema-add-table').click()
  const ids = await tableIds(page)
  expect(ids).toHaveLength(2)
  expect(new Set(ids).size).toBe(2)
  const [id, other] = ids
  await page.clock.runFor(500)
  const stored = (await liveRow(page)).notes!.schema
  expect(stored.map(t => t.id)).toEqual(ids) // the hook carries the stored id verbatim
  await openNotes(page)
  await page.getByTestId(`schema-table-name-${id}`).fill('layers')
  await expect(page.getByTestId(`schema-count-cols-${id}`)).toHaveText('0 of 16 columns') // a new table has no columns
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${id}`).click()
  await expect(page.getByTestId(`schema-count-cols-${id}`)).toHaveText('1 of 16 columns')
  await openNotes(page)
  await page.getByTestId(`schema-col-name-${id}-1`).fill('doc_id')
  await openNotes(page)
  await page.getByTestId(`schema-col-type-${id}-1`).fill('uuid')
  await openNotes(page)
  await page.getByTestId(`schema-col-note-${id}-1`).fill('owner document')
  const key = page.getByTestId(`schema-col-key-${id}-1`)
  expect(await key.locator('option').allTextContents()).toEqual(['none', 'PK', 'FK', 'unique', 'index'])
  await key.selectOption('FK')
  await page.clock.runFor(500)
  let table = (await liveRow(page)).notes!.schema.find(t => t.id === id)!
  expect(table.name).toBe('layers')
  expect(table.cols[0]).toEqual({ name: 'doc_id', type: 'uuid', key: 'FK', note: 'owner document' })
  // "none" stores no key at all
  await key.selectOption('none')
  await page.clock.runFor(500)
  table = (await liveRow(page)).notes!.schema.find(t => t.id === id)!
  expect(table.cols[0]).not.toHaveProperty('key')
  await key.selectOption('FK')
  // remove: a second column, then the table
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${id}`).click()
  await expect(page.getByTestId(`schema-count-cols-${id}`)).toHaveText('2 of 16 columns')
  await openNotes(page)
  await page.getByTestId(`schema-col-remove-${id}-2`).click()
  await expect(page.getByTestId(`schema-count-cols-${id}`)).toHaveText('1 of 16 columns')
  await expect(page.getByTestId(`schema-col-name-${id}-1`)).toHaveValue('doc_id')
  await expect(page.getByTestId(`schema-col-name-${id}-2`)).toHaveCount(0)
  await page.clock.runFor(500)
  expect((await liveRow(page)).notes!.schema.find(t => t.id === id)!.cols.map(c => c.name)).toEqual(['doc_id'])
  await openNotes(page)
  await page.getByTestId(`schema-table-remove-${id}`).click()
  await expect(page.getByTestId(`schema-table-${id}`)).toHaveCount(0)
  await expect(page.getByTestId(`schema-table-${other}`)).toHaveCount(1)
  await page.clock.runFor(500)
  expect((await liveRow(page)).notes!.schema.map(t => t.id)).toEqual([other])
  check()
})

test('DESIGN-22 the caps: 12 tables and 16 columns disable their add controls, and every count reads "n of 12" / "n of 16"', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await openNotes(page)
  const add = page.getByTestId('schema-add-table')
  for (let n = 1; n <= 12; n++) {
    await add.click()
    await expect(page.getByTestId('schema-count-tables')).toHaveText(`${n} of 12 tables`)
  }
  await expect(add).toBeDisabled()
  const ids = await tableIds(page)
  expect(ids).toHaveLength(12)
  const [id] = ids
  for (let n = 1; n <= 16; n++) {
    await openNotes(page)
    await page.getByTestId(`schema-add-col-${id}`).click()
    await expect(page.getByTestId(`schema-count-cols-${id}`)).toHaveText(`${n} of 16 columns`)
  }
  await expect(page.getByTestId(`schema-add-col-${id}`)).toBeDisabled()
  await expect(page.getByTestId(`schema-count-cols-${ids[1]}`)).toHaveText('0 of 16 columns')
  await expect(page.getByTestId(`schema-add-col-${ids[1]}`)).toBeEnabled()
  // a table block is a table too: the cap disables it
  await expect(page.getByTestId('kit-add-table')).toBeDisabled()
  await page.clock.runFor(500)
  const row = await liveRow(page)
  expect(row.notes!.schema).toHaveLength(12)
  expect(row.notes!.schema[0].cols).toHaveLength(16)
  await openNotes(page)
  await page.getByTestId(`schema-table-remove-${ids[11]}`).click()
  await expect(add).toBeEnabled()
  check()
})

test('DESIGN-09/10 the notes sit beside the canvas from 1100 px and below it under 1100', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await page.setViewportSize({ width: 1100, height: 800 })
  await startSession(page, 'Solo')
  let c = (await page.getByTestId('kit-canvas').boundingBox())!
  let n = (await page.getByTestId('notes-panel').boundingBox())!
  expect(n.x).toBeGreaterThanOrEqual(c.x + c.width - 1)
  const overlap = Math.min(c.y + c.height, n.y + n.height) - Math.max(c.y, n.y)
  expect(overlap).toBeGreaterThan(c.height / 2)
  await page.setViewportSize({ width: 1099, height: 800 })
  c = (await page.getByTestId('kit-canvas').boundingBox())!
  n = (await page.getByTestId('notes-panel').boundingBox())!
  expect(n.y).toBeGreaterThanOrEqual(c.y + c.height - 1)
  const tabs = (await page.getByTestId('session-tabs').boundingBox())!
  expect(tabs.y).toBeGreaterThanOrEqual(c.y + c.height - 1)
  check()
})

test('DESIGN-12 Close and Score replace the tabs; the notes stay, every field read-only; the rows keep the text', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await openNotes(page)
  await page.getByTestId('notes-field-req-fn').fill('upload and view a document')
  await endDrawing(page)
  await expect(page.getByTestId('session-close')).toBeVisible()
  await expect(page.getByTestId('session-tabs')).toHaveCount(0)
  await expect(page.getByTestId('notes-field-req-fn')).toHaveValue('upload and view a document')
  await fillClose(page, RL_DIVES[2])
  await expect(page.getByTestId('session-score')).toBeVisible()
  await expect(page.getByTestId('session-close')).toHaveCount(0)
  await expect(page.getByTestId('notes-field-req-fn')).toHaveValue('upload and view a document')
  await expect(page.getByTestId('notes-field-req-fn')).toHaveAttribute('readonly', '')
  expect((await designRows(page))[0].phase).toBe('score')
  check()
})

import { expect, test, type Page } from '@playwright/test'
import { KIT_FAMILIES, KIT_KINDS } from '../../src/content/diagramKit'
import { addKind, addKinds, begin, endDrawing, guard, liveRow, putDesignSession, RL, startSession, T0, openNotes } from './design-helpers'

// Design session v2, the four canvas items, frames and the canvas-focus keys (DESIGN-23 to 44) on the fake provider.
const canvas = async (page: Page) => (await liveRow(page)).canvas
const storedNotes = async (page: Page) => (await liveRow(page)).notes!
const NODES = '[data-testid^="kit-node-"][data-node-id]'
const nodeIds = (page: Page) => page.locator(NODES).evaluateAll(els => els.map(e => e.getAttribute('data-node-id')!))
const focusCanvas = (page: Page) => page.getByTestId('kit-canvas').focus()
/** A click on a part of the canvas that holds nothing (right of the blocks, scrolled into view first). */
const clickEmpty = async (page: Page) => {
  const box = (await page.getByTestId('kit-canvas').boundingBox())!
  await page.getByTestId('kit-canvas').click({ position: { x: Math.round(box.width * 0.75), y: 200 } })
}

test('DESIGN-23 the palette is one row of family buttons and the four tools; no tile shows while every family is closed', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  const palette = page.getByTestId('kit-palette')
  for (const [id, label] of [['kit-add-custom', 'Box'], ['kit-add-note', 'Note'], ['kit-add-table', 'Table'], ['kit-add-frame', 'Frame']]) {
    await expect(palette.getByTestId(id)).toBeVisible()
    await expect(palette.getByTestId(id)).toHaveText(label)
    await expect(palette.getByTestId(id)).toBeEnabled()
  }
  expect(KIT_KINDS).toHaveLength(38)
  for (const { family } of KIT_FAMILIES) {
    const f = palette.getByTestId(`kit-family-${family}`)
    await expect(f).toBeVisible()
    await expect(f).toHaveAccessibleName(family)
    await expect(f).toHaveAttribute('title', family)
    await expect(f).toHaveAttribute('aria-expanded', 'false')
  }
  await expect(palette.locator('[data-testid^="kit-tile-"]:visible')).toHaveCount(0)
  // one row: every family button and tool sits on the same line
  const tops = await Promise.all([...KIT_FAMILIES.map(f => `kit-family-${f.family}`), 'kit-add-custom', 'kit-add-frame'].map(async id => Math.round((await palette.getByTestId(id).boundingBox())!.y / 20)))
  expect(new Set(tops).size, 'one row').toBe(1)
  check()
})

test('DESIGN-23a a family flyout: one open at a time, a tile adds a node and closes it; same family, Escape and a press outside close it', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  const palette = page.getByTestId('kit-palette')
  const visibleTiles = () => palette.locator('[data-testid^="kit-tile-"]:visible')
  const canvasBefore = (await page.getByTestId('kit-canvas').boundingBox())!
  await palette.getByTestId('kit-family-data').click()
  await expect(palette.getByTestId('kit-family-data')).toHaveAttribute('aria-expanded', 'true')
  const data = KIT_FAMILIES.find(f => f.family === 'data')!.kinds
  await expect(visibleTiles()).toHaveCount(data.length)
  for (const k of data) await expect(palette.getByTestId(`kit-tile-${k}`)).toBeVisible()
  // the flyout is over the canvas, not pushing it down
  const fly = (await page.getByTestId('kit-flyout').boundingBox())!
  const canvasOpen = (await page.getByTestId('kit-canvas').boundingBox())!
  expect(canvasOpen.y).toBe(canvasBefore.y)
  expect(fly.y).toBeLessThan(canvasOpen.y + 60)
  // another family replaces it
  await palette.getByTestId('kit-family-messaging').click()
  await expect(palette.getByTestId('kit-family-data')).toHaveAttribute('aria-expanded', 'false')
  await expect(visibleTiles()).toHaveCount(2)
  // the same family again closes it
  await palette.getByTestId('kit-family-messaging').click()
  await expect(visibleTiles()).toHaveCount(0)
  // Escape closes it and focus returns to the family button
  await palette.getByTestId('kit-family-cache').click()
  await expect(visibleTiles()).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(visibleTiles()).toHaveCount(0)
  await expect(palette.getByTestId('kit-family-cache')).toBeFocused()
  // a press outside the palette closes it
  await palette.getByTestId('kit-family-edge').click()
  await expect(visibleTiles()).toHaveCount(5)
  await page.getByTestId('notes-panel').click({ position: { x: 20, y: 10 } })
  await expect(visibleTiles()).toHaveCount(0)
  // a tile adds a node of its kind and closes the flyout
  await palette.getByTestId('kit-family-messaging').click()
  await palette.getByTestId('kit-tile-queue').click()
  await expect(page.getByTestId('kit-node-queue-1')).toHaveAttribute('data-kind', 'queue')
  await expect(visibleTiles()).toHaveCount(0)
  await expect(palette.getByTestId('kit-family-messaging')).toHaveAttribute('aria-expanded', 'false')
  check()
})

test('DESIGN-24/25 a custom box: name, an 80-character description, a glyph, all stored', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-custom').click()
  const node = page.getByTestId('kit-node-custom-1')
  await expect(node).toHaveAttribute('data-kind', 'custom')
  await expect(node).toHaveAttribute('aria-pressed', 'true') // the new box is selected
  await page.getByTestId('kit-custom-label').fill('Render engine')
  await page.getByTestId('kit-custom-sub').fill('s'.repeat(90))
  await expect(page.getByTestId('kit-custom-sub')).toHaveValue('s'.repeat(80))
  await expect(page.getByTestId('kit-custom-sub-count')).toHaveText('80 / 80')
  await expect(node).toHaveAttribute('data-kind', 'custom')
  await expect.poll(async () => (await canvas(page)).nodes.find(n => n.kind === 'custom')?.sub?.length).toBe(80)
  let stored = (await canvas(page)).nodes.find(n => n.kind === 'custom')!
  expect(stored).toMatchObject({ kind: 'custom', label: 'Render engine' })
  expect(['process', undefined]).toContain(stored.glyph) // no choice yet: it behaves as process
  // the glyph select: every kit kind except custom and table, process by default
  const glyph = page.getByTestId('kit-custom-glyph')
  await expect(glyph).toHaveValue('process')
  const options = await glyph.locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
  expect(options).toEqual(KIT_KINDS.filter(k => k !== 'table'))
  expect(options).not.toContain('custom')
  await glyph.selectOption('sql')
  await expect.poll(async () => (await canvas(page)).nodes.find(n => n.kind === 'custom')?.glyph).toBe('sql')
  stored = (await canvas(page)).nodes.find(n => n.kind === 'custom')!
  expect(stored.kind).toBe('custom')
  await expect(node).toHaveAttribute('data-kind', 'custom')
  // a description cleared stores none
  await page.getByTestId('kit-custom-sub').fill('')
  await expect.poll(async () => (await canvas(page)).nodes.find(n => n.kind === 'custom')?.sub).toBeUndefined()
  check()
})

test('DESIGN-26 a custom box links like any node: by port drag, and by L and a click; the link kind changes', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-custom').click()
  await addKinds(page, ['gateway', 'service'])
  await expect(page.getByTestId('kit-count')).toHaveText('3 nodes · 0 links')
  // 1. press on the source's port, release over the target
  await page.getByTestId('kit-port-custom-1').dragTo(page.getByTestId('kit-node-gateway-1'))
  const link = page.getByTestId('kit-link-custom-1-gateway-1')
  await expect(link).toHaveAttribute('data-kind', 'sync')
  await expect(page.getByTestId('kit-count')).toHaveText('3 nodes · 1 links')
  // 2. select the source, press L, click the target
  await page.getByTestId('kit-node-gateway-1').click()
  await expect(page.getByTestId('kit-canvas')).toBeFocused()
  await page.keyboard.press('l')
  await expect(page.getByTestId('kit-status')).toHaveText('Link from Gateway 1: pick a target')
  await page.getByTestId('kit-node-service-1').click()
  await expect(page.getByTestId('kit-link-gateway-1-service-1')).toHaveAttribute('data-kind', 'sync')
  await expect(page.getByTestId('kit-status')).toHaveText('')
  // the link kind: select it, the select shows sync, change it, the stored kind changes
  await link.click()
  await expect(page.getByTestId('kit-link-kind')).toHaveValue('sync')
  await page.getByTestId('kit-link-kind').selectOption('stream')
  await expect(link).toHaveAttribute('data-kind', 'stream')
  await expect.poll(async () => (await canvas(page)).links.find(l => l.from === 'custom-1')?.kind).toBe('stream')
  expect((await canvas(page)).links).toHaveLength(2)
  check()
})

test('DESIGN-27/28 a schema table block and its schema table stay in step: names both ways, the columns as lines', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-table').click()
  const block = page.getByTestId('kit-node-table-1')
  await expect(block).toHaveAttribute('data-kind', 'table')
  await expect(page.locator('[role="group"][data-testid^="schema-table-"]')).toHaveCount(1)
  const tid = (await page.locator('[role="group"][data-testid^="schema-table-"]').getAttribute('data-testid'))!.replace('schema-table-', '')
  await expect.poll(async () => (await canvas(page)).nodes.find(n => n.kind === 'table')?.schemaId).toBe(tid)
  const table = (await storedNotes(page)).schema[0]
  expect((await canvas(page)).nodes.find(n => n.kind === 'table')!.label).toBe(table.name)
  await expect(page.getByTestId(`schema-table-name-${tid}`)).toHaveValue(table.name)
  // a column "user_id uuid FK" added in the editor
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${tid}`).click()
  await openNotes(page)
  await page.getByTestId(`schema-col-name-${tid}-1`).fill('user_id')
  await openNotes(page)
  await page.getByTestId(`schema-col-type-${tid}-1`).fill('uuid')
  await openNotes(page)
  await page.getByTestId(`schema-col-key-${tid}-1`).selectOption('FK')
  const fields = page.getByTestId('kit-node-fields-table-1')
  await expect(fields.locator('li')).toHaveText(['user_id uuid FK'])
  expect(await fields.evaluate(el => el.tagName)).toBe('UL')
  expect(await fields.evaluate(el => el.closest('[data-testid="kit-node-table-1"]') !== null)).toBe(true)
  // rename in the editor: the block follows within a second
  await openNotes(page)
  await page.getByTestId(`schema-table-name-${tid}`).fill('accounts')
  await expect(block).toHaveAccessibleName('accounts · table', { timeout: 1000 })
  await expect(block).toContainText(/accounts/i, { timeout: 1000 })
  // then rename on the canvas: the editor follows within a second
  await block.click()
  await page.getByTestId('kit-node-label').fill('accounts_v2')
  await expect(page.getByTestId(`schema-table-name-${tid}`)).toHaveValue('accounts_v2', { timeout: 1000 })
  await expect(block).toHaveAccessibleName('accounts_v2 · table', { timeout: 1000 })
  await expect.poll(async () => (await storedNotes(page)).schema[0].name).toBe('accounts_v2')
  check()
})

test('DESIGN-29 deleting the schema table keeps the block as a plain table node', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-table').click()
  const tid = (await page.locator('[role="group"][data-testid^="schema-table-"]').getAttribute('data-testid'))!.replace('schema-table-', '')
  await openNotes(page)
  await page.getByTestId(`schema-table-name-${tid}`).fill('orders')
  await openNotes(page)
  await page.getByTestId(`schema-add-col-${tid}`).click()
  await openNotes(page)
  await page.getByTestId(`schema-col-name-${tid}-1`).fill('id')
  await expect(page.getByTestId('kit-node-fields-table-1')).toBeVisible()
  await openNotes(page)
  await page.getByTestId(`schema-table-remove-${tid}`).click()
  await expect(page.locator('[role="group"][data-testid^="schema-table-"]')).toHaveCount(0)
  const block = page.getByTestId('kit-node-table-1')
  await expect(block).toHaveAccessibleName('orders · table')
  await expect(block).toHaveAttribute('data-kind', 'table')
  await expect(page.getByTestId('kit-node-fields-table-1')).toHaveCount(0)
  await expect.poll(async () => (await canvas(page)).nodes.find(n => n.kind === 'table')).toMatchObject({ kind: 'table', label: 'orders' })
  const stored = (await canvas(page)).nodes.find(n => n.kind === 'table')!
  expect(stored).not.toHaveProperty('schemaId')
  expect((await storedNotes(page)).schema).toEqual([])
  check()
})

test('DESIGN-30 deleting the block keeps the schema table in the editor and in the notes', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-table').click()
  const tid = (await page.locator('[role="group"][data-testid^="schema-table-"]').getAttribute('data-testid'))!.replace('schema-table-', '')
  await openNotes(page)
  await page.getByTestId(`schema-table-name-${tid}`).fill('orders')
  await page.getByTestId('kit-node-table-1').click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('kit-node-table-1')).toHaveCount(0)
  await expect(page.getByTestId('kit-count')).toHaveText('0 nodes · 0 links')
  await expect(page.getByTestId(`schema-table-${tid}`)).toBeVisible()
  await expect(page.getByTestId(`schema-table-name-${tid}`)).toHaveValue('orders')
  await expect.poll(async () => (await storedNotes(page)).schema.map(t => t.name)).toEqual(['orders'])
  check()
})

test('DESIGN-31 a text note is an HTML sticky over the canvas, positioned absolutely, with its own textarea; stored as {id, x, y, text}', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-note').click()
  const sticky = page.getByTestId('kit-note-note-1')
  await expect(sticky).toBeVisible()
  await expect(page.getByTestId('kit-note-text-note-1')).toBeFocused()
  await page.getByTestId('kit-note-text-note-1').fill('Edits are small diffs')
  const facts = await sticky.evaluate(el => ({ svg: el instanceof SVGElement, position: getComputedStyle(el).position, tag: el.tagName, over: !!el.closest('[data-testid="kit-canvas"]') }))
  expect(facts).toEqual({ svg: false, position: 'absolute', tag: 'DIV', over: true })
  expect(await page.getByTestId('kit-note-text-note-1').evaluate(el => el.tagName)).toBe('TEXTAREA')
  await expect.poll(async () => (await canvas(page)).notes?.[0]?.text).toBe('Edits are small diffs')
  const stored = (await canvas(page)).notes![0]
  expect(Object.keys(stored).sort()).toEqual(['id', 'text', 'x', 'y'])
  expect(stored).toMatchObject({ id: 'note-1', text: 'Edits are small diffs' })
  check()
})

test('DESIGN-32 a sticky holds 280 characters, drags 100 px from its top strip (about 4 cells), then moves one cell per arrow, never below 0', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-note').click()
  const sticky = page.getByTestId('kit-note-note-1')
  const text = page.getByTestId('kit-note-text-note-1')
  await text.fill('y'.repeat(400))
  await expect(text).toHaveValue('y'.repeat(280))
  await expect.poll(async () => (await canvas(page)).notes?.[0]?.text.length).toBe(280)
  const x0 = Number(await sticky.getAttribute('data-x'))
  const box = (await sticky.boundingBox())!
  // press on the sticky itself, inside the 8 px strip along its top edge (not on the textarea), drag 100 px right
  await page.mouse.move(box.x + box.width / 2, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + 4, { steps: 6 })
  await page.mouse.up()
  const x1 = Number(await sticky.getAttribute('data-x'))
  expect(x1 - x0).toBeGreaterThanOrEqual(3)
  expect(x1 - x0).toBeLessThanOrEqual(5)
  expect(Number(await sticky.getAttribute('data-y'))).toBe(Number((await canvas(page)).notes![0].y))
  // afterwards the sticky itself has focus, not its textarea
  await expect(sticky).toBeFocused()
  await expect.poll(async () => (await canvas(page)).notes![0].x).toBe(x1)
  // one cell per press: right first (so that the ten presses left do not meet the floor), then ten left
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
  await expect(sticky).toHaveAttribute('data-x', String(x1 + 12))
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft')
  await expect(sticky).toHaveAttribute('data-x', String(x1 + 2))
  expect(await page.getByTestId('kit-note-text-note-1').inputValue()).toBe('y'.repeat(280)) // the text was never typed into
  for (let i = 0; i < x1 + 6; i++) await page.keyboard.press('ArrowLeft')
  await expect(sticky).toHaveAttribute('data-x', '0')
  await expect.poll(async () => (await canvas(page)).notes![0].x).toBe(0)
  // a press in the textarea places the caret and does not drag
  const tb = (await text.boundingBox())!
  await page.mouse.move(tb.x + 20, tb.y + 10)
  await page.mouse.down()
  await page.mouse.move(tb.x + 120, tb.y + 10, { steps: 4 })
  await page.mouse.up()
  await expect(sticky).toHaveAttribute('data-x', '0')
  check()
})

test('DESIGN-32 twenty notes is the cap: the counter reads "20 of 20 notes" and Note is disabled', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await expect(page.getByTestId('kit-count-notes')).toHaveText('0 of 20 notes')
  for (let n = 1; n <= 20; n++) {
    await page.getByTestId('kit-add-note').click()
    await expect(page.getByTestId('kit-count-notes')).toHaveText(`${n} of 20 notes`)
  }
  await expect(page.getByTestId('kit-add-note')).toBeDisabled()
  await focusCanvas(page)
  await page.keyboard.press('n')
  await expect(page.getByTestId('kit-count-notes')).toHaveText('20 of 20 notes')
  await expect.poll(async () => (await canvas(page)).notes).toHaveLength(20)
  check()
})

test('DESIGN-33 the iso view draws no stickies; a list holds one line per note and the count', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await page.getByTestId('kit-add-note').click()
  await page.getByTestId('kit-note-text-note-1').fill('one')
  await page.getByTestId('kit-add-note').click()
  await page.getByTestId('kit-note-text-note-2').fill('two')
  await page.getByTestId('kit-view-iso').click()
  await expect(page.locator('[data-testid^="kit-note-note-"]')).toHaveCount(0)
  await expect(page.getByTestId('kit-notes-list').locator('li')).toHaveText(['one', 'two'])
  await expect(page.getByTestId('kit-notes-list')).toContainText('2 notes')
  await expect(page.getByTestId('kit-count-notes')).toHaveText('2 of 20 notes')
  await page.getByTestId('kit-view-2d').click()
  await expect(page.getByTestId('kit-note-note-1')).toBeVisible()
  await expect(page.getByTestId('kit-notes-list')).toHaveCount(0)
  check()
})

test('DESIGN-34/35 a frame: default label and kind, the seven kinds, renamed and stored; eight is the cap', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await addKinds(page, ['gateway', 'service'])
  await clickEmpty(page)
  await page.getByTestId('kit-add-frame').click()
  await expect(page.getByTestId('kit-frames')).toBeVisible()
  const row = page.getByTestId('kit-frame-frame-1')
  await expect(row).toBeVisible()
  await expect(page.getByTestId('kit-frame-label-frame-1')).toHaveValue('Frame 1')
  await expect(page.getByTestId('kit-frame-kind-frame-1')).toHaveValue('system')
  await expect(page.getByTestId('kit-node-label')).toBeDisabled() // a new frame is not a selection
  await expect.poll(async () => (await canvas(page)).zones).toEqual([{ id: 'frame-1', label: 'Frame 1', kind: 'system', nodes: [] }])
  const kinds = await page.getByTestId('kit-frame-kind-frame-1').locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
  expect(kinds).toEqual(['system', 'region', 'az', 'vpc', 'trust', 'tenant', 'team'])
  await page.getByTestId('kit-frame-label-frame-1').fill('Write path')
  await page.getByTestId('kit-frame-kind-frame-1').selectOption('vpc')
  await expect.poll(async () => (await canvas(page)).zones).toEqual([{ id: 'frame-1', label: 'Write path', kind: 'vpc', nodes: [] }])
  for (let n = 2; n <= 8; n++) {
    await page.getByTestId('kit-add-frame').click()
    await expect(page.getByTestId('kit-count-frames')).toHaveText(`${n} of 8 frames`)
  }
  await expect(page.getByTestId('kit-add-frame')).toBeDisabled()
  await focusCanvas(page)
  await page.keyboard.press('g')
  await expect(page.getByTestId('kit-count-frames')).toHaveText('8 of 8 frames')
  check()
})

test('DESIGN-36/37 frame membership: one frame at a time, None removes; deleting a member and then the frame', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await addKinds(page, ['gateway', 'service'])
  await page.getByTestId('kit-add-frame').click()
  await page.getByTestId('kit-frame-label-frame-1').fill('Edge')
  await page.getByTestId('kit-add-frame').click()
  await page.getByTestId('kit-frame-label-frame-2').fill('Core')
  await page.getByTestId('kit-node-gateway-1').click()
  const select = page.getByTestId('kit-frame-select')
  expect(await select.locator('option').allTextContents()).toEqual(['None', 'Edge', 'Core'])
  const zones = async () => Object.fromEntries((await canvas(page)).zones!.map(z => [z.id, z.nodes]))
  await select.selectOption({ label: 'Edge' })
  await expect.poll(zones).toEqual({ 'frame-1': ['gateway-1'], 'frame-2': [] })
  await select.selectOption({ label: 'Core' }) // moved, not copied
  await expect.poll(zones).toEqual({ 'frame-1': [], 'frame-2': ['gateway-1'] })
  await select.selectOption({ label: 'None' })
  await expect.poll(zones).toEqual({ 'frame-1': [], 'frame-2': [] })
  // both blocks in Edge, then Delete on one of them
  await select.selectOption({ label: 'Edge' })
  await page.getByTestId('kit-node-service-1').click()
  await page.getByTestId('kit-frame-select').selectOption({ label: 'Edge' })
  await expect.poll(zones).toEqual({ 'frame-1': ['gateway-1', 'service-1'], 'frame-2': [] })
  await page.getByTestId('kit-node-gateway-1').click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('kit-node-gateway-1')).toHaveCount(0)
  await expect.poll(zones).toEqual({ 'frame-1': ['service-1'], 'frame-2': [] })
  await page.getByTestId('kit-frame-remove-frame-1').click()
  await expect(page.getByTestId('kit-frame-frame-1')).toHaveCount(0)
  await expect(page.getByTestId('kit-node-service-1')).toBeVisible()
  await expect.poll(zones).toEqual({ 'frame-2': [] })
  await expect(page.getByTestId('kit-count')).toHaveText('1 nodes · 0 links')
  check()
})

test('DESIGN-38 a frame that lists a node that does not exist: opening writes nothing, the first canvas edit drops it, no error', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  const at = T0.getTime()
  const base = {
    id: 'ds-ghost', designId: RL, at, phase: 'drawing', minutes: 0, mode: 'human-partner', view: '2d',
    canvas: {
      layout: 'manual', nodes: [{ id: 'gateway-1', kind: 'gateway', label: 'Gateway 1', x: 2, y: 2 }], links: [], flows: [], notes: [],
      zones: [{ id: 'frame-1', label: 'Edge', kind: 'system', nodes: ['gateway-1', 'ghost'] }],
    },
    notes: { reqFn: '', reqNfr: '', assumptions: '', api: '', dataModel: '', tradeoffs: '', open: '', schema: [] },
    close: { tradeoff: { chose: '', over: '', because: '' }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: null, readNext: '' },
    deepDives: [], tradeoffs: [], rubric: null, lenses: {},
  }
  await putDesignSession(page, base)
  await page.goto(`/designs/session/${RL}`)
  await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
  await expect(page.getByTestId('kit-frame-frame-1')).toBeVisible()
  await page.waitForTimeout(1500)
  expect((await canvas(page)).zones![0].nodes).toEqual(['gateway-1', 'ghost']) // opening wrote nothing
  await addKind(page, 'service')
  await expect.poll(async () => (await canvas(page)).zones![0].nodes).toEqual(['gateway-1'])
  await expect(page.getByTestId('kit-count')).toHaveText('2 nodes · 0 links')
  check()
})

test('DESIGN-39 N, C and T with canvas focus add a note, a custom box and a table block, each named by typing at once', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await focusCanvas(page)
  await page.keyboard.press('n')
  await expect(page.getByTestId('kit-note-note-1')).toBeVisible()
  await expect(page.getByTestId('kit-note-text-note-1')).toBeFocused()
  await focusCanvas(page)
  await page.keyboard.press('c')
  await expect(page.getByTestId('kit-node-custom-1')).toBeVisible()
  await expect(page.getByTestId('kit-node-custom-1')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('kit-node-label')).toBeFocused()
  await page.getByTestId('kit-node-label').fill('Cart')
  await expect(page.getByTestId('kit-node-custom-1')).toHaveAccessibleName('Cart · custom')
  await focusCanvas(page)
  await page.keyboard.press('t')
  await expect(page.getByTestId('kit-node-table-1')).toHaveAttribute('data-kind', 'table')
  await expect(page.locator('[role="group"][data-testid^="schema-table-"]')).toHaveCount(1)
  await expect(page.getByTestId('kit-node-label')).toBeFocused()
  await expect(page.getByTestId('kit-node-label')).toHaveValue(/.+/)
  expect(await nodeIds(page)).toEqual(['custom-1', 'table-1'])
  check()
})

test('DESIGN-40 G puts the selected block in a new frame (focus on its name), Shift+G deletes the frame and keeps the blocks, G with nothing selected does nothing', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await addKinds(page, ['gateway', 'service'])
  // nothing selected: a click on empty canvas clears the selection, then G does nothing
  await clickEmpty(page)
  await expect(page.getByTestId('kit-node-gateway-1')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('kit-node-service-1')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('kit-canvas')).toBeFocused()
  await page.keyboard.press('g')
  await expect(page.getByTestId('kit-count-frames')).toHaveText('0 of 8 frames')
  await page.keyboard.press('Shift+G')
  await expect(page.getByTestId('kit-count-frames')).toHaveText('0 of 8 frames')
  // one node selected: G
  await page.getByTestId('kit-node-gateway-1').click()
  await expect(page.getByTestId('kit-canvas')).toBeFocused()
  await page.keyboard.press('g')
  await expect(page.getByTestId('kit-count-frames')).toHaveText('1 of 8 frames')
  await expect(page.getByTestId('kit-frame-frame-1')).toBeVisible()
  await expect(page.getByTestId('kit-frame-label-frame-1')).toBeFocused()
  await expect.poll(async () => (await canvas(page)).zones).toMatchObject([{ id: 'frame-1', nodes: ['gateway-1'] }])
  // Shift+G removes that frame; both blocks stay
  await focusCanvas(page)
  await page.keyboard.press('Shift+G')
  await expect(page.getByTestId('kit-count-frames')).toHaveText('0 of 8 frames')
  await expect(page.getByTestId('kit-frames')).toHaveCount(0)
  await expect(page.getByTestId('kit-count')).toHaveText('2 nodes · 0 links')
  await expect.poll(async () => (await canvas(page)).zones).toEqual([])
  check()
})

test('DESIGN-41 with canvas focus a click selects, then an arrow moves one cell, L links, Esc leaves link mode, Delete deletes; a click on empty canvas deselects', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await addKinds(page, ['gateway', 'service'])
  const gw = page.getByTestId('kit-node-gateway-1')
  await gw.click()
  await expect(page.getByTestId('kit-canvas')).toBeFocused() // the click put focus on the canvas
  await expect(gw).toHaveAttribute('aria-pressed', 'true')
  const [x0, y0] = [Number(await gw.getAttribute('data-x')), Number(await gw.getAttribute('data-y'))]
  await page.keyboard.press('ArrowRight')
  await expect(gw).toHaveAttribute('data-x', String(x0 + 1))
  await page.keyboard.press('ArrowDown')
  await expect(gw).toHaveAttribute('data-y', String(y0 + 1))
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  await expect(gw).toHaveAttribute('data-x', String(x0))
  await expect(gw).toHaveAttribute('data-y', String(y0))
  await page.keyboard.press('l')
  await expect(page.getByTestId('kit-status')).toHaveText('Link from Gateway 1: pick a target')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('kit-status')).toHaveText('')
  await page.keyboard.press('L')
  await expect(page.getByTestId('kit-status')).toHaveText('Link from Gateway 1: pick a target')
  await page.getByTestId('kit-node-service-1').click()
  await expect(page.getByTestId('kit-link-gateway-1-service-1')).toHaveAttribute('data-kind', 'sync')
  // deselect by clicking empty canvas: arrows and Delete now do nothing
  await clickEmpty(page)
  await expect(gw).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('kit-count')).toHaveText('2 nodes · 1 links')
  await expect(gw).toHaveAttribute('data-x', String(x0))
  // select again and Delete: the node and its link go
  await gw.click()
  await page.keyboard.press('Delete')
  await expect(gw).toHaveCount(0)
  await expect(page.getByTestId('kit-count')).toHaveText('1 nodes · 0 links')
  check()
})

test('DESIGN-42 Ctrl+. moves focus to the first notes box and back; Esc in a notes box returns to the canvas', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await focusCanvas(page)
  await page.keyboard.press('Control+.')
  await expect(page.getByTestId('notes-field-req-fn')).toBeFocused()
  await page.keyboard.press('Control+.')
  await expect(page.getByTestId('kit-canvas')).toBeFocused()
  await page.keyboard.press('Control+.')
  await expect(page.getByTestId('notes-field-req-fn')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('kit-canvas')).toBeFocused()
  // Esc from a box further down the panel does the same
  await openNotes(page)
  await page.getByTestId('notes-field-open').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('kit-canvas')).toBeFocused()
  // from another tab the swap brings the Notes tab up first
  await page.getByTestId('session-tab-dives').click()
  await focusCanvas(page)
  await page.keyboard.press('Control+.')
  await expect(page.getByTestId('notes-field-req-fn')).toBeFocused()
  check()
})

test('DESIGN-44 ? opens the session keys overlay (never the shell shortcuts), lists the keys, Esc closes it; 1 to 4 do nothing', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  const url = page.url()
  await focusCanvas(page)
  for (const k of ['1', '2', '3', '4']) await page.keyboard.press(k)
  expect(page.url()).toBe(url)
  await expect(page.getByTestId('kit-count')).toHaveText('0 nodes · 0 links')
  await page.keyboard.press('?')
  const keys = page.getByTestId('session-keys')
  await expect(keys).toBeVisible()
  await expect(page.getByTestId('shell-shortcuts')).toHaveCount(0)
  const text = await keys.innerText()
  for (const k of ['N', 'C', 'T', 'G', 'Shift+G', 'Arrows', 'Delete', 'L', 'Ctrl/Cmd+.', 'Esc', 'Ctrl/Cmd+Enter']) {
    expect(await keys.locator('kbd').filter({ hasText: new RegExp(`^${k.replace(/[.+/]/g, '\\$&')}$`) }).count(), `${k} in the overlay`).toBeGreaterThan(0)
  }
  expect(text).not.toMatch(/interview/i)
  await page.keyboard.press('Escape')
  await expect(keys).toHaveCount(0)
  await expect(page.getByTestId('shell-shortcuts')).toHaveCount(0)
  expect(page.url()).toBe(url)
  check()
})

test('DESIGN-17 a locked canvas ignores N, C, T and G, the arrows, Delete and L, and the palette tools', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await startSession(page, 'Solo')
  await addKinds(page, ['gateway', 'service'])
  await page.getByTestId('kit-add-note').click()
  await page.getByTestId('kit-node-gateway-1').click()
  await endDrawing(page)
  const canvasEl = page.getByTestId('kit-canvas')
  await expect(canvasEl).toHaveAttribute('data-locked', 'true')
  const snapshot = async () => ({
    count: await page.getByTestId('kit-count').innerText(),
    notes: await page.getByTestId('kit-count-notes').innerText(),
    frames: await page.getByTestId('kit-count-frames').innerText(),
    tables: await page.getByTestId('schema-count-tables').innerText(),
    x: await page.getByTestId('kit-node-gateway-1').getAttribute('data-x'),
    stored: JSON.stringify(await canvas(page)) + JSON.stringify(await storedNotes(page)),
  })
  const before = await snapshot()
  await focusCanvas(page)
  for (const k of ['n', 'c', 't', 'g', 'Shift+G', 'ArrowRight', 'Delete', 'l']) await page.keyboard.press(k)
  await page.getByTestId('kit-node-gateway-1').focus()
  for (const k of ['n', 'c', 't', 'g', 'ArrowRight', 'Delete', 'l']) await page.keyboard.press(k)
  await expect(page.getByTestId('kit-status')).toHaveText('')
  for (const t of ['kit-add-custom', 'kit-add-note', 'kit-add-table', 'kit-add-frame']) await expect(page.getByTestId(t)).toBeDisabled()
  expect(await snapshot()).toEqual(before)
  // help still opens (it edits nothing)
  await focusCanvas(page)
  await page.keyboard.press('?')
  await expect(page.getByTestId('session-keys')).toBeVisible()
  await page.keyboard.press('Escape')
  check()
})

import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { addKind, begin, designRows, endDrawing, fillClose, RL, RL_DIVES, startSession, openNotes } from './design-helpers'

// Task 29: real-browser screens for mockup section 7 (7a setup, 7b live, 7c partner card, 7d grade), plus the
// computed-style / DOM audit at every phase and the keyboard walk. Not part of the normal run:
//   DESIGN_SHOTS=1 DOJO_PORT=88xx npx playwright test tests/e2e/design-v2-shots.spec.ts --project=chromium --workers=1
// PNGs and the per-check JSON land in test-results/design-v2 (Playwright empties test-results at the start of every
// run, so copy them out before running anything else).
test.skip(!process.env.DESIGN_SHOTS, 'run with DESIGN_SHOTS=1 to write the section 7 screenshots')
const OUT = process.env.DESIGN_SHOTS_DIR ?? 'test-results/design-v2'
mkdirSync(OUT, { recursive: true })

const ARCANE = 'rgb(163, 145, 251)'
const HEADINGS = ['Requirements', 'Assumptions and estimates', 'API', 'Data model', 'Trade-offs', 'Open questions']
const WIDTHS = [['desktop', 1280, 800], ['phone', 390, 844]] as const

interface Rec { id: string; ok: boolean; detail: string }
/** Collects every check (pass or fail, with its evidence) so one failure does not hide the rest; the test fails at the end. */
function recorder(file: string) {
  const rows: Rec[] = []
  const rec = (id: string, ok: boolean, detail = '') => { rows.push({ id, ok, detail }) }
  const step = async (id: string, fn: () => Promise<unknown>) => {
    try { await fn(); rows.push({ id, ok: true, detail: '' }) } catch (e) { rows.push({ id, ok: false, detail: String(e instanceof Error ? e.message : e).split('\n').slice(0, 4).join(' | ') }) }
  }
  const done = () => {
    writeFileSync(`${OUT}/${file}.json`, JSON.stringify(rows, null, 1))
    const bad = rows.filter(r => !r.ok)
    expect(bad, `failed checks:\n${bad.map(b => `${b.id}: ${b.detail}`).join('\n')}`).toEqual([])
  }
  return { rows, rec, step, done }
}

/** The DOM / computed-style checks of Task 29 step 4, run in the page. */
async function audit(page: Page, scope: string, r: ReturnType<typeof recorder>, opts: { accent?: number | null; silk?: boolean } = {}) {
  const a = await page.evaluate(() => {
    const visible = (e: Element) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && (b.width > 0 || b.height > 0) }
    const label = (e: Element) => `${e.tagName.toLowerCase()}${e.getAttribute('data-testid') ? `[${e.getAttribute('data-testid')}]` : ''}.${String((e.getAttribute('class') ?? '')).split(' ')[0]}`
    const all = [...document.querySelectorAll('body *')]
    const withText = all.filter(e => [...e.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim()))
    const small = withText.filter(e => visible(e) && parseFloat(getComputedStyle(e).fontSize) < 14).map(e => `${label(e)} ${getComputedStyle(e).fontSize} "${(e.textContent ?? '').trim().slice(0, 24)}"`)
    const radius = all.filter(e => {
      if (e instanceof SVGElement || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName)) return false
      const s = getComputedStyle(e)
      return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius].some(v => parseFloat(v) > 0)
    }).map(e => `${label(e)} ${getComputedStyle(e).borderTopLeftRadius}`)
    const silk = withText.filter(e => visible(e) && /silkscreen/i.test(getComputedStyle(e).fontFamily) && ![16, 24, 32, 48].includes(parseFloat(getComputedStyle(e).fontSize)))
      .map(e => `${label(e)} ${getComputedStyle(e).fontSize} "${(e.textContent ?? '').trim().slice(0, 24)}"`)
    const accents = [...document.querySelectorAll<HTMLElement>('[data-accent="primary"]')]
    const lastInGroup = accents.map(el => {
      const row = el.parentElement!
      const f = [...row.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(e => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled)
      return f[f.length - 1] === el || (el as HTMLButtonElement).disabled
    })
    // visible text without the plan's own wording ([data-content])
    const hide = document.createElement('style'); hide.textContent = '[data-content]{display:none !important}'; document.head.appendChild(hide)
    const text = document.body.innerText
    hide.remove()
    const banned = [...text.matchAll(/\binterview\w*|\b(Spar|Retreat|Dig in|Load check|Slid in|Shift plan)\b|overdue|missed a day|streak lost|days since/gi)].map(m => m[0])
    const kbd = [...document.querySelectorAll('kbd')].filter(visible).map(k => parseFloat(getComputedStyle(k).fontSize))
    const de = document.documentElement
    return {
      small, radius, silk, banned, kbd,
      accents: accents.map(e => ({ id: e.getAttribute('data-testid'), text: (e.textContent ?? '').trim(), disabled: (e as HTMLButtonElement).disabled, bg: getComputedStyle(e).backgroundColor })),
      lastInGroup, hscroll: de.scrollWidth > de.clientWidth + 1, scrollW: de.scrollWidth, clientW: de.clientWidth,
    }
  })
  r.rec(`${scope}: no text under 14px`, a.small.length === 0, a.small.slice(0, 6).join('; '))
  r.rec(`${scope}: radius 0 (besides inputs, selects, textareas, SVG)`, a.radius.length === 0, a.radius.slice(0, 6).join('; '))
  if (opts.silk !== false) r.rec(`${scope}: Silkscreen only at 16/24/32/48`, a.silk.length === 0, a.silk.slice(0, 6).join('; '))
  if (opts.accent !== null) {
    const want = opts.accent ?? 1
    r.rec(`${scope}: exactly ${want} data-accent="primary"`, a.accents.length === want, JSON.stringify(a.accents))
  }
  r.rec(`${scope}: every accent button last in its group`, a.lastInGroup.every(Boolean), JSON.stringify(a.accents.map((x, i) => `${x.text}:${a.lastInGroup[i]}`)))
  r.rec(`${scope}: no banned word outside [data-content]`, a.banned.length === 0, a.banned.join(', '))
  r.rec(`${scope}: no horizontal scroll`, !a.hscroll, `scrollWidth ${a.scrollW} vs clientWidth ${a.clientW}`)
  return a
}

/** A full-page shot from the top (the rail is sticky, so a scrolled page would draw it mid-page) and a viewport shot of the same screen. */
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  await page.screenshot({ path: `${OUT}/${name}-vp.png` })
}
const msgs = (page: Page) => page.getByTestId('session-msg')

/**
 * Tab order of the accent button: nothing focusable follows it within its action group (the contract's rule, DESIGN-79 / GLOBAL-03),
 * checked in the document and by pressing Tab from it. `globalLast` records what is last on the whole screen, for information.
 */
async function tabEnd(page: Page) {
  const info = await page.evaluate(() => {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]'
    const vis = (e: HTMLElement) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return e.tabIndex >= 0 && s.visibility !== 'hidden' && s.display !== 'none' && (b.width > 0 || b.height > 0) && !e.closest('[hidden], [inert]') }
    const name = (e: HTMLElement | undefined) => (e ? `${e.getAttribute('data-testid') ?? e.tagName} "${(e.textContent ?? '').trim().slice(0, 24)}"` : null)
    const list = [...document.querySelectorAll<HTMLElement>(sel)].filter(vis)
    const accent = document.querySelector<HTMLElement>('[data-accent="primary"]')
    // a disabled accent button (an unfinished form) still counts at its place in the order, as it will be focusable once the form is ready
    const group = accent ? [...accent.parentElement!.querySelectorAll<HTMLElement>(`${sel}, [data-accent="primary"]`)].filter(e => e === accent || vis(e)) : []
    accent?.focus()
    return { n: list.length, globalLast: name(list[list.length - 1]), accent: name(accent ?? undefined), groupLast: !!accent && group[group.length - 1] === accent, groupSize: group.length, accentDisabled: (accent as HTMLButtonElement | null)?.disabled ?? null }
  })
  await page.keyboard.press('Tab')
  const after = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a === document.body || !a ? 'body' : (a.getAttribute('data-testid') ?? a.tagName) })
  return { ...info, afterTab: after }
}

for (const [name, width, height] of WIDTHS) {
  test(`section 7 screens, audits and tab ends at ${name}`, async ({ page }) => {
    test.setTimeout(240_000)
    const r = recorder(`checks-${name}`)
    await page.addInitScript(() => { localStorage.setItem('dojo:fake-ai-grade', 'findings') })
    await page.setViewportSize({ width, height })
    await begin(page)

    // 7a setup
    await page.goto(`/designs/session/${RL}`)
    await page.getByTestId('session-start').waitFor()
    await page.clock.resume()
    await shot(page, `7a-setup-${name}`)
    await audit(page, `${name} setup`, r)
    await r.step(`${name} setup: tab order: nothing follows START · DESIGN`, async () => { const t = await tabEnd(page); expect(t.groupLast, JSON.stringify(t)).toBe(true) })
    await page.keyboard.press('Escape')

    // 7b live: the AI partner, a chat, the notes, all four new canvas items
    await startSession(page, 'Interviewer')
    await r.step(`${name} drawing: session-phase innerText is "Drawing"`, async () => { expect(await page.getByTestId('session-phase').innerText()).toBe('Drawing') })
    await page.clock.resume()
    await page.getByTestId('session-tab-partner').click()
    await expect(msgs(page)).toHaveCount(1)
    await page.getByTestId('session-chat-input').fill('Photographers, about 5M a day')
    await page.getByTestId('session-send').click()
    await expect(msgs(page)).toHaveCount(3)
    await page.getByTestId('session-chat-input').fill('Edits are small diffs, a few per second per photo')
    await page.getByTestId('session-send').click()
    await expect(msgs(page)).toHaveCount(5)
    await page.getByTestId('session-tab-notes').click()
    await openNotes(page)
    await page.getByTestId('notes-field-req-fn').fill('Several people edit one photo at once\nSee each other\'s changes within a second')
    await openNotes(page)
    await page.getByTestId('notes-field-assumptions').fill('Daily users 5M\nEdits per active doc, peak 2 per s\nDiff 30 KB -> ingest ~6 MB/s')
    await openNotes(page)
    await page.getByTestId('notes-field-api').fill('POST /docs/{id}/diffs\nGET /docs/{id}/tiles/{z}/{x}/{y}')
    await openNotes(page)
    await page.getByTestId('notes-field-tradeoffs').fill('Last writer wins per layer; offline edits are lost')
    await openNotes(page)
    await page.getByTestId('notes-field-open').fill('Does undo survive a closed tab?')
    await addKind(page, 'browser')
    await addKind(page, 'gateway')
    await addKind(page, 'service')
    await addKind(page, 'sql')
    await page.getByTestId('kit-add-custom').click()
    await page.getByTestId('kit-custom-label').fill('Render engine')
    await page.getByTestId('kit-custom-sub').fill('Composites layers into tiles')
    await page.getByTestId('kit-add-table').click()
    const tid = (await page.locator('[role="group"][data-testid^="schema-table-"]').first().getAttribute('data-testid'))!.replace('schema-table-', '')
    await openNotes(page)
    await page.getByTestId(`schema-table-name-${tid}`).fill('layers')
    await page.getByTestId('kit-add-note').click()
    await page.getByTestId('kit-note-text-note-1').fill('Edits are small diffs, not full images')
    await page.getByTestId('kit-add-frame').click()
    await page.getByTestId('kit-frame-label-frame-1').fill('Write path')
    await page.getByTestId('kit-node-gateway-1').click()
    await page.getByTestId('kit-frame-select').selectOption({ label: 'Write path' })
    await page.getByTestId('kit-node-service-1').click()
    await page.getByTestId('kit-frame-select').selectOption({ label: 'Write path' })
    await page.getByTestId('kit-canvas').click({ position: { x: 20, y: 10 } })
    await page.clock.runFor(13 * 60_000) // the timer reads about 32:00
    await shot(page, `7b-live-${name}`)
    await audit(page, `${name} drawing (notes tab)`, r)
    await r.step(`${name} drawing: custom box description is stored (it is drawn by the engine, see the shot)`, async () => {
      const row = (await designRows(page)).find(x => x.phase !== 'done')!
      expect(row.canvas.nodes.find(n => n.kind === 'custom')?.sub).toBe('Composites layers into tiles')
    })
    await r.step(`${name} drawing: no two blocks overlap`, async () => {
      const boxes = await page.locator('[data-node-id]').evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return { id: e.getAttribute('data-node-id')!, l: b.left, r: b.right, t: b.top, b: b.bottom } }))
      const hits: string[] = []
      for (const [i, a] of boxes.entries()) for (const c of boxes.slice(i + 1)) if (a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1) hits.push(`${a.id} x ${c.id}`)
      expect(hits, JSON.stringify(boxes)).toEqual([])
    })
    await r.step(`${name} drawing: table block lists its columns (li under kit-node-fields)`, async () => {
      const lis = await page.getByTestId('kit-node-fields-table-1').locator('li').allTextContents()
      expect(lis.length, JSON.stringify(lis)).toBeGreaterThan(0)
      expect(lis.join(' ')).toMatch(/\bid\b.*\buuid\b.*PK/)
    })
    await r.step(`${name} drawing: sticky is an HTML element, position absolute`, async () => {
      const f = await page.getByTestId('kit-note-note-1').evaluate(el => ({ svg: el instanceof SVGElement, pos: getComputedStyle(el).position }))
      expect(f).toEqual({ svg: false, pos: 'absolute' })
    })
    await r.step(`${name} drawing: frame labelled "Write path" (list row and drawn label)`, async () => {
      await expect(page.getByTestId('kit-frame-label-frame-1')).toHaveValue('Write path')
      await expect(page.getByTestId('kit-canvas').getByText('Write path').first()).toBeVisible()
    })
    await r.step(`${name} drawing: notes section titles equal the contract headings`, async () => {
      const titles: string[] = []
      for (const id of ['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open']) titles.push(await page.getByTestId(`notes-section-${id}-title`).innerText())
      expect(titles).toEqual(HEADINGS)
    })
    await r.step(`${name} drawing: drag from the 8px strip moves the sticky`, async () => {
      const sticky = page.getByTestId('kit-note-note-1')
      const x0 = Number(await sticky.getAttribute('data-x'))
      await sticky.evaluate(el => el.scrollIntoView({ block: 'center' }))
      const box = (await sticky.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + 4)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 96, box.y + 4, { steps: 6 })
      await page.mouse.up()
      const dx = Number(await sticky.getAttribute('data-x')) - x0
      expect(dx, `moved ${dx} cells`).toBeGreaterThanOrEqual(3)
      expect(dx).toBeLessThanOrEqual(5)
    })
    await r.step(`${name} drawing: tab order: nothing follows CLOSE · DESIGN in its group`, async () => { const t = await tabEnd(page); expect(t.groupLast, JSON.stringify(t)).toBe(true) })

    // partner tab: the chat
    await page.getByTestId('session-tab-partner').click()
    await page.getByTestId('session-chat-input').scrollIntoViewIfNeeded()
    await shot(page, `7b-partner-tab-${name}`)
    await audit(page, `${name} drawing (partner tab)`, r)
    await r.step(`${name} partner tab: AI label "AI partner" in arcane ${ARCANE}`, async () => {
      const ai = msgs(page).first().getByTestId('session-msg-label')
      await expect(ai).toHaveText('AI partner')
      await expect(ai).toHaveCSS('color', ARCANE)
    })
    await r.step(`${name} partner tab: "You" label differs from the arcane colour`, async () => {
      const you = msgs(page).nth(1).getByTestId('session-msg-label')
      await expect(you).toHaveText('You')
      const c = await you.evaluate(el => getComputedStyle(el).color)
      expect(c, c).not.toBe(ARCANE)
    })
    await r.step(`${name} partner tab: every AI label is arcane`, async () => {
      const cols = await page.locator('[data-from="ai"] [data-testid="session-msg-label"]').evaluateAll(els => els.map(e => getComputedStyle(e).color))
      expect(cols.length).toBeGreaterThan(1)
      expect(new Set(cols)).toEqual(new Set([ARCANE]))
    })
    await r.step(`${name} partner tab: AI label text is not upper-cased by CSS`, async () => {
      expect(await page.locator('[data-from="ai"] [data-testid="session-msg-label"]').first().evaluate(el => getComputedStyle(el).textTransform)).toBe('none')
    })

    // keys overlay
    await page.getByTestId('kit-canvas').focus()
    await page.keyboard.press('?')
    await expect(page.getByTestId('session-keys')).toBeVisible()
    await shot(page, `keys-overlay-${name}`)
    await audit(page, `${name} keys overlay`, r, { accent: null })
    await r.step(`${name} keys overlay: kbd font-size >= 14px`, async () => {
      const sizes = await page.getByTestId('session-keys').locator('kbd').evaluateAll(els => els.map(e => parseFloat(getComputedStyle(e).fontSize)))
      expect(sizes.length).toBeGreaterThan(8)
      expect(Math.min(...sizes), JSON.stringify(sizes)).toBeGreaterThanOrEqual(14)
    })
    await r.step(`${name} keys overlay: shell-shortcuts not open`, async () => { await expect(page.getByTestId('shell-shortcuts')).toHaveCount(0) })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('session-keys')).toHaveCount(0)

    // discard dialog
    await page.getByTestId('session-discard').click()
    await expect(page.getByTestId('session-discard-confirm')).toBeVisible()
    await shot(page, `discard-dialog-${name}`)
    await audit(page, `${name} discard dialog`, r, { accent: null })
    await page.getByTestId('session-discard-cancel').click()
    await expect(page.getByTestId('session-discard-confirm')).toHaveCount(0)

    // close
    await endDrawing(page)
    await page.clock.resume()
    await shot(page, `close-${name}`)
    await audit(page, `${name} close`, r)
    await r.step(`${name} close: session-phase innerText "Close"`, async () => { expect(await page.getByTestId('session-phase').innerText()).toBe('Close') })
    await r.step(`${name} close: tab order: nothing follows NEXT · SCORE`, async () => { const t = await tabEnd(page); expect(t.groupLast, JSON.stringify(t)).toBe(true) })
    await fillClose(page, RL_DIVES[0])

    // score + 7d grade
    await expect(page.getByTestId('session-grade')).toBeVisible()
    await page.getByTestId('session-grade').scrollIntoViewIfNeeded()
    await shot(page, `score-${name}`)
    await page.getByTestId('session-grade').screenshot({ path: `${OUT}/7d-grade-${name}.png` })
    await audit(page, `${name} score`, r)
    await r.step(`${name} score: grade shows five items out of 20, checks list, stronger version`, async () => {
      await expect(page.locator('[data-testid^="session-grade-item-"]')).toHaveCount(5)
      await expect(page.getByTestId('session-grade-total')).toContainText('of 20')
      await expect(page.getByTestId('session-grade-inconsistencies')).toBeVisible()
      await expect(page.getByTestId('session-grade-stronger')).toBeVisible()
    })
    // Informational (mockup 7d only, not a contract clause): does the grade view carry an arcane "AI partner" attribution?
    const gradeLabels = await page.getByTestId('session-grade').locator('*').evaluateAll(els => els.filter(e => e.children.length === 0 && /AI partner/i.test(e.textContent ?? '')).map(e => getComputedStyle(e).color))
    r.rec(`${name} score: info, AI attribution label in the grade view (mockup 7d "AI partner - feedback")`, true, gradeLabels.length ? `found, colours ${[...new Set(gradeLabels)].join(', ')}` : 'NONE FOUND (deviation from mockup 7d, not a contract clause)')
    await r.step(`${name} score: tab order: nothing follows COMPLETE · SESSION`, async () => { const t = await tabEnd(page); expect(t.groupLast, JSON.stringify(t)).toBe(true) })
    // AI partner: the grade has scored the deep dives (their radios are disabled); the learner adds a trade-off and may change the rubric
    const row2 = page.getByTestId('session-tradeoff-row-2')
    await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
    await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
    await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
    await page.getByTestId('session-rubric').fill('12') // under 14: a redesign is due
    await page.getByTestId('session-complete').click()
    await expect(page.getByTestId('session-phase')).toHaveText('Done')
    await expect(page.getByTestId('session-reference-loading')).toHaveCount(0, { timeout: 20_000 })

    // done, with a redesign due
    await shot(page, `done-${name}`)
    await audit(page, `${name} done (redesign due)`, r)
    await r.step(`${name} done: the one accent is REDO · DESIGN`, async () => {
      const b = page.getByTestId('session-redesign')
      await expect(b).toHaveText('REDO · DESIGN')
      await expect(b).toHaveAttribute('data-accent', 'primary')
    })
    await r.step(`${name} done: tab order: nothing follows REDO · DESIGN`, async () => { const t = await tabEnd(page); expect(t.groupLast, JSON.stringify(t)).toBe(true) })
    await page.getByTestId('session-redesign').click()
    await expect(page.getByTestId('session-phase')).toHaveText('Drawing')
    await expect(page.getByTestId('session-diff')).toBeVisible()
    await shot(page, `redo-drawing-${name}`)
    await audit(page, `${name} redo drawing (diff beside the work)`, r)
    r.done()
  })
}

test('7c partner card in a second window (560 x 800), with the host screen audited around it', async ({ page, context }) => {
  test.setTimeout(120_000)
  const r = recorder('checks-card-window')
  await page.setViewportSize({ width: 1280, height: 800 })
  await begin(page)
  await startSession(page, 'With someone')
  await page.clock.resume()
  await openNotes(page)
  await page.getByTestId('notes-field-api').fill('POST /photos')
  await page.getByTestId('session-tab-partner').click()
  await audit(page, 'human-partner drawing (partner tab, card in its own window)', r)
  const [card] = await Promise.all([context.waitForEvent('page'), page.getByTestId('partner-open-window').click()])
  await card.setViewportSize({ width: 560, height: 800 })
  await card.getByTestId('partner-card').waitFor()
  await card.getByTestId('partner-name').fill('Sam')
  for (const [n, v] of [[1, 3], [2, 2], [3, 3], [4, 0], [5, 2]]) await card.getByTestId(`partner-score-${n}-${v}`).check()
  await card.getByTestId('partner-score-dive-1-2').check()
  await card.getByTestId('partner-question-1').scrollIntoViewIfNeeded().catch(() => undefined)
  await shot(card, '7c-partner-card')
  await audit(card, 'partner card window 560', r)
  await r.step('partner card window: partner-save is SAVE · SCORES, the accent', async () => {
    await expect(card.getByTestId('partner-save')).toHaveText('SAVE · SCORES')
    await expect(card.getByTestId('partner-save')).toHaveAttribute('data-accent', 'primary')
  })
  await r.step('partner card window: no shell', async () => { await expect(card.getByTestId('shell-rail')).toHaveCount(0); await expect(card.getByTestId('screen-partner')).toBeVisible() })
  await r.step('partner card window: tab order: nothing follows SAVE · SCORES', async () => { const t = await tabEnd(card); expect(t.groupLast, JSON.stringify(t)).toBe(true) })
  await r.step('partner card window: digest shows notes', async () => { await expect(card.getByTestId('partner-digest')).toContainText('API') })
  await card.setViewportSize({ width: 390, height: 844 })
  await shot(card, '7c-partner-card-390')
  await audit(card, 'partner card window 390', r)
  await card.setViewportSize({ width: 560, height: 800 })
  // a missing session
  await card.goto('/#/partner/does-not-exist')
  await card.reload()
  await card.getByTestId('partner-missing').waitFor()
  await shot(card, '7c-partner-missing')
  await audit(card, 'partner card missing', r, { accent: 0 })
  r.done()
})

for (const [name, width, height] of WIDTHS) {
  test(`7c inline fallback card (window.open blocked) at ${name}`, async ({ page }) => {
    test.setTimeout(120_000)
    const r = recorder(`checks-card-inline-${name}`)
    await page.context().addInitScript(() => { window.open = () => null })
    await page.setViewportSize({ width, height })
    await begin(page)
    await startSession(page, 'With someone')
    await page.clock.resume()
    await page.getByTestId('session-tab-partner').click()
    await page.getByTestId('partner-open-window').click()
    await expect(page.getByTestId('partner-tab').getByTestId('partner-card')).toBeVisible()
    await page.getByTestId('partner-card').scrollIntoViewIfNeeded()
    await shot(page, `7c-partner-card-inline-${name}`)
    await audit(page, `${name} drawing, inline card open`, r)
    await r.step(`${name} inline card: partner-save carries no accent (only CLOSE · DESIGN does)`, async () => {
      await expect(page.getByTestId('partner-save')).not.toHaveAttribute('data-accent', 'primary')
      await expect(page.locator('[data-accent="primary"]')).toHaveText('CLOSE · DESIGN')
    })
    await r.step(`${name} inline card: partner-toggle hides and shows the card`, async () => {
      await page.getByTestId('partner-toggle').click()
      await expect(page.getByTestId('partner-card')).toHaveCount(0)
      await page.getByTestId('partner-toggle').click()
      await expect(page.getByTestId('partner-card')).toBeVisible()
    })
    await r.step(`${name} inline card: tab order: nothing follows CLOSE · DESIGN`, async () => { const t = await tabEnd(page); expect(t.groupLast, JSON.stringify(t)).toBe(true) })
    r.done()
  })
}

test('keyboard walk (desktop): canvas keys, focus swaps, typed letters in text fields, send keys, tab ends', async ({ page }) => {
  test.setTimeout(180_000)
  const r = recorder('checks-keyboard')
  await page.setViewportSize({ width: 1280, height: 800 })
  await begin(page)
  await startSession(page, 'Interviewer')
  await page.clock.resume()
  const canvas = page.getByTestId('kit-canvas')
  const focusCanvas = () => canvas.focus()
  const count = () => page.getByTestId('kit-count').innerText()
  const fcount = () => page.getByTestId('kit-count-frames').innerText()
  const ncount = () => page.getByTestId('kit-count-notes').innerText()
  const url0 = page.url()

  await r.step('N with canvas focus adds a note and focuses its text', async () => {
    await focusCanvas(); await page.keyboard.press('n')
    await expect(page.getByTestId('kit-note-text-note-1')).toBeFocused()
  })
  await r.step('C adds a custom box, selected, name field focused', async () => {
    await focusCanvas(); await page.keyboard.press('c')
    await expect(page.getByTestId('kit-node-custom-1')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('kit-node-label')).toBeFocused()
    await page.getByTestId('kit-node-label').fill('Cart')
  })
  await r.step('T adds a table block and its schema table, name field focused', async () => {
    await focusCanvas(); await page.keyboard.press('t')
    await expect(page.getByTestId('kit-node-table-1')).toHaveAttribute('data-kind', 'table')
    await expect(page.locator('[role="group"][data-testid^="schema-table-"]')).toHaveCount(1)
    await expect(page.getByTestId('kit-node-label')).toBeFocused()
  })
  await addKind(page, 'gateway')
  await addKind(page, 'service')
  const gw = page.getByTestId('kit-node-gateway-1')
  await r.step('click a node: canvas has focus, node selected', async () => {
    await gw.click()
    await expect(canvas).toBeFocused()
    await expect(gw).toHaveAttribute('aria-pressed', 'true')
  })
  await r.step('G frames the selected node (label focused); Shift+G removes the frame, nodes stay', async () => {
    const n0 = await count()
    await page.keyboard.press('g')
    await expect(page.getByTestId('kit-frame-label-frame-1')).toBeFocused()
    expect(await fcount()).toBe('1 of 8 frames')
    await focusCanvas(); await page.keyboard.press('Shift+G')
    expect(await fcount()).toBe('0 of 8 frames')
    expect(await count()).toBe(n0)
  })
  await r.step('arrows move the selected node one cell each; L enters link mode, Esc leaves it', async () => {
    await gw.click()
    const [x0, y0] = [Number(await gw.getAttribute('data-x')), Number(await gw.getAttribute('data-y'))]
    await page.keyboard.press('ArrowRight'); await expect(gw).toHaveAttribute('data-x', String(x0 + 1))
    await page.keyboard.press('ArrowDown'); await expect(gw).toHaveAttribute('data-y', String(y0 + 1))
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp')
    await expect(gw).toHaveAttribute('data-x', String(x0)); await expect(gw).toHaveAttribute('data-y', String(y0))
    await page.keyboard.press('l')
    await expect(page.getByTestId('kit-status')).toHaveText('Link from Gateway 1: pick a target')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('kit-status')).toHaveText('')
  })
  await r.step('Delete removes the selected node', async () => {
    const n0 = await count()
    await page.keyboard.press('Delete')
    await expect(gw).toHaveCount(0)
    expect(await count()).not.toBe(n0)
  })
  await r.step('click on empty canvas deselects; G then does nothing', async () => {
    await page.getByTestId('kit-node-service-1').click()
    const box = (await canvas.boundingBox())!
    await canvas.click({ position: { x: Math.round(box.width * 0.75), y: 200 } })
    await expect(page.getByTestId('kit-node-service-1')).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('g')
    expect(await fcount()).toBe('0 of 8 frames')
  })
  await r.step('Ctrl+. swaps canvas -> first notes box -> canvas; Esc from a notes box returns to canvas', async () => {
    await focusCanvas(); await page.keyboard.press('Control+.')
    await expect(page.getByTestId('notes-field-req-fn')).toBeFocused()
    await page.keyboard.press('Control+.'); await expect(canvas).toBeFocused()
    await openNotes(page)
    await page.getByTestId('notes-field-open').click(); await page.keyboard.press('Escape'); await expect(canvas).toBeFocused()
  })
  await r.step('? with canvas focus opens only session-keys; Esc closes it; 1 to 4 on canvas do nothing', async () => {
    const n0 = await count()
    await focusCanvas()
    for (const k of ['1', '2', '3', '4']) await page.keyboard.press(k)
    expect(page.url()).toBe(url0)
    await page.keyboard.press('?')
    await expect(page.getByTestId('session-keys')).toBeVisible()
    await expect(page.getByTestId('shell-shortcuts')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('session-keys')).toHaveCount(0)
    expect(page.url()).toBe(url0)
    expect(await count()).toBe(n0)
  })

  // typing "n c t g l ? 1 2 3 4" into text fields changes nothing else
  const typed = 'n c t g l ? 1 2 3 4'
  const snapshot = async () => JSON.stringify({ c: await count(), f: await fcount(), n: await ncount(), url: page.url(), keys: await page.getByTestId('session-keys').count(), shortcuts: await page.getByTestId('shell-shortcuts').count(), tables: await page.locator('[role="group"][data-testid^="schema-table-"]').count() })
  const typeInto = async (id: string, label: string, open?: () => Promise<unknown>) => r.step(`typing "${typed}" into ${label} changes nothing else`, async () => {
    if (open) await open()
    const before = await snapshot()
    const loc = page.getByTestId(id)
    await loc.click(); await loc.fill(''); await page.keyboard.type(typed)
    await expect(loc).toHaveValue(typed)
    expect(await snapshot()).toBe(before)
    await loc.fill('')
  })
  await typeInto('notes-field-assumptions', 'a notes box')
  await page.getByTestId('kit-add-table').click()
  const tid = (await page.locator('[role="group"][data-testid^="schema-table-"]').last().getAttribute('data-testid'))!.replace('schema-table-', '')
  await typeInto(`schema-col-name-${tid}-1`, 'a schema cell')
  await typeInto('kit-note-text-note-1', 'a sticky note')
  await page.getByTestId('session-tab-partner').click()
  await typeInto('session-chat-input', 'the chat box')

  await r.step('Enter adds a line, Ctrl+Enter sends', async () => {
    const chat = page.getByTestId('session-chat-input')
    await chat.click(); await page.keyboard.type('first line'); await page.keyboard.press('Enter'); await page.keyboard.type('second line')
    await expect(chat).toHaveValue('first line\nsecond line')
    await expect(msgs(page)).toHaveCount(1)
    await page.keyboard.press('Control+Enter')
    await expect(msgs(page)).toHaveCount(3)
    await expect(chat).toHaveValue('')
  })
  await r.step('click the sticky strip then ArrowLeft moves the sticky, not the text', async () => {
    await page.getByTestId('session-tab-notes').click()
    const s = page.getByTestId('kit-note-note-1')
    const x0 = Number(await s.getAttribute('data-x'))
    await s.focus(); await page.keyboard.press('ArrowRight')
    await expect(s).toHaveAttribute('data-x', String(x0 + 1))
  })
  r.done()
})

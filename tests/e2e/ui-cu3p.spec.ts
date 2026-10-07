import { expect, test, type Page } from '@playwright/test'
import { idbAll, idbPatch, IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-3p (dojo-acceptance/reports/uat/cu-3p.md, fea93d3: Board, Week, Progress by a
// real pointer) and controller ruling 25 (R1-R5). One file for the Chromium project, so each ruling's e2e sits together.
const TUE = '2026-10-06T10:00:00' // sprint 1 day 2 (Monday start); Sprint 1 holds 16 plan cards

async function open(page: Page, at: string, path: string, ready: string) {
  await page.clock.setFixedTime(IST(at))
  await onboard(page, '2026-10-05')
  if (path !== '/') await page.goto(path)
  await expect(page.getByTestId(`screen-${ready}`)).toHaveAttribute('data-ready', 'true')
}
type Row = { id: string; title: string; status: string; sprint: number; slidFrom: number[]; order: number; children?: string[]; childOf?: string; minutes?: number }
const tickets = (page: Page) => idbAll<Row>(page, 'tickets')
const todoCards = (page: Page) => page.getByTestId('col-todo').locator('article.card')
const idOf = async (card: ReturnType<typeof todoCards>) => (await card.getAttribute('data-testid'))!.replace('card-', '')

test.describe('P2-1 / R4 · "Move to sprint…": a real mouse click works on every item, over a neighbouring card or not', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('each visible item, clicked with page.mouse at its own coordinates, sends the card there', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    for (const to of [2, 3, 4, 5, 6]) {
      const card = todoCards(page).first()
      const id = await idOf(card)
      await card.getByRole('button', { name: 'Move to sprint…' }).click()
      const menu = card.getByRole('menu', { name: 'Move to sprint' })
      await expect(menu).toBeVisible()
      const item = menu.getByRole('menuitem', { name: `Sprint ${to}`, exact: true })
      await item.scrollIntoViewIfNeeded()
      const box = (await item.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      // the menu hangs over the cards below this one: that is the case the UAT could not click
      const over = await page.evaluate(([px, py]) => {
        const hit = document.elementFromPoint(px, py)
        return { inMenu: !!hit?.closest('[role="menu"]'), under: document.elementsFromPoint(px, py).some(e => e instanceof HTMLElement && e.matches('article.card') && !e.querySelector('[role="menu"]')) }
      }, [x, y])
      expect(over.inMenu, `Sprint ${to} is the topmost thing at its own centre`).toBe(true)
      if (to >= 3) expect(over.under, `Sprint ${to} hangs over a neighbouring card`).toBe(true)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.up()
      await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.sprint, { message: `card ${id} after a click on Sprint ${to}` }).toBe(to)
      await expect(page.getByTestId('toast').or(page.getByTestId('undo'))).toBeVisible()
      await expect(page.getByRole('menu')).toHaveCount(0)
    }
  })

  test('a press that starts on an item is never a card drag or a card click: the card does not open, nothing else moves', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const card = todoCards(page).first()
    const id = await idOf(card)
    const before = await tickets(page)
    await card.getByRole('button', { name: 'Move to sprint…' }).click()
    const item = card.getByRole('menuitem', { name: 'Sprint 4', exact: true })
    const box = (await item.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.sprint).toBe(4)
    expect(page.url()).toContain('/board') // not opened as the card's Do page
    const after = await tickets(page)
    expect(after.filter(t => t.sprint !== before.find(b => b.id === t.id)!.sprint).map(t => t.id)).toEqual([id])
  })
})

test.describe('R4 · the More menu is topmost and clickable over the page', () => {
  for (const width of [1280, 375]) {
    test(`at ${width}: every item is the topmost thing at its centre, and a real click opens its screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, TUE, '/board', 'board')
      const menu = page.getByRole('menu', { name: 'More' })
      await page.getByTestId('more-button').click()
      const targets = await menu.getByRole('menuitem').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.to!))
      expect(targets.length).toBeGreaterThan(3)
      for (const to of targets) {
        if (!(await menu.isVisible())) await page.getByTestId('more-button').click()
        const item = menu.locator(`[data-to="${to}"]`)
        const box = (await item.boundingBox())!
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[role="menu"]'), [x, y]), `${to} is topmost`).toBe(true)
        await page.mouse.click(x, y)
        await expect(page).toHaveURL(new RegExp(`${to.replace('/', '\\/')}(\\?|$)`))
        await page.goto('/board')
        await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
        await page.getByTestId('more-button').click()
      }
    })
  }
})

test.describe('P2-1 / R4 · "Move to sprint…" on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('a real tap-sized click on an item over the next card sends the card there', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    for (const to of [2, 3]) {
      const card = todoCards(page).first()
      const id = await idOf(card)
      await card.getByRole('button', { name: 'Move to sprint…' }).click()
      const item = card.getByRole('menuitem', { name: `Sprint ${to}`, exact: true })
      await item.scrollIntoViewIfNeeded()
      const box = (await item.boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.sprint).toBe(to)
    }
  })
})

test.describe('P2-2 / R2 · the Doing limit counts only the sprint on screen', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('three Doing cards in Sprint 2 leave Sprint 1 free; each sprint holds three, and the toast is for the full one', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const s2 = (await tickets(page)).filter(t => t.sprint === 2 && t.status === 'todo').sort((a, b) => a.order - b.order).slice(0, 4)
    expect(s2.length).toBe(4)
    await idbPatch(page, 'tickets', s2.slice(0, 3).map(t => t.id), { status: 'doing' })
    await page.reload()
    await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
    const warn = page.getByTestId('toast').filter({ hasText: 'Doing is full' })

    // Sprint 1: Doing is empty, so three cards go in (by drag, as in the UAT), and only the fourth is refused
    await expect(page.getByTestId('count-doing')).toHaveText('0')
    for (let i = 1; i <= 3; i++) {
      await todoCards(page).first().dragTo(page.getByTestId('col-doing'))
      await expect(page.getByTestId('count-doing')).toHaveText(String(i))
    }
    expect(await warn.count(), 'no refusal while Sprint 1 has room').toBe(0)
    await todoCards(page).first().dragTo(page.getByTestId('col-doing'))
    await expect(warn).toBeVisible()
    await expect(page.getByTestId('count-doing')).toHaveText('3')

    // Sprint 2: its own Doing holds three, so a fourth card there is refused too
    await page.getByTestId('strip-2').click()
    await expect(page.getByTestId('count-doing')).toHaveText('3')
    await page.getByTestId('toast').evaluateAll(es => es.forEach(e => e.remove()))
    await page.keyboard.press('Escape')
    const fourth = page.getByTestId(`card-${s2[3].id}`)
    await fourth.focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect(warn).toBeVisible()
    await expect(page.getByTestId('count-doing')).toHaveText('3')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === s2[3].id)?.status).toBe('todo')
  })
})

test.describe('P2-3 / R1 · the sprint review counts every card that left by any route, and none that came back', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Move to sprint…, Slide ›, Slide sprint and Shift plan, each undone and then kept, as the Progress review reads them', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const undo = page.getByTestId('undo')
    let minute = 0
    type Rv = { at: number; stats: { planned: number; done: number; slipped: unknown[] } }
    const review = async () => {
      // a later instant each time, so the newest review is the one the screen calls the latest
      await page.clock.setFixedTime(IST(`2026-10-06T10:${String(++minute).padStart(2, '0')}:00`))
      // in-app navigation: a page load would start a new app session, and Undo's history with it (ruling 20 S6)
      await page.getByTestId('more-button').click()
      await page.getByRole('menuitem', { name: 'Progress' }).click()
      await expect(page.getByTestId('screen-progress')).toHaveAttribute('data-ready', 'true')
      await page.getByRole('button', { name: 'Build review' }).click()
      await expect.poll(async () => (await idbAll<Rv>(page, 'reviews')).length).toBe(minute)
      const newest = (await idbAll<Rv>(page, 'reviews')).sort((a, b) => b.at - a.at)[0].stats
      const out = { planned: newest.planned, done: newest.done, slipped: newest.slipped.length }
      // and the screen says the same
      const latest = page.getByTestId('review-latest')
      await expect(latest.getByTestId('rv-slipped')).toHaveText(String(out.slipped))
      await expect(latest.locator('.rvw-stat', { hasText: 'Planned' }).locator('dd')).toHaveText(String(out.planned))
      await page.getByRole('link', { name: 'Board' }).first().click()
      await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
      return out
    }

    // a fresh Sprint 1: 16 plan items, nothing slipped
    expect(await review()).toEqual({ planned: 16, done: 0, slipped: 0 })

    // Move to sprint… (a real click on the menu item) and Slide › (the rail) each send one card on: 2 slipped
    const first = todoCards(page).first()
    await first.getByRole('button', { name: 'Move to sprint…' }).click()
    const item = first.getByRole('menuitem', { name: 'Sprint 3', exact: true })
    const box = (await item.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(undo).toHaveText('Undo (1)')
    const second = todoCards(page).first()
    await second.hover()
    await second.getByRole('button', { name: 'Slide ›' }).click()
    await expect(undo).toHaveText('Undo (2)')
    expect(await review()).toEqual({ planned: 16, done: 0, slipped: 2 })

    // Slide sprint: all 16 are out, then Undo brings back the 14 it moved: 2 again
    await page.getByRole('button', { name: 'Slide sprint ›' }).click()
    await page.getByRole('button', { name: /^Slide \d+ cards$/ }).click()
    await expect(undo).toHaveText('Undo (3)')
    expect(await review()).toEqual({ planned: 16, done: 0, slipped: 16 })
    await undo.click()
    await expect(undo).toHaveText('Undo (2)')
    expect(await review()).toEqual({ planned: 16, done: 0, slipped: 2 })

    // Shift plan: every open card moves on: 16; undone: 2 again
    await page.getByRole('button', { name: 'Shift plan ›' }).click()
    await page.getByRole('dialog', { name: 'Shift plan?' }).getByRole('button', { name: 'Shift plan', exact: true }).click()
    await expect(undo).toHaveText('Undo (3)')
    expect(await review()).toEqual({ planned: 16, done: 0, slipped: 16 })
    await undo.click()
    await expect(undo).toHaveText('Undo (2)')
    expect(await review()).toEqual({ planned: 16, done: 0, slipped: 2 })

    // the two earlier moves undone as well: nothing slipped
    await undo.click()
    await undo.click()
    await expect(undo).toHaveText('Undo (0)')
    expect(await review()).toEqual({ planned: 16, done: 0, slipped: 0 })
  })
})

test.describe('P3-2 / R5 · reordering inside a column shows no toast, Slid in included', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('a Slid in card dropped on its own column is silent; a card from Doing dropped there is still refused', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    await page.getByRole('button', { name: 'Slide sprint ›' }).click()
    await page.getByRole('button', { name: /^Slide \d+ cards$/ }).click()
    await page.getByTestId('strip-2').click()
    const slid = page.getByTestId('col-slid').locator('article.card')
    await expect(slid).toHaveCount(16)
    const toasts = page.getByTestId('toast')
    const refused = toasts.filter({ hasText: 'Slid in fills itself' })
    const shown = await toasts.count() // "Slid 16 to S2" may still be up
    const order = async () => (await tickets(page)).filter(t => t.sprint === 2).sort((a, b) => a.order - b.order).map(t => t.id)
    const before = await order()
    // count the drops that really happen, so a drag that never started cannot pass this for nothing
    await page.evaluate(() => { (window as unknown as { drops: number }).drops = 0; document.addEventListener('drop', () => { (window as unknown as { drops: number }).drops++ }, true) })
    const drops = () => page.evaluate(() => (window as unknown as { drops: number }).drops)
    const grab = { sourcePosition: { x: 24, y: 14 } } // the title, not a button (a button does not start a drag)
    // reorder: drag one slid card onto another, and onto the column's empty space
    await slid.nth(0).dragTo(slid.nth(3), grab)
    await slid.nth(5).dragTo(page.getByTestId('col-slid'), grab)
    await expect.poll(drops).toBe(2)
    await page.waitForTimeout(400)
    // a snapshot, not an auto-retrying assertion: a toast that came and went would pass the latter
    expect(await refused.count(), 'no refusal toast on a reorder').toBe(0)
    expect(await toasts.count(), 'nothing new was said').toBeLessThanOrEqual(shown)
    expect(await order()).toEqual(before)
    await expect(slid).toHaveCount(16)
    // a card that is in Doing (a Slid in card moved there) is another column's card: Slid in refuses it, saying why
    const id = (await slid.first().getAttribute('data-testid'))!
    await slid.first().dragTo(page.getByTestId('col-doing'), grab)
    await expect(page.getByTestId('col-doing').getByTestId(id)).toBeVisible()
    // (onto the top of the column: its middle is far down the page, out of the drag's reach)
    await page.getByTestId('col-doing').getByTestId(id).dragTo(page.getByTestId('col-slid'), { ...grab, targetPosition: { x: 80, y: 30 } })
    await expect(refused).toBeVisible()
    await expect(page.getByTestId('col-doing').getByTestId(id)).toBeVisible()
    expect(await drops()).toBe(4)
  })
})

test.describe('P3-6 · Board at tablet width: the card tools fit', () => {
  for (const width of [834, 836, 837]) {
    test(`at ${width}: "Move to sprint…" is whole, Do ▸ and Slide › share a row, nothing leaves the card`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, TUE, '/board', 'board')
      for (const col of ['todo', 'doing']) {
        const card = page.getByTestId(`col-${col}`).locator('article.card').first()
        if (col === 'doing') {
          await todoCards(page).first().focus()
          await page.keyboard.press('Shift+ArrowRight')
        }
        await expect(card).toBeVisible()
        await card.hover()
        await page.evaluate(() => document.fonts.ready)
        const r = await card.evaluate(c => {
          const box = (e: Element) => e.getBoundingClientRect()
          const cardBox = box(c)
          const colBox = box(c.closest('section')!)
          const btn = (sel: string) => c.querySelector<HTMLElement>(sel)!
          const move = btn('.bd-tools > [aria-haspopup="menu"]')
          const rail = [...c.querySelectorAll<HTMLElement>('.rail > *')]
          const all = [...c.querySelectorAll<HTMLElement>('.bd-tools > *, .rail > *')]
          return {
            moveText: move.textContent,
            // scrollWidth rounds: measure the label at its natural width against the row it sits in, with a pixel to spare
            moveClipped: (() => {
              const clone = move.cloneNode(true) as HTMLElement
              clone.style.cssText = 'position:absolute;left:0;top:0;width:max-content;max-width:none;overflow:visible'
              move.parentElement!.appendChild(clone)
              const natural = clone.getBoundingClientRect().width
              clone.remove()
              const room = move.parentElement!.getBoundingClientRect().width // the button may grow to the row's width
              return natural > room - 1
            })(),
            doSlideSameRow: Math.round(box(rail[0]).top) === Math.round(box(rail[1]).top),
            outside: all.some(b => box(b).right > cardBox.right + 0.5 || box(b).left < cardBox.left - 0.5),
            cardInColumn: cardBox.right <= colBox.right + 0.5 && cardBox.left >= colBox.left - 0.5,
          }
        })
        expect(r, col).toEqual({ moveText: 'Move to sprint…', moveClipped: false, doSlideSameRow: true, outside: false, cardInColumn: true })
      }
    })
  }
})

test.describe('P3-7 · Back from a card returns to the sprint it was opened from', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  for (const n of [3, 10]) {
    test(`a card opened in Sprint ${n}: ‹ Back, and the browser's back, both land on Sprint ${n}`, async ({ page }) => {
      await open(page, TUE, '/board', 'board')
      await expect(page.getByTestId('board-sprint')).toHaveText('S1')
      await page.getByTestId(`strip-${n}`).click()
      await expect(page.getByTestId('board-sprint')).toHaveText(`S${n}`)
      const card = page.getByTestId('col-todo').locator('article.card[data-opens="true"]').first()
      const id = (await card.getAttribute('data-testid'))!.replace('card-', '')
      await card.locator('.card-title').click()
      await expect(page).toHaveURL(new RegExp(`/do/${id.replace(/[~.]/g, '.')}`))
      await page.getByTestId('do-back').click()
      await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
      await expect(page.getByTestId('board-sprint')).toHaveText(`S${n}`)
      await expect(page.getByTestId(`strip-${n}`)).toHaveAttribute('aria-current', 'true')
      await expect(page.getByTestId(`card-${id}`)).toBeVisible()
      // the browser's back button (a history step) does the same
      await page.getByTestId(`card-${id}`).locator('.card-title').click()
      await expect(page.getByTestId('do-back')).toBeVisible()
      await page.goBack()
      await expect(page.getByTestId('board-sprint')).toHaveText(`S${n}`)
      // picking sprints adds no history: the Board tab and a pick back to the current sprint read "now" and a plain /board
      await page.getByTestId('strip-1').click()
      await expect(page.getByTestId('board-sprint')).toHaveText('S1')
      expect(new URL(page.url()).search).toBe('')
      await page.getByTestId(`strip-${n}`).click()
      await page.getByRole('link', { name: 'Today' }).first().click()
      await page.getByRole('link', { name: 'Board' }).first().click()
      await expect(page.getByTestId('board-sprint')).toHaveText('S1')
    })
  }
})

test.describe('P3-16 · a dialog that is taller than the window keeps its actions in view', () => {
  for (const [width, height] of [[1280, 640], [1280, 949], [375, 667]]) {
    test(`the Check dialog at ${width} x ${height}: Check answers and Cancel are visible without scrolling, and Cancel closes it`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await open(page, TUE, '/board', 'board')
      const watch = (await tickets(page)).find(t => (t as unknown as { kind: string; session?: string }).kind === 'stage' && (t as unknown as { session?: string }).session === 'watch' && t.sprint === 1)!
      const questions = Array.from({ length: 6 }, (_, i) => (i % 2 === 0
        ? { id: `q${i}`, kind: 'open', q: `Question ${i + 1}: explain the idea in your own words, with an example of where it goes wrong.`, keyIdeas: ['a', 'b'] }
        : { id: `q${i}`, kind: 'mcq', q: `Question ${i + 1}: which statement is right?`, choices: ['The first one', 'The second one', 'The third one'], correct: 1 }))
      const brief = {
        goal: 'Understand it', steps: [{ text: 'Watch the video' }], minutes: 50, dayType: 'focus', learn: ['x'], outcome: 'You can explain it',
        deliverable: { kind: 'answers', prompt: 'Answer the questions' }, questions, status: 'approved', source: 'edited',
      }
      await idbPatch(page, 'tickets', [watch.id], { brief })
      await page.reload()
      await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
      const card = page.getByTestId(`card-${watch.id}`)
      await card.hover()
      await card.getByRole('button', { name: 'Done ✓' }).click()
      const dialog = page.getByTestId('check-dialog')
      await expect(dialog).toBeVisible()
      const box = (await dialog.boundingBox())!
      const view = page.viewportSize()!
      // the dialog is taller than the window here (or the buttons would fit anyway); the buttons must be inside the window
      const check = dialog.getByRole('button', { name: 'Check answers' })
      const cancel = dialog.getByRole('button', { name: 'Cancel' })
      for (const b of [check, cancel]) {
        const r = (await b.boundingBox())!
        expect(r.y, 'top inside the window').toBeGreaterThanOrEqual(0)
        expect(r.y + r.height, 'bottom inside the window').toBeLessThanOrEqual(view.height + 0.5)
        expect(r.y + r.height, 'bottom inside the dialog').toBeLessThanOrEqual(box.y + box.height + 0.5)
        // and nothing covers it: a real pointer at its centre lands on it
        expect(await b.evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === e })).toBe(true)
      }
      // a field that takes focus (a Tab to it) stops above the row, not under it
      await dialog.locator('textarea').last().focus()
      const field = (await dialog.locator('textarea').last().boundingBox())!
      const row = (await dialog.locator('.p-actions').boundingBox())!
      expect(field.y + field.height, 'the focused field ends above the actions').toBeLessThanOrEqual(row.y + 0.5)
      // the content still scrolls: the last question can be reached, and the actions stay put
      await dialog.locator('.ck-question').last().scrollIntoViewIfNeeded()
      const r2 = (await cancel.boundingBox())!
      expect(r2.y + r2.height).toBeLessThanOrEqual(view.height + 0.5)
      await cancel.click()
      await expect(dialog).toBeHidden()
    })
  }
})

test.describe('P3-11 / P3-12 · Week: repeats are marked, and a tile never ends a line on a dangling dot', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('one card left in Sprint 1: every later day that lists it carries "↻ again"', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    // every card but one done: the sprint's lone open card fills each working day
    const all = (await tickets(page)).filter(t => t.sprint === 1 && t.status === 'todo')
    const keep = all.find(t => t.id === 'm1w1t1')?.id ?? all[0].id
    await idbPatch(page, 'tickets', all.filter(t => t.id !== keep).map(t => t.id), { status: 'done', doneAt: IST('2026-10-05T12:00:00').getTime() })
    await page.goto('/week')
    await expect(page.getByTestId('screen-week')).toHaveAttribute('data-ready', 'true')
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Sat', 'Sun']
    const listed = await Promise.all(days.map(async d => (await page.getByTestId(`day-${d}`).locator(`a[href="/do/${keep}"]`).count()) > 0))
    expect(listed).toEqual([true, true, true, true, true, true])
    const chips = await Promise.all(days.map(async d => await page.getByTestId(`again-${d}-${keep}`).count()))
    expect(chips).toEqual([0, 1, 1, 1, 1, 1]) // the first listing carries none
  })

  for (const width of [1280, 834, 393, 375]) {
    test(`at ${width}: the "n done · n min focus" line has the dot between two things on one line, or no dot`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, TUE, '/week', 'week')
      const metas = await page.locator('.week-meta').evaluateAll(els => els.map(m => {
        const d = m.querySelector<HTMLElement>('.week-done')!.getBoundingClientRect()
        const f = m.querySelector<HTMLElement>('.week-focus')!.getBoundingClientRect()
        const sep = m.querySelector<HTMLElement>('.week-sep')!
        return { sepShown: getComputedStyle(sep).display !== 'none', sameLine: Math.round(d.top) === Math.round(f.top), text: (m as HTMLElement).innerText.replace(/\s+/g, ' ').trim() }
      }))
      expect(metas.length).toBeGreaterThan(5)
      for (const m of metas) expect(m.sepShown, m.text).toBe(m.sameLine)
    })
  }
})

test.describe('P3-12 · the 72 sprint cells say which sprint they are', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('hovering a cell shows "Sprint n" (and "now" on the current one) in the page\'s own bubble', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    await page.getByTestId('strip-36').hover()
    await expect(page.getByTestId('tip')).toHaveText('Sprint 36')
    await page.getByTestId('strip-1').hover()
    await expect(page.getByTestId('tip')).toHaveText('Sprint 1 · now')
    await page.mouse.move(5, 5)
    await expect(page.getByTestId('tip')).toHaveCount(0)
  })
})

test.describe('P3-13 · Progress at tablet width: the Design radar is readable, "0 / 192" stays on one line', () => {
  for (const width of [836, 1000]) {
    test(`at ${width}: the radar has room for its labels and the deep-dives value does not wrap`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, TUE, '/progress', 'progress')
      const r = await page.getByTestId('ev-design-radar').evaluate(link => {
        const well = link.querySelector<HTMLElement>('.ev-radar-well')!
        const chart = well.querySelector<HTMLElement>('sr-chart')!
        const dives = document.querySelector<HTMLElement>('[data-testid="ev-design-dives-value"]')!
        const line = parseFloat(getComputedStyle(dives).lineHeight) || dives.getBoundingClientRect().height
        return { chartW: chart.getBoundingClientRect().width, chartH: chart.getBoundingClientRect().height, divesLines: Math.round(dives.getBoundingClientRect().height / line) }
      })
      expect(r.chartW, 'radar width').toBeGreaterThanOrEqual(170)
      expect(r.chartH, 'radar height').toBeGreaterThanOrEqual(150)
      expect(r.divesLines, 'value lines').toBe(1)
    })
  }
})

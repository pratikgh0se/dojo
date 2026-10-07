import { expect, test, type Page } from '@playwright/test'
import { idbAll, IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-1 (dojo-acceptance/reports/uat/cu-1.md, 96c58d5), to controller ruling 23
// (ui-foundation.md): K1 the footer legend is truthful per screen, K2 Board cards fit their column at 834, K3 the Today
// NOW actions at phone width follow today-375, and the P3 look fixes.
const TUE = '2026-10-06T10:00:00' // sprint 1 day 2: interview code (LeetCode 200 has an Open link)
const WED = '2026-10-07T10:00:00'

async function open(page: Page, at: string, path = '/', ready = 'today') {
  await page.clock.setFixedTime(IST(at))
  await onboard(page, '2026-10-05')
  if (path !== '/') await page.goto(path)
  await expect(page.getByTestId(`screen-${ready}`)).toHaveAttribute('data-ready', 'true')
}
const legend = (page: Page) => page.getByTestId('keys-legend')
const GLOBAL = '1–9, 0 tabs · a atlas · b banks · m more · t today'
type Row = { id: string; status: string; sprint: number }
const tickets = (page: Page) => idbAll<Row>(page, 'tickets')
const leadId = async (page: Page) => (await page.getByTestId('start-button').getAttribute('href'))!.replace('/do/', '')

test.describe('K1 · Today keys (short window, so the page scrolls)', () => {
  test.use({ viewport: { width: 1280, height: 520 } })

  test('the legend lists Enter, space, d and s; space starts and pauses the timer and never scrolls the page', async ({ page }) => {
    await open(page, TUE)
    await expect(legend(page)).toHaveText(`${GLOBAL} · Enter start · space timer · d done · s slide`)
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // clean focus, no pointer press
    await page.keyboard.press('Space')
    await expect(page.getByTestId('now-readout')).toHaveText(/^2[45]:\d\d$/)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.keyboard.press('Space')
    await expect(page.getByTestId('now-readout')).toHaveAttribute('data-paused', 'true')
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.keyboard.press('Space')
    await expect(page.getByTestId('now-readout')).not.toHaveAttribute('data-paused')
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('d marks the NOW item done, s slides it to the next sprint', async ({ page }) => {
    await open(page, TUE)
    const first = await leadId(page)
    // no click: a click on page background is a stray one and the letter shortcuts ignore it (cu-r2 A2#22)
    await page.keyboard.press('d')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === first)?.status).toBe('done')
    await expect(page.getByTestId('start-button')).not.toHaveAttribute('href', `/do/${first}`)
    const second = await leadId(page)
    await page.keyboard.press('s')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === second)?.sprint).toBe(2)
    await expect(page.getByText(/^Slid .+ to Sprint 2$/)).toBeVisible()
  })

  test('Enter opens the NOW item', async ({ page }) => {
    await open(page, TUE)
    const id = await leadId(page)
    // no click: a click on page background is a stray one and the letter shortcuts ignore it (cu-r2 A2#22)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/do/${id}$`))
  })
})

test.describe('K1 · Do keys', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('space toggles the timer, d marks it done, Esc leaves', async ({ page }) => {
    await open(page, TUE)
    const id = await leadId(page)
    await page.goto(`/do/${id}`)
    await expect(page.getByTestId('do-screen')).toBeVisible()
    // no click: a click on page background is a stray one and the letter shortcuts ignore it (cu-r2 A2#22)
    await expect(page.getByTestId('keys-legend')).toHaveCount(0) // Do has no footer (S1); its keys still act
    await page.keyboard.press('Space')
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('timer-state')).toHaveText('paused')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    await page.keyboard.press('d')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.status).toBe('done')
  })

  test('s slides the card, Esc leaves Do', async ({ page }) => {
    await open(page, TUE)
    const id = await leadId(page)
    await page.goto(`/do/${id}`)
    await expect(page.getByTestId('do-screen')).toBeVisible()
    // no click: a click on page background is a stray one and the letter shortcuts ignore it (cu-r2 A2#22)
    await page.keyboard.press('s')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.sprint).toBe(2)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('do-screen')).toHaveCount(0)
  })
})

test.describe('K1 · Board keys', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('with no card focused the legend has only the global keys and d, s do nothing; with a card focused its keys act', async ({ page }) => {
    await open(page, WED, '/board', 'board')
    await expect(legend(page)).toHaveText(GLOBAL)
    // no click: a click on page background is a stray one and the letter shortcuts ignore it (cu-r2 A2#22)
    const before = await tickets(page)
    await page.keyboard.press('d')
    await page.keyboard.press('s')
    await page.keyboard.press('Shift+ArrowRight')
    expect(await tickets(page)).toEqual(before)

    const card = page.getByTestId('col-todo').locator('article.card').first()
    const id = (await card.getAttribute('data-testid'))!.replace('card-', '')
    await card.focus()
    await expect(legend(page)).toHaveText(`${GLOBAL} · Enter open · Shift+←/→ move · d done · s slide`)
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.status).toBe('doing')
    await expect(page.getByTestId('col-doing').getByTestId(`card-${id}`)).toBeFocused()

    // a control inside the card: the keys still act on the card, Enter stays the control's own
    await page.keyboard.press('Tab')
    await expect(page.getByTestId(`card-${id}`).locator('button, a').first()).toBeFocused()
    await expect(legend(page)).toHaveText(`${GLOBAL} · Shift+←/→ move · d done · s slide`)
    await page.keyboard.press('d')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === id)?.status).toBe('done')
  })
})

test.describe('K2 · Board at 834: cards fit their column', () => {
  test.use({ viewport: { width: 834, height: 1000 } })

  test('every card, and everything in it, stays inside its column; titles wrap', async ({ page }) => {
    await open(page, WED, '/board', 'board')
    const bad = await page.evaluate(() => {
      const out: string[] = []
      for (const col of document.querySelectorAll<HTMLElement>('[data-testid^="col-"]')) {
        const c = col.getBoundingClientRect()
        for (const card of col.querySelectorAll<HTMLElement>('article.card')) {
          const r = card.getBoundingClientRect()
          const name = card.getAttribute('data-testid')
          if (r.right > c.right + 0.5 || r.left < c.left - 0.5) out.push(`${name} box ${r.left}-${r.right} outside column ${c.left}-${c.right}`)
          if (card.scrollWidth > card.clientWidth + 0.5) out.push(`${name} scrollWidth ${card.scrollWidth} > ${card.clientWidth}`)
          for (const el of card.querySelectorAll<HTMLElement>('*')) {
            const e = el.getBoundingClientRect()
            if (e.width > 0 && e.right > r.right + 0.5) out.push(`${name} > ${el.className || el.tagName} reaches ${e.right}, card ends ${r.right}`)
          }
          const title = card.querySelector<HTMLElement>('.card-title')!
          if (title.scrollWidth > title.clientWidth + 0.5) out.push(`${name} title does not wrap`)
        }
      }
      return out
    })
    expect(bad).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(834)
    expect(await page.getByTestId('col-todo').locator('article.card').count()).toBeGreaterThan(3)
  })
})

for (const width of [375, 393]) {
  test.describe(`K3 · Today NOW actions at ${width}`, () => {
    test.use({ viewport: { width, height: 852 } })

    test('Spar · 50 and Spar · 25 share a row, Open is one line, Start is full width (today-375)', async ({ page }) => {
      await open(page, TUE)
      const box = (id: string) => page.getByTestId(id).evaluate(e => e.getBoundingClientRect().toJSON() as DOMRect)
      const [s50, s25, open_, start] = await Promise.all(['spar-50', 'spar-25', 'open-link', 'start-button'].map(box))
      const actions = await page.locator('.now-actions').evaluate(e => e.getBoundingClientRect().toJSON() as DOMRect)
      // the Spar buttons side by side, filling the row between them
      expect(Math.abs(s50.top - s25.top)).toBeLessThanOrEqual(1)
      expect(s25.left).toBeGreaterThanOrEqual(s50.right)
      expect(s50.left).toBeCloseTo(actions.left, 0)
      expect(s25.right).toBeCloseTo(actions.right, 0)
      // Open: one line, a full row, with its whole label in the title
      expect(open_.height).toBeLessThanOrEqual(44.5)
      expect(open_.width).toBeCloseTo(actions.width, 0)
      await expect(page.getByTestId('open-link')).toHaveAttribute('title', 'LeetCode 200')
      expect(await page.getByTestId('open-link').evaluate(e => e.querySelector('.now-open-label')!.getBoundingClientRect().height)).toBeLessThan(26)
      // Start: the whole row, under the others, and 44 tall
      expect(start.width).toBeCloseTo(actions.width, 0)
      expect(start.left).toBeCloseTo(actions.left, 0)
      expect(start.top).toBeGreaterThanOrEqual(open_.bottom)
      expect(open_.top).toBeGreaterThanOrEqual(s50.bottom)
      expect(start.height).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })

    test('a long Open label ends in an ellipsis, never wraps', async ({ page }) => {
      await open(page, TUE)
      await page.getByTestId('open-link').evaluate(e => { e.querySelector('.now-open-label')!.textContent = 'Open · A very long link label that cannot fit the phone tile at all ↗' })
      const label = page.locator('.now-open-label')
      expect(await label.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true) // clipped, with text-overflow: ellipsis
      expect(await label.evaluate(e => getComputedStyle(e).textOverflow)).toBe('ellipsis')
      expect((await page.getByTestId('open-link').boundingBox())!.height).toBeLessThanOrEqual(44.5)
    })
  })
}

test.describe('P3 · onboarding', () => {
  test.use({ viewport: { width: 700, height: 700 } })

  test('P3-2 / P3-3: the error is format-neutral and goes when a valid date is picked', async ({ page }) => {
    await page.goto('/')
    const date = page.getByRole('textbox', { name: 'Start date' })
    await date.fill('')
    await page.getByRole('button', { name: 'Start the plan ▸' }).click()
    const error = page.getByTestId('form-error')
    await expect(error).toHaveText('Pick a valid date.') // the native field shows dd/mm/yyyy, so no YYYY-MM-DD
    await expect(date).toHaveAttribute('aria-invalid', 'true')
    await date.fill('2026-10-05')
    await expect(error).toHaveCount(0)
    await expect(date).not.toHaveAttribute('aria-invalid')
    await expect(page.getByTestId('start-date-note').or(page.getByTestId('start-date-warn')).first()).toBeVisible()
  })

  test('P3-7: the calendar icon\'s keyboard focus is a 2 px orange ring, not Chrome\'s white box', async ({ page }) => {
    await page.goto('/')
    const date = page.getByRole('textbox', { name: 'Start date' })
    await date.focus() // the day segment
    const box = (await date.boundingBox())!
    const icon = { x: box.x + box.width - 44, y: box.y - 6, width: 44, height: box.height + 12 }
    // count the house orange (#ff8a2a) and pure white pixels in the icon's cell
    const count = async () => page.evaluate(async b64 => {
      // no fetch of a data: URL (the app's CSP connect-src forbids it, G6): decode the bytes by hand
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))], { type: 'image/png' }))
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let orange = 0, white = 0
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 255) < 8 && Math.abs(d[i + 1] - 138) < 12 && Math.abs(d[i + 2] - 42) < 16) orange++
        if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white++
      }
      return { orange, white, w: c.width, h: c.height }
    }, (await page.screenshot({ clip: icon })).toString('base64'))
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab') // month, year
    const onYear = await count()
    await page.keyboard.press('Tab') // the calendar icon
    const onIcon = await count()
    // the icon's glyph is white at every stop; the white box around it is the UA ring, and must not come back
    expect(onIcon.white).toBeLessThanOrEqual(onYear.white + 4)
    // a ring 2 px thick around a box about 24 px square: about 4 * 2 * 24 = 192 px, at 1x
    expect(onIcon.orange).toBeGreaterThan(120)
    // and the field's own ring (a segment focused) is not what is being counted: it is gone while the icon has focus
    await page.keyboard.press('Shift+Tab')
    await expect(date).toBeFocused()
  })
})

test.describe('P3 · More menu', () => {
  test('P3-8: the key hints are the keys: a and b in lower case, as the legend says', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page, WED)
    await page.getByTestId('more-button').click()
    const hint = (name: string) => page.getByRole('menuitem', { name, exact: true }).locator('.more-key')
    await expect(hint('Atlas')).toHaveText('a')
    await expect(hint('Banks')).toHaveText('b')
    expect(await hint('Atlas').evaluate(e => (e as HTMLElement).innerText)).toBe('a') // innerText follows text-transform
    expect(await hint('Banks').evaluate(e => (e as HTMLElement).innerText)).toBe('b')
    await expect(hint('Map')).toHaveText('6')
    await expect(legend(page)).toContainText('a atlas · b banks')
  })

  const label = (page: Page) => page.getByTestId('more-button').evaluate(e => ({
    text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), on: e.classList.contains('tab-on'), aria: e.getAttribute('aria-label'),
    right: e.getBoundingClientRect().right, vw: window.innerWidth,
  }))

  test('P3-14: on phone the More button reads "More · <Tab> ▾" where that fits its row, else "More ▾" in the accent colour', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await open(page, WED)
    // 375: no tab name fits next to Today, Board and DSA: the label is short, the accent and the aria-label say where we are
    await page.goto('/settings')
    await expect(page.getByTestId('more-button')).toBeVisible()
    expect(await label(page)).toMatchObject({ text: 'MORE ▾', on: true, aria: 'More · Settings ▾' })
    await page.goto('/map')
    expect(await label(page)).toMatchObject({ text: 'MORE ▾', on: true, aria: 'More · Map ▾' })
    // 430: a short name fits, a long one does not
    await page.setViewportSize({ width: 430, height: 800 })
    await page.goto('/map')
    expect(await label(page)).toMatchObject({ text: 'MORE · MAP ▾', on: true })
    await page.goto('/progress')
    expect(await label(page)).toMatchObject({ text: 'MORE ▾', on: true, aria: 'More · Progress ▾' })
    // 520: every name fits
    await page.setViewportSize({ width: 520, height: 800 })
    await page.goto('/settings')
    expect(await label(page)).toMatchObject({ text: 'MORE · SETTINGS ▾', on: true })
    // never past the 16 px gutter, and it follows a resize without a reload
    for (const w of [375, 430, 520, 393]) {
      await page.setViewportSize({ width: w, height: 800 })
      await expect.poll(async () => { const l = await label(page); return l.right <= l.vw - 16 + 0.5 }).toBe(true)
    }
    await page.setViewportSize({ width: 375, height: 800 })
    await expect.poll(async () => (await label(page)).text).toBe('MORE ▾')
    await page.setViewportSize({ width: 520, height: 800 })
    await expect.poll(async () => (await label(page)).text).toBe('MORE · SETTINGS ▾')
  })

  test('P3-14: a page that is not in More leaves the label plain, at any width', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 800 })
    await open(page, WED)
    expect(await label(page)).toMatchObject({ text: 'MORE ▾', on: false, aria: 'More ▾' })
  })
})

test.describe('P3-17 · Today against today-1280 and components-1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the Focus chips are flat outlines, the row counts are Space Mono 17, the More menu has the panel bevel and its drop band', async ({ page }) => {
    await open(page, WED)
    // the six chips (1 G H D B ½): a 2 px #414968 outline on nothing, no bevel, Space Mono 14, 30 x 30
    for (const g of ['1', 'G', 'H', 'D', 'B', '½']) {
      const s = await page.getByTestId(`badge-${g}`).evaluate(e => { const c = getComputedStyle(e); const b = e.getBoundingClientRect(); return { border: c.border, shadow: c.boxShadow, bg: c.backgroundColor, font: c.fontSize, family: c.fontFamily.split(',')[0], w: b.width, h: b.height } })
      expect(s, g).toEqual({ border: '2px solid rgb(65, 73, 104)', shadow: 'none', bg: 'rgba(0, 0, 0, 0)', font: '14px', family: '"Space Mono"', w: 30, h: 30 })
    }
    // the drawer rows' counts: Space Mono at the mockup's computed 17 px (F2.2's scale has no 20)
    for (const c of await page.locator('.drawer-count').all()) {
      expect(await c.evaluate(e => [getComputedStyle(e).fontSize, getComputedStyle(e).fontFamily.split(',')[0]])).toEqual(['17px', '"Space Mono"'])
    }
    // the More menu is a panel: the same 3 px border and bevel, and its 8 px drop band, as components-1280's menu
    await page.getByTestId('more-button').click()
    const menu = page.getByRole('menu', { name: 'More' })
    await expect(menu).toBeVisible()
    await menu.evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)))
    const bevel = (sel: string) => page.locator(sel).first().evaluate(e => { const c = getComputedStyle(e); return { border: c.border, shadow: c.boxShadow, bg: c.backgroundColor } })
    expect(await bevel('.more-menu')).toEqual(await bevel('.sr-panel'))
    expect((await bevel('.more-menu')).shadow).toBe('rgb(65, 73, 104) 3px 3px 0px 0px inset, rgb(27, 31, 48) -3px -3px 0px 0px inset, rgb(15, 17, 28) 0px 8px 0px 0px')
  })
})

test.describe('cu-r2 A2#22 · a stray click on page background arms no card shortcut', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Do: click the background, type "sdm1": nothing slides, completes or moves', async ({ page }) => {
    await open(page, TUE)
    const id = await leadId(page)
    const before = (await tickets(page)).find(t => t.id === id)!
    await page.goto(`/do/${id}`)
    await expect(page.getByTestId('do-screen')).toBeVisible()
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.type('sdm1')
    await page.keyboard.press('Space')
    await page.waitForTimeout(400)
    await expect(page.getByTestId('do-screen')).toBeVisible()
    await expect(page.getByTestId('timer-state')).toHaveText('idle')
    const after = (await tickets(page)).find(t => t.id === id)!
    expect(after.status).toBe(before.status)
    expect(after.sprint).toBe(before.sprint)
  })
})

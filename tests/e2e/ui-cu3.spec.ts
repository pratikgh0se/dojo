import { expect, test, type Page } from '@playwright/test'
import { idbAll, IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-3 (dojo-acceptance/reports/uat/cu-3.md, 96c58d5: Board, Week, Progress):
// P2-1 the Undo tooltip, P2-2 the sprint review after a slide, and the P3s (Pin, Shift+arrows from a card's button, the
// "↻ again" tooltip, the Done counts, the DSA tile against Evidence, the footer legend, long titles).
const TUE = '2026-10-06T10:00:00' // sprint 1 day 2 (Monday start); Sprint 1 holds 16 plan cards

async function open(page: Page, at: string, path: string, ready: string) {
  await page.clock.setFixedTime(IST(at))
  await onboard(page, '2026-10-05')
  if (path !== '/') await page.goto(path)
  await expect(page.getByTestId(`screen-${ready}`)).toHaveAttribute('data-ready', 'true')
}
const GLOBAL = '1–9, 0 tabs · a atlas · b banks · m more · t today'
type Row = { id: string; title: string; status: string; sprint: number; slidFrom: number[] }
const tickets = (page: Page) => idbAll<Row>(page, 'tickets')
const todoCards = (page: Page) => page.getByTestId('col-todo').locator('article.card')

test.describe('P2-1 · the Undo button names its action and the page shows it on hover', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('title and aria-label follow the stack; a real hover shows the bubble under the button, in view', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const undo = page.getByTestId('undo')
    await expect(undo).toHaveAttribute('data-tip', 'Nothing to undo')
    await expect(undo).toHaveAttribute('aria-label', 'Nothing to undo')
    expect(await page.getByTestId('tip').count()).toBe(0)

    const first = todoCards(page).first()
    const id = (await first.getAttribute('data-testid'))!.replace('card-', '')
    const title = (await tickets(page)).find(t => t.id === id)!.title
    await first.focus()
    await page.keyboard.press('Shift+ArrowRight')
    const moved = `Undo: move '${title}' to Doing`
    await expect(undo).toHaveAttribute('data-tip', moved)
    await expect(undo).toHaveAttribute('aria-label', moved)
    await expect(undo).toHaveText('Undo (1)')

    // the pointer reaches the button itself (nothing covers it), and resting on it shows the words
    const box = (await undo.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), [cx, cy])).toBe('undo')
    await page.mouse.move(cx, cy)
    const tip = page.getByTestId('tip')
    await expect(tip).toHaveText(moved)
    const t = (await tip.boundingBox())!
    expect(t.y).toBeGreaterThanOrEqual(box.y + box.height) // under the button, never over it
    expect(t.x).toBeGreaterThanOrEqual(0)
    expect(t.x + t.width).toBeLessThanOrEqual(1280) // the button is at the right edge: the bubble is pulled back in
    // leaving the button takes it away
    await page.mouse.move(5, 5)
    await expect(tip).toHaveCount(0)

    // a slide of the whole sprint is the newest step: the words follow, and so does the bubble
    await page.getByRole('button', { name: 'Slide sprint ›' }).click()
    await page.getByRole('button', { name: /^Slide \d+ cards$/ }).click()
    const slid = 'Undo: slide 16 cards from Sprint 1 to Sprint 2' // the card in Doing is unfinished too
    await expect(undo).toHaveAttribute('data-tip', slid)
    await expect(undo).toHaveAttribute('aria-label', slid)
    await expect(undo).toHaveText('Undo (2)')
    await undo.hover()
    await expect(tip).toHaveText(slid)
    // Undo takes it back, and the button names the step before it
    await undo.click()
    await expect(undo).toHaveText('Undo (1)')
    await expect(undo).toHaveAttribute('data-tip', moved)
    await undo.click()
    await expect(undo).toHaveText('Undo (0)')
    await expect(undo).toHaveAttribute('data-tip', 'Nothing to undo')
  })

  test('the keyboard shows it too: Tab to the button', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const first = todoCards(page).first()
    await first.focus()
    await page.keyboard.press('Shift+ArrowRight')
    const undo = page.getByTestId('undo')
    await expect(undo).toHaveText('Undo (1)')
    await undo.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(undo).toBeFocused()
    await expect(page.getByTestId('tip')).toHaveText(/^Undo: move '.+' to Doing$/)
  })
})

test.describe('P2-2 · the sprint review after a slide', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Slide sprint then Build review: the slid cards are slipped, planned is the sprint\'s own plan, the Board agrees', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const first = todoCards(page).first()
    await first.focus()
    await page.keyboard.press('d') // one card done
    await expect(page.getByTestId('count-done')).toHaveText('1')
    await page.getByRole('button', { name: 'Slide sprint ›' }).click()
    await page.getByRole('button', { name: /^Slide 15 cards$/ }).click()
    await expect(page.getByTestId('toast').filter({ hasText: 'Slid 15 to S2' })).toBeVisible()
    await expect(page.getByTestId('debt-own')).toHaveText('own 1')
    await page.getByTestId('strip-2').click()
    await expect(page.getByTestId('debt-slid')).toHaveText('slid in 15') // what the Board says...

    await page.goto('/progress')
    await expect(page.getByTestId('screen-progress')).toHaveAttribute('data-ready', 'true')
    await page.getByRole('button', { name: 'Build review' }).click()
    const latest = page.getByTestId('review-latest')
    await expect(latest.getByTestId('rv-slipped')).toHaveText('15') // ...the review says too
    await expect(latest.locator('.rvw-stat', { hasText: 'Planned' }).locator('dd')).toHaveText('16')
    await expect(latest.getByTestId('rv-done')).toHaveText('1')
    await expect(latest).toContainText('Slipped:')
    await expect(page.getByTestId('review-prose')).toHaveText('Review for Sprint 1: 1/16 cards done.')
  })
})

test.describe('P3-2 · pinning never makes a card taller', () => {
  for (const width of [1280, 1100, 834, 375]) {
    test(`at ${width}: Pin, Unpin and the "Pinned" chip leave the card's height as it was`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, TUE, '/board', 'board')
      const cards = todoCards(page)
      for (let i = 0; i < 6; i++) {
        const card = cards.nth(i)
        const id = (await card.getAttribute('data-testid'))!
        const h0 = (await card.boundingBox())!.height
        await card.getByRole('button', { name: 'Pin', exact: true }).click()
        await expect(page.getByTestId(id).getByRole('button', { name: 'Unpin', exact: true })).toBeVisible()
        await expect(page.getByTestId(id).getByText('Pinned', { exact: true })).toBeVisible()
        expect(Math.round((await page.getByTestId(id).boundingBox())!.height), `${id} pinned`).toBe(Math.round(h0))
        await page.getByTestId(id).getByRole('button', { name: 'Unpin', exact: true }).click()
        await expect(page.getByTestId(id).getByRole('button', { name: 'Pin', exact: true })).toBeVisible()
        expect(Math.round((await page.getByTestId(id).boundingBox())!.height), `${id} unpinned`).toBe(Math.round(h0))
      }
    })
  }

  test('at 1280 Unpin and Move to sprint… sit on one row, whole', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page, TUE, '/board', 'board')
    const card = todoCards(page).first()
    const id = (await card.getAttribute('data-testid'))!
    await card.getByRole('button', { name: 'Pin', exact: true }).click()
    const pinned = page.getByTestId(id)
    await expect(pinned.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible()
    const r = await pinned.locator('.bd-tools').evaluate(t => {
      const tools = t.getBoundingClientRect()
      return Array.from(t.querySelectorAll<HTMLElement>(':scope > .sr-btn')).map(b => {
        const x = b.getBoundingClientRect()
        return { label: b.innerText, top: Math.round(x.top), right: Math.round(x.right), clipped: b.scrollWidth > b.clientWidth, outside: x.right > tools.right + 0.5 }
      })
    })
    expect(r.map(b => b.label.toLowerCase())).toEqual(['unpin', 'move to sprint…'])
    expect(r[0].top).toBe(r[1].top)
    expect(r.some(b => b.clipped || b.outside)).toBe(false)
  })
})

test.describe('P3-3 · Shift+←/→ act on the card whose button holds focus', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('with Pin or Move to sprint… focused, Shift+→ moves the card to Doing and Shift+← back', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const card = todoCards(page).first()
    const id = (await card.getAttribute('data-testid'))!.replace('card-', '')
    const status = async () => (await tickets(page)).find(t => t.id === id)?.status
    await card.getByRole('button', { name: 'Pin', exact: true }).focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(status).toBe('doing')
    await expect(page.getByTestId('col-doing').getByTestId(`card-${id}`)).toBeFocused()
    // focus a button of the card in Doing, and go back
    await page.getByTestId(`card-${id}`).getByRole('button', { name: 'Move to sprint…' }).focus()
    await page.keyboard.press('Shift+ArrowLeft')
    await expect.poll(status).toBe('todo')
    // the same from the rail buttons (Slide › is a plain button; Do ▸ a link); the rail is shown while the card is hovered
    await page.getByTestId(`card-${id}`).hover()
    await page.getByTestId(`card-${id}`).getByRole('button', { name: 'Slide ›' }).focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(status).toBe('doing')
    await page.getByTestId(`card-${id}`).hover()
    await page.getByTestId(`card-${id}`).getByTestId(`do-${id}`).focus()
    await page.keyboard.press('Shift+ArrowLeft')
    await expect.poll(status).toBe('todo')
  })
})

test.describe('P3-4 · the Week "↻ again" chip shows its title on hover', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('hovering the chip shows "Second pass: re-solve it from memory" under it, in view', async ({ page }) => {
    await open(page, TUE, '/week', 'week')
    const chip = page.getByTestId('again-Sun-m1w1i1')
    await expect(chip).toHaveText('↻ again')
    await expect(chip).toHaveAttribute('data-tip', 'Second pass: re-solve it from memory')
    await chip.hover()
    const tip = page.getByTestId('tip')
    await expect(tip).toHaveText('Second pass: re-solve it from memory')
    const c = (await chip.boundingBox())!
    const t = (await tip.boundingBox())!
    expect(t.y).toBeGreaterThanOrEqual(c.y + c.height)
    expect(t.x + t.width).toBeLessThanOrEqual(1280)
    await page.mouse.move(5, 5)
    await expect(tip).toHaveCount(0)
  })
})

test.describe('P3-7 · the footer legend lists only keys that act', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Week and Progress carry the global keys only', async ({ page }) => {
    await open(page, TUE, '/week', 'week')
    await expect(page.getByTestId('keys-legend')).toHaveText(GLOBAL)
    await page.goto('/progress')
    await expect(page.getByTestId('screen-progress')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('keys-legend')).toHaveText(GLOBAL)
    for (const key of ['Enter start', 'space timer', 'd done', 's slide', 'Shift+', 'Esc leave Do']) {
      await expect(page.getByTestId('keys-legend')).not.toContainText(key)
    }
  })
})

test.describe('P3-6 · the DSA tile and Evidence', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('a problem ticked on the Board is in the DSA tile and the ring, not in the Do-attempt stats, and Evidence says so', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const p200 = page.getByTestId('card-p200')
    await p200.focus()
    await page.keyboard.press('d')
    await expect.poll(async () => (await tickets(page)).find(t => t.id === 'p200')?.status).toBe('done')
    await page.goto('/dsa')
    await expect(page.getByTestId('dsa-solved')).toContainText('1/169')
    await page.goto('/progress')
    await expect(page.getByTestId('screen-progress')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('ring-dsa-count')).toHaveText(/^1\//)
    await expect(page.getByTestId('ev-dsa-solved-value')).toHaveText('0') // integration I-12: a tick is no Do attempt
    await expect(page.getByTestId('ev-dsa-help-value')).toHaveText('0')
    await expect(page.getByTestId('ev-dsa-ticked')).toHaveText('1 more problem is marked done without a Do attempt, so not counted above.')
  })

  test('with nothing ticked the line is not there', async ({ page }) => {
    await open(page, TUE, '/progress', 'progress')
    await expect(page.getByTestId('ev-dsa-solved-value')).toHaveText('0')
    await expect(page.getByTestId('ev-dsa-ticked')).toHaveCount(0)
  })
})

test.describe('P3-8 · long titles are whole in the data and clamped by CSS', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('no stored title ends in "…"; the long ones show in full as the card\'s title attribute and Week link', async ({ page }) => {
    await open(page, TUE, '/board', 'board')
    const all = await tickets(page)
    expect(all.filter(t => t.title.endsWith('…')).map(t => t.id)).toEqual([])
    const routine = all.find(t => t.id === 'm1w1i1')!
    expect(routine.title).toBe('Set the routine: 25 minutes per problem, no hints until time is up; then study the best solution and re-solve from blank the next day')
    const title = page.getByTestId('card-m1w1i1').locator('.card-title')
    await expect(title).toHaveText(routine.title)
    await expect(title).toHaveAttribute('title', routine.title)
    // the cut is CSS: three lines, then an ellipsis
    expect(await title.evaluate(e => getComputedStyle(e).webkitLineClamp)).toBe('3')
    expect(await title.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true)
    await page.goto('/week')
    await expect(page.getByTestId('day-Thu').getByRole('link', { name: routine.title, exact: true })).toBeVisible()
  })
})

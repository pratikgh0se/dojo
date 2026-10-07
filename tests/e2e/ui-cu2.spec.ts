import { expect, test, type Page } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-2 (dojo-acceptance/reports/uat/cu-2.md, 96c58d5), to controller ruling 24
// (ui-foundation.md): S1 a running study session is visible everywhere, S2 no pace verdict in sprint 1, S3 one source of
// focus minutes, S4 the DSA drawer rows at phone width, and the P3 look fixes.
const T0 = IST('2026-10-06T10:00:00') // Tuesday, sprint 1 day 2 (starts Mon 2026-10-05): interview code, the NOW card is LeetCode 200

async function start(page: Page, time = T0) {
  await page.clock.install({ time })
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
}
const leadId = async (page: Page) => (await page.getByTestId('start-button').getAttribute('href'))!.replace('/do/', '')

/** From Today: Start ▸ opens the NOW card's Do, then Start session there (25 / 5, or a custom focus / break). */
async function startSession(page: Page, goal = 'trace the queue', custom?: { focus: number; brk: number }) {
  await page.getByTestId('start-button').click()
  await expect(page.getByTestId('screen-do')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Start session' }).click()
  const dlg = page.getByRole('dialog', { name: 'Plan this session' })
  await dlg.getByLabel('This session I will').fill(goal)
  if (custom) {
    await dlg.getByRole('radio', { name: 'Custom' }).check()
    await dlg.getByLabel('Focus minutes').fill(String(custom.focus))
    await dlg.getByLabel('Break minutes').fill(String(custom.brk))
  }
  await dlg.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('session-timer')).toBeVisible()
}
const pill = (page: Page) => page.getByTestId('session-pill')
const secs = (s: string | null) => Number(s!.slice(0, 2)) * 60 + Number(s!.slice(3, 5))
const sessionRowId = async (page: Page, ticketId: string) => {
  const rows = await idbAll<{ id: string; ticketId: string; outcome: string }>(page, 'sessions')
  return rows.find(r => r.ticketId === ticketId && r.outcome === 'studied')!.id.replace(/^s-/, '')
}
const pillSecs = async (page: Page) => secs(await page.getByTestId('session-pill-time').textContent())

test.describe('S1 · a running session is visible everywhere', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('leave mid-session and come back: the pill and the NOW tile follow it on every screen, and a click returns to Do', async ({ page }) => {
    await start(page)
    const id = await leadId(page)
    await expect(pill(page)).toHaveCount(0)
    await startSession(page)
    await page.getByTestId('do-back').click() // back to Today
    await expect(page.getByTestId('screen-today')).toBeVisible()
    // Today: the pill under the header, and the NOW tile is the running state, not idle Spar buttons
    await expect(pill(page)).toBeVisible()
    await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus')
    await expect(page.getByTestId('session-pill-title')).toContainText('Number of Islands')
    await expect(page.getByTestId('now-session')).toBeVisible()
    await expect(page.getByTestId('spar-25')).toHaveCount(0)
    await expect(page.getByTestId('now-session-pause')).toBeVisible()
    await expect(page.getByTestId('now-session-end')).toBeVisible()
    const t0 = await pillSecs(page)
    await page.clock.fastForward('02:00')
    await expect.poll(() => pillSecs(page)).toBeLessThanOrEqual(t0 - 119)
    // every other screen, by the app's own navigation
    for (const [key, screen] of [['2', 'board'], ['7', 'progress'], ['8', 'week'], ['3', 'dsa']] as const) {
      await page.keyboard.press(key)
      await expect(page.getByTestId(`screen-${screen}`)).toHaveAttribute('data-ready', 'true')
      await expect(pill(page), `${screen} has the pill`).toBeVisible()
      await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus')
      expect(await pillSecs(page)).toBeLessThan(25 * 60)
    }
    // a click on the pill returns to that card's Do, where the session is still counting
    await page.getByTestId('session-pill-link').click()
    await expect(page).toHaveURL(new RegExp(`/do/${id}$`))
    await expect(page.getByTestId('session-timer')).toBeVisible()
    expect(secs(await page.getByTestId('session-timer').textContent())).toBeLessThan(25 * 60 - 119)
    await expect(pill(page)).toHaveCount(1) // and the card's own Do shows the pill too, with Pause and Resume (UAT cu-2p P3-6)
  })

  test('Pause from the pill holds the session wherever it is; Resume runs it on', async ({ page }) => {
    await start(page)
    await startSession(page)
    await page.keyboard.press('Escape') // leave Do
    await page.keyboard.press('2')
    await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
    await page.clock.fastForward('01:00')
    await page.getByTestId('session-pill-pause').click()
    await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus · paused')
    const held = await pillSecs(page)
    await page.clock.fastForward('05:00')
    expect(await pillSecs(page)).toBe(held)
    await page.getByTestId('session-pill-resume').click()
    await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus')
    await page.clock.fastForward('01:00')
    await expect.poll(() => pillSecs(page)).toBeLessThanOrEqual(held - 59)
  })

  test('a reload during a running session keeps the pill and the clock; a long gap asks Resume or End', async ({ page }) => {
    await start(page)
    await startSession(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await page.clock.fastForward('03:00')
    const before = await pillSecs(page)
    await page.reload()
    await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
    await expect(pill(page)).toBeVisible()
    await expect(page.getByTestId('now-session')).toBeVisible()
    expect(Math.abs((await pillSecs(page)) - before)).toBeLessThanOrEqual(3)
    await expect(page.getByRole('dialog', { name: 'Welcome back' })).toHaveCount(0)
    // a gap of more than two minutes past the block's end parks the session; the pill says Away and the dialog asks
    await page.clock.fastForward('40:00')
    await page.reload()
    await expect(page.getByRole('dialog', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByTestId('session-pill-phase')).toHaveText('Away')
    await page.getByTestId('away-resume').click()
    await expect(page.getByTestId('session-pill-phase')).not.toHaveText('Away')
    await expect(page.getByTestId('session-pill-pause')).toBeVisible()
  })

  test('End in the NOW tile ends the session itself: the End session dialog, one Progress row, no pill, idle Spar buttons', async ({ page }) => {
    await start(page)
    const id = await leadId(page)
    await startSession(page)
    await page.keyboard.press('Escape')
    await page.clock.fastForward('04:00')
    await page.getByTestId('now-session-end').click()
    const dlg = page.getByRole('dialog', { name: 'End session' })
    await dlg.getByRole('textbox', { name: 'Done' }).fill('read the loop')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(pill(page)).toHaveCount(0)
    await expect(page.getByTestId('now-session')).toHaveCount(0)
    await expect(page.getByTestId('spar-25')).toBeVisible()
    await expect(page.getByTestId('now-readout')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('dojo-study'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('dojo-timer'))).toBeNull()
    const rows = await idbAll<{ ticketId: string; outcome: string; endLog?: { done: string } }>(page, 'sessions')
    expect(rows.filter(r => r.outcome === 'studied')).toEqual([expect.objectContaining({ ticketId: id, endLog: expect.objectContaining({ done: 'read the loop' }) })])
    await page.keyboard.press('7')
    await expect(page.locator('[data-testid^="study-session-"]')).toContainText('read the loop')
  })

  test('the space key on Today pauses and resumes the session, and the break stays the running state', async ({ page }) => {
    await start(page)
    await startSession(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('now-session')).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // clean focus, no pointer press
    await page.keyboard.press('Space')
    await expect(page.getByTestId('now-readout')).toHaveAttribute('data-paused', 'true')
    await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus · paused')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('now-readout')).not.toHaveAttribute('data-paused')
    await page.clock.fastForward('25:00')
    await expect(page.getByTestId('session-pill-phase')).toHaveText('Break')
    await expect(page.getByTestId('now-session')).toHaveAttribute('data-phase', 'break')
    await expect(page.getByTestId('spar-25')).toHaveCount(0)
  })
})

for (const width of [375, 393, 834, 1280]) {
  test.describe(`S1 · layout at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('the pill and the running NOW tile fit the screen and the Start ▸ button stays reachable', async ({ page }) => {
      await start(page)
      await startSession(page, 'a goal long enough to matter')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('now-session')).toBeVisible()
      const sw = () => page.evaluate(() => document.documentElement.scrollWidth)
      expect(await sw()).toBeLessThanOrEqual(width)
      for (const id of ['session-pill', 'now-session', 'now-session-pause', 'now-session-end', 'start-button']) {
        const b = (await page.getByTestId(id).boundingBox())!
        expect(b.x, id).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width, id).toBeLessThanOrEqual(width + 0.5)
      }
      if (width < 768) for (const id of ['session-pill-pause', 'now-session-pause', 'now-session-end']) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(43.5)
      if (process.env.DOJO_SHOTS) await page.screenshot({ path: `${process.env.DOJO_SHOTS}/cu2-s1-${width}.png` }) // opt-in, for looking at the layout
      // the pill's title is one line, ending in an ellipsis when it cannot fit, with the pause button never pushed out
      const title = page.getByTestId('session-pill-title')
      expect(await title.evaluate(e => e.scrollWidth >= e.clientWidth)).toBe(true)
      expect(await sw()).toBeLessThanOrEqual(width)
    })
  })
}

test.describe('S2 · the Load check in sprint 1 (cu-2 P2-2)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('one finished 1-minute block is no pace: still Fits, the first-sprint sentence, no slide advice', async ({ page }) => {
    await start(page)
    await expect(page.getByTestId('load-verdict')).toHaveText('Fits')
    await startSession(page, 'one minute', { focus: 1, brk: 1 })
    await page.getByRole('textbox', { name: 'Notes' }).fill('a note, so no "Stuck?" prompt')
    await page.clock.fastForward('01:00')
    await expect(page.getByTestId('session-phase')).toHaveText('Break')
    await page.keyboard.press('Escape') // leave Do
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await expect(page.getByTestId('focus-today')).toHaveText('1 min')
    await expect(page.getByTestId('load-focus')).toHaveText('1 min of real focus in the last 7 days')
    await expect(page.getByTestId('load-verdict')).toHaveText('Fits')
    await expect(page.getByTestId('load-text')).toContainText('Your pace appears here after the first sprint ends.')
    await expect(page.getByTestId('load-text')).not.toContainText('pace of about')
    await expect(page.getByTestId('load-text')).not.toContainText('least important')
    await expect(page.getByTestId('load-row').nth(2)).toContainText('Planned pace')
    await expect(page.getByRole('button', { name: 'Ask what to slide' })).toHaveCount(0)
  })
})

test.describe('S3 · one source of focus minutes (cu-2 P2-6)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('after a session Today, Week and Progress agree, say what they count, and the session row says its own length', async ({ page }) => {
    await start(page)
    const id = await leadId(page)
    await startSession(page)
    // three 25-minute blocks with their two breaks between: 75 focus minutes in 85 minutes on the clock
    for (let i = 0; i < 3; i++) {
      await page.getByRole('textbox', { name: 'Notes' }).fill(`block ${i}`) // progress, so no "Stuck?" prompt
      await page.clock.fastForward('25:00')
      await expect(page.getByTestId('session-phase')).toHaveText('Break')
      if (i < 2) await page.clock.fastForward('05:00')
    }
    // an attempt timer's minutes are not focus: they must not show up in any of the three
    await page.getByRole('button', { name: 'End session' }).click()
    const dlg = page.getByRole('dialog', { name: 'End session' })
    await dlg.getByRole('textbox', { name: 'Done' }).fill('three blocks')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByTestId('hist-length').first()).toContainText('85 min session · 75 min focus')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await expect(page.getByTestId('focus-today')).toHaveText('75 min')
    await expect(page.getByTestId('load-focus')).toHaveText('75 min of real focus in the last 7 days')

    await page.keyboard.press('8')
    await expect(page.getByTestId('screen-week')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('day-meta-Tue')).toHaveText('0 done · 75 min focus')
    if (process.env.DOJO_SHOTS) await page.screenshot({ path: `${process.env.DOJO_SHOTS}/cu2-s3-week.png` })

    await page.keyboard.press('7')
    await expect(page.getByTestId('screen-progress')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('pace-hours')).toHaveText('1.3 h') // 75 min
    await expect(page.getByText('Focus hours')).toBeVisible()
    await expect(page.getByTestId(`study-session-s-${await sessionRowId(page, id)}`)).toBeVisible()
    await expect(page.locator('[data-testid^="study-length"]').first()).toHaveText('85 min session · 75 min focus')
    if (process.env.DOJO_SHOTS) await page.screenshot({ path: `${process.env.DOJO_SHOTS}/cu2-s3-progress.png`, fullPage: true })
  })
})

for (const width of [375, 393]) {
  test.describe(`S4 · the DSA drawer rows at ${width} (cu-2 P2-5)`, () => {
    test.use({ viewport: { width, height: 852 } })

    test('number, title, NeetCode, difficulty chip and Do ▸ sit on one or two clean lines, nothing wraps per digit or overlaps', async ({ page }) => {
      await start(page)
      await page.locator('[data-testid="drawer-dsa"] .drawer-head').click()
      const rows = page.locator('[data-testid="drawer-dsa"] .dig-problem')
      await expect(rows.first()).toBeVisible()
      expect(await rows.count()).toBeGreaterThan(5)
      if (process.env.DOJO_SHOTS) await page.locator('[data-testid="drawer-dsa"]').screenshot({ path: `${process.env.DOJO_SHOTS}/cu2-s4-${width}.png` })
      const bad = await page.evaluate(() => {
        const out: string[] = []
        const rect = (e: Element) => e.getBoundingClientRect()
        const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
        for (const row of document.querySelectorAll<HTMLElement>('[data-testid="drawer-dsa"] .dig-problem')) {
          const name = row.getAttribute('data-testid')
          const r = rect(row)
          const parts = ['.dig-box', '.dig-problem-link', '.dig-nc', '.dig-diff', '.dig-do'].map(sel => [sel, row.querySelector(sel)] as const).filter(([, e]) => e)
          for (const [sel, e] of parts) {
            const b = rect(e!)
            if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) out.push(`${name} ${sel} leaves its row`)
          }
          for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
            if (hit(rect(parts[i][1]!), rect(parts[j][1]!))) out.push(`${name} ${parts[i][0]} overlaps ${parts[j][0]}`)
          }
          const num = row.querySelector('.dig-problem-num')!
          const nb = rect(num)
          if (nb.height > 30) out.push(`${name} number is ${nb.height}px tall (wrapped per digit)`)
          if (row.scrollWidth > row.clientWidth + 0.5) out.push(`${name} scrolls sideways`)
          // two lines at most for the controls under the title: NeetCode, chip and Do ▸ share the lower band
          const meta = row.querySelector('.dig-problem-meta')!
          if (rect(meta).height > 2 * 44 + 4 + 0.5) out.push(`${name} controls take more than two lines`)
          const diff = row.querySelector('.dig-diff')!
          if ((diff as HTMLElement).scrollWidth > (diff as HTMLElement).clientWidth + 0.5) out.push(`${name} chip text is clipped`)
        }
        return out
      })
      expect(bad).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      // tick, link and the row's controls stay 44 px touch targets
      const first = rows.first()
      for (const sel of ['.dig-box', '.dig-nc', '.dig-do']) {
        const el = first.locator(sel).first()
        if (await el.count()) expect((await el.boundingBox())!.height, sel).toBeGreaterThanOrEqual(43.5)
      }
    })
  })
}

test.describe('P3-3 · Consistency labels', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the M, W and F labels sit beside Monday, Wednesday and Friday, and today\'s cell is on today\'s row', async ({ page }) => {
    await start(page) // Tuesday
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // clean focus, no pointer press
    await page.keyboard.press('d') // tick the NOW item: today's cell lights
    await expect(page.getByTestId('cal-total')).toHaveText('1 logged')
    const geo = await page.getByTestId('consistency-cal').evaluate(el => {
      const labels = [...el.querySelectorAll('.cons-label')].filter(t => ['M', 'W', 'F'].includes(t.textContent ?? '')).map(t => ({ l: t.textContent, y: t.getBoundingClientRect().top + t.getBoundingClientRect().height / 2 }))
      const cells = [...el.querySelectorAll('[data-testid="cal-cell"]')].map(r => r.getBoundingClientRect())
      const rowsY = [...new Set(cells.map(c => Math.round(c.top)))].sort((a, b) => a - b)
      const lastCol = Math.max(...cells.map(c => Math.round(c.left)))
      const lit = [...el.querySelectorAll('[data-testid="cal-cell"]')].filter(r => Number((r as HTMLElement).dataset.level) > 0)
      return { labels, rowsY, lastColCells: cells.filter(c => Math.round(c.left) === lastCol).map(c => Math.round(c.top)), litCount: lit.length }
    })
    expect(geo.labels.map(l => l.l)).toEqual(['M', 'W', 'F'])
    expect(geo.rowsY.length).toBe(7)
    // each label is vertically inside the row of its weekday: Monday is row 1, Wednesday row 3, Friday row 5 (Sunday-first)
    const rowOf = (y: number) => geo.rowsY.reduce((best, top, i) => (Math.abs(top - y) < Math.abs(geo.rowsY[best] - y) ? i : best), 0)
    expect(geo.labels.map(l => rowOf(l.y))).toEqual([1, 3, 5])
    // today (Tuesday) is the last column's row 2, right under the M row; Wednesday on is the future
    const week = (JSON.parse((await page.getByTestId('consistency-cal').getAttribute('data'))!) as { weeks: (number | null)[][] }).weeks[7]
    expect(week.slice(0, 4)).toEqual([0, 0, 1, null])
    expect(geo.lastColCells.length).toBe(7)
  })

  // UAT cu-2p P3-2: the grid fills its panel, and every day names itself on hover
  test('the Consistency grid fills its panel and a cell shows its day in a tooltip', async ({ page }) => {
    await start(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // clean focus, no pointer press
    await page.keyboard.press('d')
    await expect(page.getByTestId('cal-total')).toHaveText('1 logged')
    const panel = (await page.locator('.consistency').boundingBox())!
    const grid = (await page.getByTestId('consistency-cal').boundingBox())!
    expect(grid.width, 'the grid spans the panel, not its left third').toBeGreaterThan(panel.width * 0.8)
    const today = page.locator('[data-testid="cal-cell"][data-level="5"]')
    await expect(today).toHaveCount(1)
    await today.hover()
    await expect(page.getByTestId('tip')).toHaveText(/^Tue 2026-10-06 · 1 logged$/, { timeout: 3000 })
    await page.locator('[data-testid="cal-cell"][data-level="0"]').first().hover()
    await expect(page.getByTestId('tip')).toHaveText(/ · nothing logged$/, { timeout: 3000 })
  })
})

test.describe('P3-8 / P3-9 · End session and focus mode keep the reader\'s place', () => {
  test.use({ viewport: { width: 1280, height: 520 } })

  test('Exit focus mode returns the page to where it was (P3-9)', async ({ page }) => {
    await start(page)
    await startSession(page)
    const scrollY = () => page.evaluate(() => Math.round(window.scrollY))
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(max).toBeGreaterThan(200)
    // the place the reader is at when the button is pressed (the click itself may scroll the button into view first)
    const focusBtn = page.getByRole('button', { name: 'Focus mode' })
    await page.evaluate(y => window.scrollTo(0, y), 240)
    await focusBtn.scrollIntoViewIfNeeded()
    const place = await scrollY()
    expect(place).toBeGreaterThanOrEqual(200)
    await focusBtn.click()
    await expect(page.getByTestId('focus-screen')).toBeVisible()
    await page.getByRole('button', { name: 'Exit focus mode' }).click()
    await expect(page.getByTestId('do-screen')).toBeVisible()
    await expect.poll(scrollY).toBe(place)
    // the f key does the same, in and out
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // clean focus, no pointer press
    const placeAgain = await scrollY()
    await page.keyboard.press('f')
    await expect(page.getByTestId('focus-screen')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('do-screen')).toBeVisible()
    await expect.poll(scrollY).toBe(placeAgain)
  })

  test('End session › Keep going keeps what was typed (P3-8)', async ({ page }) => {
    await start(page)
    await startSession(page)
    await page.getByRole('button', { name: 'End session' }).click()
    let dlg = page.getByRole('dialog', { name: 'End session' })
    await dlg.getByRole('textbox', { name: 'Stuck on' }).fill('queue order')
    await dlg.getByRole('button', { name: 'Keep going' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'End session' }).click()
    dlg = page.getByRole('dialog', { name: 'End session' })
    await expect(dlg.getByRole('textbox', { name: 'Stuck on' })).toHaveValue('queue order')
    await expect(dlg.getByText('11 / 280')).toBeVisible()
  })
})

test.describe('P3-15 · the Pom panel matches today-1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('a 96 x 200 avatar well, LV between the label and the next form, a short 12-cube XP row, a panel as tall as its row mates', async ({ page }) => {
    await start(page)
    await expect(page.getByTestId('level')).toBeVisible()
    const g = await page.evaluate(() => {
      const box = (sel: string) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom } }
      const cubes = [...document.querySelectorAll('.pom-next .sr-cube')].map(c => c.getBoundingClientRect())
      const xp = document.querySelector('.pom-xp')!
      return {
        well: box('.pom-stage-well'), stats: box('.pom-stats'), lv: box('[data-testid="level"]'), label: box('[data-testid="form-name"]'), next: box('.pom-next'),
        pom: box('.vitals-pom'), clock: box('.sprint-clock'), cons: box('.consistency'),
        cubes: cubes.map(c => ({ w: c.width, h: c.height, r: c.right })), rowLeft: cubes[0]?.left ?? 0,
        xpColor: getComputedStyle(xp).color, primary: getComputedStyle(document.body).color,
      }
    })
    expect(Math.round(g.well.w)).toBe(96)
    expect(Math.round(g.well.h)).toBe(200)
    expect(g.cubes).toHaveLength(12)
    expect(g.cubes.every(c => Math.round(c.w) === 10 && Math.round(c.h) === 10)).toBe(true)
    expect(g.cubes[11].r - g.rowLeft).toBeLessThan(150) // a short row, not the panel's width (223)
    // LV sits in the middle of the 200 px column, between the label and the next-form block
    const mid = g.stats.y + g.stats.h / 2
    expect(Math.abs(g.lv.y + g.lv.h / 2 - mid)).toBeLessThanOrEqual(12)
    expect(g.lv.y).toBeGreaterThan(g.label.b + 8)
    expect(g.next.y).toBeGreaterThan(g.lv.b + 8)
    // the panel is no taller than the mockup's (200 + padding and border), and its row mates are the same height
    expect(g.pom.h).toBeLessThanOrEqual(250)
    expect(Math.round(g.clock.h)).toBe(Math.round(g.pom.h))
    expect(Math.round(g.cons.h)).toBe(Math.round(g.pom.h))
    expect(g.xpColor).toBe(g.primary)
  })
})

for (const width of [375, 360]) {
  test.describe(`P3-17 · focus mode at ${width}`, () => {
    test.use({ viewport: { width, height: 852 } })

    test('End session and Exit focus mode share a row (360 is a 375 window with a classic scrollbar)', async ({ page }) => {
      await start(page)
      await startSession(page, 'Watch chapters and predict')
      await page.getByRole('button', { name: 'Focus mode' }).click()
      await expect(page.getByTestId('focus-screen')).toBeVisible()
      const [a, b] = await Promise.all(['End session', 'Exit focus mode'].map(async n => (await page.getByRole('button', { name: n }).boundingBox())!))
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1)
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
      expect(b.x + b.width).toBeLessThanOrEqual(width - 16 + 0.5)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  })
}

test.describe('P3-14 · "This attempt" keeps the minutes before a Today pause', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Spar 3 min, pause 2 min, resume 1 min, then Do: 4 minutes, not 1', async ({ page }) => {
    await start(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // clean focus, no pointer press
    await page.keyboard.press('Space') // Spar · 25 starts
    await expect(page.getByTestId('now-readout')).toBeVisible()
    await page.clock.fastForward('03:00')
    await page.keyboard.press('Space') // pause
    await expect(page.getByTestId('now-readout')).toHaveAttribute('data-paused', 'true')
    await page.clock.fastForward('02:00')
    await page.keyboard.press('Space') // resume
    await expect(page.getByTestId('now-readout')).not.toHaveAttribute('data-paused')
    await page.clock.fastForward('01:00')
    await page.getByTestId('start-button').click()
    await expect(page.getByTestId('screen-do')).toHaveAttribute('data-ready', 'true')
    const seconds = Number(await page.getByTestId('do-timer-elapsed').first().getAttribute('data-seconds'))
    expect(seconds).toBeGreaterThanOrEqual(238)
    expect(seconds).toBeLessThanOrEqual(246)
  })
})

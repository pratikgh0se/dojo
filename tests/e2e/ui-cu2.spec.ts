import { expect, test, type Page } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-2 (dojo-acceptance/reports/uat/cu-2.md, 96c58d5), to controller ruling 24
// (ui-foundation.md): S1 a running study session is visible everywhere, S2 no pace verdict early on, S3 one source of focus
// minutes, S4 rows at phone width, and the P3 look fixes. R1 follows the contracts: Start on Today (`start-button`, TODAY-24) opens
// the quest's ticket view with its one timer already running (TICKET-04); a session is one block of the remembered length and
// stops at zero (TICKET-09); the session pill stays under the header of Today, Path, Skills and Review; the Plan-this-session
// dialog, the NOW tile, the Load check, the Consistency grid, Week, Progress and the Pom panel are retired (README "Retired hooks").
const T0 = IST('2026-10-06T10:00:00') // Tuesday: the quest is the first watch ticket (budget 60)

async function start(page: Page, time = T0) {
  await page.clock.install({ time })
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
}
type Row = { id: string; kind: string; status: string }
const leadId = async (page: Page) => (await page.getByTestId('today-quest').getAttribute('data-ticket-id'))!
const problemId = async (page: Page) => (await idbAll<Row>(page, 'tickets')).find(t => t.kind === 'problem' && t.status === 'todo')!.id

/** From Today: Start opens the quest's ticket view with the timer running at the remembered length. */
async function startSession(page: Page) {
  await page.getByTestId('start-button').click()
  await expect(page.getByTestId('screen-do')).toBeVisible()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
}
/** Starts a not-started problem ticket from its own page (its help ladder, code panel and "This attempt" line stay, TICKET-25). */
async function startProblem(page: Page): Promise<string> {
  const id = await problemId(page)
  await page.goto(`/do/${id}`)
  await expect(page.getByTestId('screen-do')).toBeVisible()
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  return id
}
const pill = (page: Page) => page.getByTestId('session-pill')
const secs = (s: string | null) => Number(s!.slice(0, 2)) * 60 + Number(s!.slice(3, 5))
const pillSecs = async (page: Page) => secs(await page.getByTestId('session-pill-time').textContent())

test.describe('S1 · a running session is visible everywhere', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('leave mid-session and come back: the pill follows it on every destination, Today offers RESUME, and a click on the pill returns to the ticket', async ({ page }) => {
    await start(page)
    const id = await leadId(page)
    const title = (await page.getByTestId('today-title').textContent())!
    await expect(pill(page)).toHaveCount(0)
    await startSession(page)
    await page.getByTestId('do-back').click() // back to Today
    await expect(page.getByTestId('screen-today')).toBeVisible()
    // Today: the pill under the header, and the quest card is the started ticket (TODAY-03), not a fresh start
    await expect(pill(page)).toBeVisible()
    await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus')
    await expect(page.getByTestId('session-pill-title')).toContainText(title)
    await expect(page.getByTestId('today-quest')).toHaveAttribute('data-action', 'resume')
    await expect(page.getByTestId('start-button')).toHaveText(/^RESUME · \d\d:\d\d$/)
    await expect(page.getByTestId('session-pill-pause')).toBeVisible()
    const t0 = await pillSecs(page)
    await page.clock.fastForward('02:00')
    await expect.poll(() => pillSecs(page)).toBeLessThanOrEqual(t0 - 119)
    // every other destination, by the app's own keys 2 to 4 and back to Today on 1 (SHELL-02)
    for (const [key, screen] of [['2', 'path'], ['5', 'skills'], ['6', 'review'], ['1', 'today']] as const) {
      await page.keyboard.press(key)
      await expect(page.getByTestId(`screen-${screen}`)).toBeVisible()
      await expect(pill(page), `${screen} has the pill`).toBeVisible()
      await expect(page.getByTestId('session-pill-phase')).toHaveText('Focus')
      expect(await pillSecs(page)).toBeLessThan(25 * 60)
    }
    // a click on the pill returns to that ticket, where the session is still counting
    await page.getByTestId('session-pill-link').click()
    await expect(page).toHaveURL(new RegExp(`/do/${id}$`))
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    expect(secs(await page.getByTestId('timer-readout').textContent())).toBeLessThan(25 * 60 - 119)
  })

  test('Pause from the pill holds the session wherever it is; Resume runs it on', async ({ page }) => {
    await start(page)
    await startSession(page)
    await page.keyboard.press('2') // Path
    await expect(page.getByTestId('screen-path')).toBeVisible()
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

  test('a reload during a running session keeps the pill and the clock; a long gap leaves the session at zero, waiting', async ({ page }) => {
    await start(page)
    await startSession(page)
    await page.getByTestId('do-back').click()
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await page.clock.fastForward('03:00')
    const before = await pillSecs(page)
    await page.reload()
    await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
    await expect(pill(page)).toBeVisible()
    await expect(page.getByTestId('today-quest')).toHaveAttribute('data-action', 'resume')
    expect(Math.abs((await pillSecs(page)) - before)).toBeLessThanOrEqual(3)
    await expect(page.getByRole('dialog', { name: 'Welcome back' })).toHaveCount(0)
    // a single session never parks as "away": a long gap leaves it at zero, waiting (TICKET-09), with nothing to ask and nothing marked done
    await page.clock.fastForward('40:00')
    await page.reload()
    await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByRole('dialog', { name: 'Welcome back' })).toHaveCount(0)
    await expect(pill(page)).toBeVisible()
    await expect(page.getByTestId('session-pill-time')).toHaveText('00:00')
    await expect(page.getByTestId('session-pill-pause')).toHaveCount(0)
    await page.getByTestId('session-pill-link').click()
    await expect(page.getByTestId('ticket-time-up')).toHaveText('Time is up. Keep going or finish.')
    await expect(page.getByTestId('timer-state')).toHaveText('over')
    await expect(page.getByTestId('ticket-done')).toBeVisible()
  })

  test('End on the ticket ends the session itself: the End session dialog, one session row, no pill, the ticket stays started', async ({ page }) => {
    await start(page)
    const id = await leadId(page)
    await startSession(page)
    await page.clock.fastForward('04:00')
    await page.getByTestId('timer-end').click()
    const dlg = page.getByRole('dialog', { name: 'End session' })
    await dlg.getByRole('textbox', { name: 'Done' }).fill('read the loop')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(pill(page)).toHaveCount(0)
    await expect(page.getByTestId('timer-state')).toHaveText('ready')
    expect(await page.evaluate(() => localStorage.getItem('dojo-study'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('dojo-timer'))).toBeNull()
    const rows = await idbAll<{ ticketId: string; outcome: string; endLog?: { done: string } }>(page, 'sessions')
    expect(rows.filter(r => r.outcome === 'studied')).toEqual([expect.objectContaining({ ticketId: id, endLog: expect.objectContaining({ done: 'read the loop' }) })])
    // ending a session finishes no ticket: it is still started, and Today offers it again (TODAY-03), without a clock
    expect((await idbAll<Row>(page, 'tickets')).find(t => t.id === id)?.status).toBe('doing')
    await page.getByTestId('do-back').click()
    await expect(page.getByTestId('today-quest')).toHaveAttribute('data-action', 'resume')
    await expect(page.getByTestId('start-button')).toHaveText('RESUME · WATCH')
  })

  test('on a problem the space key pauses and resumes the session, and at zero it stops and waits', async ({ page }) => {
    await start(page)
    await startProblem(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // clean focus, no pointer press
    await page.keyboard.press('Space')
    await expect(page.getByTestId('timer-state')).toHaveText('paused')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    await page.clock.fastForward('25:00')
    await expect(page.getByTestId('ticket-time-up')).toHaveText('Time is up. Keep going or finish.')
    await expect(page.getByTestId('timer-state')).toHaveText('over')
    await expect(page.getByTestId('timer-readout')).toHaveText('00:00')
  })
})

for (const width of [375, 393, 834, 1280]) {
  test.describe(`S1 · layout at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('the pill and the quest card fit the screen, and the RESUME button stays reachable', async ({ page }) => {
      await start(page)
      await startSession(page)
      await page.getByTestId('do-back').click()
      await expect(pill(page)).toBeVisible()
      const sw = () => page.evaluate(() => document.documentElement.scrollWidth)
      expect(await sw()).toBeLessThanOrEqual(width)
      for (const id of ['session-pill', 'session-pill-pause', 'today-quest', 'start-button', 'today-pick-else']) {
        const b = (await page.getByTestId(id).boundingBox())!
        expect(b.x, id).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width, id).toBeLessThanOrEqual(width + 0.5)
      }
      if (width < 768) for (const id of ['session-pill-pause', 'start-button']) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(43.5)
      if (process.env.DOJO_SHOTS) await page.screenshot({ path: `${process.env.DOJO_SHOTS}/cu2-s1-${width}.png` }) // opt-in, for looking at the layout
      // the pill's title is one line, with the pause button never pushed out
      const title = page.getByTestId('session-pill-title')
      expect(await title.evaluate(e => e.getBoundingClientRect().height)).toBeLessThan(30)
      expect(await sw()).toBeLessThanOrEqual(width)
    })
  })
}

test.describe('S2 · no pace verdict early on (cu-2 P2-2; the Load check itself is retired)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('one finished 5-minute session (the shortest length) counts as five focus minutes and the pace line stays the plan-end sentence, with no verdict or slide advice', async ({ page }) => {
    await start(page)
    await page.goto('/settings')
    await expect(page.getByTestId('screen-settings')).toBeVisible()
    await page.getByTestId('settings-session-minutes').fill('5') // the remembered length, the shortest one (SET-06)
    await expect.poll(async () => (await idbAll<{ sessionMinutes?: number }>(page, 'settings'))[0]?.sessionMinutes).toBe(5)
    await page.goto('/')
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await startSession(page)
    await expect(page.getByTestId('timer-readout')).toHaveText(/^0[45]:\d\d$/)
    await page.clock.fastForward('05:00')
    await expect(page.getByTestId('ticket-time-up')).toBeVisible()
    await page.getByTestId('timer-end').click()
    const dlg = page.getByRole('dialog', { name: 'End session' })
    await dlg.getByRole('textbox', { name: 'Done' }).fill('five minutes')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByTestId('do-back').click()
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await page.getByTestId('today-stats-toggle').click()
    await expect(page.getByTestId('today-stats')).toContainText('Focus today 5 of 60 min')
    const pace = await page.getByTestId('today-stats-pace').textContent()
    expect(pace).toMatch(/^at this pace the plan ends about [A-Z][a-z]+ \d{4}$/i)
    const text = (await page.getByTestId('screen-today').innerText()).toLowerCase()
    for (const word of ['behind', 'late', 'overdue', 'slide', 'least important', 'pace of about', 'load check']) expect(text, word).not.toContain(word)
  })
})

test.describe('S3 · one source of focus minutes (cu-2 P2-6)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('after a session the ticket\'s history and Today\'s Stats agree, say what they count, and the session row says its own length', async ({ page }) => {
    await start(page)
    const id = await startProblem(page)
    // one 25-minute block, run to zero
    await page.clock.fastForward('25:00')
    await expect(page.getByTestId('ticket-time-up')).toBeVisible()
    await page.getByRole('button', { name: 'End session' }).first().click()
    const dlg = page.getByRole('dialog', { name: 'End session' })
    await dlg.getByRole('textbox', { name: 'Done' }).fill('one block')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByTestId('hist-length').first()).toContainText('25 min session · 25 min focus')
    const events = (await idbAll<{ t: string; minutes?: number }>(page, 'events')).filter(e => e.t === 'focus')
    expect(events.map(e => e.minutes)).toEqual([25])
    const sessions = await idbAll<{ ticketId: string; focusMinutes?: number }>(page, 'sessions')
    expect(sessions.find(s => s.ticketId === id)?.focusMinutes).toBe(25)

    await page.keyboard.press('Escape') // leave Do (a problem page keeps Esc)
    await expect(page.getByTestId('screen-today')).toBeVisible()
    await page.getByTestId('today-stats-toggle').click()
    await expect(page.getByTestId('today-stats')).toContainText('Focus today 25 of 60 min')
  })
})

for (const width of [375, 393]) {
  test.describe(`S4 · the pick list rows at ${width} (cu-2 P2-5; the DSA drawer is retired)`, () => {
    test.use({ viewport: { width, height: 852 } })

    test('title, lane and minutes sit inside their row, nothing overlaps, and the page does not scroll sideways', async ({ page }) => {
      await start(page)
      await page.getByTestId('today-pick-else').click()
      const rows = page.locator('[data-testid^="today-pick-item-"]')
      await expect(rows.first()).toBeVisible()
      expect(await rows.count()).toBeGreaterThan(5)
      if (process.env.DOJO_SHOTS) await page.getByTestId('today-pick-list').screenshot({ path: `${process.env.DOJO_SHOTS}/cu2-s4-${width}.png` })
      const bad = await page.evaluate(() => {
        const out: string[] = []
        const rect = (e: Element) => e.getBoundingClientRect()
        const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
        for (const row of document.querySelectorAll<HTMLElement>('[data-testid^="today-pick-item-"]')) {
          const name = row.getAttribute('data-testid')
          const r = rect(row)
          const parts = [...row.children].map((e, i) => [`child ${i}`, e] as const)
          for (const [sel, e] of parts) {
            const b = rect(e)
            if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) out.push(`${name} ${sel} leaves its row`)
          }
          for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
            if (hit(rect(parts[i][1]), rect(parts[j][1]))) out.push(`${name} ${parts[i][0]} overlaps ${parts[j][0]}`)
          }
          if (row.scrollWidth > row.clientWidth + 0.5) out.push(`${name} scrolls sideways`)
        }
        return out
      })
      expect(bad).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      // a row stays a comfortable touch target
      expect((await rows.first().boundingBox())!.height).toBeGreaterThanOrEqual(36)
    })
  })
}

test.describe('P3-8 / P3-9 · End session and focus mode keep the reader\'s place', () => {
  test.use({ viewport: { width: 1280, height: 520 } })

  test('Exit focus mode returns the page to where it was (P3-9)', async ({ page }) => {
    await start(page)
    await startSession(page)
    const scrollY = () => page.evaluate(() => Math.round(window.scrollY))
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(max).toBeGreaterThan(200)
    // the place the reader is at when the key is pressed
    await page.evaluate(y => window.scrollTo(0, y), 240)
    const place = await scrollY()
    expect(place).toBeGreaterThanOrEqual(200)
    await page.keyboard.press('f') // TICKET-29
    await expect(page.getByTestId('focus-screen')).toBeVisible()
    await page.getByTestId('focus-exit').click()
    await expect(page.getByTestId('do-screen')).toBeVisible()
    await expect.poll(scrollY).toBe(place)
    // F and Esc do the same, in and out
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
    await page.getByTestId('timer-end').click()
    let dlg = page.getByRole('dialog', { name: 'End session' })
    await dlg.getByRole('textbox', { name: 'Stuck on' }).fill('queue order')
    await dlg.getByRole('button', { name: 'Keep going' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    await page.getByTestId('timer-end').click()
    dlg = page.getByRole('dialog', { name: 'End session' })
    await expect(dlg.getByRole('textbox', { name: 'Stuck on' })).toHaveValue('queue order')
    await expect(dlg.getByText('11 / 280')).toBeVisible()
  })
})

for (const width of [375, 360]) {
  test.describe(`P3-17 · focus mode at ${width}`, () => {
    test.use({ viewport: { width, height: 852 } })

    test('End session and Exit focus mode share a row (360 is a 375 window with a classic scrollbar)', async ({ page }) => {
      await start(page)
      await startSession(page)
      await page.keyboard.press('f')
      await expect(page.getByTestId('focus-screen')).toBeVisible()
      const [a, b] = await Promise.all(['End session', 'Exit focus mode'].map(async n => (await page.getByRole('button', { name: n }).boundingBox())!))
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1)
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
      expect(b.x + b.width).toBeLessThanOrEqual(width - 16 + 0.5)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  })
}

test.describe('P3-14 · "This attempt" keeps the minutes before a pause', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('on a problem: 3 min, pause 2 min, resume 1 min: 4 minutes, not 1', async ({ page }) => {
    await start(page)
    await startProblem(page)
    await page.clock.fastForward('03:00')
    await page.getByTestId('timer-pause').click()
    await expect(page.getByTestId('timer-state')).toHaveText('paused')
    await page.clock.fastForward('02:00')
    await page.getByTestId('timer-resume').click()
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    await page.clock.fastForward('01:00')
    await expect.poll(async () => Number(await page.getByTestId('do-timer-elapsed').first().getAttribute('data-seconds'))).toBeGreaterThanOrEqual(238)
    expect(Number(await page.getByTestId('do-timer-elapsed').first().getAttribute('data-seconds'))).toBeLessThanOrEqual(246)
  })
})

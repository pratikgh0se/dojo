import { expect, test, type Page } from './fixtures'
import { IST, idbAll, onboard } from './helpers'
import { ownTextElements } from './type-scan'

// ux spec section 3 (the study session), contract UX-06..UX-11, on a fake clock: time flows, and
// fastForward jumps it (the app derives every phase from the wall clock, so a jump credits the block).
// R1 (docs/contracts/ticket-view.md, today-and-shell.md): a session IS the ticket's one timer. Start (`start-button` on Today, `ticket-start` on the
// ticket) begins ONE block of the remembered length (`sessionMinutes`, 25 here) that stops at zero and waits (TICKET-09). There is no Plan-this-session
// dialog, no goal field, no 25/5 or custom cycle, no break or Long break, no "Stuck?" prompt and no "Welcome back" dialog (a single block never
// parks as away); the focus minutes are read in Today's Stats drawer (`today-stats`, "Focus today N of M min", TODAY-25) instead of `focus-today`.
const T0 = IST('2026-10-06T21:10:00')
const PHASE_MIN = 25

type Row = { id: string; kind: string; status: string }

async function begin(page: Page) {
  await page.clock.install({ time: T0 })
  await onboard(page, '2026-10-05')
  await expect(page.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
}
/** From Today: Start opens the quest's ticket view with its one timer running (TICKET-04). */
async function startQuest(page: Page) {
  await page.getByTestId('start-button').click()
  await expect(page.getByTestId('screen-do')).toBeVisible()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
}
/** The problem kind keeps the session panel, the brief, the help ladder and the End session dialog around the one timer (TICKET-25). */
async function openProblem(page: Page): Promise<string> {
  // Number of Islands (p200) when the plan has it: its statement is plain text, so the readability scan has no 12 px <sup> to trip on
  const todo = (await idbAll<Row>(page, 'tickets')).filter(t => t.kind === 'problem' && t.status === 'todo')
  const id = (todo.find(t => t.id === 'p200') ?? todo[0]!).id
  await page.goto(`/do/${id}`)
  await expect(page.getByTestId('screen-do')).toBeVisible()
  return id
}
async function startProblem(page: Page): Promise<string> {
  const id = await openProblem(page)
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  return id
}
const secs = (s: string | null) => Number(s!.slice(0, 2)) * 60 + Number(s!.slice(3, 5))
const focusEvents = async (page: Page) => (await idbAll<{ t: string; minutes?: number }>(page, 'events')).filter(e => e.t === 'focus').map(e => e.minutes)
const studied = async (page: Page) => (await idbAll<{ outcome: string }>(page, 'sessions')).filter(s => s.outcome === 'studied').length
/** Today's Stats drawer reading of the focus minutes (TODAY-25); opened once. */
async function focusToday(page: Page): Promise<string> {
  const stats = page.getByTestId('today-stats')
  if (!(await stats.isVisible())) await page.getByTestId('today-stats-toggle').click()
  return ((await stats.textContent()) ?? '').match(/Focus today (\d+) of (\d+) min/)?.[1] ?? 'none'
}
async function endSession(page: Page) {
  await page.getByTestId('timer-end').click()
  await page.getByRole('dialog', { name: 'End session' }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog', { name: 'End session' })).toBeHidden()
}

test('UX-06: Start begins the one timer with the card beside it; no plan dialog', async ({ page }) => {
  await begin(page)
  await openProblem(page)
  await expect(page.getByTestId('session-panel')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Start session/ })).toHaveCount(0)
  await page.getByTestId('ticket-start').click()
  await expect(page.getByRole('dialog')).toHaveCount(0) // TICKET-36: no "Plan this session"
  await expect(page.getByTestId('session-phase')).toHaveText('Focus')
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  await expect(page.getByTestId('timer-readout')).toHaveCount(1) // TICKET-08
  await expect(page.getByTestId('timer-readout')).toHaveText(/^2[45]:\d\d$/)
  const brief = page.getByTestId('session-brief')
  await expect(brief).toBeVisible()
  await expect(brief).toContainText((await page.getByTestId('do-title').textContent())!)
  await expect(page.getByTestId('session-panel')).toBeVisible()
})

test('UX-07/UX-11: the block is credited in full as focus minutes, the timer stops and waits, no XP', async ({ page }) => {
  await begin(page)
  const xp0 = await page.getByTestId('xp-total').getAttribute('data-value')
  expect(await focusToday(page)).toBe('0')
  await startQuest(page)
  await page.clock.fastForward('24:00')
  await expect(page.getByTestId('timer-state')).toHaveText('running')
  expect(await focusEvents(page)).toEqual([])
  await page.clock.fastForward('01:05')
  await expect(page.getByTestId('timer-state')).toHaveText('over') // no break phase: it stops at zero and waits (TICKET-09)
  await expect(page.getByTestId('timer-readout')).toHaveText('00:00')
  await expect(page.getByTestId('ticket-time-up')).toBeVisible()
  await expect(page.getByTestId('session-phase')).toHaveText('Focus')
  await page.clock.fastForward('30:00') // nothing follows: no break, no second block
  expect(await focusEvents(page)).toEqual([PHASE_MIN])
  await page.goto('/')
  expect(await focusToday(page)).toBe('25')
  await expect(page.getByTestId('xp-total')).toHaveAttribute('data-value', xp0!)
})

for (const kind of ['problem', 'watch'] as const) {
  test(`UX-08 (${kind}): F opens focus mode with only the brief, timer, Notes and two buttons; Esc leaves it and the timer runs on`, async ({ page }) => {
    await begin(page)
    if (kind === 'problem') await startProblem(page)
    else await startQuest(page)
    const title = (await page.getByTestId('do-title').textContent())!
    await page.keyboard.press('f')
    await expect(page.getByTestId('focus-screen')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Exit focus mode' })).toBeVisible()
    await expect(page.getByTestId('session-brief')).toContainText(title)
    await expect(page.getByTestId('focus-timer')).toHaveText(/^\d\d:\d\d$/)
    await expect(page.getByRole('textbox', { name: 'Notes' })).toBeVisible()
    await expect(page.getByTestId('session-notes')).toBeFocused() // UX-17: entering focus mode puts the cursor in Notes
    // the shell keeps its rail and 48 px header around a ticket (shell.css `.sh-main[data-work]`), so "only" is scoped to the focus screen itself
    const focus = page.getByTestId('focus-screen')
    const buttons = await focus.getByRole('button').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => e.textContent))
    expect(buttons.sort()).toEqual(['End session', 'Exit focus mode'])
    await expect(focus.getByRole('link')).toHaveCount(0)
    if (kind === 'problem') await expect(page.getByTestId('ladder')).toBeHidden() // mounted underneath, not visible
    await page.clock.fastForward('01:00')
    const t1 = secs(await page.getByTestId('focus-timer').textContent())
    await page.getByTestId('session-notes').fill('typed in focus mode')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('focus-screen')).toHaveCount(0)
    await expect(page.getByTestId('do-back')).toBeVisible()
    await expect(page).toHaveURL(/\/do\/[^/]+$/)
    await page.clock.fastForward('01:00')
    const t2 = secs(await page.getByTestId('timer-readout').textContent())
    expect(t1 - t2).toBeGreaterThanOrEqual(58)
    await expect(page.getByTestId('timer-state')).toHaveText('running')
    // TICKET-29 gives focus mode one door in, the F key (the ticket view has no "Focus mode" button), and two out
    await page.keyboard.press('f')
    await expect(page.getByTestId('focus-screen')).toBeVisible()
    await expect(page.getByTestId('session-notes')).toHaveValue('typed in focus mode')
    await page.getByTestId('focus-exit').click()
    await expect(page.getByTestId('do-back')).toBeVisible()
  })
}

// R1 polish (TICKET-29): focus mode hides the rail (desktop) and the tab bar (phone) and has one main landmark; Esc and focus-exit bring them back.
for (const [name, viewport, nav] of [['desktop', { width: 1280, height: 800 }, 'shell-rail'], ['phone', { width: 375, height: 667 }, 'shell-tabbar']] as const) {
  test(`focus mode hides the ${nav} on ${name}; Esc and focus-exit restore it; one main landmark`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await begin(page)
    await startQuest(page)
    await expect(page.getByTestId(nav)).toBeVisible()
    for (const leave of ['escape', 'exit'] as const) {
      await page.keyboard.press('f')
      await expect(page.getByTestId('focus-screen')).toBeVisible()
      await expect(page.getByTestId(nav)).toBeHidden()
      await expect(page.locator('main')).toHaveCount(1)
      await expect(page.getByTestId('focus-screen')).toHaveAttribute('aria-label', 'Focus')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      if (leave === 'escape') await page.keyboard.press('Escape')
      else await page.getByTestId('focus-exit').click()
      await expect(page.getByTestId('focus-screen')).toHaveCount(0)
      await expect(page.getByTestId(nav)).toBeVisible()
    }
  })
}

test('readability holds in every session state: not started, running, focus mode, time up and the end dialog', async ({ page }) => {
  await begin(page)
  const bad = async (label: string) => {
    const els = await ownTextElements(page)
    const tiny = els.filter(e => e.size < 14).map(e => `${e.tag}.${e.cls} "${e.text}" ${e.size}px`)
    const pixel = els.filter(e => /^"?Silkscreen/.test(e.family) && ![16, 24, 32, 48].includes(e.size)).map(e => `${e.tag}.${e.cls} ${e.size}px`)
    expect([label, tiny, pixel]).toEqual([label, [], []])
  }
  await openProblem(page)
  await bad('not started')
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('session-panel')).toBeVisible()
  await bad('session panel')
  // ui-do D4 / ruling 10: the ladder's rung notes are Chivo 15 secondary descriptions, not reading paragraphs
  const ps = (await ownTextElements(page)).filter(e => e.tag === 'p' && e.cls !== 'rung-note')
  for (const p of ps) expect([p.cls, /^"?Chivo/.test(p.family), p.size >= 17, p.lh >= 1.5 * p.size - 0.01]).toEqual([p.cls, true, true, true])
  await page.keyboard.press('f')
  await expect(page.getByTestId('focus-screen')).toBeVisible()
  await bad('focus mode')
  await page.keyboard.press('Escape')
  await page.clock.fastForward('25:05')
  await expect(page.getByTestId('ticket-time-up')).toBeVisible()
  await bad('time is up')
  await page.getByTestId('session-end').click() // the problem screen carries End session in the timer card's button row (Do.tsx `trailing`)
  await expect(page.getByRole('dialog', { name: 'End session' })).toBeVisible()
  await bad('end dialog')
})

test('UX-12: the session runs on every screen: Today reads 25 focus minutes without returning to the ticket', async ({ page }) => {
  await begin(page)
  await startQuest(page)
  await page.getByTestId('ticket-notes').fill('some progress')
  await page.goto('/path')
  await expect(page.getByTestId('screen-path')).toBeVisible()
  await expect(page.getByTestId('session-pill')).toBeVisible()
  await page.keyboard.press('1') // Today (SHELL-02)
  await expect(page.getByTestId('screen-today')).toBeVisible()
  expect(await focusToday(page)).toBe('0')
  await page.clock.fastForward('25:00')
  await expect.poll(() => focusToday(page)).toBe('25')
  await page.clock.fastForward('05:00')
  await page.clock.fastForward('25:00') // no break, no second block: the figure stays at the one block
  await expect.poll(() => focusToday(page)).toBe('25')
  expect(await focusEvents(page)).toEqual([PHASE_MIN])
})

test('UX-13: two tabs on one session credit the block once; after one ends it the other never brings it back', async ({ context, page }) => {
  await begin(page)
  await startQuest(page)
  const other = await context.newPage() // same context: same clock, same storage, same locks
  await other.goto('/')
  await expect(other.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  expect(await focusToday(other)).toBe('0')
  await page.clock.fastForward('25:05')
  await expect.poll(() => focusToday(other)).toBe('25')
  expect(await focusEvents(page)).toEqual([PHASE_MIN])
  await endSession(page)
  await expect(page.getByTestId('timer-state')).toHaveText('ready') // the stored session is gone; the ticket stays doing
  await page.clock.fastForward('30:00')
  await other.reload()
  await expect(other.getByTestId('screen-today')).toHaveAttribute('data-ready', 'true')
  expect(await focusToday(other)).toBe('25')
  await expect(other.getByTestId('session-pill')).toHaveCount(0)
  expect(await studied(page)).toBe(1)
  expect(await other.evaluate(() => localStorage.getItem('dojo-study'))).toBeNull()
})

test('UX-14: a sleep gap credits the block once and leaves the session stopped at zero, never behind "Welcome back"', async ({ page }) => {
  await begin(page)
  await startQuest(page)
  await page.clock.fastForward('05:00:00')
  await expect(page.getByTestId('timer-state')).toHaveText('over')
  await expect(page.getByTestId('timer-readout')).toHaveText('00:00')
  await expect(page.getByTestId('ticket-time-up')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await focusEvents(page)).toEqual([PHASE_MIN]) // the block is credited at its own length, not the five hours slept
  await page.clock.fastForward('01:00:00')
  expect(await focusEvents(page)).toEqual([PHASE_MIN]) // and only once
  await endSession(page)
  await expect.poll(() => studied(page)).toBe(1)
})

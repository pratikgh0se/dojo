import { expect, test, type Page } from './fixtures'
import { dojoBaseUrl } from '../../dojoPort'
import { IST, onboard } from './helpers'

const T0 = IST('2026-10-06T21:10:00')
const FONTS = new Set<string>() // fonts are self-hosted (public/fonts): no third-party origin is allowed

/** C-LADDER §8: no request leaves BASE_URL (fonts are self-hosted; never the helper in fake mode). */
function offOrigin(page: Page): string[] {
  const own = new URL(test.info().project.use.baseURL ?? dojoBaseUrl(process.env)).origin
  const bad: string[] = []
  page.on('request', r => {
    const u = new URL(r.url())
    if (u.protocol === 'data:' || u.protocol === 'blob:') return
    if (u.origin !== own && !FONTS.has(u.origin)) bad.push(r.url())
  })
  return bad
}

async function start(page: Page, time = T0) {
  await page.clock.install({ time })
  await onboard(page, '2026-10-05')
}
async function toHint(page: Page) {
  await page.goto('/do/p200')
  await page.getByTestId('do-timer-preset-25').click()
  // Starting the timer writes to IndexedDB (startDoing) before the timer state flips to running;
  // wait for that real (non-clock) completion so the fast-forward below counts from a timer that
  // has actually started, not from the still-idle state the click leaves behind for a few ms.
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.clock.fastForward('10:00')
}
const spent = (page: Page) => page.getByTestId('ladder-spent')

test('H-01…H-09 climb the ladder on p200, reload keeps the cycle, Give up unlocks Solution', async ({ page }) => {
  const bad = offOrigin(page)
  await start(page)
  await page.goto('/do/p200')
  await expect(page.getByRole('region', { name: 'Help ladder' })).toBeVisible()
  await expect(page.getByTestId('ladder-open-solution')).toHaveAccessibleName('Solution, locked until you give up')
  await page.getByTestId('do-timer-preset-25').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.clock.fastForward('09:59')
  await expect(page.getByTestId('ladder-open-hint')).toHaveAccessibleName('Hint, locked, costs 2 xp')
  await page.clock.fastForward('00:01')
  await expect(page.getByTestId('ladder-open-hint')).toHaveAccessibleName('Open Hint, costs 2 xp')
  await expect(page.getByTestId('ladder-announcer')).toHaveText('Hint unlocked, costs 2 xp')
  await page.getByTestId('ladder-open-hint').click()
  await expect(page.getByTestId('ladder-hint-1')).toContainText('[fake:hint]')
  await expect(spent(page)).toHaveAttribute('data-xp', '2')
  await expect(page.getByTestId('ladder-why-hint')).toHaveText('Why did I pay for this? Hint cost 2 xp.')
  await page.getByTestId('ladder-open-picture').click()
  await expect(page.getByTestId('ladder-picture-player')).toHaveAttribute('data-source', 'model')
  await page.getByTestId('ladder-open-video').click()
  await expect(page.getByTestId('ladder-video-links').getByRole('link', { name: 'NeetCode solution' })).toHaveAttribute('href', 'https://neetcode.io/solutions/number-of-islands')
  await expect(spent(page)).toHaveAttribute('data-xp', '8')
  await page.reload()
  await expect(page.getByTestId('ladder-rung-video')).toHaveAttribute('data-state', 'open')
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled()
  await page.getByTestId('do-outcome-giveup').click()
  await expect(page.getByTestId('toast')).toHaveText('Logged. Redo in 3 days.')
  await expect(page.getByTestId('do-given-up')).toHaveText('Given up · redo due Oct 9')
  await page.getByTestId('ladder-open-solution').click()
  await expect(page.getByTestId('ladder-solution')).toContainText('[fake:solution]')
  await expect(spent(page)).toHaveAttribute('data-xp', '13')
  expect(bad).toEqual([])
})

test('H-25/H-27/H-28 the redo shows on Today when due and a pass refunds 5', async ({ page }) => {
  await start(page)
  await toHint(page)
  await page.getByTestId('ladder-open-hint').click()
  await expect(spent(page)).toHaveAttribute('data-xp', '2')
  await page.getByTestId('ladder-open-picture').click()
  await expect(spent(page)).toHaveAttribute('data-xp', '5')
  await page.getByTestId('do-outcome-giveup').click()
  await page.getByTestId('ladder-open-solution').click()
  await expect(spent(page)).toHaveAttribute('data-xp', '10')
  await page.clock.setFixedTime(IST('2026-10-08T23:59:00'))
  await page.goto('/')
  await expect(page.getByTestId('drawer-dsa')).toBeVisible()
  await expect(page.getByTestId('today-redo-drawer')).toHaveCount(0)
  await page.clock.setFixedTime(IST('2026-10-09T00:01:00'))
  await page.goto('/')
  await expect(page.getByTestId('today-redo-toggle')).toContainText('Redo · 1')
  await page.getByTestId('today-redo-toggle').click()
  await expect(page.getByTestId('today-redo-row-p200')).toHaveText('Number of Islands · 3d since first try · +5 xp waiting')
  await page.getByTestId('today-redo-row-p200').click()
  await expect(page).toHaveURL(/\/do\/p200$/)
  await expect(page.getByTestId('redo-banner')).toHaveAttribute('data-stage', '0')
  await expect(page.getByTestId('ladder-rung-picture')).toHaveAttribute('data-cost', '6')
  await page.getByTestId('do-outcome-solved').click()
  await expect(page.getByTestId('toast')).toHaveText('+5 xp refunded')
  await page.goto('/do/p200')
  await expect(page.getByTestId('do-ticket-xp')).toHaveText('Net 5 xp')
})

test('H-31-regression Give up, then a redo session\'s timer still reaches 10:00 and unlocks Hint', async ({ page }) => {
  // Uses `page.clock.setSystemTime` (not `setFixedTime`) to jump to the redo's due date: unlike
  // setFixedTime, it moves the clock forward without freezing Date.now() there - time keeps
  // flowing from the new point on, exactly like a real device's clock after an NTP jump, so the Do
  // screen's live elapsed timer (which reads only lib/clock's now(), C-LADDER §2.1/§2.2) keeps
  // advancing normally for the second (redo) cycle started below.
  await start(page)
  await toHint(page)
  await page.getByTestId('ladder-open-hint').click()
  await expect(page.getByTestId('ladder-rung-hint')).toHaveAttribute('data-state', 'open')
  await page.getByTestId('ladder-open-picture').click()
  await expect(page.getByTestId('ladder-rung-picture')).toHaveAttribute('data-state', 'open')
  await page.getByTestId('do-outcome-giveup').click()
  await expect(page.getByTestId('do-given-up')).toBeVisible() // wait for the give-up write to land
  await page.getByTestId('ladder-open-solution').click() // C = 2 + 3 + 5 = 10, due end + 3d
  await expect(page.getByTestId('ladder-rung-solution')).toHaveAttribute('data-state', 'open')

  await page.clock.setSystemTime(IST('2026-10-09T00:01:00')) // jumps forward; time keeps flowing
  await page.goto('/')
  await page.getByTestId('today-redo-toggle').click()
  await page.getByTestId('today-redo-row-p200').click()
  await expect(page.getByTestId('redo-banner')).toBeVisible()

  await page.getByTestId('do-timer-preset-25').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await expect(page.getByTestId('do-timer-elapsed')).toHaveAttribute('data-seconds', '0')
  await page.clock.fastForward('10:00')

  await expect(page.getByTestId('do-timer-elapsed')).toHaveAttribute('data-seconds', '600')
  await expect(page.getByTestId('ladder-open-hint')).toHaveAccessibleName('Open Hint, costs 2 xp')
})

test('H-32-regression a failed redo becomes due again and its row still opens a redo session', async ({ page }) => {
  // rungUses key off a cycle's id (RungUse.cycleId/Cycle.id, always unique via newId()), not its
  // wall-clock attemptStart, so a cycle created after a clock jump can never wrongly "inherit" an
  // already-closed cycle's rung uses. Uses `page.clock.setSystemTime` (not `setFixedTime`) to jump
  // to each due date while keeping time flowing, like H-31-regression above.
  await start(page)
  await toHint(page)
  await page.getByTestId('ladder-open-hint').click()
  await expect(page.getByTestId('ladder-rung-hint')).toHaveAttribute('data-state', 'open')
  await page.getByTestId('ladder-open-picture').click()
  await expect(page.getByTestId('ladder-rung-picture')).toHaveAttribute('data-state', 'open')
  await page.getByTestId('do-outcome-giveup').click()
  await expect(page.getByTestId('do-given-up')).toBeVisible() // wait for the give-up write to land
  await page.getByTestId('ladder-open-solution').click() // C = 2 + 3 + 5 = 10, due end + 3d
  await expect(page.getByTestId('ladder-rung-solution')).toHaveAttribute('data-state', 'open')

  await page.clock.setSystemTime(IST('2026-10-09T00:01:00'))
  await page.goto('/')
  await page.getByTestId('today-redo-toggle').click()
  await page.getByTestId('today-redo-row-p200').click()
  await expect(page.getByTestId('redo-banner')).toBeVisible()

  // Fail the redo: Solved with help at deepest rung 3 (Picture) keeps the stage, due +3 days.
  await page.getByTestId('do-timer-preset-25').click()
  await page.getByRole('button', { name: 'Pause' }).waitFor()
  await page.clock.fastForward('10:00')
  await page.getByTestId('ladder-open-hint').click()
  await expect(page.getByTestId('ladder-rung-hint')).toHaveAttribute('data-state', 'open')
  await page.getByTestId('ladder-open-picture').click()
  await expect(page.getByTestId('ladder-rung-picture')).toHaveAttribute('data-state', 'open')
  await page.getByTestId('do-outcome-help').click()
  await expect(page.getByTestId('toast')).toHaveText('Not yet. Redo again in 3 days.')

  // A quiet visit in between (no outcome) leaves a cycle behind at this timestamp. Net stays 0:
  // this "Solved with help" is the ticket's first-ever solve (base 10 becomes payable), but it
  // never offsets the original give-up cycle's un-refunded help cost (hint 2 + picture 3 +
  // solution 5 = 10), and this redo session's own cost is zeroed because it failed.
  await page.goto('/do/p200')
  await expect(page.getByTestId('do-ticket-xp')).toHaveAttribute('data-xp', '0')

  // 3 days later the redo is due again; its row must still open a fresh redo session.
  await page.clock.setSystemTime(IST('2026-10-12T00:01:00'))
  await page.goto('/')
  await page.getByTestId('today-redo-toggle').click()
  await expect(page.getByTestId('today-redo-row-p200')).toContainText('+5 xp waiting')
  await page.getByTestId('today-redo-row-p200').click()
  await expect(page.getByTestId('redo-banner')).toHaveAttribute('data-stage', '0')
  await expect(page.getByTestId('ladder-open-hint')).toHaveAccessibleName('Hint, locked, costs 2 xp')
})

test('H-44/H-47 a failed hint charges nothing; Retry shows the loader, then the hint', async ({ page }) => {
  await start(page)
  await toHint(page)
  await page.evaluate(() => localStorage.setItem('dojo-ai-fake-fail', 'hint:claude_missing'))
  await page.getByTestId('ladder-open-hint').click()
  await expect(page.getByTestId('ai-error')).toContainText('Claude Code is not installed or not on PATH.')
  await expect(spent(page)).toHaveAttribute('data-xp', '0')
  await page.evaluate(() => {
    localStorage.removeItem('dojo-ai-fake-fail')
    localStorage.setItem('dojo-ai-fake-delay-ms', '1500')
  })
  await page.getByTestId('ai-retry').click()
  await expect(page.getByRole('status', { name: 'Asking the helper…' })).toBeVisible()
  await page.clock.fastForward(1500)
  await expect(page.getByTestId('ladder-hint-1')).toBeVisible()
  await expect(spent(page)).toHaveAttribute('data-xp', '2')
})

test('H-39…H-41 Ask what to slide appears only when Heavy and slides the suggestions', async ({ page }) => {
  await start(page)
  await expect(page.getByTestId('ai-slide-ask')).toHaveCount(0)
  await page.clock.setFixedTime(IST('2026-10-20T21:10:00'))
  await page.goto('/')
  await expect(page.getByTestId('load-verdict')).toHaveText('Heavy')
  const rows = page.getByTestId('load-row')
  const due = await rows.nth(0).locator('.load-cell').count()
  const cap = await rows.nth(2).locator('.load-cell').count()
  await page.getByTestId('ai-slide-ask').click()
  await expect(page.getByTestId('ai-slide-panel').getByRole('listitem')).toHaveCount(due - cap)
  await page.getByTestId('ai-slide-confirm').click()
  await expect(page.getByTestId('ai-slide-panel')).toHaveCount(0)
  await expect(rows.nth(0).locator('.load-cell')).toHaveCount(cap)
})

test('H-66/H-67 layout: two columns at 1280, stacked with no horizontal scroll at 560', async ({ page }) => {
  await start(page)
  await toHint(page)
  const log = page.getByTestId('do-attempt-log')
  const ladder = page.getByTestId('ladder')
  const [l1, d1] = [await log.boundingBox(), await ladder.boundingBox()]
  expect(d1!.x).toBeGreaterThan(l1!.x + l1!.width)
  await page.setViewportSize({ width: 560, height: 900 })
  for (const n of ['hint', 'picture', 'video']) {
    await page.getByTestId(`ladder-open-${n}`).click()
    await expect(page.getByTestId(`ladder-rung-${n}`)).toHaveAttribute('data-state', 'open')
  }
  await page.getByTestId('do-outcome-giveup').click()
  await page.getByTestId('ladder-open-solution').click()
  await expect(page.getByTestId('ladder-quiz')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  const [l2, d2] = [await log.boundingBox(), await ladder.boundingBox()]
  expect(d2!.y).toBeGreaterThan(l2!.y)
})

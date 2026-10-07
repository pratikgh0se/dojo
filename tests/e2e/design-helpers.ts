import { expect, test, type Page } from '@playwright/test'
import { dojoBaseUrl } from '../../dojoPort'
import { IST, onboard } from './helpers'

export const T0 = IST('2026-10-11T10:00:00')
export const RL = 'd-ratelimit'
export const RL_TITLE = 'Distributed rate limiter and API gateway'
export const RL_DIVES = [
  'Token bucket vs sliding log vs sliding window at the edge',
  'Where state lives: local, Redis, or gossip; what happens on partition',
  'Multi-tenant fairness and priority',
  'Returning the right headers and retry-after',
] as const
export const CACHE = 'd-cache'
const OTHER_ALLOWED = ['data:', 'blob:'] // fonts are self-hosted (public/fonts)
/** The app's own origin: the project's baseURL (the `real` project serves from dojo-server), else DOJO_PORT's. */
const allowed = () => [test.info().project.use.baseURL ?? dojoBaseUrl(process.env), ...OTHER_ALLOWED]

/** C-DESIGN §0 global guards: call first, run the returned check last. */
export function guard(page: Page): () => void {
  const errors: string[] = []
  const foreign: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(e.message))
  const ok = allowed()
  page.on('request', r => { if (!ok.some(a => r.url().startsWith(a))) foreign.push(r.url()) })
  return () => {
    expect(errors, 'console errors').toEqual([])
    expect(foreign, 'requests leaving the origin').toEqual([])
  }
}

export async function begin(page: Page, at: Date = T0): Promise<void> {
  // install() alone keeps ticking in real time — that is what lets React's scheduler (rAF-based)
  // get through the app's initial mount. We freeze later, once a page has actually finished
  // mounting and we are about to do exact-second math (see `freeze`).
  await page.clock.install({ time: at })
  await onboard(page, '2026-10-05')
}

/**
 * Freezes the (till-now still real-time-ticking) clock right where it is. Call this only after a
 * page has fully mounted: pausing the clock before/during a fresh mount starves React's
 * rAF-driven scheduler and the page never finishes rendering (session screens hang on
 * "Loading…"). `pauseAt` cannot target the past, so we add a small buffer for the round trip.
 */
export async function freeze(page: Page): Promise<void> {
  const current = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(current + 500)
}

/**
 * A frozen clock starves React's rAF-driven scheduler on a fresh mount (a `goto`/`reload` never
 * finishes rendering — the session screen hangs on "Loading…"). Resume before navigating so the
 * new document's initial mount runs on a live clock, same as `begin`.
 */
export async function resumeAndGo(page: Page, go: () => Promise<unknown>): Promise<void> {
  await page.clock.resume()
  await go()
}

export async function startSession(page: Page, mode: 'Solo' | 'Interviewer' = 'Solo', id: string = RL): Promise<void> {
  await page.goto(`/designs/session/${id}`)
  // Freeze only once the setup page has actually mounted (see `freeze`'s note), and before the
  // session is created, so `session.at` itself lands on an already-frozen, exact instant.
  await page.getByRole('button', { name: 'Start · 45 min' }).waitFor()
  await freeze(page)
  await page.getByRole('radio', { name: mode }).check()
  await page.getByRole('button', { name: 'Start · 45 min' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('drawing')
}

export async function addKinds(page: Page, kinds: string[]): Promise<void> {
  for (const k of kinds) await page.getByRole('button', { name: `Add ${k}`, exact: true }).click()
}

/** Keyboard link (C-DESIGN D-18 step 4): focus source, `l`, focus target, Enter. */
export async function keyLink(page: Page, from: string, to: string): Promise<void> {
  await page.getByTestId(`kit-node-${from}`).focus()
  await page.keyboard.press('l')
  await page.getByTestId(`kit-node-${to}`).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId(`kit-link-${from}-${to}`)).toHaveCount(1)
}

export async function setKind(page: Page, from: string, to: string, kind: string): Promise<void> {
  await page.getByTestId(`kit-link-${from}-${to}`).click()
  await page.getByRole('combobox', { name: 'Link kind' }).selectOption(kind)
  await expect(page.getByTestId(`kit-link-${from}-${to}`)).toHaveAttribute('data-kind', kind)
}

/** Data set S1's canvas (C-DESIGN D-31). */
export async function drawS1(page: Page): Promise<void> {
  await addKinds(page, ['gateway', 'service', 'cache', 'sql'])
  await keyLink(page, 'gateway-1', 'service-1')
  await keyLink(page, 'service-1', 'cache-1')
  await keyLink(page, 'service-1', 'sql-1')
  await setKind(page, 'gateway-1', 'service-1', 'async')
  await setKind(page, 'service-1', 'sql-1', 'write')
  await expect(page.getByTestId('kit-count')).toHaveText('4 nodes · 3 links')
}

export async function endDrawing(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'End drawing' }).click()
  await page.getByRole('dialog', { name: 'End drawing now?' }).getByRole('button', { name: 'End drawing' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('close')
}

export async function fillClose(page: Page, q4: string, readNext = 'Stripe rate limiter blog post'): Promise<void> {
  const f = page.getByTestId('session-close')
  await f.getByRole('textbox', { name: 'Chose' }).fill('sliding window counter in Redis')
  await f.getByRole('textbox', { name: 'Over' }).fill('token bucket per node')
  await f.getByRole('textbox', { name: 'Because' }).fill('global limit needs shared state; 2 ms Redis RTT is fine')
  await f.getByRole('textbox', { name: 'What breaks first at 10× load, and what would you change?' }).fill('Redis hot key; shard counters')
  await f.getByRole('textbox', { name: 'Where is the data, who owns it, and what is eventually consistent?' }).fill('Redis owns counters; logs are eventual')
  await f.getByRole('radio', { name: q4, exact: true }).check()
  await f.getByRole('textbox', { name: 'One thing you would read next.' }).fill(readNext)
  await page.getByRole('button', { name: 'Next: score' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('score')
}

export async function pick(page: Page, group: string, value: 0 | 1 | 2): Promise<void> {
  await page.getByTestId('session-score').getByRole('radiogroup', { name: group, exact: true })
    .getByRole('radio', { name: String(value), exact: true }).check()
}

/** S1 scores: dives 2 1 2 0, lenses, trade-off 2, rubric 12. */
export async function scoreS1(page: Page): Promise<void> {
  const dives = [2, 1, 2, 0] as const
  for (const [i, q] of RL_DIVES.entries()) await pick(page, q, dives[i])
  const lenses = { Load: 2, Data: 1, Consistency: 1, Failure: 0, Latency: 2, Cost: 1, Evolution: 1 } as const
  for (const [name, v] of Object.entries(lenses)) await pick(page, name, v)
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
  await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
  await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
  await page.getByRole('spinbutton', { name: 'Rubric (0–20)' }).fill('12')
}

/** The whole S1 session: solo, 12 minutes, Q4 = deep dive 2, completed. */
export async function completeS1(page: Page): Promise<void> {
  await startSession(page, 'Solo', RL)
  await drawS1(page)
  await page.clock.runFor(12 * 60_000)
  await endDrawing(page)
  await fillClose(page, RL_DIVES[1])
  await scoreS1(page)
  await page.getByRole('button', { name: 'Complete session' }).click()
  await expect(page.getByTestId('session-phase')).toHaveText('done')
}

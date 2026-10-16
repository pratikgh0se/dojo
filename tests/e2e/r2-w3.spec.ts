import { expect, test, type Page } from '@playwright/test'
import { IST, idbAll, idbPatch, onboard } from './helpers'

// R2 W3: the lab loop on a build ticket and the topic badges, with the /labs/* routes answered by page.route (vite dev has no lab server).
type Row = { id: string; kind: string; status: string; node?: string; area?: string }
const SHOTS = process.env.R2_SHOTS_DIR
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }

async function mockLabs(page: Page, ticketId: string, state: { pass: boolean }) {
  const info = {
    ok: true, title: 'Tiny lab', path: 'labs/t-lab', repo: 'ai-platform-lab', version: 1, timeoutSec: 3, tickets: [ticketId], closingTicket: ticketId,
    milestones: [{ ticket: ticketId, checkIds: ['c1', 'c2'] }], rubric: [{ id: 'r1', text: 'The bound is tested.' }],
  }
  await page.route('**/labs/info**', r => r.fulfill({ json: info }))
  await page.route('**/labs/setup', r => r.fulfill({ json: { ok: true, status: 'created', path: '/Users/t/labs/ai-platform-lab/labs/t-lab', baseCommit: 'a'.repeat(40) } }))
  await page.route('**/labs/run', r => r.fulfill({
    json: {
      ok: true,
      run: {
        at: Date.now(), ms: 900, exit: state.pass ? 0 : 2, timedOut: false, tail: 'make: running the checks\n',
        results: {
          checks: [
            { id: 'c1', name: 'Parses the input', status: 'pass', detail: 'ok' },
            { id: 'c2', name: 'Bound holds', status: state.pass ? 'pass' : 'fail', detail: state.pass ? 'ok' : 'expected 4, got 5, and this detail is long enough to wrap on a phone screen' },
            { id: 'c3', name: 'Knee found', status: 'skip', detail: 'later' },
          ],
          summary: { pass: 0, fail: 0, skip: 0 },
        },
      },
    },
  }))
  await page.route('**/labs/hint', async r => {
    const rung = (r.request().postDataJSON() as { rung: number }).rung
    await r.fulfill({ json: rung === 3 ? { ok: true, text: 'Loop to n minus one.', ref: { file: 'check/c1.txt', from: 1, to: 2, code: 'for i in range(n - 1):\n    step(i)' } } : { ok: true, text: `Hint text ${rung}` } })
  })
}

async function prepare(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.clock.setFixedTime(IST('2026-11-04T10:00:00'))
  await onboard(page, '2026-11-02')
  const t = (await idbAll<Row>(page, 'tickets')).find(x => x.kind === 'build' && x.status === 'todo')!
  await idbPatch(page, 'tickets', [t.id], { lab: { id: 't-lab', gpu: 'none' } })
  return t
}

test('R2 W3: set up, failing then passing checks, the Done gate, hints, and the review unlocking', async ({ page }) => {
  const state = { pass: false }
  const t = await prepare(page)
  await mockLabs(page, t.id, state)
  await page.goto(`/do/${t.id}`)
  await expect(page.getByTestId('ticket-lab-block')).toHaveAttribute('data-state', 'not-set-up')
  await expect(page.getByTestId('ticket-review-request')).toBeDisabled()
  await expect(page.getByTestId('ticket-review-note')).toHaveText('Available once every milestone is passed.')
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('ticket-done')).toBeDisabled()
  await expect(page.getByTestId('ticket-selfmark')).toHaveCount(0)

  await page.getByTestId('ticket-lab-setup').click()
  await expect(page.getByTestId('ticket-lab-path')).toHaveText('/Users/t/labs/ai-platform-lab/labs/t-lab'.replace('/Users/t', '~')) // no userHome on a Dexie-only dev server
  await shot(page, '1280-lab-set-up')

  await page.getByTestId('ticket-lab-run').click()
  await expect(page.getByTestId('ticket-check-summary')).toHaveText('1 passed, 1 failed, 1 skipped')
  await expect(page.getByTestId('ticket-check-c2')).toHaveAttribute('data-status', 'fail')
  await expect(page.getByTestId('ticket-check-later').getByTestId('ticket-check-c3')).toHaveAttribute('data-status', 'skip')
  await expect(page.getByTestId('ticket-lab-milestone')).toHaveAttribute('data-passed', 'false')
  await expect(page.getByTestId('ticket-done')).toBeDisabled()
  await shot(page, '1280-lab-failing')

  await page.getByTestId('ticket-hint-1').click()
  await expect(page.getByTestId('ticket-hint-text-1')).toContainText('Hint text 1')
  await page.getByTestId('ticket-hint-2').click()
  await page.getByTestId('ticket-hint-3').click()
  await expect(page.getByTestId('ticket-hint-confirm')).toBeVisible()
  await page.getByTestId('ticket-hint-confirm-yes').click()
  await expect(page.getByTestId('ticket-hint-ref-file')).toHaveText('check/c1.txt lines 1 to 2')
  await expect(page.getByTestId('ticket-lab-help')).toHaveText('With help')
  await shot(page, '1280-lab-hints')

  await page.reload()
  await expect(page.getByTestId('ticket-done')).toBeVisible() // the study session survives a reload
  for (const n of [1, 2, 3]) await expect(page.getByTestId(`ticket-hint-text-${n}`)).toBeVisible() // stored rungs come back
  await expect(page.getByTestId('ticket-hint-ref-code')).toContainText('for i in range(n - 1):')

  state.pass = true
  await page.getByTestId('ticket-lab-run').click()
  await expect(page.getByTestId('ticket-lab-milestone')).toHaveAttribute('data-passed', 'true')
  await expect(page.getByTestId('ticket-done')).toBeEnabled()
  await expect(page.getByTestId('ticket-review-request')).toBeEnabled() // every milestone of the lab passed: no ticket needs to be done
  await expect(page.getByTestId('ticket-review-note')).toHaveCount(0)
  await shot(page, '1280-lab-passed')

  // GLOBAL-03: one accent on the page, Done
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
  await page.getByTestId('ticket-done').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
})

test('R2 W3: Mark done without checks finishes the ticket, stores no run and passes no milestone', async ({ page }) => {
  const t = await prepare(page)
  await mockLabs(page, t.id, { pass: false })
  await page.goto(`/do/${t.id}`)
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('ticket-done')).toBeDisabled()
  await page.getByTestId('ticket-lab-skip-checks').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  expect(await idbAll(page, 'labRuns')).toHaveLength(0)
  await expect(page.getByTestId('ticket-lab-milestone')).toHaveAttribute('data-passed', 'false')
})

test('R2 W3: a lab the server does not know leaves Done alone', async ({ page }) => {
  const t = await prepare(page)
  await page.route('**/labs/info**', r => r.fulfill({ status: 404, json: { ok: false, error: { code: 'unknown_lab', message: 'x' } } }))
  await page.goto(`/do/${t.id}`)
  await expect(page.getByTestId('ticket-lab-block')).toHaveAttribute('data-state', 'missing')
  await expect(page.getByTestId('ticket-lab-missing')).toHaveText('This lab is not available in this copy of Dojo.')
  await page.getByTestId('ticket-start').click()
  await expect(page.getByTestId('ticket-done')).toBeEnabled()
})

test('R2 W3: the lab block fits a phone', async ({ page }) => {
  const t = await prepare(page)
  await mockLabs(page, t.id, { pass: false })
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto(`/do/${t.id}`)
  await page.getByTestId('ticket-start').click()
  await page.getByTestId('ticket-lab-setup').click()
  await page.getByTestId('ticket-lab-run').click()
  await expect(page.getByTestId('ticket-check-summary')).toBeVisible()
  await page.getByTestId('ticket-check-tail-toggle').click()
  await page.getByTestId('ticket-hint-1').click()
  await page.getByTestId('ticket-hint-2').click()
  await page.getByTestId('ticket-hint-3').click()
  await page.getByTestId('ticket-hint-confirm-yes').click()
  await expect(page.getByTestId('ticket-hint-ref-code')).toBeVisible()
  await shot(page, '375-lab')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid="ticket-lab-block"] button')]
    .filter(e => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().height < 44).map(e => e.getAttribute('data-testid')))
  expect(small).toEqual([])
})

test('R2 W3: topic badges follow the data and stay off the trees', async ({ page }) => {
  const t = await prepare(page)
  await mockLabs(page, t.id, { pass: true })
  const rows = await idbAll<Row>(page, 'tickets')
  const node = rows.find(r => r.id === t.id)!.node!
  const mine = rows.filter(r => r.node === node && r.area !== 'dsa' && r.area !== 'design')
  await idbPatch(page, 'tickets', mine.filter(r => r.kind === 'watch' || r.kind === 'read').map(r => r.id), { status: 'done' })
  await page.goto(`/skills/area/${mine[0].area}?node=${node}`)
  await expect(page.getByTestId(`skills-node-badge-${node}`)).toBeVisible()
  await expect(page.getByTestId('skills-node-nextline')).toBeVisible()
  await shot(page, '1280-skills-badge')
  await page.setViewportSize({ width: 375, height: 667 })
  await page.reload()
  await expect(page.getByTestId(`skills-row-${node}`).getByTestId(`skills-node-badge-${node}`)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await shot(page, '375-skills-badge')
  await page.goto('/skills/dsa')
  await expect(page.getByTestId('skills-area-view')).toBeVisible()
  await expect(page.locator('[data-testid^="skills-node-badge-"], [data-testid="skills-node-nextline"]')).toHaveCount(0)
})

import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

const REPO = 'https://github.com/example-user/forge'
const FONT_ORIGINS = new Set<string>() // fonts are self-hosted (public/fonts)
const REGIONS = ['Evidence', 'Learn → build → prove', 'Learn board', 'Build board', 'Artifact timeline', 'Measures wall']
const S00 = 'Stage 00 · Setup + math by picture'

function guard(page: Page, baseURL: string | undefined) {
  const own = new URL(baseURL ?? 'http://127.0.0.1:8794').origin
  const errors: string[] = []
  const foreign: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  page.on('request', r => {
    const url = r.url()
    if (url.startsWith('blob:') || url.startsWith('data:')) return
    const origin = new URL(url).origin
    if (origin !== own && !FONT_ORIGINS.has(origin)) foreign.push(url)
  })
  return { errors, foreign }
}

async function openAi(page: Page, at = '2026-10-14T10:00:00') {
  await page.clock.setFixedTime(IST(at))
  await onboard(page, '2026-10-05')
  await page.keyboard.press('5')
  await expect(page).toHaveURL(/\/ai$/)
  await expect(page.getByRole('region', { name: 'Evidence' })).toBeVisible()
}

const card = (page: Page, title: string) =>
  page.getByTestId('board-card').filter({ has: page.getByRole('button', { name: title, exact: true }) })
const openBtn = (page: Page, title: string) => card(page, title).getByTestId('board-card-open')

async function addArtifact(page: Page, p: { title: string; stage: string; repo?: string; commit?: string }) {
  await page.getByRole('button', { name: 'Add artifact' }).click()
  const dlg = page.getByRole('dialog', { name: 'New artifact' })
  await dlg.getByLabel('Title', { exact: true }).fill(p.title)
  await dlg.getByLabel('Stage', { exact: true }).selectOption({ label: p.stage })
  if (p.repo) await dlg.getByLabel('Repo URL', { exact: true }).fill(p.repo)
  if (p.commit) await dlg.getByLabel('Commit', { exact: true }).fill(p.commit)
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dlg).toBeHidden()
  await expect(card(page, p.title)).toHaveCount(1)
}

async function openArtifact(page: Page, title: string): Promise<Locator> {
  await openBtn(page, title).click()
  const dlg = page.getByRole('dialog', { name: `Artifact · ${title}` })
  await expect(dlg).toBeVisible()
  return dlg
}

async function addMeasureUI(dlg: Locator, choice: string, value: string, unit = '') {
  const f = dlg.getByTestId('measure-form')
  const before = await dlg.getByTestId('measure-list').getByRole('listitem').count()
  await f.getByLabel('Measure', { exact: true }).selectOption(choice)
  await f.getByLabel('Value', { exact: true }).fill(value)
  await f.getByLabel('Unit', { exact: true }).fill(unit)
  await f.getByRole('button', { name: 'Add measure' }).click()
  await expect(dlg.getByTestId('measure-list').getByRole('listitem')).toHaveCount(before + 1)
}

const timelineCell = (page: Page, row: number, col: number) =>
  page.getByTestId('ai-timeline-table').locator('tbody tr').nth(row).locator('td').nth(col)

/**
 * A manual drag with intermediate mouse movement and an explicit scroll while the button is
 * down. Plain `locator.dragTo()` loses Chromium's native HTML5 drag session on very tall pages
 * (13+ seeded cards stacked at 560px pushes the target hundreds of pixels below the fold) because
 * it scrolls the target into view without any pointer movement in between; a real mouse drag does
 * not have that problem. Used only where the page is taller than the viewport.
 */
async function dragCard(page: Page, source: Locator, target: Locator) {
  const src = (await source.boundingBox())!
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 + 10, { steps: 5 })
  await target.scrollIntoViewIfNeeded()
  const tgt = (await target.boundingBox())!
  await page.mouse.move(tgt.x + tgt.width / 2, tgt.y + tgt.height / 2, { steps: 10 })
  await page.mouse.up()
}

test('seed, region order, ladder shape, M5c intact (scenarios 1–3)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await openAi(page)
  const names = await page.locator('section[aria-labelledby]').evaluateAll(els =>
    els.map(e => document.getElementById(e.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''),
  )
  expect(names).toEqual(REGIONS)
  const wall = await page.getByRole('region', { name: 'Measures wall' }).boundingBox()
  const ladder = await page.getByRole('heading', { name: 'Stage ladder' }).boundingBox()
  expect(ladder!.y).toBeGreaterThan(wall!.y)
  const notStarted = page.getByTestId('board-col-not-started').getByTestId('board-card-open')
  await expect(notStarted).toHaveCount(12)
  await expect(notStarted.first()).toHaveText(S00)
  await expect(notStarted.last()).toHaveText('Stage 11 · Research')
  for (const n of ['Building', 'Runs', 'Measured', 'Written up']) {
    await expect(page.getByRole('heading', { name: `${n} · 0`, exact: true })).toBeVisible()
  }
  await expect(page.getByTestId('ai-evidence-stages')).toHaveText('0/12')
  await expect(page.getByTestId('ai-evidence-measured')).toHaveText('0/12')
  await expect(page.getByTestId('ai-evidence-blank')).toHaveText('0')
  await expect(page.locator('[data-testid^="ai-cube-row-"]')).toHaveCount(12)
  await expect(page.getByTestId('ai-cube-checkpoint')).toHaveText('Checkpoint · S38')
  await expect(page.getByTestId('ai-cube-ladder').locator('[role="img"][data-state="empty"]')).toHaveCount(36)
  await expect(page.getByTestId('board-learn-col-queued').getByTestId('board-learn-card')).toHaveCount(12)
  await expect(page.locator('[data-testid^="ai-rung-"][data-state="empty"]')).toHaveCount(12)
  await expect(page.getByTestId('stage-ladder').locator(':scope > li')).toHaveCount(13)
  await page.goto('/ai?stage=1')
  await expect(page.getByTestId('balance-watch')).toHaveText('0/72')
  await page.getByRole('button', { name: 'Watch · S2', exact: true }).click()
  await expect(page.getByTestId('balance-watch')).toHaveText('1/72')
  await expect(page.getByTestId('ai-cube-01-learn')).toHaveAttribute('aria-label', 'Stage 01 learn: partial (1/3)')
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('add, drag, gates, keyboard and backward moves (scenarios 4, 8–11, 13)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await openAi(page)
  await addArtifact(page, { title: 'micrograd engine', stage: 'Stage 01', repo: REPO, commit: 'a1b2c3d' })
  await expect(page.getByTestId('board-col-not-started').getByTestId('board-card-open').nth(2)).toHaveText('micrograd engine')
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-stage', '01')
  await expect(card(page, 'micrograd engine').getByRole('img', { name: 'repo' })).toBeVisible()
  await expect(card(page, 'micrograd engine').getByTestId('measure-chip')).toHaveCount(0)
  await expect(page.getByTestId('ai-evidence-measured')).toHaveText('0/13')
  await expect(timelineCell(page, 0, 1)).toHaveText('13')

  await card(page, 'micrograd engine').dragTo(page.getByTestId('board-col-building'))
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'building')
  await expect(page.getByRole('heading', { name: 'Not started · 12', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Building · 1', exact: true })).toBeVisible()
  await expect(page.getByTestId('board-live')).toHaveText('micrograd engine moved to Building.')

  await card(page, S00).dragTo(page.getByTestId('board-col-runs'))
  await expect(page.getByTestId('board-gate-alert')).toHaveText('Runs needs a repo URL and a commit.')
  await expect(card(page, S00)).toHaveAttribute('data-status', 'not-started')

  await openBtn(page, 'micrograd engine').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'runs')
  await expect(openBtn(page, 'micrograd engine')).toBeFocused()
  await expect(page.getByTestId('board-live')).toHaveText('micrograd engine moved to Runs.')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByTestId('board-gate-alert')).toHaveText('Measured needs at least one measure.')
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'runs')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'building')
  await expect(openBtn(page, 'micrograd engine')).toBeFocused()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'not-started')
  const dlg = await openArtifact(page, 'micrograd engine')
  await expect(dlg.getByLabel('Repo URL', { exact: true })).toHaveValue(REPO)
  await expect(dlg.getByLabel('Commit', { exact: true })).toHaveValue('a1b2c3d')
  await dlg.getByLabel('Status', { exact: true }).selectOption({ label: 'Written up' })
  await expect(dlg.getByRole('alert')).toHaveText('Measured needs at least one measure.')
  await expect(dlg.getByLabel('Status', { exact: true })).toHaveValue('not started')
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('measures, firsts, timeline, export, remove (scenarios 16–20)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await openAi(page)
  await addArtifact(page, { title: 'micrograd engine', stage: 'Stage 01', repo: REPO, commit: 'a1b2c3d' })
  await card(page, 'micrograd engine').dragTo(page.getByTestId('board-col-runs'))
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'runs')
  let dlg = await openArtifact(page, 'micrograd engine')
  await addMeasureUI(dlg, 'loss', '1.98')
  await addMeasureUI(dlg, 'tokens/sec', '412', 'tok/s')
  await addMeasureUI(dlg, 'eval score', '0.82')
  await expect(dlg.getByTestId('measure-list').getByRole('listitem')).toHaveText(['loss 1.98 · S1', 'tokens/sec 412 tok/s · S1', 'eval score 0.82 · S1'])
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  await expect(card(page, 'micrograd engine').getByTestId('measure-chip')).toHaveText('eval score 0.82')
  await expect(page.getByTestId('measure-table').locator('tbody tr')).toHaveCount(3)
  await card(page, 'micrograd engine').dragTo(page.getByTestId('board-col-measured'))
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'measured')
  await expect(page.getByTestId('ai-evidence-measured')).toHaveText('1/13')
  await expect(timelineCell(page, 0, 3)).toHaveText('0')
  await expect(timelineCell(page, 0, 4)).toHaveText('1')

  await page.clock.setFixedTime(IST('2026-10-20T10:00:00'))
  dlg = await openArtifact(page, 'micrograd engine')
  await addMeasureUI(dlg, 'loss', '1.41')
  await expect(dlg.getByTestId('measure-list').getByRole('listitem').nth(3)).toHaveText('loss 1.41 · S2')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('measure-first-loss')).toHaveText('1.98 · S1 · micrograd engine')
  await expect(page.getByTestId('measure-first-tps')).toHaveText('412 tok/s · S1 · micrograd engine')
  await expect(page.getByTestId('measure-first-eval')).toHaveText('0.82 · S1 · micrograd engine')
  await expect(card(page, 'micrograd engine').getByTestId('measure-chip')).toHaveText('loss 1.41')
  await expect(page.getByTestId('measure-table').locator('tbody tr').nth(3).locator('td').first()).toHaveText('S2')

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Markdown' }).click()])
  expect(download.suggestedFilename()).toBe('dojo-measures.md')
  expect(readFileSync(await download.path(), 'utf8')).toBe([
    '# Measures',
    '',
    '| Sprint | Stage | Artifact | Measure | Value | Unit |',
    '|---|---|---|---|---|---|',
    '| S1 | 01 | micrograd engine | loss | 1.98 |  |',
    '| S1 | 01 | micrograd engine | tokens/sec | 412 | tok/s |',
    '| S1 | 01 | micrograd engine | eval score | 0.82 |  |',
    '| S2 | 01 | micrograd engine | loss | 1.41 |  |',
  ].join('\n') + '\n')

  await page.reload()
  await expect(page.getByTestId('ai-timeline-table').locator('tbody tr')).toHaveCount(2)
  await expect(timelineCell(page, 0, 4)).toHaveText('1')
  await expect(timelineCell(page, 1, 4)).toHaveText('1')

  dlg = await openArtifact(page, 'micrograd engine')
  const list = dlg.getByTestId('measure-list')
  for (let left = 4; left > 0; left--) {
    await list.getByRole('button', { name: /^Remove /, exact: false }).first().click()
    await expect(list.getByRole('listitem')).toHaveCount(left - 1)
  }
  await page.keyboard.press('Escape')
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'measured')
  await expect(page.getByTestId('measure-first-loss')).toHaveText('—')
  await expect(page.getByTestId('measure-wall')).toContainText('No measures yet — add one on an artifact.')
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('deep link survives reload, Esc returns focus, delete asks first, unknown id is harmless (scenarios 6, 7)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await openAi(page)
  await addArtifact(page, { title: 'micrograd engine', stage: 'Stage 01', repo: REPO, commit: 'a1b2c3d' })
  await openArtifact(page, 'micrograd engine')
  await expect(page).toHaveURL(/\?artifact=art-/)
  await page.reload()
  const dlg = page.getByRole('dialog', { name: 'Artifact · micrograd engine' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByLabel('Commit', { exact: true })).toHaveValue('a1b2c3d')
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  await expect(page).not.toHaveURL(/artifact=/)
  await expect(openBtn(page, 'micrograd engine')).toBeFocused()

  let d2 = await openArtifact(page, 'micrograd engine')
  await d2.getByRole('button', { name: 'Delete artifact' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(card(page, 'micrograd engine')).toHaveCount(1)
  await d2.getByRole('button', { name: 'Delete artifact' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(card(page, 'micrograd engine')).toHaveCount(0)
  await expect(page.getByTestId('ai-evidence-measured')).toHaveText('0/12')
  d2 = await openArtifact(page, S00)
  await expect(d2.getByRole('button', { name: 'Delete artifact' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.goto('/ai?artifact=nope')
  await expect(page.getByRole('region', { name: 'Build board' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('cubes fill from tickets, commit and grade; Done is independent of status (scenarios 22, 24, 25, 29–31)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await openAi(page)
  await page.goto('/ai?stage=0')
  await page.getByRole('button', { name: 'Watch · S1', exact: true }).click()
  await expect(page.getByTestId('ai-cube-00-learn')).toHaveAttribute('aria-label', 'Stage 00 learn: full (1/1)')
  await expect(page.getByTestId('board-learn-col-watched').getByTestId('board-learn-card')).toHaveAttribute('data-stage', '00')
  await page.getByRole('button', { name: 'Rebuild · S1', exact: true }).click()
  await expect(page.getByTestId('ai-cube-00-build')).toHaveAttribute('data-state', 'empty')
  await page.getByRole('button', { name: 'Build · S1', exact: true }).click()
  await expect(page.getByTestId('ai-cube-00-build')).toHaveAttribute('aria-label', 'Stage 00 build: partial (1/1) — needs a commit')

  let dlg = await openArtifact(page, S00)
  await dlg.getByLabel('Repo URL', { exact: true }).fill(REPO)
  await dlg.getByLabel('Commit', { exact: true }).fill('c0ffee1')
  await dlg.getByLabel('Proof note', { exact: true }).fill('forward/backward on 3 nodes, checked by finite differences')
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByTestId('ai-cube-00-build')).toHaveAttribute('data-state', 'full')
  await expect(page.getByTestId('board-learn-col-built').getByTestId('board-learn-card')).toHaveAttribute('data-stage', '00')
  await page.getByRole('button', { name: 'Teachback · S1', exact: true }).click()
  await expect(page.getByTestId('ai-cube-00-prove')).toHaveAttribute('aria-label', 'Stage 00 prove: partial (1/1) — needs a grade or blank test')

  await page.evaluate(() => localStorage.setItem('dojo-ai-fake-delay-ms', '400'))
  dlg = await openArtifact(page, S00)
  await dlg.getByRole('button', { name: 'Request grade' }).click()
  await expect(dlg.getByRole('status', { name: 'Grading…' })).toBeVisible()
  await expect(dlg.getByTestId('grade-request')).toBeDisabled()
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  await page.evaluate(() => localStorage.removeItem('dojo-ai-fake-delay-ms'))
  await expect(dlg.getByTestId('grade-verdict')).toHaveText('Passed')
  await expect(dlg.getByTestId('grade-feedback').getByRole('listitem').first()).toHaveText(/^\[fake:grade\].*art-stage-00/)
  await expect(dlg.getByTestId('grade-missing')).toHaveCount(0)
  await expect(dlg.getByTestId('grade-at')).toHaveText('Graded 14 Oct 2026')
  await expect(dlg.getByTestId('artifact-commit-checked')).toHaveText('Commit checked')
  await expect(dlg.getByTestId('artifact-done')).toHaveText('Done')
  await expect(dlg.getByTestId('grade-request')).toHaveText('Re-grade')
  await page.keyboard.press('Escape')
  await expect(card(page, S00).getByTestId('grade-chip')).toHaveText('4/5')
  await expect(card(page, S00).getByTestId('artifact-done-badge')).toBeVisible()
  await expect(page.getByTestId('ai-cube-row-00')).toHaveAttribute('data-complete', 'true')
  await expect(page.getByTestId('board-learn-col-proven').getByTestId('board-learn-card')).toHaveAttribute('data-stage', '00')
  await expect(page.getByTestId('ai-evidence-stages')).toHaveText('1/12')

  await card(page, S00).dragTo(page.getByTestId('board-col-runs'))
  await expect(card(page, S00)).toHaveAttribute('data-status', 'runs')
  await expect(card(page, S00).getByTestId('artifact-done-badge')).toBeVisible()

  await page.goto('/ai?artifact=art-stage-00')
  dlg = page.getByRole('dialog', { name: `Artifact · ${S00}` })
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  await expect(dlg.getByTestId('grade-loading')).toHaveCount(0)
  await expect(dlg.getByRole('button', { name: 'Re-grade' })).toBeEnabled()
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('grade below pass and grader unavailable (scenarios 32, 33)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await openAi(page)
  await addArtifact(page, { title: 'micrograd engine', stage: 'Stage 01', repo: REPO, commit: 'a1b2c3d' })
  await page.evaluate(() => localStorage.setItem('dojo:fake-ai-grade', 'low'))
  let dlg = await openArtifact(page, 'micrograd engine')
  await dlg.getByRole('button', { name: 'Request grade' }).click()
  await expect(dlg.getByTestId('grade-score')).toHaveText('2/5')
  await expect(dlg.getByTestId('grade-verdict')).toHaveText('Not yet')
  await expect(dlg.getByTestId('grade-missing').getByRole('listitem').first()).toHaveText(/^\[fake:grade\]/)
  await expect(dlg.getByTestId('artifact-done')).toHaveCount(0)
  await expect(page.getByTestId('ai-cube-01-prove')).toHaveAttribute('data-state', 'empty')

  await page.evaluate(() => localStorage.removeItem('dojo:fake-ai-grade'))
  await dlg.getByRole('button', { name: 'Re-grade' }).click()
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  await page.evaluate(() => localStorage.setItem('dojo:fake-ai-grade', 'error'))
  await dlg.getByRole('button', { name: 'Re-grade' }).click()
  const err = dlg.getByTestId('grade-error')
  await expect(err).toContainText('Grader unavailable — nothing was saved.')
  await expect(err).toContainText('fake grade unavailable')
  await expect(dlg.getByTestId('grade-retry')).toBeVisible()
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  await expect(dlg.getByTestId('artifact-done')).toHaveText('Done')
  await page.keyboard.press('Escape')
  await card(page, 'micrograd engine').dragTo(page.getByTestId('board-col-building'))
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'building')
  await expect(card(page, 'micrograd engine').getByTestId('artifact-done-badge')).toBeVisible()
  await page.evaluate(() => localStorage.removeItem('dojo:fake-ai-grade'))
  dlg = await openArtifact(page, 'micrograd engine')
  await dlg.getByRole('button', { name: 'Re-grade' }).click()
  await expect(dlg.getByTestId('grade-score')).toHaveText('4/5')
  await expect(dlg.getByTestId('grade-error')).toHaveCount(0)
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('blank test countdown, Solved and Not yet (scenarios 26, 27)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await page.clock.install({ time: IST('2026-10-14T10:00:00') })
  await onboard(page, '2026-10-05')
  await page.goto('/ai')
  await page.getByRole('button', { name: 'Blank test · Stage 00', exact: true }).click()
  const d0 = page.getByRole('dialog', { name: 'Blank test · Stage 00' })
  await expect(d0).toContainText('No video, no agent, blank file.')
  await d0.getByLabel('What will you rebuild?').fill('forward pass by hand')
  await d0.getByRole('button', { name: 'Start' }).click()
  await expect(d0.getByTestId('ai-blank-timer')).toHaveText('25:00')
  await page.clock.fastForward('01:00')
  await expect(d0.getByTestId('ai-blank-timer')).toHaveText('24:00')
  await d0.getByRole('button', { name: 'Solved' }).click()
  await expect(page.getByTestId('ai-evidence-blank')).toHaveText('1')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('ai-cube-00-prove')).toHaveAttribute('data-state', 'partial')

  await page.getByRole('button', { name: 'Blank test · Stage 01', exact: true }).click()
  const d1 = page.getByRole('dialog', { name: 'Blank test · Stage 01' })
  await d1.getByLabel('What will you rebuild?').fill('micrograd backward pass')
  await d1.getByRole('button', { name: 'Start' }).click()
  await d1.getByRole('button', { name: 'Not yet' }).click()
  await expect(d1.getByTestId('ai-blank-redo-due')).toHaveText('Redo due 24 Oct 2026')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('ai-cube-row-01').getByTestId('ai-blank-redo-due')).toHaveText('Redo due 24 Oct 2026')
  await expect(page.getByTestId('ai-evidence-blank')).toHaveText('1')
  await page.reload()
  await expect(page.getByTestId('ai-cube-row-01').getByTestId('ai-blank-redo-due')).toHaveText('Redo due 24 Oct 2026')
  await expect(page.getByTestId('ai-evidence-blank')).toHaveText('1')
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('560px: no page scroll, stacked columns, dialog gutter, drag and keyboard (scenario 36)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await page.setViewportSize({ width: 560, height: 900 })
  await openAi(page)
  await addArtifact(page, { title: 'micrograd engine', stage: 'Stage 01', repo: REPO, commit: 'a1b2c3d' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560)
  for (const prefix of ['board-col-', 'board-learn-col-']) {
    const slugs = prefix === 'board-col-' ? ['not-started', 'building', 'runs', 'measured', 'written-up'] : ['queued', 'watched', 'built', 'proven']
    const boxes = await Promise.all(slugs.map(s => page.getByTestId(`${prefix}${s}`).boundingBox()))
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y)
      expect(Math.abs(boxes[i]!.x - boxes[0]!.x)).toBeLessThan(2)
    }
  }
  const col = await page.getByTestId('board-col-not-started').boundingBox()
  for (const b of await page.getByTestId('board-col-not-started').getByTestId('board-card').all()) {
    const box = await b.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(col!.x + col!.width + 1)
  }
  const dlg = await openArtifact(page, 'micrograd engine')
  const dbox = await dlg.boundingBox()
  expect(dbox!.x).toBeGreaterThanOrEqual(16)
  expect(dbox!.x + dbox!.width).toBeLessThanOrEqual(544)
  await page.keyboard.press('Escape')
  await dragCard(page, card(page, 'micrograd engine'), page.getByTestId('board-col-building'))
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'building')
  await openBtn(page, 'micrograd engine').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(card(page, 'micrograd engine')).toHaveAttribute('data-status', 'runs')
  await expect(openBtn(page, 'micrograd engine')).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560)
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

test('1280px: five Build columns and four Learn columns in one row (scenario 37)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openAi(page)
  for (const ids of [
    ['not-started', 'building', 'runs', 'measured', 'written-up'].map(s => `board-col-${s}`),
    ['queued', 'watched', 'built', 'proven'].map(s => `board-learn-col-${s}`),
  ]) {
    const boxes = await Promise.all(ids.map(id => page.getByTestId(id).boundingBox()))
    for (let i = 1; i < boxes.length; i++) {
      expect(Math.abs(boxes[i]!.y - boxes[0]!.y)).toBeLessThan(2)
      expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x)
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  expect(g.errors).toEqual([])
  expect(g.foreign).toEqual([])
})

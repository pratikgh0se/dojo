import { expect, test, type Page } from '@playwright/test'
import { idbAll, idbPatch, IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-r1b (dojo-acceptance/reports/uat/cu-r1b.md): F-B2 / F-B4 (the Board counts after a
// split), F-B10 (brief chip), F-B11, F-B12, F-B13 (375 / 834 layouts), F-B15 (the strip's one row).
const TUE = '2026-10-06T10:00:00'

async function open(page: Page, path: string, ready: string) {
  await page.clock.setFixedTime(IST(TUE))
  await onboard(page, '2026-10-05')
  if (path !== '/') await page.goto(path)
  await expect(page.getByTestId(`screen-${ready}`)).toHaveAttribute('data-ready', 'true')
}
const BRIEF = (status: 'draft' | 'approved') => ({ status, source: 'ai', goal: 'g', steps: [], minutes: 30, dayType: 'code', learn: [], outcome: 'o', deliverable: { kind: 'none', prompt: '' }, questions: [] })
type Row = { id: string; title: string; status: string; sprint: number; order: number; kind?: string; estMin?: number; children?: string[]; childOf?: string }
const tickets = (page: Page) => idbAll<Row>(page, 'tickets')
const todoCards = (page: Page) => page.getByTestId('col-todo').locator('article.card')

async function splitFirstProblem(page: Page): Promise<string> {
  const p = (await tickets(page)).filter(t => t.sprint === 1 && t.kind === 'problem' && (t.estMin ?? 0) >= 30 && t.status === 'todo').sort((a, b) => a.order - b.order)[0]
  await idbPatch(page, 'tickets', [p.id], { brief: BRIEF('approved') })
  await page.goto(`/do/${p.id}`)
  await page.getByRole('button', { name: 'Split into sessions' }).click()
  await page.getByTestId('split-dialog').getByRole('button', { name: 'Split', exact: true }).click()
  await expect(page.getByTestId('split-sessions')).toBeVisible()
  await page.goto('/board')
  await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
  return p.id
}

test.describe('F-B2 / F-B4 · the Board counts after a split', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('a part dragged into Done is counted by its header; the split group line is no extra Doing card', async ({ page }) => {
    await open(page, '/board', 'board')
    const parent = await splitFirstProblem(page)
    const parts = page.getByTestId('col-todo').locator(`article.card[data-testid^="card-${parent}~"]`)
    await expect(parts).toHaveCount(3)
    await expect(page.getByTestId(`group-${parent}`)).toBeVisible()

    await parts.first().dragTo(page.getByTestId('col-done'))
    await expect(page.getByTestId('col-done').locator('article.card')).toHaveCount(1)
    await expect(page.getByTestId('count-done')).toHaveText('1') // cu-r1b F-B2: the listed card

    // Doing: the remaining part plus one more card = 2 shown; a third drop is allowed, the fourth refused
    await parts.first().dragTo(page.getByTestId('col-doing'))
    await todoCards(page).first().dragTo(page.getByTestId('col-doing'))
    await expect(page.getByTestId('count-doing')).toHaveText('2')
    await todoCards(page).first().dragTo(page.getByTestId('col-doing'))
    await expect(page.getByTestId('count-doing')).toHaveText('3')
    const warn = page.getByTestId('toast').filter({ hasText: 'Doing is full (3/3)' })
    expect(await warn.count()).toBe(0)
    await todoCards(page).first().dragTo(page.getByTestId('col-doing'))
    await expect(warn).toBeVisible()
  })
})

test.describe('F-B10 / F-B15 · card chip and the strip at 1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the brief chip starts the chip row of an unpinned card, and a sprint past 72 stays on the strip row', async ({ page }) => {
    await open(page, '/board', 'board')
    const t = (await tickets(page)).find(x => x.sprint === 1 && x.status === 'todo')!
    const last = (await tickets(page)).filter(x => x.sprint === 1 && x.status === 'todo').pop()!
    await idbPatch(page, 'tickets', [t.id], { brief: BRIEF('draft') })
    await idbPatch(page, 'tickets', [last.id], { sprint: 73 })
    await page.reload()
    await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
    const card = page.getByTestId(`card-${t.id}`)
    const chip = card.locator('.chip', { hasText: 'brief · draft' })
    await expect(chip).toBeVisible()
    const [cb, kb] = await Promise.all([chip.boundingBox(), card.boundingBox()])
    expect(cb!.x - kb!.x, 'the chip is at the card\'s left, not pushed right').toBeLessThan(40)

    const tops = await page.getByTestId('strip').locator('.strip-cell').evaluateAll(cs => [...new Set(cs.map(c => Math.round(c.getBoundingClientRect().top)))])
    expect(cs73(await page.getByTestId('strip').locator('.strip-cell').count())).toBe(true)
    expect(tops, 'one row of cells').toHaveLength(1)
  })
})
const cs73 = (n: number) => n >= 73

test.describe('F-B11 / F-B12 / F-B13 · phone and tablet layouts', () => {
  test('375: the Progress delta rows are one line each and the Week chart labels are not cut', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 860 })
    await open(page, '/progress', 'progress')
    const rows = page.locator('.pace-row')
    for (let i = 0; i < await rows.count(); i++) {
      const box = await rows.nth(i).boundingBox()
      expect(box!.height, `pace row ${i} stays on one line`).toBeLessThan(30)
    }
    await page.goto('/week')
    await expect(page.getByTestId('screen-week')).toHaveAttribute('data-ready', 'true')
    const labels = await page.locator('svg[aria-label="Minutes per week, last 8 weeks"] text.chart-label').evaluateAll(es => es.filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent ?? ''))
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(labels.filter(l => l.includes('…'))).toEqual([])
  })

  test('834: the DSA note under Evidence fits its column', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1000 })
    await open(page, '/board', 'board')
    const p = (await tickets(page)).find(t => t.sprint === 1 && t.kind === 'problem' && t.status === 'todo')!
    await page.getByTestId(`card-${p.id}`).focus()
    await page.keyboard.press('d')
    await expect(page.getByTestId('col-done').locator('article.card')).toHaveCount(1)
    await page.goto('/progress')
    await expect(page.getByTestId('screen-progress')).toHaveAttribute('data-ready', 'true')
    const note = page.getByTestId('ev-dsa-ticked')
    await note.scrollIntoViewIfNeeded()
    const [n, col] = await Promise.all([note.boundingBox(), page.locator('.ev-col[aria-label="DSA"]').boundingBox()])
    expect(n!.x + n!.width).toBeLessThanOrEqual(col!.x + col!.width + 0.5)
    expect(await note.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
    // the three groups sit in as many columns as fit: no group is left alone on a row
    const tops = await page.locator('.ev-col').evaluateAll(cs => cs.map(c => Math.round(c.getBoundingClientRect().top)))
    expect(tops.length).toBe(3)
  })
})

import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { idbCount, onboard } from './helpers'

// W7 (trees-and-banks.md ATLAS-01 to ATLAS-10) in a real browser, on the live plan, start 2026-10-05.
// where the after-shots go; the run command sets it (default: next to the other test output)
const SHOTS = process.env.W7_SHOTS ?? 'test-results/w7-shots'
const INTRO = 'Rows are patterns, columns are data structures; a cell shows where the pattern applies'

function watch(page: Page) {
  const problems: string[] = []
  page.on('console', m => m.type() === 'error' && problems.push(`console: ${m.text()}`))
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
  return () => expect(problems).toEqual([])
}

const writes = async (page: Page) => (await Promise.all(['tickets', 'sessions', 'atlasRuns', 'ops', 'redos'].map(s => idbCount(page, s)))).join(',')

for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 375, height: 667 }]) {
  test.describe(`W7 Atlas at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('ATLAS-01/02/03/10: intro, a whole grid, every cell named, reading writes nothing', async ({ page }) => {
      const ok = watch(page)
      await onboard(page, '2026-10-05')
      const before = await writes(page)
      await page.goto('/atlas')
      await expect(page.getByTestId('atlas-intro')).toBeVisible()
      await expect(page.getByTestId('atlas-intro')).toHaveText(INTRO)
      const matrix = page.getByTestId('atlas-matrix')
      await expect(matrix).toBeVisible()
      const rows = await page.locator('tr[data-testid^="atlas-row-"]').count()
      expect(rows).toBeGreaterThanOrEqual(36)
      expect(await page.locator('[data-testid="atlas-row-binary-search"] [data-testid^="atlas-cell-binary-search-"]').count()).toBe(16)
      // every cell: a title and an accessible name of its kind
      const bad = await page.evaluate(() => {
        const out: string[] = []
        for (const td of document.querySelectorAll<HTMLElement>('td[data-testid^="atlas-cell-"]')) {
          const kind = td.dataset.kind
          const tail = kind === 'main' ? 'main picture' : kind === 'side' ? 'side panel' : 'not drawn'
          if (!td.title.endsWith(` ${tail}`) || td.getAttribute('aria-label') !== td.title || !td.title.includes(': ')) out.push(td.dataset.testid ?? '?')
        }
        return out
      })
      expect(bad).toEqual([])
      await expect(page.getByRole('cell', { name: 'Binary search: number line main picture' })).toBeVisible()
      // phone: no sideways scroll on the page itself
      const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(scrolls).toBe(false)
      // selecting a row keeps the intro
      await page.getByRole('button', { name: 'Trie', exact: true }).click()
      await expect(page.getByTestId('atlas-intro')).toHaveText(INTRO)
      await page.screenshot({ path: `${SHOTS}/scope2-w7-atlas-${vp.name}.png`, fullPage: false })
      expect(await writes(page)).toBe(before)
      ok()
    })

    test('ATLAS-04: a cell link opens its row and focuses the problem list; none cells have no link', async ({ page }) => {
      const ok = watch(page)
      await onboard(page, '2026-10-05')
      await page.goto('/atlas')
      await expect(page.getByTestId('atlas-cell-link-binary-search-GRAPH')).toHaveCount(0)
      const link = page.getByTestId('atlas-cell-link-shortest-path-GRAPH')
      await link.scrollIntoViewIfNeeded()
      await link.click()
      await expect(page).toHaveURL(/[?&]pattern=shortest-path/)
      await expect(page.getByTestId('atlas-detail')).toBeVisible()
      await expect(page.getByTestId('atlas-problems')).toBeFocused()
      const n = await page.locator('[data-testid^="atlas-problem-"]').count()
      expect(n).toBeGreaterThan(0)
      expect(await link.getAttribute('aria-label')).toMatch(new RegExp(n === 1 ? ' 1 problem$' : ` ${n} problems$`))
      await page.screenshot({ path: `${SHOTS}/scope2-w7-atlas-cell-link-${vp.name}.png` })
      ok()
    })

    test('ATLAS-05/06/07: every row has a walkthrough that plays, a problem, and an agreeing Left', async ({ page }) => {
      test.setTimeout(240_000)
      const ok = watch(page)
      await onboard(page, '2026-10-05')
      await page.goto('/atlas')
      await expect(page.getByTestId('atlas-matrix')).toBeVisible()
      const slugs = await page.locator('tr[data-testid^="atlas-row-"]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.testid!.replace('atlas-row-', '')))
      expect(slugs.length).toBeGreaterThanOrEqual(36)
      for (const slug of slugs) {
        await page.goto(`/atlas?pattern=${slug}`)
        const detail = page.getByTestId('atlas-detail')
        await expect(detail).toBeVisible()
        await expect(detail).not.toContainText('No walkthrough yet')
        await expect(detail).not.toContainText('No plan problems tagged yet')
        const first = page.getByTestId('atlas-walk-1')
        await expect(first).toBeVisible()
        const play = page.getByTestId('atlas-walk-play-1')
        await expect(play).toBeEnabled()
        await play.click()
        await expect(page.getByTestId('lab-player').first()).toBeVisible()
        const problems = page.locator('[data-testid^="atlas-problem-"]')
        expect(await problems.count(), slug).toBeGreaterThanOrEqual(1)
        for (const href of await problems.evaluateAll(els => els.map(e => e.getAttribute('href')))) expect(href).toMatch(/^\/do\/p\d+$/)
        const left = await page.getByTestId(`atlas-left-${slug}`).innerText()
        expect(Number(left), slug).toBe(await problems.count())
      }
      ok()
    })
  })
}

test.describe('W7 /dsa pattern chips', () => {
  test('ATLAS-08/09: every problem of every topic has a chip that lands on a row listing it', async ({ page }) => {
    test.setTimeout(240_000)
    const ok = watch(page)
    await onboard(page, '2026-10-05')
    await page.goto('/dsa')
    await expect(page.getByTestId('dsa-solved')).toBeVisible()
    const topics = await page.locator('[data-testid^="topic-"]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.testid!).filter(t => /^topic-\d+$/.test(t)))
    expect(topics).toHaveLength(17)
    let seen = 0
    for (const t of topics) {
      await page.goto(`/dsa?topic=${t.replace('topic-', '')}`)
      await expect(page.getByTestId('topic-detail')).toBeVisible()
      await expect(page.locator('[data-testid^="row-p"]').first()).toBeVisible()
      // one snapshot of the whole topic: every row holds its chip, with a label and a link to a row
      const report = await page.evaluate(() => {
        const out: { id: string; text: string; href: string | null }[] = []
        for (const row of document.querySelectorAll<HTMLElement>('[data-testid^="row-p"]')) {
          const id = row.dataset.testid!.replace('row-', '')
          const chip = row.querySelector<HTMLAnchorElement>(`[data-testid="dsa-pattern-${id}"]`)
          out.push({ id, text: chip?.innerText.trim() ?? '', href: chip?.getAttribute('href') ?? null })
        }
        return out
      })
      expect(report.length, t).toBeGreaterThan(0)
      for (const r of report) {
        expect(r.text.length, r.id).toBeGreaterThan(0)
        expect(r.href, r.id).toMatch(/^\/atlas\?pattern=[a-z-]+$/)
        seen++
      }
    }
    expect(seen).toBeGreaterThanOrEqual(170)
    // follow one chip: the Atlas row lists the problem
    await page.goto('/dsa?topic=2')
    await expect(page.getByTestId('topic-detail')).toBeVisible()
    const id = (await page.locator('[data-testid^="row-p"]').first().getAttribute('data-testid'))!.replace('row-', '')
    await page.getByTestId(`dsa-pattern-${id}`).click()
    await expect(page).toHaveURL(/\/atlas\?pattern=/)
    await expect(page.getByTestId('atlas-detail')).toBeVisible()
    await expect(page.getByTestId(`atlas-problem-${id}`)).toBeVisible()
    ok()
  })

  test('chip fits a phone row: no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await onboard(page, '2026-10-05')
    await page.goto('/dsa?topic=1')
    await expect(page.getByTestId('topic-detail')).toBeVisible()
    await page.getByTestId('topic-detail').locator('.trow').first().scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: `${SHOTS}/scope2-w7-dsa-chip-phone.png` })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByTestId('topic-detail').locator('.trow').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/scope2-w7-dsa-chip-desktop.png` })
  })
})

const NEW_ROWS: Record<string, string> = {
  'prefix-sum': 'prefixSum', 'dp-bitmask': 'bitmaskTsp', trie: 'trie', 'segment-fenwick': 'segTree', 'string-match': 'kmp',
  'scc-bridges': 'bridges', 'flow-matching': 'matching', combinatorics: 'pascal', simulation: 'life',
}
for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 375, height: 667 }]) {
  test(`W7 the nine new walkthroughs draw and play to the end at ${vp.name}`, async ({ page }) => {
    test.setTimeout(240_000)
    const ok = watch(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await onboard(page, '2026-10-05')
    mkdirSync(SHOTS, { recursive: true })
    for (const [slug, key] of Object.entries(NEW_ROWS)) {
      await page.goto(`/atlas?pattern=${slug}`)
      const first = page.getByTestId('atlas-walk-1')
      await expect(first).toBeVisible()
      await first.getByRole('button', { name: 'Play', exact: true }).click()
      const player = page.getByTestId('lab-player').first()
      await expect(player).toBeVisible()
      // stop autoplay, then use the player's own controls: the middle of the walk, then the last step
      await player.getByRole('button', { name: /Pause|Play/ }).first().click()
      const counter = player.getByTestId('lab-step-counter')
      await player.getByRole('button', { name: 'First step' }).click()
      const total = Number(/\/ (\d+)/.exec(await counter.innerText())![1])
      expect(total, key).toBeGreaterThan(8)
      if (vp.name === 'desktop') {
        for (let i = 0; i < Math.floor(total / 2); i++) await player.getByRole('button', { name: 'Step forward' }).click()
        await player.scrollIntoViewIfNeeded()
        await player.screenshot({ path: `${SHOTS}/scope2-w7-walk-${key}-mid-desktop.png` })
      }
      await player.getByRole('button', { name: 'Last step' }).click()
      await expect(counter).toHaveText(`STEP ${total} / ${total}`)
      await player.scrollIntoViewIfNeeded()
      await player.screenshot({ path: `${SHOTS}/scope2-w7-walk-${key}-end-${vp.name}.png` })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), key).toBe(false)
    }
    ok()
  })
}

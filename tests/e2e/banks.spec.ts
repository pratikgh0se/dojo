import { expect, test, type Page } from './fixtures'
import { IST, onboard } from './helpers'

const FONT_ORIGINS: string[] = [] // fonts are self-hosted (public/fonts)
const flashes = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset.flashes ?? '0'))

async function start(page: Page, errors: string[]) {
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.install({ time: IST('2026-10-12T09:00:00') })
  await onboard(page, '2026-10-05')
}
const tabCount = (page: Page, id: string) => page.getByTestId(`banks-tab-count-${id}`)
const xpTotal = async (page: Page) => {
  await page.goto('/')
  return Number((await page.getByTestId('xp-total').textContent())?.replace(/\D+/g, ''))
}

test('counts, sources and switching (S-01, S-03, S-05, S-06)', async ({ page }) => {
  const errors: string[] = []
  await start(page, errors)
  await page.goto('/banks')
  await expect(page.getByRole('tab', { name: /^Plan bank/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('banks-visible-count')).toHaveText('Showing 169 of 169')
  const want: Record<string, string> = { neetcode150: '0/6', blind75: '0/6', codeforces: '0/5', hellointerview: '0/3', mine: '0/0' }
  for (const [id, text] of Object.entries(want)) await expect(tabCount(page, id)).toHaveText(text)
  await page.getByRole('tab', { name: /^Fixture Set C/ }).click()
  await expect(page.getByTestId('banks-visible-count')).toHaveText('Showing 4 of 4', { timeout: 2000 })
  const n = await page.locator('[data-testid^="bank-item-"][data-status]').count()
  expect(n).toBe(4)
  await page.getByRole('tab', { name: /^Fixture Designs/ }).click()
  await expect(page).toHaveURL(/bank=hellointerview/)
  await page.reload()
  await expect(page.getByRole('tab', { name: /^Fixture Designs/ })).toHaveAttribute('aria-selected', 'true')
  await page.goBack()
  await expect(page.getByRole('tab', { name: /^Fixture Set C/ })).toHaveAttribute('aria-selected', 'true')
  expect(errors).toEqual([])
})

test('bank tick: XP but no plan progress, Board Done chip, reload, untick (S-21–S-25)', async ({ page }) => {
  const errors: string[] = []
  await start(page, errors)
  const xp0 = await xpTotal(page)
  await page.goto('/banks?bank=blind75')
  const f0 = await flashes(page)
  await page.getByRole('checkbox', { name: 'Done: Pair Finder' }).click()
  await expect(page.getByTestId('toast')).toContainText('+5 xp · Saved')
  await expect(tabCount(page, 'blind75')).toHaveText('1/6')
  expect(await flashes(page)).toBe(f0 + 1)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Done: Pair Finder' })).toBeChecked()
  expect(await xpTotal(page)).toBe(xp0 + 5)
  await page.goto('/dsa')
  await expect(page.getByTestId('dsa-solved')).toHaveText('0/169')
  await page.goto('/board')
  const card = page.getByTestId('col-done').getByTestId('card-p9001')
  await expect(card).toContainText('Pair Finder')
  await expect(card.getByTestId('bank-chip')).toHaveText('Fixture Set B')
  await page.goto('/banks?bank=blind75')
  await page.getByRole('checkbox', { name: 'Done: Pair Finder' }).click()
  await expect(tabCount(page, 'blind75')).toHaveText('0/6')
  expect(await xpTotal(page)).toBe(xp0)
  await page.goto('/board')
  await expect(page.getByTestId('card-p9001')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('in-plan and design overlap (S-27, S-29, S-31)', async ({ page }) => {
  const errors: string[] = []
  await start(page, errors)
  await page.goto('/banks?bank=blind75')
  await page.getByRole('checkbox', { name: 'Done: Region Counter' }).click()
  await expect(tabCount(page, 'plan')).toHaveText('1/169')
  await page.getByTestId('bank-cell-p200').click()
  await expect(page).toHaveURL(/\/dsa\?topic=1/)
  await expect(page.getByTestId('dsa-solved')).toHaveText('1/169')
  await page.goto('/banks?bank=hellointerview')
  await page.getByRole('checkbox', { name: 'Done: Fixture Chat' }).click()
  await expect(page.getByTestId('toast')).toContainText('+20 xp · Saved')
  await expect(page.getByTestId('bank-item-hi-fx-chat')).toHaveAttribute('data-ticket-id', 'd-chat')
  expect(errors).toEqual([])
})

test('Mine and Codeforces import survive reload (S-33, S-35, S-38, S-40, S-41)', async ({ page }) => {
  const errors: string[] = []
  await start(page, errors)
  await page.goto('/banks?bank=mine')
  await page.getByRole('textbox', { name: 'URL or name' }).fill('https://leetcode.com/problems/maximum-number-of-robots-within-budget/')
  await page.getByRole('button', { name: 'Classify' }).click()
  await expect(page.getByTestId('mine-suggestion-note')).toHaveText(/^\[fake:classify\]/)
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(tabCount(page, 'mine')).toHaveText('0/1')
  await page.getByRole('textbox', { name: 'URL or name' }).fill('https://leetcode.com/problems/fixture-pair-finder/')
  await page.getByRole('button', { name: 'Classify' }).click()
  await expect(page.getByTestId('mine-suggestion-note')).toHaveText('Known item · Fixture Set B')
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByTestId('bank-item-p9001')).toBeVisible()
  await page.getByRole('textbox', { name: 'URL or name' }).fill('__fail_classify__')
  await page.getByRole('button', { name: 'Classify' }).click()
  await expect(page.getByTestId('mine-error')).toContainText('fake classify failure')
  await page.goto('/banks?bank=codeforces')
  await page.getByRole('button', { name: 'Import ladder' }).click()
  await page.getByRole('textbox', { name: 'Ladder JSON' }).fill('[{"contestId":9999,"index":"Z","name":"Contract Import Probe","rating":1700,"tags":["greedy"]}]')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByTestId('banks-import-result')).toHaveText('1 new, 0 already present')
  await page.reload()
  await expect(page.getByTestId('bank-item-cf-9999Z')).toBeVisible()
  await page.goto('/banks?bank=mine')
  await expect(tabCount(page, 'mine')).toHaveText('0/2')
  expect(errors).toEqual([])
})

test('no foreign origins while using every tab (S-42)', async ({ page, baseURL }) => {
  const errors: string[] = []
  const foreign: string[] = []
  page.on('request', r => {
    const o = new URL(r.url()).origin
    if (o !== new URL(baseURL!).origin && !FONT_ORIGINS.includes(o)) foreign.push(r.url())
  })
  await start(page, errors)
  await page.goto('/banks')
  for (const name of ['Fixture Set A', 'Fixture Set B', 'Fixture Set C', 'Fixture Ladder', 'Fixture Designs', 'Mine', 'Plan bank']) {
    await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click()
  }
  await page.goto('/banks?bank=blind75&q=pair')
  await page.getByRole('checkbox', { name: 'Done: Pair Finder' }).click()
  await expect(page.getByRole('checkbox', { name: 'Done: Pair Finder' })).toBeChecked()
  await page.goto('/banks?bank=mine')
  await page.getByRole('textbox', { name: 'URL or name' }).fill('Kadane')
  await page.getByRole('button', { name: 'Classify' }).click()
  await expect(page.getByTestId('mine-suggestion')).toBeVisible()
  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})

test('560 px: no horizontal scroll, 44 px ticks (S-44)', async ({ page }) => {
  const errors: string[] = []
  await page.setViewportSize({ width: 560, height: 900 })
  await start(page, errors)
  for (const id of ['plan', 'neetcode150', 'blind75', 'striver', 'codeforces', 'hellointerview', 'mine']) {
    await page.goto(`/banks?bank=${id}`)
    await page.getByTestId('banks-visible-count').waitFor()
    const [sw, cw] = await page.evaluate(() => [document.scrollingElement!.scrollWidth, document.scrollingElement!.clientWidth])
    expect(sw, id).toBeLessThanOrEqual(cw)
    // F6.10 / triage M16: the visible tick is the 20 x 20 house checkbox; its label is the 44 x 44 tap box
    const tick = page.getByTestId('bank-item-tick').first()
    if (await tick.count()) {
      const box = await tick.locator('xpath=..').boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  }
  expect(errors).toEqual([])
})

test('reduced motion: Mine tick toasts without a flash (S-37)', async ({ page }) => {
  const errors: string[] = []
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await start(page, errors)
  await page.goto('/banks?bank=mine')
  await page.getByRole('textbox', { name: 'URL or name' }).fill('Kadane on a circular array')
  await page.getByRole('button', { name: 'Classify' }).click()
  const suggestion = page.getByRole('group', { name: 'Suggestion' })
  await suggestion.getByRole('combobox', { name: 'Difficulty' }).selectOption('H')
  await suggestion.getByRole('textbox', { name: 'Title' }).fill('Circular Kadane')
  await page.getByRole('button', { name: 'Accept' }).click()
  const f0 = await flashes(page)
  await page.getByRole('checkbox', { name: 'Done: Circular Kadane' }).click()
  await expect(page.getByTestId('toast')).toContainText('+15 xp · Saved')
  expect(await flashes(page)).toBe(f0)
  await expect(page.getByRole('button', { name: 'Remove Circular Kadane' })).toBeDisabled()
  await page.goto('/board')
  await expect(page.getByTestId('col-done').getByTestId('bank-chip')).toHaveText('Mine')
  expect(errors).toEqual([])
})

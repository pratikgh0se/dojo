import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'

// Findings of the computer-use UAT lane cu-r3 (dojo-acceptance/reports/uat/cu-r3.md), measured on the real page.
const WED = '2026-10-14T10:00:00'

async function openAi(page: Page) {
  await page.clock.setFixedTime(IST(WED))
  await onboard(page, '2026-10-05')
  await page.goto('/ai')
  await expect(page.getByRole('region', { name: 'Evidence' })).toBeVisible()
}

test.describe('A12 · the artifact dialog form is steady', () => {
  for (const w of [1280, 393]) {
    test(`${w}: errors do not reflow the form, VALUE/UNIT stay apart, Request grade is clear of the footer`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 })
      await openAi(page)
      await page.getByTestId('artifact-add').click()
      let dlg = page.getByRole('dialog', { name: 'New artifact' })
      await dlg.getByLabel('Title', { exact: true }).fill('steady form')
      const ys = async () => dlg.locator('input, select, textarea').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top - els[0].getBoundingClientRect().top)))
      const before = await ys()
      await dlg.getByLabel('Repo URL', { exact: true }).fill('nope')
      await dlg.getByLabel('Commit', { exact: true }).fill('zz')
      await dlg.getByLabel('Write-up link', { exact: true }).fill('nope')
      await expect(dlg.getByText('Enter an http(s) URL.')).toBeVisible()
      expect(await ys(), 'no field moved when the errors showed').toEqual(before)
      await dlg.getByLabel('Repo URL', { exact: true }).fill('https://github.com/example-user/forge')
      await dlg.getByLabel('Commit', { exact: true }).fill('a1b2c3d')
      await dlg.getByLabel('Write-up link', { exact: true }).fill('')
      await dlg.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(dlg).toBeHidden()
      await page.getByTestId('board-card').filter({ has: page.getByRole('button', { name: 'steady form', exact: true }) }).getByTestId('board-card-open').click()
      dlg = page.getByRole('dialog', { name: /Artifact · steady form/ })
      await expect(dlg).toBeVisible()

      const mf = dlg.getByTestId('measure-form')
      await mf.scrollIntoViewIfNeeded()
      const rects = async () => mf.locator('label, input, select, button').evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect()
        const o = e.closest('[data-testid="measure-form"]')!.getBoundingClientRect()
        return { t: e.tagName, l: Math.round(r.left), top: Math.round(r.top - o.top), r: Math.round(r.right), b: Math.round(r.bottom - o.top) }
      }))
      const m0 = await rects()
      await mf.getByRole('button', { name: 'Add measure' }).click()
      await expect(mf.getByText('Enter a number.')).toBeVisible()
      const m1 = await rects()
      expect(m1, 'the measures row did not move when its error showed').toEqual(m0)
      const labels = await mf.locator('label').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })))
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j]
        const overlap = a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
        expect(overlap, `labels ${i} and ${j} overlap: ${JSON.stringify(labels)}`).toBe(false)
      }

      // Request grade: wholly above the footer row, and a result does not send the dialog back to its top.
      const grade = dlg.getByTestId('grade-request')
      await grade.scrollIntoViewIfNeeded()
      const clear = async () => page.evaluate(() => {
        const g = document.querySelector('[data-testid="grade-request"]')!.getBoundingClientRect()
        const bar = [...document.querySelectorAll('.p-dialog > .p-actions')].pop()!.getBoundingClientRect()
        return { gb: g.bottom, bt: bar.top, gt: g.top }
      })
      const c = await clear()
      expect(c.gb, 'Request grade ends above the footer').toBeLessThanOrEqual(c.bt + 0.5)
      const top0 = await dlg.evaluate(e => e.scrollTop)
      await grade.click()
      await expect(dlg.getByTestId('grade-score')).toBeVisible()
      expect(await dlg.evaluate(e => e.scrollTop), 'the dialog did not jump to its top').toBeGreaterThan(Math.min(top0, 40))
    })
  }
})

test.describe('A13 · dialogs are min(640, viewport - 32) wide', () => {
  test('Discard this session? and End drawing now? at 1280 and 834', async ({ page }) => {
    const { begin, startSession, drawS1 } = await import('./design-helpers')
    await page.setViewportSize({ width: 1280, height: 900 })
    await begin(page)
    await startSession(page, 'Solo')
    await drawS1(page)
    for (const [w, name, opener] of [[1280, 'Discard this session?', 'Discard session'], [1280, 'End drawing now?', 'End drawing'], [834, 'Discard this session?', 'Discard session']] as const) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.getByRole('button', { name: opener }).click()
      const dlg = page.getByRole('dialog', { name })
      await expect(dlg).toBeVisible()
      const width = (await dlg.boundingBox())!.width
      expect(Math.round(width), `${name} at ${w}`).toBe(Math.min(640, w - 32))
      await dlg.getByRole('button', { name: /Cancel|Keep going/ }).click()
    }
  })
})

test('r3b P3-1: Solved after Not yet in one Blank test dialog says the attempt is recorded', async ({ page }) => {
  await openAi(page)
  await page.getByRole('button', { name: 'Blank test · Stage 00', exact: true }).click()
  const dlg = page.getByTestId('ai-blank-dialog')
  await dlg.getByLabel('What will you rebuild?').fill('micrograd')
  await dlg.getByTestId('ai-blank-start').click()
  await dlg.getByTestId('ai-blank-notyet').click()
  await expect(dlg.getByTestId('ai-blank-redo-due')).toBeVisible()
  await expect(dlg.getByTestId('ai-blank-recorded')).toHaveCount(0)
  await dlg.getByTestId('ai-blank-solved').click({ force: true })
  await expect(dlg.getByTestId('ai-blank-recorded')).toContainText('already recorded as Not yet')
})

test('r3b P3-4: the 2-up tier ladder tiles of a row are one height at 393', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 800 })
  await page.clock.setFixedTime(IST(WED))
  await onboard(page, '2026-10-05')
  await page.goto('/designs')
  await expect(page.locator('.ladder > .ladder-col')).toHaveCount(6)
  const hs = await page.locator('.ladder > .ladder-col').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { t: Math.round(r.top), h: Math.round(r.height) } }))
  expect(hs.length).toBe(6)
  for (let i = 0; i < 6; i += 2) {
    expect(hs[i].t, `row ${i / 2} tiles start together`).toBe(hs[i + 1].t)
    expect(hs[i].h, `row ${i / 2} tiles are one height`).toBe(hs[i + 1].h)
  }
})

test('r3b P3-5: the design session rail does not stick on a phone, and sticks at 1280', async ({ page }) => {
  const { begin, startSession, drawS1 } = await import('./design-helpers')
  await page.setViewportSize({ width: 393, height: 780 })
  await begin(page)
  await startSession(page, 'Solo')
  await drawS1(page)
  const rail = page.getByTestId('session-rail')
  expect(await rail.evaluate(e => getComputedStyle(e).position)).toBe('static')
  expect((await rail.boundingBox())!.height, 'compact: well under a quarter of the window').toBeLessThan(780 * 0.24)
  await page.setViewportSize({ width: 1280, height: 800 })
  expect(await rail.evaluate(e => getComputedStyle(e).position)).toBe('sticky')
})

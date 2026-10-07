import { expect, test, type Page } from '@playwright/test'
import { IST, onboard } from './helpers'
import { begin, completeS1, drawS1, endDrawing, fillClose, guard, pick, resumeAndGo, RL, RL_DIVES, scoreS1, startSession } from './design-helpers'

// Findings of the computer-use UAT lane cu-7 (dojo-acceptance/reports/uat/cu-7.md, 47aa717: Designs, the design session, the AI
// screen). Layout and scroll findings are measured here on the real page; the AI-output handling has its own vitest files.
const TUE = '2026-10-06T10:00:00'

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!
const noPageScroll = async (page: Page, w: number) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w)

test.describe('P2-2 · the design session stacks below 1100 (K3)', () => {
  test('834: the canvas sits above the side panel, in every phase, and Your diagram above the Reference', async ({ page }) => {
    const check = guard(page)
    await page.setViewportSize({ width: 834, height: 1000 })
    await begin(page)
    await startSession(page, 'Interviewer')
    await drawS1(page)
    let canvas = await box(page, 'kit-canvas')
    let side = await box(page, 'session-interviewer')
    expect(side.y, 'the Interviewer panel is below the canvas').toBeGreaterThanOrEqual(canvas.y + canvas.height - 1)
    expect(canvas.width, 'the canvas has the full width').toBeGreaterThan(700)
    await noPageScroll(page, 834)
    await page.clock.runFor(60_000)
    await endDrawing(page)
    canvas = await box(page, 'kit-canvas')
    const close = await box(page, 'session-close')
    expect(close.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1)
    await noPageScroll(page, 834)
    check()
  })

  test('834: the Done view stacks Your diagram over the Reference; 1100 puts them side by side', async ({ page }) => {
    const check = guard(page)
    await page.setViewportSize({ width: 834, height: 1000 })
    await begin(page)
    await completeS1(page)
    const yours = await box(page, 'session-yours')
    const ref = await box(page, 'session-reference')
    expect(ref.y).toBeGreaterThanOrEqual(yours.y + yours.height - 1)
    expect(yours.width).toBeGreaterThan(700)
    await noPageScroll(page, 834)
    await page.setViewportSize({ width: 1099, height: 1000 })
    expect((await box(page, 'session-reference')).y, '1099 is still stacked').toBeGreaterThanOrEqual((await box(page, 'session-yours')).y + 100)
    await page.setViewportSize({ width: 1100, height: 1000 })
    await expect.poll(async () => {
      const y2 = await box(page, 'session-yours')
      const r2 = await box(page, 'session-reference')
      return r2.x >= y2.x + y2.width - 1 && Math.abs(r2.y - y2.y) < 4
    }, { message: '1100 is two columns' }).toBe(true)
    check()
  })

  test('1100: canvas left, panel right; 1099 stacked', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 })
    await begin(page)
    await startSession(page, 'Interviewer')
    const canvas = await box(page, 'kit-canvas')
    const side = await box(page, 'session-interviewer')
    expect(side.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1)
    expect(canvas.width).toBeGreaterThan(side.width * 1.8)
    await page.setViewportSize({ width: 1099, height: 900 })
    expect((await box(page, 'session-interviewer')).y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1)
  })
})

test.describe('P2-3 · /ai on a phone keeps Blank test on screen', () => {
  for (const w of [375, 393]) {
    test(`${w}: every row's button sits inside the window and its row`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 812 })
      await page.clock.setFixedTime(IST(TUE))
      await onboard(page, '2026-10-05')
      await page.goto('/ai')
      await expect(page.getByTestId('ai-cube-ladder')).toBeVisible()
      for (const nn of ['00', '05', '11']) {
        const row = page.getByTestId(`ai-cube-row-${nn}`)
        await row.scrollIntoViewIfNeeded()
        const b = (await page.getByTestId(`ai-blank-${nn}`).boundingBox())!
        const r = (await row.boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(w)
        expect(b.x + b.width).toBeLessThanOrEqual(r.x + r.width + 1)
        // the whole label shows, not a clipped "B"
        expect(b.width).toBeGreaterThan(70)
      }
    })
  }
})

test.describe('P3 · the design session', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('P3-2 the JSON opens right under its button, in view, above the palette and the canvas', async ({ page }) => {
    await begin(page)
    await startSession(page, 'Solo')
    await drawS1(page)
    await page.getByRole('button', { name: 'JSON', exact: true }).click()
    const json = await box(page, 'kit-json')
    const btn = (await page.getByRole('button', { name: 'JSON', exact: true }).boundingBox())!
    const canvas = await box(page, 'kit-canvas')
    expect(json.y).toBeGreaterThanOrEqual(btn.y + btn.height - 1)
    expect(json.y - (btn.y + btn.height), 'the JSON starts within a few pixels of the toolbar').toBeLessThan(40)
    expect(json.y + json.height).toBeLessThanOrEqual(800)
    expect(json.y + json.height).toBeLessThanOrEqual(canvas.y + 1)
    expect(JSON.parse((await page.getByTestId('kit-json').textContent())!).layout).toBe('manual')
  })

  test('P3-3 the transcript follows the newest message', async ({ page }) => {
    const check = guard(page)
    await page.setViewportSize({ width: 393, height: 800 })
    await begin(page)
    await startSession(page, 'Interviewer')
    const msgs = page.getByTestId('session-msg')
    for (let i = 1; i <= 6; i++) {
      const n = await msgs.count()
      await page.getByRole('textbox', { name: 'Your answer' }).fill(`answer number ${i} with a few words so it wraps`)
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(msgs).toHaveCount(n + 2)
    }
    const log = page.getByRole('log', { name: 'Interview transcript' })
    const m = await log.evaluate(el => ({ top: el.scrollTop, h: el.scrollHeight, c: el.clientHeight }))
    expect(m.h, 'the transcript is longer than its box').toBeGreaterThan(m.c + 50)
    expect(m.top + m.c, 'the view is at the bottom').toBeGreaterThanOrEqual(m.h - 2)
    const last = (await msgs.last().boundingBox())!
    const lb = (await log.boundingBox())!
    expect(last.y + last.height).toBeLessThanOrEqual(lb.y + lb.height + 1)
    check()
  })

  test('P2-1 a closing line sent as done:true is taken; an unusable reply says so in plain words and Retry recovers', async ({ page }) => {
    const check = guard(page)
    await begin(page)
    await startSession(page, 'Interviewer')
    const msgs = page.getByTestId('session-msg')
    const say = async (t: string) => {
      const n = await msgs.count()
      await page.getByRole('textbox', { name: 'Your answer' }).fill(t)
      await page.getByRole('button', { name: 'Send' }).click()
      return n
    }
    for (let i = 1; i <= 8; i++) await expect(msgs).toHaveCount((await say(`answer ${i}`)) + 2)
    // the model closes with done:true: repaired, no error
    await page.evaluate(() => localStorage.setItem('dojo:fake-ai-interview', 'closing-done'))
    const n = await say('answer 9')
    await expect(msgs).toHaveCount(n + 2)
    await expect(page.getByTestId('session-ai-error')).toHaveCount(0)
    await expect(page.getByTestId('session-interview-status')).toHaveText('Interview complete · 4 of 4 deep dives')
    check()
  })

  test('P2-1 an unusable closing reply: a plain sentence, no validator words, Retry works', async ({ page }) => {
    await begin(page)
    await startSession(page, 'Interviewer')
    const msgs = page.getByTestId('session-msg')
    for (let i = 1; i <= 8; i++) {
      const n = await msgs.count()
      await page.getByRole('textbox', { name: 'Your answer' }).fill(`answer ${i}`)
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(msgs).toHaveCount(n + 2)
    }
    await page.evaluate(() => localStorage.setItem('dojo:fake-ai-interview', 'malformed'))
    await page.getByRole('textbox', { name: 'Your answer' }).fill('answer 9')
    await page.getByRole('button', { name: 'Send' }).click()
    const err = page.getByTestId('session-ai-error')
    await expect(err).toContainText('closing line did not come through')
    expect(await err.textContent()).not.toMatch(/must be|missing|lenses|perItem|oneThingToStudy/)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(err).toContainText('closing line did not come through')
    await page.evaluate(() => localStorage.removeItem('dojo:fake-ai-interview'))
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(err).toHaveCount(0)
    await expect(msgs.last()).toHaveAttribute('data-from', 'interviewer')
  })

  test('P3-9 a dialog is 640 wide (F6.6)', async ({ page }) => {
    await page.setViewportSize({ width: 1330, height: 900 })
    await begin(page)
    await startSession(page, 'Solo')
    await page.getByRole('button', { name: 'End drawing' }).click()
    const dlg = page.getByRole('dialog', { name: 'End drawing now?' })
    expect((await dlg.boundingBox())!.width).toBe(640)
    await dlg.getByRole('button', { name: 'Keep going' }).click()
    await page.getByRole('button', { name: 'Discard session' }).click()
    expect((await page.getByRole('dialog', { name: 'Discard this session?' }).boundingBox())!.width).toBe(640)
  })

  test('P3-7 / P3-12 / P3-15 the score form: each choice is one group that wraps as a unit; a bad rubric says why; a done session shows its length, not a clock', async ({ page }) => {
    for (const w of [1280, 393]) {
      await page.setViewportSize({ width: w, height: 900 })
      await begin(page)
      await startSession(page, 'Solo')
      await drawS1(page)
      await page.clock.runFor(12 * 60_000)
      await endDrawing(page)
      await fillClose(page, RL_DIVES[1])
      const groups = page.getByTestId('session-score').getByRole('radiogroup')
      const n = await groups.count()
      expect(n).toBe(11)
      for (let i = 0; i < n; i++) {
        const pos = await groups.nth(i).getByRole('radio').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] }))
        // a deep dive's three choices (they carry a word each) stand one under another; a lens's three share a line
        if (i < 4) expect(new Set(pos.map(p => p[0])).size, `dive ${i} at ${w}: one column ${pos}`).toBe(1)
        else expect(new Set(pos.map(p => p[1])).size, `lens ${i} at ${w}: one line ${pos}`).toBe(1)
      }
      const rubric = page.getByRole('spinbutton', { name: 'Rubric (0–20)' })
      await rubric.fill('25')
      await expect(page.getByTestId('session-rubric-error')).toContainText('0 to 20')
      await rubric.fill('')
      await expect(page.getByTestId('session-rubric-error')).toHaveCount(0)
      if (w === 1280) {
        await scoreS1(page)
        await page.getByRole('button', { name: 'Complete session' }).click()
        await expect(page.getByTestId('session-phase')).toHaveText('done')
        await expect(page.getByTestId('session-timer')).toHaveText('12 min')
        await expect(page.getByTestId('session-timer')).not.toHaveAttribute('role', 'timer')
      }
      // a fresh start for the second width
      await resumeAndGo(page, () => page.evaluate(() => indexedDB.databases().then(ds => ds.forEach(d => d.name && indexedDB.deleteDatabase(d.name)))))
    }
  })

  test('P3-5 Your diagram and the Reference fit their wells at 375: nothing is cut, nothing scrolls sideways', async ({ page }) => {
    const check = guard(page)
    await page.setViewportSize({ width: 375, height: 900 })
    await begin(page)
    await completeS1(page)
    await expect(page.getByTestId('session-reference-json').or(page.getByTestId('session-reference').locator('sr-diagram'))).toBeVisible()
    for (const id of ['session-yours', 'session-reference']) {
      const well = page.getByTestId(id).locator('.ds-well')
      await expect(well.locator('.fit-sizer[data-scale]')).toHaveCount(1)
      const m = await well.evaluate(el => {
        const w = el.getBoundingClientRect()
        const svg = el.querySelector('sr-diagram')!.shadowRoot!.querySelector('svg')!.getBoundingClientRect()
        return { sx: el.scrollWidth - el.clientWidth, left: svg.left - w.left, right: w.right - svg.right, width: svg.width, wellW: w.width }
      })
      expect(m.sx, `${id} scrolls sideways`).toBeLessThanOrEqual(1)
      expect(m.left).toBeGreaterThanOrEqual(-1)
      expect(m.right, `${id}: the drawing ends inside its well`).toBeGreaterThanOrEqual(-1)
      expect(m.width).toBeLessThanOrEqual(m.wellW)
    }
    check()
  })
})

test.describe('P3 · Designs', () => {
  test('P3-6 tier names never break inside a word at 393 and 375', async ({ page }) => {
    await page.clock.setFixedTime(IST(TUE))
    await onboard(page, '2026-10-05')
    for (const w of [393, 375, 834, 1280]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/designs')
      await expect(page.getByTestId('tier-ladder')).toBeVisible()
      const broken = await page.locator('.ladder-name').evaluateAll(els => {
        const out: string[] = []
        for (const el of els) {
          const text = el.firstChild as Text
          const re = /\S+/g
          let m: RegExpExecArray | null
          while ((m = re.exec(text.data))) {
            const r = document.createRange()
            r.setStart(text, m.index)
            r.setEnd(text, m.index + m[0].length)
            if (r.getClientRects().length > 1) out.push(m[0])
          }
        }
        return out
      })
      expect(broken, `at ${w}`).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w)
    }
  })

  test('P3-4 / P3-5 / P3-10 after a session: a wall cell names itself on hover, the shelf thumbnail shows the whole drawing, the tile and the wall agree', async ({ page }) => {
    const check = guard(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await begin(page)
    await completeS1(page)
    await resumeAndGo(page, () => page.goto('/designs'))
    const cell = page.getByTestId('wall-cell').first()
    await expect(cell).toHaveAttribute('title', /.+ · deep dive 1 · /)
    // wall says 2 answered in full (dives 1 and 3 of S1); the tile reads both numbers
    await expect(page.getByText('2 of 192 answered in full')).toBeVisible()
    await expect(page.getByTestId('designs-dives').locator('xpath=..')).toContainText('2 answered in full')
    const thumb = page.getByTestId('shelf-tier-2').getByTestId('shelf-thumb').first()
    await expect(thumb.locator('.fit-sizer[data-scale]')).toHaveCount(1)
    const m = await thumb.locator('.ev-thumb-art').evaluate(el => {
      const a = el.getBoundingClientRect()
      const s = el.querySelector('sr-diagram')!.shadowRoot!.querySelector('svg')!.getBoundingClientRect()
      return { l: s.left - a.left, t: s.top - a.top, r: a.right - s.right, b: a.bottom - s.bottom, w: s.width, h: s.height }
    })
    expect(m.l).toBeGreaterThanOrEqual(-1)
    expect(m.t).toBeGreaterThanOrEqual(-1)
    expect(m.r).toBeGreaterThanOrEqual(-1)
    expect(m.b).toBeGreaterThanOrEqual(-1)
    expect(m.w, 'the drawing fills a useful part of its thumbnail').toBeGreaterThan(60)
    check()
  })
})

test.describe('P3-8 · a dialog does not let the page scroll behind it', () => {
  test('wheel over the Add artifact dialog leaves the page where it was', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 })
    await page.clock.setFixedTime(IST(TUE))
    await onboard(page, '2026-10-05')
    await page.goto('/ai')
    await page.getByTestId('artifact-add').scrollIntoViewIfNeeded()
    await page.getByTestId('artifact-add').click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    const y0 = await page.evaluate(() => window.scrollY)
    await page.mouse.move(40, 300)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.scrollY)).toBe(y0)
  })
})

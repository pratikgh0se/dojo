import { expect, test, type Locator, type Page } from '@playwright/test'
import { onboard } from './helpers'

// Findings of the computer-use UAT lane cu-6 (dojo-acceptance/reports/uat/cu-6.md: DSA, Banks, Atlas, Map). One file for the
// Chromium project, so each finding's e2e sits together.
const exact = (name: string) => ({ name, exact: true })
const warmup = (page: Page) => page.getByRole('region', exact('Warm-up'))

async function lastStep(page: Page, topic: number): Promise<Locator> {
  await onboard(page, '2026-10-05')
  await page.goto(`/dsa?topic=${topic}`)
  const warm = warmup(page)
  await warm.getByRole('button', exact('Last step')).click()
  return warm.getByTestId('lab-player')
}

/** Every drawn text that sits inside a box (a graph node, an array / queue cell) fits that box; no caption leaves the drawing. */
async function fitProblems(player: Locator): Promise<string[]> {
  return player.evaluate(host => {
    const root = (host.querySelector('sr-algo, sr-algo2') as HTMLElement).shadowRoot!
    const svg = root.querySelector('svg')!
    const W = svg.getBoundingClientRect().width
    const rects = [...svg.querySelectorAll('rect[stroke]')].map(r => r.getBoundingClientRect()).filter(r => r.width > 8)
    const bad: string[] = []
    svg.querySelectorAll('text').forEach(t => {
      const b = t.getBoundingClientRect()
      const s = t.textContent ?? ''
      if (t.hasAttribute('data-cap')) { if (b.right > svg.getBoundingClientRect().left + W + 1) bad.push(`caption "${s}" leaves the drawing`); return }
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2
      const box = rects.find(r => cx > r.left && cx < r.right && cy > r.top && cy < r.bottom)
      if (box && (b.left < box.left - 0.5 || b.right > box.right + 0.5)) bad.push(`"${s}" is ${Math.round(b.width)} wide in a ${Math.round(box.width)} wide box`)
    })
    return bad
  })
}

test.describe('P2-1 · the Topological sort warm-up: node labels and the ORDER cells hold their text', () => {
  test.use({ viewport: { width: 1330, height: 900 } })

  test('at the last step every label fits its node or cell, and the labels do not overlap', async ({ page }) => {
    const player = await lastStep(page, 2)
    expect(await fitProblems(player)).toEqual([])
    const names = await player.evaluate(host => {
      const svg = (host.querySelector('sr-algo') as HTMLElement).shadowRoot!.querySelector('svg')!
      const boxes = [...svg.querySelectorAll('text')].filter(t => ['shirt', 'tie', 'jacket', 'pants', 'belt', 'shoes', 'socks'].includes(t.textContent ?? '')).map(t => t.getBoundingClientRect())
      let overlaps = 0
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++
      }
      return { n: boxes.length, overlaps }
    })
    expect(names.n).toBe(14) // 7 nodes + 7 ORDER cells
    expect(names.overlaps).toBe(0)
  })
})

test.describe('P3-3 · the Union-find warm-up: the caption fits and the find tag stays off the neighbours', () => {
  test.use({ viewport: { width: 1330, height: 900 } })

  test('every step: the caption stays inside the drawing and no tag sits on another', async ({ page }) => {
    const player = await lastStep(page, 3)
    await player.getByRole('button', exact('First step')).click()
    const fwd = player.getByRole('button', exact('Step forward'))
    for (let k = 1; k <= 75; k++) {
      await fwd.click()
      if (k % 5 !== 1) continue
      const r = await player.evaluate(host => {
        const svg = (host.querySelector('sr-algo2') as HTMLElement).shadowRoot!.querySelector('svg')!
        const box = svg.getBoundingClientRect()
        // a text's box is its line box, about 4 px taller than the glyphs on each side: compare the glyph rows
        const glyphs = (t: Element) => { const b = t.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top + 4, bottom: b.bottom - 4 } }
        const texts = [...svg.querySelectorAll('text')].map(t => ({ s: t.textContent ?? '', b: glyphs(t), cap: t.hasAttribute('data-cap') }))
        const cap = texts.find(t => t.cap)!
        const capRight = svg.querySelector('text[data-cap]')!.getBoundingClientRect().right
        const tags = texts.filter(t => !t.cap && (t.s === 'find' || /^r\d+$/.test(t.s)))
        let overlaps = 0
        for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
          const a = tags[i]!.b, b = tags[j]!.b
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++
        }
        const onCaption = tags.filter(t => t.b.left < cap.b.right && t.b.right > cap.b.left && t.b.top < cap.b.bottom && t.b.bottom > cap.b.top).length
        const outside = tags.filter(t => t.b.right > box.right + 1 || t.b.left < box.left - 1).length
        return { r: { capOk: capRight <= box.right + 1, overlaps, onCaption, outside }, dbg: JSON.stringify([cap.b, ...tags.map(t => [t.s, t.b.left, t.b.top, t.b.right, t.b.bottom])]) }
      })
      expect(r.r, `step ${k} ${r.dbg}`).toEqual({ capOk: true, overlaps: 0, onCaption: 0, outside: 0 })
    }
  })
})

/** The button's resting box shadow's drop and its translateY, as drawn. */
const pressedLook = (b: Locator) => b.evaluate(el => {
  const cs = getComputedStyle(el)
  return { ty: new DOMMatrix(cs.transform).m42, drop: /rgb\(15, 17, 28\) 0px 0px 0px 0px$/.test(cs.boxShadow) }
})

test.describe('P3-1 / P3-4 · a toggled button keeps the pressed look (F6.1)', () => {
  test.use({ viewport: { width: 1330, height: 900 } })

  test('the warm-up chip, Predict and Sort by problems left are down while pressed and up otherwise', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/dsa?topic=7')
    const warm = warmup(page)
    const chips = warm.getByRole('group', exact('Warm-up walkthroughs')).getByRole('button')
    await expect(chips.first()).toBeVisible()
    expect(await chips.count()).toBeGreaterThan(1)
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => pressedLook(chips.first())).toEqual({ ty: 4, drop: true })
    await expect.poll(() => pressedLook(chips.nth(1))).toEqual({ ty: 0, drop: false })
    await chips.nth(1).click()
    await expect.poll(() => pressedLook(chips.nth(1))).toEqual({ ty: 4, drop: true })
    await expect.poll(() => pressedLook(chips.first())).toEqual({ ty: 0, drop: false })

    const predict = warm.getByRole('button', exact('Predict'))
    await expect.poll(() => pressedLook(predict)).toEqual({ ty: 0, drop: false })
    await predict.click()
    await expect(predict).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => pressedLook(predict)).toEqual({ ty: 4, drop: true })

    await page.goto('/atlas')
    const sort = page.getByRole('button', exact('Sort by problems left'))
    await expect.poll(() => pressedLook(sort)).toEqual({ ty: 0, drop: false })
    await sort.click()
    await expect(sort).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => pressedLook(sort)).toEqual({ ty: 4, drop: true })
    await sort.click()
    await expect.poll(() => pressedLook(sort)).toEqual({ ty: 0, drop: false })
  })
})

test.describe('P3-2 · the block scrubber under a player goes to the step you click or drag to', () => {
  test.use({ viewport: { width: 1330, height: 900 } })

  test('click, drag, and the end of a drag; it is off in a predict run', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/dsa?topic=1')
    const warm = warmup(page)
    const counter = warm.getByTestId('lab-step-counter')
    const scrub = warm.getByTestId('lab-scrub')
    await scrub.scrollIntoViewIfNeeded()
    await expect(scrub).toBeVisible()
    const box = (await scrub.boundingBox())!
    const n = Number((await counter.textContent())!.split('/')[1])
    expect(n).toBeGreaterThan(20)
    const y = box.y + box.height / 2
    const stepNow = async () => Number((await counter.textContent())!.match(/STEP (\d+)/)![1])
    await page.mouse.click(box.x + box.width * 0.5, y)
    await expect.poll(stepNow).toBeGreaterThan(0)
    const mid = await stepNow()
    expect(Math.abs(mid - n / 2)).toBeLessThanOrEqual(Math.ceil(n / 60) + 1)
    // dragging: the step follows the pointer, and past the left end it is back at 0
    await page.mouse.move(box.x + box.width * 0.2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 6 })
    await expect.poll(stepNow).toBeGreaterThan(mid)
    const dragged = await stepNow()
    expect(Math.abs(dragged - n * 0.8)).toBeLessThanOrEqual(Math.ceil(n / 60) + 1)
    await page.mouse.move(box.x - 40, y, { steps: 6 })
    await page.mouse.up()
    await expect(counter).toHaveText(`STEP 0 / ${n}`)
    // the player's own pieces follow the step
    await page.mouse.click(box.x + box.width - 2, y)
    await expect(counter).toHaveText(`STEP ${n} / ${n}`)
    await expect(warm.getByTestId('lab-player')).toHaveAttribute('data-step', String(n))
    // a predict run asks its questions in order: the scrubber is off
    await warm.getByRole('button', exact('Predict')).click()
    await expect(scrub).toHaveAttribute('data-enabled', 'false')
    await expect(counter).toHaveText(`STEP 0 / ${n}`)
    await page.mouse.click(box.x + box.width * 0.5, y)
    await expect(counter).toHaveText(`STEP 0 / ${n}`)
  })
})

test.describe('P3-5 · arriving at /dsa by a link that names a topic brings the topic into view', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a Plan · S<n> link in Banks lands with the topic detail on screen; a reload keeps its position', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/banks')
    const link = page.getByTestId('bank-item-inplan').last()
    await link.scrollIntoViewIfNeeded()
    await link.click()
    await expect(page).toHaveURL(/\/dsa\?topic=\d+$/)
    const detail = page.getByTestId('topic-detail')
    await expect(detail).toBeVisible()
    await expect.poll(() => page.getByTestId('lab-player').first().evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight * 0.5 })).toBe(true)
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
    // a reload is a POP: it keeps wherever the browser puts it (no extra scroll to the detail)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.reload()
    await expect(detail).toBeVisible()
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5)
  })
})

test.describe('P3-6 · Atlas with no row open does not leave the right of the screen empty', () => {
  test('desktop: a hint stands where the detail opens; it gives way to the detail, and is left out on a tablet', async ({ page }) => {
    await page.setViewportSize({ width: 1330, height: 900 })
    await onboard(page, '2026-10-05')
    await page.goto('/atlas')
    const hint = page.getByTestId('atlas-hint')
    await expect(hint).toBeVisible()
    const m = (await page.getByTestId('atlas-matrix').boundingBox())!
    const h = (await hint.boundingBox())!
    expect(h.x).toBeGreaterThanOrEqual(m.x + m.width - 1)
    expect(h.x + h.width).toBeGreaterThan(1330 * 0.8)
    await page.getByTestId('atlas-row-topo-sort').getByRole('button').first().click()
    await expect(page.getByTestId('atlas-detail')).toBeVisible()
    await expect(hint).toHaveCount(0)
    await page.setViewportSize({ width: 834, height: 1100 })
    await page.goto('/atlas')
    await expect(page.getByTestId('atlas-matrix')).toBeVisible()
    await expect(hint).toBeHidden()
  })
})

test.describe('cu-6 (design alignment) · Atlas on a phone: pinned row headers and the problem list', () => {
  test.use({ viewport: { width: 393, height: 852 } })

  test('a scrolled matrix shows no cell beside the pinned row headers', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/atlas')
    const wrap = page.locator('.atlas-matrix-wrap')
    await wrap.scrollIntoViewIfNeeded()
    await wrap.evaluate(el => { el.scrollLeft = 250 })
    await expect(wrap).toHaveAttribute('data-scrolled', 'true')
    expect(await page.locator('.am-corner').evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none')
    await wrap.evaluate(el => { el.scrollLeft = 0 })
    await expect(wrap).toHaveAttribute('data-scrolled', 'false')
    expect(await page.locator('.am-corner').evaluate(el => getComputedStyle(el).boxShadow)).toBe('none')
    await wrap.evaluate(el => { el.scrollLeft = 250 })
    const row = page.getByTestId('atlas-row-sorting')
    const head = row.locator('th').first()
    await expect.poll(async () => {
      const w = (await wrap.boundingBox())!
      const r = (await head.boundingBox())!
      // every point left of the row header's text, from the well's inner edge to the header's right edge, is the header itself
      return page.evaluate(([x, y, hx]) => {
        const out: string[] = []
        for (let px = x; px < hx; px += 4) { const e = document.elementFromPoint(px, y); if (e && !e.closest('th')) out.push(`${px}:${e.tagName}`) }
        return out
      }, [w.x + 3, r.y + r.height / 2, r.x + r.width - 2] as const)
    }).toEqual([])
  })

  test('each tagged problem is one block: its cube, title and sprint share the title\'s lines', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/atlas?pattern=binary-search')
    const items = page.getByTestId('atlas-detail').locator('.atlas-problems li')
    await expect(items.first()).toBeVisible()
    const n = await items.count()
    expect(n).toBeGreaterThan(5)
    for (let i = 0; i < n; i++) {
      const [cube, link, sprint] = await items.nth(i).evaluate(li => [...li.children].map(c => { const r = c.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }))
      expect(cube!.top, `row ${i} cube`).toBeGreaterThanOrEqual(link!.top - 1)
      expect(cube!.bottom, `row ${i} cube`).toBeLessThanOrEqual(link!.bottom + 1)
      expect(sprint!.top, `row ${i} sprint`).toBeGreaterThanOrEqual(link!.top - 1)
      expect(sprint!.bottom, `row ${i} sprint`).toBeLessThanOrEqual(link!.bottom + 1)
    }
  })
})

test.describe('P3-11 · Overview timeline on a phone: ticks are sprint numbers, not dates', () => {
  test('393: S1, S13, ... with no printed date; the date is in the tick title', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    await onboard(page, '2026-10-05')
    await page.goto('/overview')
    const ticks = page.locator('[data-testid^="tick-"]')
    await expect(ticks.first()).toBeAttached()
    expect(await page.locator('.tl-tick').allTextContents()).toEqual(['S1', 'S13', 'S25', 'S37', 'S49', 'S61'])
    await expect(page.locator('.tl-date')).toHaveCount(0)
    await expect(ticks.first().locator('title')).toHaveText(/^S1 starts 2026-10-05$/)
  })
})

test.describe('P3-14 · Hello Interview rows: an empty difficulty or pattern reads `—` without a box', () => {
  test('the chips still read `—` (S-12) and have no visible border', async ({ page }) => {
    await onboard(page, '2026-10-05')
    await page.goto('/banks?bank=hellointerview')
    const first = page.getByTestId('bank-item-difficulty').first()
    await expect(first).toHaveText('—')
    await expect(page.getByTestId('bank-item-pattern').first()).toHaveText('—')
    expect(await first.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgba(0, 0, 0, 0)')
    // a filled chip keeps its box
    await page.goto('/banks')
    const filled = page.getByTestId('bank-item-pattern').first()
    await expect(filled).not.toHaveText('—')
    expect(await filled.evaluate(el => getComputedStyle(el).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)')
  })
})

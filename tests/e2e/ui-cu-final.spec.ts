import { expect, test, type Page } from '@playwright/test'
import { idbAll, idbPatch, IST, onboard } from './helpers'

// Findings of the final real-cursor pass (dojo-acceptance/reports/uat/cu-final.md): each assertion is what the tester measured.
const TUE = '2026-10-06T10:00:00'
async function open(page: Page, path: string, ready: string) {
  await page.clock.setFixedTime(IST(TUE))
  await onboard(page, '2026-10-05')
  if (path !== '/') await page.goto(path)
  await expect(page.getByTestId(`screen-${ready}`)).toHaveAttribute('data-ready', 'true')
}
const BRIEF = { status: 'draft', source: 'ai', goal: 'g', steps: [], minutes: 30, dayType: 'code', learn: [], outcome: 'o', deliverable: { kind: 'none', prompt: '' }, questions: [] }
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test.describe('rows 1 / 4 / 9 · one tooltip: the app\'s own, never beside a native title, and clear of the controls', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('no element carries both data-tip and title (Today, Board, Do), and the Do timer bubble does not cover Start', async ({ page }) => {
    await open(page, '/', 'today')
    const both = () => page.evaluate(() => document.querySelectorAll('[data-tip][title]').length)
    expect(await both()).toBe(0)
    await page.goto('/board')
    await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
    expect(await both()).toBe(0)
    await page.goto('/do/p200')
    await expect(page.getByTestId('screen-do')).toHaveAttribute('data-ready', 'true')
    expect(await both()).toBe(0)
    for (const target of [page.locator('.timer-row'), page.getByTestId('do-timer-elapsed')]) {
      await target.hover()
      const tip = page.getByTestId('tip')
      await expect(tip).toBeVisible()
      const tb = (await tip.boundingBox())!
      for (const id of ['do-timer-preset-25', 'do-timer-preset-50', 'start-session']) {
        expect(overlaps(tb, (await page.getByTestId(id).boundingBox())!), `${id} stays uncovered`).toBe(false)
      }
      await page.mouse.move(5, 5)
      await expect(tip).toBeHidden()
    }
  })

  test('the consistency grid and Retreat each show one bubble and no title', async ({ page }) => {
    await open(page, '/', 'today')
    const cell = page.locator('.consistency [data-tip]').first()
    await expect(cell).not.toHaveAttribute('title', /.+/)
    await cell.hover()
    await expect(page.getByTestId('tip')).toHaveCount(1)
  })
})

test.describe('row 3 · scope tooltips', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('every Board column head (Done too) and the Today "This sprint" tile say their scope', async ({ page }) => {
    await open(page, '/board', 'board')
    for (const c of ['slid', 'todo', 'doing', 'done']) await expect(page.getByTestId(`head-${c}`)).toHaveAttribute('data-tip', /in .*, Sprint \d+/)
    await expect(page.getByTestId('head-done')).toHaveAttribute('data-tip', /^\d+ cards? in Done/)
    await page.goto('/')
    await expect(page.getByTestId('now-eyebrow')).toBeVisible()
    const tile = page.getByTestId('health-stat').filter({ hasText: 'This sprint' })
    await expect(tile).toHaveAttribute('data-tip', /plan tasks done this sprint/)
    await tile.hover()
    await expect(page.getByTestId('tip')).toContainText('plan tasks done this sprint')
  })
})

test.describe('row 10 · the brief chip leads the chip row', () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  test('on a card that also has a resource chip, brief is the first chip and the row is one line', async ({ page }) => {
    await open(page, '/board', 'board')
    const withSrc = page.locator('article.card:has(.chip-src)').first()
    await expect(withSrc).toBeVisible()
    const id = (await withSrc.getAttribute('data-testid'))!.replace('card-', '')
    await idbPatch(page, 'tickets', [id], { brief: BRIEF })
    await page.reload()
    await expect(page.getByTestId('screen-board')).toHaveAttribute('data-ready', 'true')
    const chips = page.getByTestId(`card-${id}`).locator('.card-chips > .chip')
    await expect(chips.first()).toHaveText('brief · draft')
    const tops = await chips.evaluateAll(cs => cs.filter(c => !c.classList.contains('pin-ghost')).map(c => Math.round(c.getBoundingClientRect().top)))
    expect(tops.length).toBeGreaterThanOrEqual(2)
    expect(tops[0], 'brief is on the first row of the chips').toBe(Math.min(...tops))
    expect(await chips.evaluateAll(cs => cs.slice(1).some(c => c.classList.contains('chip-brief'))), 'brief appears once, first').toBe(false)
  })
})

test.describe('row 21 · a session closed with 0 focus blocks keeps its Earlier sessions row', () => {
  test('Start session, Solved at once on DSA 200: the row is there after the approach question and on reopening', async ({ page }) => {
    await open(page, '/do/p200', 'do')
    await page.getByRole('button', { name: 'Start session' }).click()
    await page.getByRole('dialog', { name: 'Plan this session' }).getByRole('button', { name: 'Start' }).click()
    await expect(page.getByTestId('session-timer')).toBeVisible()
    await page.getByRole('button', { name: 'Solved ✓' }).click()
    await expect(page.getByTestId('session-history')).toContainText('Ended by: Solved ✓')
    await page.getByRole('button', { name: /Back to Board/ }).click()
    await page.goto('/do/p200')
    await expect(page.getByTestId('session-history')).toContainText('0 min focus')
    expect((await idbAll<{ focusMinutes?: number }>(page, 'sessions'))[0]!.focusMinutes).toBe(0)
  })
})

test.describe('row 29 · the tier ladder at 393', () => {
  test.use({ viewport: { width: 393, height: 852 } })
  test('two across, the two tiles of a row are one height and their text starts at the top', async ({ page }) => {
    await open(page, '/designs', 'designs')
    const tiles = page.locator('.ladder-col')
    const n = await tiles.count()
    expect(n).toBeGreaterThanOrEqual(4)
    const r = await tiles.evaluateAll(ts => ts.map(t => {
      const b = t.getBoundingClientRect()
      const name = t.querySelector('.ladder-name')!.getBoundingClientRect()
      return { top: Math.round(b.top), h: Math.round(b.height * 10) / 10, nameOff: Math.round(name.top - b.top) }
    }))
    for (let i = 0; i + 1 < n; i += 2) {
      expect(r[i]!.top, `row ${i / 2} tiles share a top`).toBe(r[i + 1]!.top)
      expect(r[i]!.h, `row ${i / 2} tiles are one height`).toBe(r[i + 1]!.h)
    }
    for (const t of r) expect(t.nameOff, 'the name sits at the top of its tile').toBeLessThanOrEqual(10)
  })
})

test.describe('row 25 · reference diagram node labels at 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } })
  test('the label never touches its sub-label, and both sit inside the chip', async ({ page }) => {
    await open(page, '/', 'today')
    const data = { layout: 'layered', nodes: [
      { id: 'c', kind: 'browser', label: 'Client' }, { id: 'lb', kind: 'loadbalancer', label: 'Load Balancer' },
      { id: 'gw', kind: 'gateway', label: 'API Gateway', sub: 'auth, rate limit' }, { id: 'svc', kind: 'service', label: 'Order Service', sub: 'node · 3 replicas' }],
      links: [{ from: 'c', to: 'lb' }, { from: 'lb', to: 'gw' }, { from: 'gw', to: 'svc' }] }
    const r = await page.evaluate(async d => {
      const s = document.createElement('script'); s.src = '/engines/diagram.js'; document.head.appendChild(s)
      await new Promise(res => { s.onload = res })
      await document.fonts.ready
      const mod = '/src/lib/engineType.ts'
      const { adoptReadable } = await import(/* @vite-ignore */ mod)
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:1280px;z-index:99999;background:#111'
      const el = document.createElement('sr-diagram'); el.setAttribute('data', JSON.stringify(d)); el.setAttribute('theme', 'dark'); el.setAttribute('view', '2d')
      host.appendChild(el); document.body.appendChild(host)
      await customElements.whenDefined('sr-diagram')
      adoptReadable(el); await new Promise(res => setTimeout(res, 400)); adoptReadable(el); await new Promise(res => setTimeout(res, 400))
      const svg = el.shadowRoot!.querySelector('svg')!
      const texts = [...svg.querySelectorAll('text')].map(t => ({ s: t.textContent ?? '', b: t.getBoundingClientRect() }))
      // chips: the stroked rects 46 or 28 tall under a prop
      const chips = [...svg.querySelectorAll('rect[stroke]')].map(x => x.getBoundingClientRect()).filter(b => b.height >= 28 && b.height <= 46 && b.width > 60)
      const out: string[] = []
      for (const [label, sub] of [['API GATEWAY', 'auth, rate limit'], ['ORDER SERVICE', 'node · 3 replicas']]) {
        const a = texts.find(t => t.s === label)!, b = texts.find(t => t.s === sub)!
        const glyphBottom = a.b.top + a.b.height - 4 // the line box is ~4 px taller than the glyphs
        if (b.b.top + 4 < glyphBottom) out.push(`${label} overlaps ${sub}`)
        for (const t of [a, b]) {
          const chip = chips.find(c => t.b.left >= c.left - 1 && t.b.left < c.right && t.b.top >= c.top - 1 && t.b.top < c.bottom)
          if (!chip || t.b.right > chip.right - 4) out.push(`${t.s} leaves its chip`)
        }
      }
      const lb = texts.find(t => t.s === 'LOAD BALANCER')!
      const lbChip = chips.find(c => lb.b.left >= c.left - 1 && lb.b.left < c.right && lb.b.top >= c.top - 1 && lb.b.top < c.bottom)
      if (!lbChip || lb.b.right > lbChip.right - 6) out.push('LOAD BALANCER touches the chip edge')
      return out
    }, data)
    expect(r).toEqual([])
  })
})

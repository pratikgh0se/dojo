import { expect, test, type Locator, type Page } from './fixtures'
import { onboard } from './helpers'

// P3 findings of the code-blind Electron UAT run 3 (dojo-acceptance/reports/uat/dojo-electron-r3.md, e9148d2)
// that need only the page (vite dev, Dexie): the storage-backed ones are in storage/ui-uat-r3.spec.ts.

const exact = (name: string) => ({ name, exact: true })
const counter = (scope: Page | Locator) => scope.getByTestId('lab-step-counter').first()

type EngineEl = HTMLElement & {
  k: number
  model: { structures: { t: { nodes: Record<string, { label: string }> } } }
  stateAt(k: number): { calls: { frames: string[] }; t: { nodeState: Record<string, string> } }
}

test('r3 J6 (P3): Memoization · fib(5): every step has a caption, and the call stack, the tree and n agree', async ({ page }) => {
  await onboard(page, '2026-10-05')
  await page.goto('/atlas?pattern=dp-memo')
  await page.getByRole('list', exact('Walkthroughs')).getByRole('listitem')
    .filter({ has: page.getByText('Memoization · fib(5)', { exact: true }) }).getByRole('button', exact('Play')).click()
  const p = page.getByRole('region', exact('Player: Memoization · fib(5)'))
  await p.getByRole('button', exact('Pause')).click()
  await p.getByRole('button', exact('First step')).click()
  await expect(counter(p)).toHaveText('STEP 0 / 27') // UAT r4 J6: the walkthrough now agrees with its code
  const seen = { calls: 0 }
  for (let k = 1; k <= 27; k++) {
    await p.getByRole('button', exact('Step forward')).click()
    await expect(counter(p)).toHaveText(`STEP ${k} / 27`)
    const caption = (await p.getByTestId('lab-caption').textContent()) ?? ''
    expect(caption.trim(), `caption at step ${k}`).not.toBe('')
    // UAT r4 J6: no memo write for a base case, and on a return n is the frame now on top
    expect(caption, `step ${k}`).not.toMatch(/^memo\[[01]\]/)
    const r = /^fib\(\d\) returns \d\.$/.exec(caption)
    if (r) {
      const top = await p.locator('sr-algo').evaluate((el: HTMLElement) => { const e = el as EngineEl; return e.stateAt(e.k).calls.frames.at(-1) ?? null })
      if (top) await expect(p.locator('.lab-vars dt', { hasText: /^n$/ }).locator('xpath=following-sibling::dd'), `n at step ${k}`).toHaveText(top.replace(/^fib\((\d)\)$/, '$1'))
    }
    const m = /^Call fib\((\d)\)\.$/.exec(caption)
    if (!m) continue
    seen.calls++
    const n = m[1]
    const engine = await p.locator('sr-algo').evaluate((el: HTMLElement) => {
      const e = el as EngineEl
      const s = e.stateAt(e.k)
      const nodes = e.model.structures.t.nodes
      return { top: s.calls.frames.at(-1) ?? null, current: Object.entries(s.t.nodeState).filter(([, st]) => st === 'current').map(([id]) => nodes[id].label) }
    })
    expect(engine.top, `stack top at step ${k}`).toBe(`fib(${n})`)
    expect(engine.current, `highlight at step ${k}`).toContain(`f${n}`)
    await expect(p.locator('.lab-vars dt', { hasText: /^n$/ }).locator('xpath=following-sibling::dd')).toHaveText(n)
  }
  expect(seen.calls).toBeGreaterThanOrEqual(6)
})

test('r5 J6 (P3): Memoization · fib(5): at every step the lit code line, the stack top and n belong to one frame; the stage keeps its size', async ({ page }) => {
  await onboard(page, '2026-10-05')
  await page.goto('/atlas?pattern=dp-memo')
  await page.getByRole('list', exact('Walkthroughs')).getByRole('listitem')
    .filter({ has: page.getByText('Memoization · fib(5)', { exact: true }) }).getByRole('button', exact('Play')).click()
  const p = page.getByRole('region', exact('Player: Memoization · fib(5)'))
  await p.getByRole('button', exact('Pause')).click()
  await p.getByRole('button', exact('First step')).click()
  await expect(counter(p)).toHaveText('STEP 0 / 27')
  const code = p.getByTestId('lab-code')
  const sizes = new Set<string>()
  const kinds = new Set<string>()
  for (let k = 1; k <= 27; k++) {
    await p.getByRole('button', exact('Step forward')).click()
    await expect(counter(p)).toHaveText(`STEP ${k} / 27`)
    const caption = ((await p.getByTestId('lab-caption').textContent()) ?? '').trim()
    const at = `step ${k}: ${caption}`
    await expect(code.locator('li[aria-current="step"]'), `${at}: one lit line`).toHaveCount(1)
    const lit = await code.locator('li').evaluateAll(lis => lis.findIndex(li => li.getAttribute('aria-current') === 'step'))
    const top = await p.locator('sr-algo').evaluate((el: HTMLElement) => { const e = el as EngineEl; return e.stateAt(e.k).calls.frames.at(-1) ?? null })
    expect(top, `${at}: a frame on the stack`).not.toBeNull()
    await expect(p.locator('.lab-vars dt', { hasText: /^n$/ }).locator('xpath=following-sibling::dd'), `${at}: n is the stack top's`).toHaveText(top!.replace(/^fib\((\d)\)$/, '$1'))
    const ret = /^fib\((\d)\) returns \d+\.$/.exec(caption)
    const want = /^Call fib/.test(caption) ? 0 : /is in the memo/.test(caption) ? 1 : /^Base case/.test(caption) ? 2 : /^memo\[/.test(caption) ? 3
      : ret && top !== `fib(${ret[1]})` ? 3 // a return shows the caller, on the line that receives the value
      : ret ? 4 : -1 // fib(5) has no caller: its own return memo[n]
    kinds.add(ret ? (want === 3 ? 'caller' : 'own return') : String(want))
    expect(lit, at).toBe(want)
    const box = await p.locator('.lab-body').boundingBox()
    sizes.add(`${Math.round(box!.width)}x${Math.round(box!.height)}`)
  }
  expect([...kinds].sort()).toEqual(['0', '1', '2', '3', 'caller', 'own return'])
  expect([...sizes], 'the stage keeps one size').toHaveLength(1)
})

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

test('r3 J2 (P3): switching to Today and AI never flashes "Loading…" (ruling 9: only after 300 ms)', async ({ page }) => {
  await onboard(page, '2026-10-05')
  await page.evaluate(() => {
    const w = window as unknown as { __flash: string[] }
    w.__flash = []
    new MutationObserver(() => {
      for (const p of document.querySelectorAll('p.loading')) if ((p.textContent ?? '').includes('Loading')) w.__flash.push(location.pathname)
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  for (let i = 0; i < 3; i++) {
    for (const [name, id] of [['AI', 'ai'], ['Today', 'today'], ['Board', 'board'], ['Today', 'today']] as const) {
      await tab(page, name).click()
      await expect(page.getByTestId(`screen-${id}`)).toHaveAttribute('data-ready', 'true')
    }
  }
  expect(await page.evaluate(() => (window as unknown as { __flash: string[] }).__flash)).toEqual([])
})

test('r3 J2 / r4 #10 (P3): clicking a DSA topic brings its detail into view, and the picture player with its step controls', async ({ page }) => {
  await onboard(page, '2026-10-05')
  for (const height of [860, 832]) {
    await page.setViewportSize({ width: 1280, height })
    await page.goto('/dsa')
    await page.getByTestId('topic-7').click()
    const detail = page.getByTestId('topic-detail')
    await expect(detail).toBeVisible()
    const player = detail.getByTestId('lab-player')
    await player.waitFor()
    // the step controls and the row under them are on screen; the player's top is not scrolled away
    const rows = player.locator('.lab-bar')
    await expect.poll(async () => {
      const last = (await rows.last().boundingBox())!
      return last.y + last.height <= height
    }, { timeout: 5000 }).toBe(true)
    await expect.poll(async () => Math.round((await player.boundingBox())!.y), { timeout: 5000 }).toBeGreaterThanOrEqual(0)
    await expect(player.getByRole('button', { name: 'Step forward', exact: true })).toBeInViewport({ ratio: 1 })
    // the detail is never left below the fold
    expect(Math.round((await detail.boundingBox())!.y)).toBeLessThan(80)
  }
})

test('r3 J7 (P3): source chips show the whole name; only CSS may ellipsise it, and the tooltip is the full label', async ({ page }) => {
  await onboard(page, '2026-10-05')
  await page.goto('/board')
  const chips = page.locator('.card .chip-src')
  await expect(chips.first()).toBeVisible()
  const all = await chips.evaluateAll(els => els.map(e => ({ text: e.textContent ?? '', title: e.getAttribute('title') ?? '', overflow: getComputedStyle(e).textOverflow, clipped: e.scrollWidth > e.clientWidth })))
  expect(all.length).toBeGreaterThan(3)
  for (const c of all) {
    expect(c.title, c.text).not.toBe('')
    expect(c.text).toBe(c.title.split(/[:·]/)[0].replace(/\([^)]*\)/g, '').trim())
    expect(c.overflow).toBe('ellipsis')
  }
  expect(all.map(c => c.text)).toContain('Tech Interview Handbook') // UAT r3: was "Tech Interview Handboo"
})

test('r3 J9 (P3): Map skill-tree labels are whole and inside their nodes (ruling 1)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await onboard(page, '2026-10-05')
  await page.goto('/map')
  const nodes = await page.locator('svg.skill-tree').evaluate(svg => [...svg.querySelectorAll('g.tree-node')].map(g => {
    const texts = [...g.querySelectorAll('text.node-label')] as SVGTextElement[]
    return {
      label: g.querySelector('title')?.textContent ?? '',
      text: texts.map(t => t.textContent).join(' '),
      right: Math.max(...texts.map(t => t.getBBox().x + t.getBBox().width)),
      width: (g.querySelector('rect.node-box') as SVGRectElement).getBBox().width,
    }
  }))
  expect(nodes.length).toBeGreaterThan(10)
  for (const n of nodes) {
    expect(n.text, n.label).toBe(n.label)
    expect(n.right, n.label).toBeLessThanOrEqual(n.width - 2)
  }
})

test('r3 J3 (P3): Retreat says what it does; a statement\'s repo files are file references', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T21:10:00+05:30') })
  await onboard(page, '2026-10-05')
  await page.goto('/do/stage-00-setup-w1-build')
  const refs = page.locator('.st-text code.file-ref')
  await expect(refs).toHaveText(['forge/labs/00-black-box/README.md', 'QUESTIONS.md', 'forge/stages/00-setup/tests/core'])
  await expect(page.locator('.st-text')).toContainText('Saturday 2: finish forge/stages/00-setup/tests/core, then one break-it lab')
  await page.getByTestId('do-timer-preset-25').click()
  const retreat = page.getByRole('button', { name: 'Retreat: stop the timer' })
  await expect(retreat).toHaveText('Retreat')
  await expect(retreat).toHaveAttribute('data-tip', 'Stop the timer')
})

test('r3 J7 (P3): a column move (Shift+→, a drag) is one Undo step, and Undo puts the card back', async ({ page }) => {
  await onboard(page, '2026-10-05')
  await page.goto('/board')
  const card = page.getByTestId('col-todo').locator('article').first()
  const id = (await card.getAttribute('data-testid'))!
  await expect(page.getByTestId('undo')).toHaveText('Undo (0)')
  await expect(page.getByTestId('undo')).toBeDisabled()
  await card.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByTestId('col-doing').getByTestId(id)).toBeVisible()
  await expect(page.getByTestId('undo')).toHaveText('Undo (1)')
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('col-todo').getByTestId(id)).toBeVisible()
  await expect(page.getByTestId('undo')).toHaveText('Undo (0)')
  await expect(page.getByTestId('undo')).toBeDisabled()
  await page.getByTestId('col-todo').getByTestId(id).dragTo(page.getByTestId('col-doing'))
  await expect(page.getByTestId('col-doing').getByTestId(id)).toBeVisible()
  await expect(page.getByTestId('undo')).toHaveText('Undo (1)')
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('col-todo').getByTestId(id)).toBeVisible()
})

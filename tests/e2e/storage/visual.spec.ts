import { expect, test, type Page } from '@playwright/test'
import { GO_VF, PY_VF } from '../../helpers/visualSolutions'
import { openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// C-VISUAL (Part 4c): the visual families on Do, through dojo-server with a writer token (Go on PATH).
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

type Lang = 'go' | 'py'

async function openDo(page: Page, id: string, lang: Lang = 'go') {
  await page.goto(`/do/${id}`)
  await expect(page.getByTestId('code-panel')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Code' })).toBeVisible()
  if (lang === 'py') {
    const radio = page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Python' })
    await radio.check()
    await expect(radio).toBeChecked()
  }
}
async function setCode(page: Page, code: string, lang: Lang = 'go') {
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  const id = new URL(page.url()).pathname.split('/').pop()
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id && (r.lang ?? 'go') === lang)?.source, { timeout: 5000 }).toBe(code)
}
const status = (page: Page) => page.getByTestId('run-status')
async function runVF(page: Page, id: keyof typeof GO_VF, lang: Lang, mode: 'Run' | 'Submit', want: string) {
  const [pack, code] = (lang === 'go' ? GO_VF : PY_VF)[id]
  await openDo(page, pack, lang)
  await setCode(page, code, lang)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await expect(status(page)).toHaveText(want, { timeout: 90_000 })
  await expect(page.getByTestId('dp-view')).toBeVisible()
}
const view = (page: Page) => page.getByTestId('dp-view')
const counterText = async (page: Page) => (await view(page).getByTestId('dp-step-counter').textContent()) ?? ''

/**
 * Moves to the `nth` step (1-based, from Step 1) whose `<kind>-caption` reads exactly `text`, walking with
 * "Next step" inside the page; returns that step number.
 */
async function seek(page: Page, kind: string, text: string, nth = 1): Promise<number> {
  await view(page).getByTestId(`${kind}-view`).waitFor()
  await view(page).getByTestId('dp-scrubber').press('Home')
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText(/^Step 1 \//)
  const k = await page.evaluate(async ({ kind, text, nth }) => {
    const root = document.querySelector('[data-testid="dp-view"]')!
    const cap = () => (root.querySelector(`[data-testid="${kind}-caption"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const next = [...root.querySelectorAll('button')].find(b => b.textContent === 'Next step') as HTMLButtonElement
    const step = () => Number(/Step (\d+)/.exec(root.querySelector('[data-testid="dp-step-counter"]')!.textContent!)![1])
    let seen = 0
    for (;;) {
      if (cap() === text && ++seen === nth) return step()
      if (next.disabled) return -1
      next.click()
      await new Promise(r => setTimeout(r, 0))
    }
  }, { kind, text, nth })
  expect(k, `a step whose ${kind}-caption reads "${text}"`).toBeGreaterThan(0)
  await expect(view(page).getByTestId(`${kind}-caption`)).toHaveText(text)
  return k
}
/** How many steps have `<kind>-caption` exactly `text` (walks every step inside the page). */
async function countCaption(page: Page, kind: string, text: string): Promise<number> {
  await view(page).getByTestId('dp-scrubber').press('Home')
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText(/^Step 1 \//)
  return page.evaluate(async ({ kind, text }) => {
    const root = document.querySelector('[data-testid="dp-view"]')!
    const cap = () => (root.querySelector(`[data-testid="${kind}-caption"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const next = [...root.querySelectorAll('button')].find(b => b.textContent === 'Next step') as HTMLButtonElement
    let n = 0
    for (;;) {
      if (cap() === text) n++
      if (next.disabled) return n
      next.click()
      await new Promise(r => setTimeout(r, 0))
    }
  }, { kind, text })
}
const next = (page: Page) => view(page).getByRole('button', { name: 'Next step' }).click()
const prev = (page: Page) => view(page).getByRole('button', { name: 'Previous step' }).click()
/** The panels inside dp-view, in document order (dp-table, dp-tree, then the family views). */
const panels = async (page: Page) => (await view(page).locator('[data-testid="dp-table"], [data-testid="dp-tree"], [data-testid$="-view"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid'))))
const el = (page: Page, testid: string) => view(page).getByTestId(testid)
async function is(page: Page, testid: string, text: string | null, state?: string) {
  if (text !== null) await expect(el(page, testid)).toHaveText(text)
  if (state) await expect(el(page, testid)).toHaveAttribute('data-state', state)
}

// ---------------------------------------------------------------- the scenarios, as checks shared by Go and Python

async function checkVF01(page: Page) {
  // the only step whose caption reads dist[2] = 3 (via 3)
  expect(await countCaption(page, 'graph', 'dist[2] = 3 (via 3)')).toBe(1)
  await seek(page, 'graph', 'dist[2] = 3 (via 3)')
  await is(page, 'graph-node-2', '2 · 3', 'current')
  await is(page, 'graph-node-1', '1 · 0', 'visited')
  await is(page, 'graph-node-3', '3 · 1', 'visited')
  await is(page, 'graph-node-4', '4', 'idle')
  await is(page, 'graph-edge-3-2', null, 'current')
  await is(page, 'graph-edge-1-2', null, 'idle')
  await is(page, 'graph-edge-1-3', null, 'tree')
  await expect(view(page).getByTestId(/^heap-slot-/)).toHaveCount(1)
  await is(page, 'heap-slot-0', '2 (4)')
  await expect(el(page, 'heap-caption')).toHaveText('')
  await next(page)
  await expect(el(page, 'heap-caption')).toHaveText('push 2 (3) → slot 0')
  await is(page, 'heap-slot-0', '2 (3)', 'current')
  await is(page, 'heap-slot-1', '2 (4)')
  await is(page, 'heap-node-0', '2 (3)', 'current')
  await is(page, 'heap-node-1', '2 (4)')
  await is(page, 'graph-edge-3-2', null, 'tree')
  expect(await panels(page)).toEqual(['graph-view', 'heap-view'])
}

async function checkVF06(page: Page) {
  const k = await seek(page, 'search', 'lo=1 mid=3 hi=6 · pred(3)=false → lo=4')
  await expect(el(page, 'search-lo')).toHaveAttribute('data-value', '4')
  await expect(el(page, 'search-hi')).toHaveAttribute('data-value', '6')
  await expect(el(page, 'search-mid')).toHaveAttribute('data-value', '3')
  await expect(el(page, 'search-probe-6')).toHaveAttribute('data-pred', 'true')
  await expect(el(page, 'search-probe-3')).toHaveAttribute('data-pred', 'false')
  await prev(page)
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText(new RegExp(`^Step ${k - 1} /`))
  await expect(el(page, 'search-caption')).toHaveText('lo=1 mid=3 hi=6 · pred(3)=false')
}

async function checkVF10(page: Page) {
  const t = await counterText(page)
  const [, a, b] = /Step (\d+) \/ (\d+)/.exec(t)!
  expect(a).toBe(b) // Step N
  await is(page, 'game-state-0-2', '0-2 · lose (-2)')
  await is(page, 'game-state-0-3', '0-3 · win (5)')
  await is(page, 'game-state-1-3', '1-3 · win (6)')
  await is(page, 'game-state-0-0', '0-0 · win (3)')
  await expect(view(page).locator('[data-testid^="dp-node-"]').filter({ hasText: /^best\(0,3\)/ }).last()).toHaveText('best(0,3) → 5')
  expect(await view(page).locator('[data-hit="true"]').count()).toBeGreaterThan(0)
  expect(await panels(page)).toEqual(['dp-tree', 'game-view'])
  await expect(view(page).getByTestId('dp-table')).toHaveCount(0)
}

test('VF-01/VF-19: Dijkstra on p743 (Go Submit) pins the graph and heap; the family views load only after the run', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const scripts: string[] = []
  page.on('response', r => { if (r.request().resourceType() === 'script') scripts.push(r.url()) })
  const [pack, code] = GO_VF.vf01
  await openDo(page, pack)
  await setCode(page, code)
  const before = scripts.length
  // VF-19: no script fetched before the first family run carries the family views
  const bodies = await Promise.all(scripts.slice(0, before).map(u => page.request.get(u).then(r => r.text())))
  for (const b of bodies) expect(b).not.toContain('graph-view')
  expect(scripts.slice(0, before).some(u => /FamilyPanels/.test(u))).toBe(false)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 90_000 })
  await expect(view(page).getByTestId('graph-view')).toBeVisible()
  await checkVF01(page)
  await ctx.close()
})

test('UAT r4 (open since r3): on p743 the graph and heap panes keep one height per case while stepping', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf01', 'go', 'Submit', 'Passed 5/5')
  await expect(view(page).getByTestId('graph-view')).toBeVisible()
  const N = Number(/Step (\d+) \/ (\d+)/.exec(await counterText(page))![2])
  const byCase = new Map<string, Set<string>>()
  for (let k = N; k >= Math.max(1, N - 60); k--) {
    const said = (await view(page).getByTestId('dp-narration').first().textContent()) ?? ''
    const c = /^Case (\d+) of/.exec(said)?.[1] ?? '?'
    const h = async (id: string) => Math.round((await view(page).getByTestId(id).boundingBox())?.height ?? -1)
    const set = byCase.get(c) ?? new Set<string>()
    set.add(`graph ${await h('graph-view')} · heap ${await h('heap-view')}`)
    byCase.set(c, set)
    if (k > 1) await prev(page)
  }
  for (const [c, hs] of byCase) if (c !== '?') expect([...hs], `case ${c}`).toHaveLength(1)
  // UAT r5: the first case too, from its first step, where the heap is not declared yet (the pane grew 83 → 358 px)
  await view(page).getByTestId('dp-scrubber').press('Home')
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText(/^Step 1 \//)
  const first = new Set<string>()
  const row = new Set<number>()
  let before = 0, after = 0
  for (let k = 1; k <= N; k++) {
    const said = (await view(page).getByTestId('dp-narration').first().textContent()) ?? ''
    if (/^Case (\d+) of/.exec(said) && !/^Case 1 of/.test(said)) break
    const h = async (id: string) => Math.round((await view(page).getByTestId(id).boundingBox())?.height ?? -1)
    first.add(`graph ${await h('graph-view')} · heap ${await h('heap-view')}`)
    // where the row under the trace sits, measured from the step view (scroll-proof)
    row.add(await page.evaluate(() => Math.round(document.querySelector('.do-outcome-row')!.getBoundingClientRect().top - document.querySelector('[data-testid="dp-view"]')!.getBoundingClientRect().top)))
    if (await view(page).getByTestId('heap-box').count()) after++
    else before++
    if (k < N) await next(page)
  }
  expect(before, 'steps of case 1 before the heap is declared').toBeGreaterThan(0)
  expect(after, 'steps of case 1 with the heap').toBeGreaterThan(0)
  expect([...first], 'case 1').toHaveLength(1)
  expect([...row], 'the outcome row under the trace').toHaveLength(1)
  await ctx.close()
})

test('VF-02: topological sort on p207 (Go Submit)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf02', 'go', 'Submit', 'Passed 5/5')
  await seek(page, 'graph', 'mark 3: in 1')
  await is(page, 'graph-node-3', '3 · in 1', 'current')
  await is(page, 'graph-node-0', '0 · in 0', 'visited')
  await is(page, 'graph-node-1', '1 · in 0', 'visited')
  await is(page, 'graph-node-2', '2 · in 0', 'seen')
  await expect(view(page).getByTestId(/^queue-item-/)).toHaveCount(1)
  await is(page, 'queue-item-0', '2')
  await ctx.close()
})

test('VF-03: union-find on p684 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf03', 'go', 'Run', 'Passed 2/2')
  await seek(page, 'dsu', 'union(3, 4): 4 now under 1')
  await seek(page, 'dsu', 'union(1, 4): already joined (root 1)')
  for (const x of [2, 3, 4]) await expect(el(page, `dsu-node-${x}`)).toHaveAttribute('data-parent', '1')
  for (const x of [1, 5]) await expect(el(page, `dsu-node-${x}`)).toHaveAttribute('data-root', 'true')
  for (const x of [1, 4]) await expect(el(page, `dsu-node-${x}`)).toHaveAttribute('data-state', 'current')
  await expect(el(page, 'dsu-count')).toHaveText('3 sets')
  await ctx.close()
})

test('VF-04: heap on p215 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf04', 'go', 'Run', 'Passed 2/2')
  await seek(page, 'heap', 'push 4 (4) → slot 0')
  await is(page, 'heap-slot-0', '4 (4)', 'current')
  await is(page, 'heap-slot-1', '6 (6)')
  await is(page, 'heap-slot-2', '5 (5)')
  for (const [i, t] of [[0, '4 (4)'], [1, '6 (6)'], [2, '5 (5)']] as const) await is(page, `heap-node-${i}`, t)
  await next(page)
  await expect(el(page, 'heap-caption')).toHaveText('pop 4 (4)')
  await is(page, 'heap-slot-0', '5 (5)', 'current')
  await is(page, 'heap-slot-1', '6 (6)')
  await expect(el(page, 'heap-slot-2')).toHaveCount(0)
  await ctx.close()
})

test('VF-05: window on p3 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf05', 'go', 'Run', 'Passed 2/2')
  await seek(page, 'array', 'window [1..3] (len 3)')
  for (let i = 0; i < 8; i++) await expect(el(page, `array-cell-${i}`)).toHaveAttribute('data-state', i >= 1 && i <= 3 ? 'window' : 'idle')
  await expect(el(page, 'array-cell-3')).toHaveText('a')
  await expect(el(page, 'pointer-lo')).toHaveAttribute('data-index', '1')
  await expect(el(page, 'pointer-hi')).toHaveAttribute('data-index', '3')
  await prev(page)
  await expect(el(page, 'array-caption')).toHaveText('hi → 3')
  await ctx.close()
})

test('VF-06: binary search on p875 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf06', 'go', 'Run', 'Passed 2/2')
  await checkVF06(page)
  await ctx.close()
})

test('VF-07: linked list on p206 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf07', 'go', 'Run', 'Passed 2/2')
  await seek(page, 'list', 'next(1) = 0')
  await expect(el(page, 'list-node-0')).toHaveAttribute('data-next', 'nil')
  await expect(el(page, 'list-node-1')).toHaveAttribute('data-next', '0')
  await is(page, 'list-node-1', '2', 'current')
  for (const [i, n] of [[2, '3'], [3, '4'], [4, 'nil']] as const) await expect(el(page, `list-node-${i}`)).toHaveAttribute('data-next', n)
  await expect(el(page, 'list-pointer-prev')).toHaveAttribute('data-node', '0')
  await expect(el(page, 'list-pointer-curr')).toHaveAttribute('data-node', '1')
  await ctx.close()
})

test('VF-08: intervals on p56 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf08', 'go', 'Run', 'Passed 2/2')
  await seek(page, 'intervals', 'out[0] = [1,6]')
  const out = view(page).locator('[data-testid="intervals-box"][data-name="out"]')
  const inn = view(page).locator('[data-testid="intervals-box"][data-name="in"]')
  await expect(out.getByTestId('interval-0')).toHaveText('[1,6]')
  await expect(out.getByTestId('interval-0')).toHaveAttribute('data-state', 'current')
  await expect(inn.getByTestId('interval-0')).toHaveText('[1,3]')
  await expect(inn.getByTestId('interval-0')).toHaveAttribute('data-mark', 'new')
  await expect(inn.getByTestId('interval-1')).toHaveText('[2,6]')
  await expect(inn.getByTestId('interval-1')).toHaveAttribute('data-mark', '')
  await next(page)
  await expect(el(page, 'intervals-caption')).toHaveText('in[1] [2,6]: merged')
  await ctx.close()
})

test('VF-09: tree on p543 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf09', 'go', 'Run', 'Passed 2/2')
  await seek(page, 'tree', '1 (2): h=2')
  await is(page, 'tree-node-1', '2 · h=2', 'current')
  await expect(el(page, 'tree-node-1')).toHaveAttribute('data-parent', '0')
  await expect(el(page, 'tree-node-1')).toHaveAttribute('data-side', 'L')
  await is(page, 'tree-node-2', '4 · h=1', 'visited')
  await is(page, 'tree-node-3', '5 · h=1', 'visited')
  await is(page, 'tree-node-0', '1', 'visited')
  await expect(el(page, 'tree-node-4')).toHaveCount(0)
  await ctx.close()
})

test('VF-10: game on p877 (Go Run)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf10', 'go', 'Run', 'Passed 2/2')
  await checkVF10(page)
  await ctx.close()
})

test('VF-11: VF-01, VF-06 and VF-10 in Python give the same captions, texts and states', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runVF(page, 'vf01', 'py', 'Submit', 'Passed 5/5')
  await checkVF01(page)
  await runVF(page, 'vf06', 'py', 'Run', 'Passed 2/2')
  await checkVF06(page)
  await runVF(page, 'vf10', 'py', 'Run', 'Passed 2/2')
  await checkVF10(page)
  await ctx.close()
})

test('VF-13: new types: unchanged list and interval starters, a ListNode redeclaration, Python TreeNode for free', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p206')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Failed 0/2', { timeout: 90_000 })
  await expect(page.getByTestId('run-case-1').getByTestId('run-diff')).toHaveText('reverseList([1,2,3,4,5]): expected [5,4,3,2,1], got [1,2,3,4,5]')
  await openDo(page, 'p56')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Failed 0/2', { timeout: 90_000 })
  await expect(page.getByTestId('run-case-1').getByTestId('run-diff')).toHaveText('merge([[1,3],[2,6],[8,10],[15,18]]): expected [[1,6],[8,10],[15,18]], got [[1,3],[2,6],[8,10],[15,18]]')
  await openDo(page, 'p206')
  await setCode(page, 'package main\n\ntype ListNode struct {\n\tVal  int\n\tNext *ListNode\n}\n\nfunc reverseList(head *ListNode) *ListNode { return head }\n')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Compile error', { timeout: 90_000 })
  await openDo(page, 'p543', 'py')
  await setCode(page, 'def diameterOfBinaryTree(root: TreeNode | None) -> int:\n    best = 0\n    def h(n):\n        nonlocal best\n        if n is None:\n            return 0\n        l, r = h(n.left), h(n.right)\n        best = max(best, l + r)\n        return 1 + max(l, r)\n    h(root)\n    return best\n', 'py')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 90_000 })
  await ctx.close()
})

test('VF-14: the pinned misuse is the exact run-error in Go and Python, and the steps up to it stay viewable', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p3')
  await setCode(page, 'package main\n\nimport "dojo/tk"\n\nfunc lengthOfLongestSubstring(s string) int {\n\ta := tk.Chars("s", s)\n\ta.Pointer("lo", 0)\n\ta.Pointer("lo", 99)\n\treturn 0\n}\n')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Runtime error', { timeout: 90_000 })
  await expect(page.getByTestId('run-error').first()).toHaveText('line 8: tk: pointer lo → 99 is outside s (-1..8)')
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText('Step 4 / 4')
  await expect(el(page, 'array-caption')).toHaveText('lo → 0')
  await openDo(page, 'p3', 'py')
  await setCode(page, 'from dojo import tk\n\ndef lengthOfLongestSubstring(s):\n    a = tk.Chars("s", s)\n    a.Pointer("lo", 0)\n    a.Pointer("lo", 99)\n    return 0\n', 'py')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(status(page)).toHaveText('Runtime error', { timeout: 90_000 })
  await expect(page.getByTestId('run-error').first()).toHaveText('line 6: IndexError: tk: pointer lo → 99 is outside s (-1..8)')
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText('Step 4 / 4')
  await prev(page)
  await expect(el(page, 'array-caption')).toHaveText('array s (5)')
  await ctx.close()
})

/** C-VISUAL §6 on the open page: Step N, 20 Previous presses, a current element, a scrub to Step 1. */
async function checkPerformance(page: Page, kind: string, clicked: number) {
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText('Step 20000 / 20000', { timeout: 5000 })
  const toStepN = Date.now() - clicked
  await expect(page.getByTestId('run-truncated')).toHaveText('Showing the first 20000 steps')
  await view(page).getByTestId(`${kind}-view`).waitFor()
  const t0 = Date.now()
  for (let i = 0; i < 20; i++) await prev(page)
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText('Step 19980 / 20000', { timeout: 4000 })
  const prev20 = Date.now() - t0
  expect(prev20).toBeLessThan(4000)
  expect(await view(page).getByTestId(`${kind}-view`).locator('[data-state="current"]').count()).toBeGreaterThan(0)
  const t1 = Date.now()
  await view(page).getByTestId('dp-scrubber').fill('1')
  await expect(view(page).getByTestId('dp-step-counter')).toHaveText('Step 1 / 20000', { timeout: 1000 })
  const scrub = Date.now() - t1
  console.log(`perf ${kind}: run→Step N ${toStepN} ms (incl. build+run), 20× Previous ${prev20} ms, scrub to 1 ${scrub} ms`)
  return { toStepN, prev20, scrub }
}

test('VF-15/VF-16: 15000 t.Set plus 15000 g.Visit share the cap; the mixed run meets §6', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p3')
  await setCode(page, 'package main\n\nimport "dojo/tk"\n\nfunc lengthOfLongestSubstring(s string) int {\n\tif len(s) != 8 {\n\t\treturn 1\n\t}\n\tt := tk.Table("dp", 1, 10)\n\tfor i := 0; i < 15000; i++ {\n\t\tt.Set(0, i%10, i)\n\t}\n\tg := tk.Graph("g", true)\n\tfor i := 0; i < 15000; i++ {\n\t\tg.Visit(i % 50)\n\t}\n\treturn 3\n}\n')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const clicked = Date.now()
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 90_000 })
  await expect(view(page).getByTestId('dp-table')).toBeVisible()
  await expect(view(page).getByTestId('graph-view')).toBeVisible()
  await checkPerformance(page, 'graph', clicked)
  await ctx.close()
})

test('VF-16: a 25000-event heap run meets §6 (Go)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p215')
  await setCode(page, 'package main\n\nimport "dojo/tk"\n\nfunc findKthLargest(nums []int, k int) int {\n\th := tk.Heap("h")\n\tfor i := 0; i < 25000; i++ {\n\t\th.Push(i, (i*7919)%10007)\n\t}\n\treturn 5 - (len(nums) - 6) / 3 * 1\n}\n')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const clicked = Date.now()
  await expect(status(page)).toHaveText(/^(Passed|Failed) /, { timeout: 90_000 })
  await checkPerformance(page, 'heap', clicked)
  await ctx.close()
})

import { expect, test, type Page } from '@playwright/test'
import { GO_VF, PY_MORE, PY_VF } from '../../helpers/visualSolutions'
import { openApp, rows } from './briefs-helpers'
import { ServerHarness } from './harness'
import { assertControlsStill, assertNodesStay, assertOneSizePerCase, byCase, summary, walkSteps, type Sample } from './families-walk'

// UAT cu-5 P2-1 (ui-visual-families V0.3, "one size per case"): through the real page, every family keeps one pane size for a
// whole case while the learner steps, and the step controls never move. Each test runs a solution, walks every step with the
// real Next button inside the page, and compares the boxes of the panes, the band and the controls from step to step.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 180_000 })

type Lang = 'go' | 'py'

async function runIt(page: Page, pack: string, code: string, lang: Lang, mode: 'Run' | 'Submit', want: RegExp) {
  await page.goto(`/do/${pack}`)
  await expect(page.getByRole('textbox', { name: 'Code' })).toBeVisible()
  if (lang === 'py') {
    const radio = page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Python' })
    await radio.check()
    await expect(radio).toBeChecked()
  }
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === pack && (r.lang ?? 'go') === lang)?.source, { timeout: 5000 }).toBe(code)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(want, { timeout: 90_000 })
  await expect(page.getByTestId('dp-view')).toBeVisible()
}

/** The panes a walk is expected to have drawn (each at some step), so a spec cannot pass by seeing nothing. */
const kindsSeen = (ss: Sample[]) => new Set(ss.flatMap(s => Object.keys(s.panes)))

async function check(page: Page, what: string, panes: string[]) {
  const ss = await walkSteps(page, { playFirst: true })
  const seen = kindsSeen(ss)
  for (const p of panes) expect(seen.has(p), `${what}: ${p} drawn`).toBe(true)
  expect(byCase(ss).size, `${what}: more than one case`).toBeGreaterThan(1)
  try {
    assertOneSizePerCase(ss, what)
    assertNodesStay(ss, what)
    assertControlsStill(ss, what)
  } catch (e) {
    console.log(`${what}\n${summary(ss)}`)
    throw e
  }
}

const PY: Record<string, [string, string]> = { ...PY_VF, ...PY_MORE }
const FAMILIES: { name: string; key: string; mode?: 'Run' | 'Submit'; want?: RegExp; panes: string[] }[] = [
  { name: 'graph and heap (p743)', key: 'vf01', panes: ['graph-view', 'heap-view'] },
  { name: 'graph and queue (p207)', key: 'vf02', panes: ['graph-view', 'queue-view'] },
  { name: 'a graph on its own (p802)', key: 'g802', panes: ['graph-view'] },
  { name: 'union-find (p684)', key: 'vf03', panes: ['dsu-view'] },
  { name: 'graph and union-find (p1584, Kruskal)', key: 'k1584', panes: ['graph-view', 'dsu-view'] },
  { name: 'game table and call tree (p877)', key: 'vf10', panes: ['game-view', 'dp-tree-pane'] },
  { name: 'intervals in and out (p56)', key: 'vf08', panes: ['intervals-view'] },
  { name: 'array with pointers and a window (p153)', key: 'a153', panes: ['array-view'] },
  { name: 'array, two pointers (p11)', key: 'a11', panes: ['array-view'] },
  { name: 'characters with a window (p3)', key: 'vf05', panes: ['array-view'] },
  { name: 'heap (p215)', key: 'vf04', panes: ['heap-view'] },
  { name: 'tree (p543)', key: 'vf09', panes: ['tree-view'] },
  { name: 'binary search (p875)', key: 'vf06', panes: ['search-view'] },
  { name: 'linked list (p206)', key: 'vf07', panes: ['list-view'] },
]

for (const f of FAMILIES) {
  test(`P2-1: ${f.name} keeps one pane size per case and the controls hold still (Python)`, async ({ browser }) => {
    const { ctx, page } = await openApp(browser, srv)
    const [pack, code] = PY[f.key]
    await runIt(page, pack, code, 'py', f.mode ?? 'Submit', f.want ?? /^Passed 5\/5$/)
    await check(page, f.name, f.panes)
    await ctx.close()
  })
}

test('P2-1: the same in Go (graph and heap, p743)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const [pack, code] = GO_VF.vf01
  await runIt(page, pack, code, 'go', 'Submit', /^Passed 5\/5$/)
  await check(page, 'p743 in Go', ['graph-view', 'heap-view'])
  await ctx.close()
})

test('P2-1: on a phone the panes stack and still keep one size per case (graph and queue, p207)', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.setViewportSize({ width: 393, height: 852 })
  const [pack, code] = PY.vf02
  await runIt(page, pack, code, 'py', 'Submit', /^Passed 5\/5$/)
  await check(page, 'p207 at 393', ['graph-view', 'queue-view'])
  await ctx.close()
})

test('P3-13: the family panes share a row from 1100 px wide and stack below it', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  const [pack, code] = PY.vf02
  await runIt(page, pack, code, 'py', 'Submit', /^Passed 5\/5$/)
  const xs = async () => ({
    g: (await page.getByTestId('graph-view').boundingBox())!, q: (await page.getByTestId('queue-view').boundingBox())!,
  })
  await page.setViewportSize({ width: 1100, height: 900 })
  await expect.poll(async () => { const { g, q } = await xs(); return q.x > g.x + g.width - 1 }, { message: 'at 1100 the queue is beside the graph' }).toBe(true)
  await page.setViewportSize({ width: 1099, height: 900 })
  await expect.poll(async () => { const { g, q } = await xs(); return Math.abs(q.x - g.x) < 1 && q.y > g.y + g.height - 1 }, { message: 'at 1099 the queue is under the graph' }).toBe(true)
  await ctx.close()
})

const P91_MEMO = `from dojo import tk

memo = {}

def f(s, i):
    if i in memo:
        tk.Hit("f", i)
        return memo[i]
    tk.Enter("f", i)
    if i <= 1:
        v = 0 if (i == 1 and s[0] == '0') else 1
    else:
        v = 0
        if s[i - 1] != '0':
            v += f(s, i - 1)
        if s[i - 2] == '1' or (s[i - 2] == '2' and s[i - 1] <= '6'):
            v += f(s, i - 2)
    memo[i] = v
    tk.Exit(v)
    return v

def numDecodings(s: str) -> int:
    memo.clear()
    tk.Link("f", "dp")
    tk.Table("dp", 1, len(s) + 1)
    return f(s, len(s))
`

test('P2-1: a DP trace (table and call tree, p91) keeps one size per case too', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await runIt(page, 'p91', P91_MEMO, 'py', 'Submit', /^Passed 5\/5$/)
  await check(page, 'p91 memo', ['dp-table-pane', 'dp-tree-pane'])
  await ctx.close()
})

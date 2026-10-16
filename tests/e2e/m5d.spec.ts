import { expect, test, type Page } from '@playwright/test'
import { idbAll, idbPatch, IST, onboard } from './helpers'

type Ticket = { id: string; status: string; lane: string; estMin: number; archived?: boolean; node?: string }
type PlanNode = { id: string; area: string; title: string; pre: string[] }
type Plan = { nodes: PlanNode[] }

const planOf = async (page: Page): Promise<Plan> => (await page.request.get('/data/plan.json')).json()

// R1: the Map is Skills (README Retired `node-*` old tree, `need-*`, `skill-*`; SHELL-20 sends /map to Today). The old demo followed a
// locked node to the prerequisite holding it back (SKILLS-13, SKILLS-14, SKILLS-16); the sprint prev/next half left with the sprints.
test('M5d demo: follow a locked topic to the prerequisite holding it back (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  const plan = await planOf(page)
  const byId = new Map(plan.nodes.map(n => [n.id, n]))
  // a node that has tickets and a prerequisite in its own area, so it is locked only by that prerequisite (SKILLS-14)
  const tickets = await idbAll<Ticket>(page, 'tickets')
  const withTickets = new Set(tickets.filter(t => !t.archived).map(t => t.node))
  const locked = plan.nodes.find(n => n.area !== 'dsa' && n.area !== 'design' && withTickets.has(n.id) && n.pre.some(p => byId.get(p)?.area === n.area))!
  const parent = byId.get(locked.pre.find(p => byId.get(p)?.area === locked.area)!)!

  await page.keyboard.press('5')
  await expect(page).toHaveURL(/\/skills$/)
  await page.getByTestId(`skills-area-${locked.area}`).click()
  await expect(page).toHaveURL(new RegExp(`/skills/area/${locked.area}$`))

  await expect(page.getByTestId(`skills-node-${locked.id}`)).toHaveAttribute('data-state', 'locked')
  // SKILLS-13: no note under a node; the panel carries what to do first
  await expect(page.locator('[data-testid^="skills-node-note-"]')).toHaveCount(0)
  await expect(page.getByTestId(`skills-node-${locked.id}`).locator('[data-glyph="lock"]').first()).toBeVisible()
  await page.getByTestId(`skills-node-${locked.id}`).click()
  const panel = page.getByTestId('skills-node-panel')
  await expect(panel.locator('.sk-ptitle')).toHaveText(locked.title)
  await expect(panel).toContainText('Needs first')
  await expect(panel).toContainText(parent.title)
  // locked is soft: the next-ticket action is there and enabled (SKILLS-14), and no wording blocks the learner
  await expect(page.getByTestId('skills-node-start')).toBeEnabled()
  await expect(panel).not.toContainText(/blocked|forbidden|unlock by/i)

  // follow it to the parent: select the prerequisite node; its panel names it and lists the locked topic under "Unlocks"
  await page.getByTestId(`skills-node-${parent.id}`).click()
  await expect(panel.locator('.sk-ptitle')).toHaveText(parent.title)
  await expect(panel).toContainText('Unlocks')
  await expect(panel).toContainText(locked.title)

  // the walk wrote nothing (SKILLS-21)
  expect((await idbAll<Ticket>(page, 'tickets')).filter(t => t.status !== 'todo')).toEqual([])
})

// R1: Progress (rings, badges, NOW marker) is Skills > Stats (SKILLS-24/25; README Retired `ring-*`, `badge-*`, `no-sessions`). Same story:
// two DSA problems are done, the counts follow the live plan, and there is no session yet.
test('Stats: minutes match the live plan, one row per lane, no sessions yet', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-20T21:10:00'))
  await onboard(page, '2026-10-05')
  await idbPatch(page, 'tickets', ['p200', 'p127'], { status: 'done', xp: 10, doneAt: IST('2026-10-06T21:30:00').getTime(), doneAtApprox: false })
  await page.reload()
  // the last active day is long before the clock: a restart day (RIT-52), the usual mix is behind the Floor's toggle
  await page.getByTestId('today-mix-toggle').click()
  await page.getByTestId('start-button').waitFor()
  await page.keyboard.press('5')
  await page.getByTestId('skills-tab-stats').click()
  await expect(page).toHaveURL(/\/skills\/stats$/)

  const live = (await idbAll<Ticket>(page, 'tickets')).filter(t => !t.archived)
  const sum = (ts: Ticket[]) => ts.reduce((n, t) => n + t.estMin, 0)
  const done = live.filter(t => t.status === 'done')
  expect(done.map(t => t.id).sort()).toEqual(['p127', 'p200'])
  expect(sum(done)).toBeGreaterThan(0)
  await expect(page.getByTestId('skills-stats-done-min')).toHaveText(String(sum(done)))
  await expect(page.getByTestId('skills-stats-total-min')).toHaveText(String(sum(live)))
  // README lane tag: a bank ticket counts as DSA, so the DSA row carries the two problems and the AI row nothing done
  const dsa = live.filter(t => t.lane === 'dsa' || t.lane === 'bank')
  await expect(page.getByTestId('skills-stats-lane-dsa')).toHaveAttribute('data-done', String(sum(dsa.filter(t => t.status === 'done'))))
  await expect(page.getByTestId('skills-stats-lane-dsa')).toHaveAttribute('data-total', String(sum(dsa)))
  await expect(page.getByTestId('skills-stats-lane-path')).toHaveAttribute('data-done', '0')
  await expect(page.getByTestId('skills-stats-pace')).toHaveText(/^0 of \d+ min in the last 14 days$/)
  expect(await idbAll(page, 'sessions')).toEqual([])
})

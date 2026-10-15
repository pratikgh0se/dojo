import { expect, test, type Page } from '@playwright/test'
import { IST, idbAll, onboard } from './helpers'

type Ticket = { id: string; status: string; node?: string; area?: string; estMin: number; archived?: boolean }
type Plan = { areas: Array<{ id: string; name: string }>; nodes: Array<{ id: string; area: string; title: string }> }

const planOf = async (page: Page): Promise<Plan> => (await page.request.get('/data/plan.json')).json()

// R1 replaces the AI capstone screen (README Retired `stage-*`, `cube-*`, `balance-*`, `/ai`) with Skills (SKILLS-02/04/08/09/17):
// see where an area stands on the map, open it, start the next topic's ticket from the node panel, finish it, and the map moves.
test('M5c demo: see where an area stands on Skills, start its next topic ticket, finish it (live plan)', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-19T21:10:00'))
  await onboard(page, '2026-10-05')
  const plan = await planOf(page)
  const quest = (await page.getByTestId('today-quest').getAttribute('data-ticket-id'))!
  const questTicket = (await idbAll<Ticket>(page, 'tickets')).find(t => t.id === quest)!
  const areaId = questTicket.area!
  const nodeId = questTicket.node!
  const area = plan.areas.find(a => a.id === areaId)!
  const areaNodes = plan.nodes.filter(n => n.area === areaId)

  await page.keyboard.press('5')
  await expect(page).toHaveURL(/\/skills$/)
  // the map and its summary cover the AI areas only; the DSA and Design trees have their own tabs (SKILLS-02, SKILLS-04 as amended)
  const aiAreas = plan.areas.filter(a => a.id !== 'dsa' && a.id !== 'design')
  const aiNodes = plan.nodes.filter(n => n.area !== 'dsa' && n.area !== 'design')
  await expect(page.locator('[data-testid^="skills-area-"][data-state]')).toHaveCount(aiAreas.length)
  await expect(page.getByTestId('skills-summary')).toContainText(`0 of ${aiNodes.length} topics done`)
  const meter = page.getByTestId(`skills-area-meter-${areaId}`)
  await expect(meter).toHaveAttribute('data-done', '0')
  const total = Number(await meter.getAttribute('data-total'))
  expect(total).toBeGreaterThan(0)

  await page.getByTestId(`skills-area-${areaId}`).click()
  await expect(page).toHaveURL(new RegExp(`/skills/area/${areaId}$`))
  await expect(page.getByTestId('skills-area-view')).toContainText(area.name)
  await expect(page.getByTestId('skills-area-view')).toContainText(`0 of ${areaNodes.length} topics`)
  await expect(page.locator('[data-testid^="skills-node-note-"]')).toHaveCount(0) // SKILLS-13
  // the quest's topic is the one "next" node, and its panel starts the first ticket of the topic
  await expect(page.locator('[data-testid^="skills-node-"][data-state="next"]')).toHaveCount(1)
  await expect(page.getByTestId(`skills-node-${nodeId}`)).toHaveAttribute('data-state', 'next')
  await page.getByTestId(`skills-node-${nodeId}`).click()
  await expect(page.getByTestId('skills-node-panel')).toContainText(plan.nodes.find(n => n.id === nodeId)!.title)
  await page.getByTestId('skills-node-start').click()
  await expect(page).toHaveURL(new RegExp(`/do/${quest}$`))
  await expect.poll(async () => (await idbAll<Ticket>(page, 'tickets')).find(t => t.id === quest)?.status).toBe('doing')

  await page.getByTestId('ticket-done').click()
  await expect(page.getByTestId('ticket-done-state')).toBeVisible()
  await expect.poll(async () => (await idbAll<Ticket>(page, 'tickets')).find(t => t.id === quest)?.status).toBe('done')

  await page.keyboard.press('5')
  await expect(page.getByTestId(`skills-area-meter-${areaId}`)).toHaveAttribute('data-done', String(questTicket.estMin))
  await expect(page.getByTestId(`skills-area-${areaId}`)).toHaveAttribute('data-state', 'in-progress')
  // finishing the quest ticket is the only completion
  const tickets = await idbAll<Ticket>(page, 'tickets')
  expect(tickets.filter(t => t.status === 'done').map(t => t.id)).toEqual([quest])
})

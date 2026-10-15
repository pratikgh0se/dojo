// R1 scope 2, W6: the Design and AI question banks on /banks (trees-and-banks.md BANK-01 to BANK-28), at 1280x800 and 375.
import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { idbAll, onboard } from './helpers'

// pictures go to W6_SHOTS_DIR (the visual-check folder); by default into test-results
const SHOTS = process.env.W6_SHOTS_DIR ?? 'test-results/w6-shots'
mkdirSync(SHOTS, { recursive: true })

interface Q { id: string; area: string; node: string; type: string; difficulty: number; question: string; answer: string; checklist: string[]; source?: string }
interface PlanNode { id: string; area: string; kind: string; title: string }
interface Plan { qbank: Q[]; nodes: PlanNode[] }

async function plan(page: Page): Promise<Plan> {
  return page.evaluate(async () => (await fetch('/data/plan.json')).json()) as Promise<Plan>
}
const designNodes = (p: Plan) => p.nodes.filter(n => n.area === 'design' && n.kind !== 'band')
const questionsOf = (p: Plan, area: string) => {
  const rank = new Map(p.nodes.map((n, i) => [n.id, i]))
  return p.qbank.filter(q => q.area === area).sort((a, b) => rank.get(a.node)! - rank.get(b.node)! || a.difficulty - b.difficulty || (a.id < b.id ? -1 : 1))
}
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const ops = async (page: Page) => (await page.request.get('/db/health').catch(() => null))?.ok() ?? false

test.describe('W6 question banks at 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('BANK-01 tabs and BANK-27 the DSA tab is the old screen', async ({ page }) => {
    await onboard(page)
    await page.goto('/banks')
    const tabs = page.getByTestId('banks-areas')
    await expect(tabs.getByRole('tab')).toHaveText(['DSA', 'Design', 'AI'])
    await expect(page.getByTestId('banks-area-dsa')).toHaveAttribute('aria-selected', 'true')
    for (const id of ['banks-page', 'banks-header', 'banks-search', 'banks-filter-status', 'banks-clear-filters']) await expect(page.getByTestId(id)).toBeVisible()
    await expect(page.locator('[data-testid^="banks-q-"]')).toHaveCount(0)
    await page.getByTestId('banks-area-design').click()
    await expect(page).toHaveURL(/area=design/)
    await expect(page.getByTestId('banks-area-design')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('banks-q-page')).toBeVisible()
    await expect(page.getByTestId('banks-page')).toHaveCount(0)
    await page.getByTestId('banks-area-ai').click()
    await expect(page).toHaveURL(/area=ai/)
    await expect(page.getByTestId('banks-q-page')).toHaveAttribute('data-area', 'ai')
    await page.goto('/banks?area=dsa&bank=mine')
    for (const id of ['mine-add', 'mine-input', 'mine-classify']) await expect(page.getByTestId(id)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/scope2-w6-dsa-1280.png` })
  })

  test('GLOBAL-10 the DSA source tabs are role=tab test ids inside a tablist, at /banks and /banks?area=dsa', async ({ page }) => {
    await onboard(page)
    for (const url of ['/banks', '/banks?area=dsa']) {
      await page.goto(url)
      await expect(page.getByTestId('banks-page')).toBeVisible()
      for (const id of ['plan', 'neetcode150', 'blind75', 'striver', 'codeforces', 'hellointerview', 'mine']) {
        await expect(page.locator(`[role="tablist"] [data-testid="banks-tab-${id}"][role="tab"]`), `${url} ${id}`).toHaveCount(1)
      }
    }
  })

  test('BANK-25 switching tabs shows the nodes of that tab at once: AI nodes on AI, design nodes on Design', async ({ page }) => {
    await onboard(page)
    await page.goto('/banks?area=design')
    const options = () => page.getByTestId('banks-q-filter-node').locator('option').allTextContents()
    await expect.poll(async () => (await options()).length).toBeGreaterThan(5)
    expect(await options()).toContain('The design method')
    // no waiting between the click and the read: the old tab's list must already be gone
    await page.getByTestId('banks-area-ai').click()
    let now = await options()
    expect(now).toContain('Neural network basics')
    expect(now).not.toContain('The design method')
    await page.getByTestId('banks-area-design').click()
    now = await options()
    expect(now).toContain('The design method')
    expect(now).not.toContain('Neural network basics')
    await page.getByTestId('banks-area-dsa').click()
    await expect(page.getByTestId('banks-page')).toBeVisible()
    await expect(page.locator('[data-testid^="banks-q-"]')).toHaveCount(0)
  })

  test('BANK-04, BANK-17 the list, its order and the progress', async ({ page }) => {
    await onboard(page)
    const p = await plan(page)
    const qs = questionsOf(p, 'design')
    expect(qs.length).toBeGreaterThan(100)
    await page.goto('/banks?area=design')
    await expect(page.getByTestId('banks-q-list').locator('[data-testid^="banks-q-row-"]')).toHaveCount(qs.length)
    const ids = await page.locator('[data-testid^="banks-q-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')!.replace('banks-q-row-', '')))
    expect(ids).toEqual(qs.map(q => q.id))
    const row = page.getByTestId(`banks-q-row-${qs[0].id}`)
    await expect(row).toHaveAttribute('data-seen', 'false')
    expect(await row.getAttribute('data-last-grade')).toBeNull()
    await expect(row).toContainText('Not seen')
    await expect(row).toContainText(`Level ${qs[0].difficulty}`)
    await expect(page.getByTestId('banks-q-visible-count')).toHaveText(`Showing ${qs.length} of ${qs.length}`)
    const prog = page.getByTestId('banks-q-progress')
    await expect(prog).toHaveText(`0 of ${qs.length} seen`)
    await expect(prog).toHaveAttribute('data-total', String(qs.length))
    await expect(page.locator('[data-testid^="banks-q-aimade-"]')).toHaveCount(0)
  })

  test('BANK-05, BANK-06, BANK-07 filters, the address and no match', async ({ page }) => {
    await onboard(page)
    const p = await plan(page)
    const qs = questionsOf(p, 'design')
    const node = designNodes(p).find(n => qs.some(q => q.node === n.id))!
    const inNode = qs.filter(q => q.node === node.id)
    await page.goto('/banks?area=design')
    const nodeSel = page.getByTestId('banks-q-filter-node')
    await expect(nodeSel.locator('option').first()).toHaveText('All nodes')
    expect(await nodeSel.locator('option').count()).toBe(1 + new Set(qs.map(q => q.node)).size)
    await expect(page.getByTestId('banks-q-filter-type').locator('option')).toHaveText(['All', 'Concept', 'Estimate', 'Trade-off', 'Design'])
    await expect(page.getByTestId('banks-q-filter-difficulty').locator('option')).toHaveText(['All', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'])
    await expect(page.getByTestId('banks-q-clear')).toBeDisabled()
    await nodeSel.selectOption(node.id)
    await expect(page.getByTestId('banks-q-visible-count')).toHaveText(`Showing ${inNode.length} of ${qs.length}`)
    await expect(page.getByTestId('banks-q-node-progress')).toHaveText(`0 of ${inNode.length} seen in this node`)
    const type = inNode[0].type
    await page.getByTestId('banks-q-filter-type').selectOption(type)
    const both = inNode.filter(q => q.type === type)
    await expect(page.getByTestId('banks-q-visible-count')).toHaveText(`Showing ${both.length} of ${qs.length}`)
    await page.getByTestId('banks-q-filter-difficulty').selectOption(String(both[0].difficulty))
    const all3 = both.filter(q => q.difficulty === both[0].difficulty)
    await expect(page.getByTestId('banks-q-list').locator('li')).toHaveCount(all3.length)
    await expect(page).toHaveURL(new RegExp(`node=${node.id}&type=${type}&diff=${both[0].difficulty}|area=design`))
    const url = new URL(page.url())
    expect(url.searchParams.get('node')).toBe(node.id)
    expect(url.searchParams.get('type')).toBe(type)
    expect(url.searchParams.get('diff')).toBe(String(both[0].difficulty))
    expect(url.searchParams.get('level')).toBeNull()
    await page.reload()
    await expect(nodeSel).toHaveValue(node.id)
    await expect(page.getByTestId('banks-q-filter-type')).toHaveValue(type)
    await expect(page.getByTestId('banks-q-filter-difficulty')).toHaveValue(String(both[0].difficulty))
    await expect(page.getByTestId('banks-q-list').locator('li')).toHaveCount(all3.length)
    // the AI tab has its own filters
    await page.getByTestId('banks-area-ai').click()
    await expect(page.getByTestId('banks-q-filter-node')).toHaveValue('')
    // BANK-07: a combination that matches nothing
    await page.goto(`/banks?area=design&node=${node.id}`)
    const missing = (['concept', 'estimate', 'tradeoff', 'design'] as const).find(t => !inNode.some(q => q.type === t))
    if (missing) {
      await page.getByTestId('banks-q-filter-type').selectOption(missing)
      await expect(page.getByTestId('banks-q-empty')).toHaveAttribute('data-empty', 'true')
      await expect(page.locator('[data-testid^="banks-q-row-"]')).toHaveCount(0)
      await page.getByTestId('banks-q-empty').getByRole('button').click()
      await expect(page.getByTestId('banks-q-filter-type')).toHaveValue('')
      await expect(nodeSel).toHaveValue('') // the empty state's action clears every filter
      await expect(page.getByTestId('banks-q-clear')).toBeDisabled()
    }
    await nodeSel.selectOption(node.id)
    await page.getByTestId('banks-q-clear').click()
    await expect(nodeSel).toHaveValue('')
    expect(new URL(page.url()).searchParams.get('node')).toBeNull()
  })

  test('BANK-08 to BANK-14, BANK-25 answer first, grade, regrade, Add to Review; BANK-15 the Review card', async ({ page }) => {
    await onboard(page)
    const p = await plan(page)
    const q = questionsOf(p, 'design').find(x => x.source) ?? questionsOf(p, 'design')[0]
    const nodeTitle = p.nodes.find(n => n.id === q.node)!.title
    await page.goto('/banks?area=design')
    const writes = async () => (await idbAll(page, 'bankGrades')).length + (await idbAll(page, 'redos')).length + (await idbAll(page, 'bankExtra')).length
    const before = await writes()
    await page.getByTestId(`banks-q-row-${q.id}`).click()
    const practice = page.getByTestId('banks-q-practice')
    await expect(practice).toBeVisible()
    await expect(page.getByTestId('banks-q-question')).toHaveText(q.question)
    await expect(page.getByTestId('banks-q-answer')).toHaveValue('')
    await expect(page.getByTestId('banks-q-answer')).toBeEnabled()
    const reveal = page.getByTestId('banks-q-reveal')
    await expect(reveal).toBeDisabled()
    await expect(reveal).toHaveAttribute('data-accent', 'primary')
    await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
    // nothing of the model answer or the checklist is on the page, and no grade button
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(body).not.toContain(q.answer.replace(/\s+/g, ' ').slice(0, 60))
    for (const c of q.checklist) expect(body).not.toContain(c)
    await expect(page.getByTestId('banks-q-grade-hard')).toHaveCount(0)
    await page.getByTestId('banks-q-answer').fill('   ')
    await expect(reveal).toBeDisabled()
    await page.getByTestId('banks-q-answer').fill('my rough answer')
    await expect(reveal).toBeEnabled()
    await expect(reveal).toHaveText('REVEAL · ANSWER')
    await reveal.click()
    await expect(page.getByTestId('banks-q-your-answer')).toHaveText('my rough answer')
    await expect(page.getByTestId('banks-q-model')).toHaveText(q.answer)
    for (let i = 0; i < q.checklist.length; i++) await expect(page.getByTestId(`banks-q-check-${i + 1}`)).toBeVisible()
    await expect(page.getByTestId('banks-q-checklist').locator('li')).toHaveText(q.checklist)
    if (q.source) await expect(page.getByTestId('banks-q-source')).toContainText(q.source)
    else await expect(page.getByTestId('banks-q-source')).toHaveCount(0)
    await expect(reveal).toHaveCount(0)
    await expect(page.locator('[data-accent="primary"]')).toHaveCount(0)
    await page.getByTestId('banks-q-check-1').check()
    await page.getByTestId('banks-q-check-1').uncheck()
    expect(await writes()).toBe(before) // BANK-10, BANK-25: reading writes nothing
    await expect(page.getByTestId('banks-q-add-review')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/scope2-w6-practice-revealed-1280.png` })

    // BANK-11: Hard writes one grade row and nothing else
    await page.getByTestId('banks-q-grade-hard').click()
    await expect.poll(async () => (await idbAll<{ id: string; grade: string; tries: number; area: string; node: string }>(page, 'bankGrades')).length).toBe(1)
    const [g] = await idbAll<{ id: string; grade: string; tries: number; area: string; node: string; at: number }>(page, 'bankGrades')
    expect(g).toMatchObject({ id: q.id, area: 'design', node: q.node, grade: 'hard', tries: 1 })
    expect(await idbAll(page, 'redos')).toHaveLength(0)
    if (test.info().project.name === 'real') {
      // with the disk server on, the grade reaches the server's document store (the new table syncs like pulses did)
      await expect.poll(async () => {
        const st = (await (await page.request.get('/db/state')).json()) as { tables: Record<string, unknown[]> }
        return st.tables.bankGrades?.length ?? 0
      }, { timeout: 10_000 }).toBe(1)
    }
    const row = page.getByTestId(`banks-q-row-${q.id}`)
    await expect(row).toContainText('Last: Hard')
    await expect(row).toHaveAttribute('data-seen', 'true')
    await expect(row).toHaveAttribute('data-last-grade', 'hard')
    await expect(page.getByTestId('banks-q-progress')).toHaveAttribute('data-seen', '1')

    // BANK-13/14: Add to Review writes one bank_q redo due in three days
    const add = page.getByTestId('banks-q-add-review')
    await expect(add).toBeEnabled()
    const clickAt = await page.evaluate(() => Date.now())
    await add.click()
    await expect(page.getByTestId('banks-q-added')).toHaveText('Added to Review')
    await expect(page.getByTestId('banks-q-added')).toBeDisabled()
    await expect(add).toHaveCount(0)
    const redos = await idbAll<{ id: string; source: string; ticketId: string; stage: number; due: string; createdAt: number; closedAt?: number; piece: { topic: string; question: string; answer: string; qid: string } }>(page, 'redos')
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({ source: 'bank_q', ticketId: q.id, stage: 0, piece: { topic: nodeTitle, question: q.question, answer: q.answer, qid: q.id } })
    expect(redos[0].closedAt).toBeUndefined()
    const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const d3 = new Date(clickAt); d3.setDate(d3.getDate() + 3)
    expect(redos[0].due).toBe(dayKey(d3.getTime()))
    expect(Math.abs(redos[0].createdAt - clickAt)).toBeLessThan(5000)

    // BANK-12: regrade (practise again): same row, tries 2, no second redo, "Added" stays
    await row.click()
    await page.getByTestId('banks-q-answer').fill('second try')
    await page.getByTestId('banks-q-reveal').click()
    await expect(page.getByTestId('banks-q-added')).toBeVisible()
    await page.getByTestId('banks-q-grade-again').click()
    await expect.poll(async () => (await idbAll<{ grade: string; tries: number }>(page, 'bankGrades'))[0].tries).toBe(2)
    const [g2] = await idbAll<{ id: string; grade: string; tries: number; at: number }>(page, 'bankGrades')
    expect(await idbAll(page, 'bankGrades')).toHaveLength(1)
    expect(g2).toMatchObject({ id: q.id, grade: 'again', tries: 2 })
    expect(g2.at).toBeGreaterThan(g.at)
    await expect(page.getByTestId('banks-q-added')).toBeVisible()
    await expect(page.getByTestId('banks-q-add-review')).toHaveCount(0)
    expect(await idbAll(page, 'redos')).toHaveLength(1)
    await expect(page.getByTestId('banks-q-progress')).toHaveAttribute('data-seen', '1')
    // Good: no offer
    await row.click()
    await page.getByTestId('banks-q-answer').fill('third')
    await page.getByTestId('banks-q-reveal').click()
    await page.getByTestId('banks-q-grade-good').click()
    await expect(row).toContainText('Last: Good')
    await expect(page.getByTestId('banks-q-add-review')).toHaveCount(0)

    // BANK-15: when the redo is due it is a "Question" check card in Review
    await page.clock.setFixedTime(new Date(Date.now() + 4 * 86_400_000)) // the redo is due three days out
    await page.goto('/review')
    const card = page.getByTestId('review-card')
    await expect(page.getByTestId('review-count')).toHaveAttribute('data-count', /\d+/)
    // step to the bank card
    for (let i = 0; i < 40; i++) {
      if ((await card.getAttribute('data-ticket-id')) === q.id) break
      await page.getByTestId('review-skip').click()
    }
    await expect(card).toHaveAttribute('data-ticket-id', q.id)
    await expect(card).toHaveAttribute('data-kind', 'check')
    await expect(page.getByTestId('review-card-kind')).toHaveText('Question')
    await expect(page.getByTestId('review-card-lane')).toHaveText('Design')
    await expect(page.getByTestId('review-card-title')).toHaveText(nodeTitle)
    await expect(page.getByTestId('review-card-question')).toHaveText(q.question)
    await expect(page.getByTestId('review-answer')).toHaveValue('')
    expect(((await page.locator('body').innerText()).replace(/\s+/g, ' '))).not.toContain(q.answer.replace(/\s+/g, ' ').slice(0, 60))
    await page.getByTestId('review-answer').fill('x')
    await page.getByTestId('review-reveal').click()
    await expect(page.getByTestId('review-stored-answer')).toHaveText(q.answer)
    await expect(page.getByTestId('review-redo')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/scope2-w6-review-card-1280.png` })
  })

  test('BANK-18 to BANK-24 More questions, AI-made rows, grade, delete (the open redo survives)', async ({ page }) => {
    await onboard(page)
    const p = await plan(page)
    const node = designNodes(p)[2]
    const base = questionsOf(p, 'design').length
    await page.goto('/banks?area=design')
    const more = page.getByTestId('banks-q-more')
    await expect(more).toBeDisabled()
    await expect(page.getByTestId('banks-q-more-hint')).toBeVisible()
    await page.getByTestId('banks-q-filter-node').selectOption(node.id)
    await expect(more).toBeEnabled()
    await expect(page.getByTestId('banks-q-more-hint')).toHaveCount(0)
    await more.click()
    await expect(more).toBeDisabled() // the fake job takes at least 300 ms
    await expect.poll(async () => (await idbAll(page, 'bankExtra')).length, { timeout: 5000 }).toBe(5)
    await expect(more).toBeEnabled()
    const rows = await idbAll<{ id: string; area: string; node: string; aiMade: boolean; type: string; difficulty: number; checklist: string[]; at: number }>(page, 'bankExtra')
    for (const r of rows) expect(r).toMatchObject({ area: 'design', node: node.id, aiMade: true })
    expect(new Set(rows.map(r => r.id)).size).toBe(5)
    expect(rows.some(r => p.qbank.some(q => q.id === r.id))).toBe(false)
    const log = await idbAll<{ job: string; provider: string; ok: boolean }>(page, 'aiLog')
    expect(log.filter(l => l.job === 'bank_more')).toEqual([expect.objectContaining({ provider: 'fake', ok: true })])
    await page.getByTestId('banks-q-clear').click()
    await expect(page.getByTestId('banks-q-visible-count')).toHaveText(`Showing ${base + 5} of ${base + 5}`)
    await expect(page.getByTestId('banks-q-progress')).toHaveAttribute('data-total', String(base + 5))
    for (const r of rows) await expect(page.getByTestId(`banks-q-aimade-${r.id}`)).toBeVisible()
    const shippedId = questionsOf(p, 'design')[0].id
    await expect(page.getByTestId(`banks-q-aimade-${shippedId}`)).toHaveCount(0)
    // BANK-23: Delete only on an AI-made question
    await page.getByTestId(`banks-q-row-${shippedId}`).click()
    await expect(page.getByTestId('banks-q-delete')).toHaveCount(0)
    // BANK-20: practise, grade Again, add to review, reload, then BANK-24 delete
    const target = rows[0]
    await page.getByTestId(`banks-q-row-${target.id}`).click()
    await expect(page.getByTestId('banks-q-delete')).toBeVisible()
    await page.getByTestId('banks-q-answer').fill('answer')
    await page.getByTestId('banks-q-reveal').click()
    await page.getByTestId('banks-q-grade-again').click()
    await page.getByTestId('banks-q-add-review').click()
    await expect(page.getByTestId('banks-q-added')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId(`banks-q-row-${target.id}`)).toHaveAttribute('data-last-grade', 'again')
    await page.getByTestId(`banks-q-row-${target.id}`).click()
    await page.getByTestId('banks-q-delete').click()
    await page.getByTestId('banks-q-delete-cancel').click()
    expect(await idbAll(page, 'bankExtra')).toHaveLength(5)
    await page.getByTestId('banks-q-delete').click()
    await page.getByTestId('banks-q-delete-confirm').click()
    await expect.poll(async () => (await idbAll(page, 'bankExtra')).length).toBe(4)
    expect(await idbAll(page, 'bankGrades')).toHaveLength(0)
    expect(await idbAll(page, 'redos')).toHaveLength(1) // BANK-16: the Review card survives its question
    await expect(page.getByTestId(`banks-q-row-${target.id}`)).toHaveCount(0)
    await expect(page.getByTestId('banks-q-progress')).toHaveAttribute('data-total', String(base + 4))
    await page.reload()
    await expect(page.getByTestId(`banks-q-row-${target.id}`)).toHaveCount(0)
    await page.clock.setFixedTime(new Date(Date.now() + 4 * 86_400_000))
    await page.goto('/review')
    await expect(page.getByTestId('review-card')).toBeVisible()
    for (let i = 0; i < 40; i++) {
      if ((await page.getByTestId('review-card').getAttribute('data-ticket-id')) === target.id) break
      await page.getByTestId('review-skip').click()
    }
    await expect(page.getByTestId('review-card')).toHaveAttribute('data-ticket-id', target.id)
    await expect(page.getByTestId('review-card-kind')).toHaveText('Question')
  })

  test('BANK-21 More questions on the AI tab; BANK-22 a failed job', async ({ page }) => {
    await onboard(page)
    const p = await plan(page)
    const aiNode = p.nodes.find(n => n.area !== 'design' && n.area !== 'dsa' && n.kind !== 'band' && p.qbank.some(q => q.node === n.id))!
    await page.goto('/banks?area=ai')
    await page.getByTestId('banks-q-filter-node').selectOption(aiNode.id)
    // failure first: no row, one sentence, the button usable again, aiLog ok false
    await page.evaluate(() => localStorage.setItem('dojo:fake-ai-bank_more', 'error'))
    await page.getByTestId('banks-q-more').click()
    await expect(page.getByTestId('banks-q-more-error')).toBeVisible()
    await expect(page.getByTestId('banks-q-more')).toBeEnabled()
    expect(await idbAll(page, 'bankExtra')).toHaveLength(0)
    expect((await idbAll<{ job: string; ok: boolean }>(page, 'aiLog')).filter(l => l.job === 'bank_more')).toEqual([expect.objectContaining({ ok: false })])
    await page.evaluate(() => localStorage.removeItem('dojo:fake-ai-bank_more'))
    await page.getByTestId('banks-q-more').click()
    await expect.poll(async () => (await idbAll(page, 'bankExtra')).length, { timeout: 5000 }).toBe(5)
    const rows = await idbAll<{ area: string; node: string }>(page, 'bankExtra')
    for (const r of rows) expect(r).toMatchObject({ area: 'ai', node: aiNode.id })
    await expect(page.getByTestId('banks-q-more-error')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/scope2-w6-ai-1280.png` })
  })
})

test.describe('W6 question banks at 375', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('BANK-28 phone: no sideways scroll, tabs, one accent before reveal and none after', async ({ page }) => {
    await onboard(page)
    const p = await plan(page)
    const q = questionsOf(p, 'design')[0]
    await page.goto('/banks?area=design')
    await expect(page.getByTestId('banks-areas').getByRole('tab')).toHaveCount(3)
    for (const id of ['dsa', 'design', 'ai']) await expect(page.getByTestId(`banks-area-${id}`)).toBeVisible()
    expect(await noHScroll(page)).toBe(true)
    await page.screenshot({ path: `${SHOTS}/scope2-w6-list-375.png` })
    await page.getByTestId(`banks-q-row-${q.id}`).click()
    await expect(page.getByTestId('banks-q-answer')).toBeVisible()
    await expect(page.getByTestId('banks-q-reveal')).toBeVisible()
    await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
    expect(await noHScroll(page)).toBe(true)
    await page.screenshot({ path: `${SHOTS}/scope2-w6-practice-375.png` })
    await page.getByTestId('banks-q-answer').fill('text')
    await page.getByTestId('banks-q-reveal').click()
    await expect(page.locator('[data-accent="primary"]')).toHaveCount(0)
    expect(await noHScroll(page)).toBe(true)
    await page.getByTestId('banks-q-grade-hard').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/scope2-w6-revealed-375.png` })
    // GLOBAL-06: the AI tab with its whole list drawn (long question and node-title chips) must not scroll sideways
    await page.goto('/banks?area=ai')
    await expect(page.locator('[data-testid^="banks-q-row-"]').first()).toBeVisible()
    expect(await noHScroll(page)).toBe(true)
    await page.locator('[data-testid^="banks-q-row-"]').first().click()
    await expect(page.getByTestId('banks-q-answer')).toBeVisible()
    expect(await noHScroll(page)).toBe(true)
    await page.goto('/banks')
    await expect(page.getByTestId('banks-page')).toBeVisible()
    expect(await noHScroll(page)).toBe(true)
  })
})

void ops

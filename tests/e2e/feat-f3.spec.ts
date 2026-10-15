import { expect, test, type Page } from '@playwright/test'
import { begin, drawS1, endDrawing, fillClose, guard, pick, putDesignSession, resumeAndGo, RL, RL_DIVES, startSession } from './design-helpers'
import { idbAll } from './helpers'

// F3 (DESIGN-97 to DESIGN-107): AI feedback with evidence chips, and "Keep what you missed" on the done view of an AI-partner session.
// where the after screenshots go (set F3_SHOTS to collect them; the default stays inside test-results)
const SHOTS = process.env.F3_SHOTS ?? 'test-results/f3-shots'
type Redo = { id: string; ticketId: string; source: string; stage: number; due: number | string; closedAt?: number; piece?: { topic: string; question: string; answer: string; sessionId: string } }
type Row = { id: string; keptAt?: number; redesignDue?: number; interview?: { final?: { missed?: { topic: string }[]; perItem: { feedback?: string; evidence?: { source: string; target: string }[] }[] } } }
const redos = (page: Page) => idbAll<Redo>(page, 'redos')
const sessions = (page: Page) => idbAll<Row>(page, 'designSessions')

/** An AI-partner session through the fake grade to the done view; `zeroDive` scores one deep dive 0 so a redesign is due. */
async function aiSessionDone(page: Page, zeroDive = false): Promise<void> {
  await startSession(page, 'Interviewer', RL)
  await drawS1(page)
  await page.clock.runFor(12 * 60_000)
  await endDrawing(page)
  await fillClose(page, RL_DIVES[0])
  await expect(page.getByTestId('session-grade')).toBeVisible()
  const row2 = page.getByTestId('session-tradeoff-row-2')
  await row2.getByRole('textbox', { name: 'Chose' }).fill('fail open')
  await row2.getByRole('textbox', { name: 'Over' }).fill('fail closed')
  await row2.getByRole('textbox', { name: 'Because' }).fill('limiter outage must not take the API down')
  if (zeroDive) await pick(page, RL_DIVES[1], 0)
  await page.getByTestId('session-complete').click()
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
}

test('F3 the done view: feedback paragraphs with chips, stronger on the right, and the Keep panel adds three review cards once', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await aiSessionDone(page)

  // the stored grade (DESIGN-97)
  const [row] = await sessions(page)
  const final = row.interview!.final!
  expect(final.perItem).toHaveLength(5)
  for (const p of final.perItem) {
    expect(p.feedback).toBeTruthy()
    expect(p.evidence!.length).toBeGreaterThanOrEqual(1)
  }
  expect(final.missed).toHaveLength(3)
  expect(row.keptAt).toBeUndefined()

  // the feedback block (DESIGN-98, 99)
  const grade = page.getByTestId('session-grade')
  await expect(grade.getByRole('heading', { name: 'AI partner · feedback' })).toBeVisible()
  await expect(grade).toContainText('Read your notes and the diagram')
  const item1 = page.getByTestId('session-grade-item-1')
  await expect(item1.getByRole('heading')).toHaveText('Requirements and numbers · 4 of 4')
  await expect(item1.locator('p')).toHaveText(final.perItem[0].feedback!)
  const chip1 = page.getByTestId('session-grade-cite-1-1')
  await expect(chip1).toHaveText('Notes Requirements')
  await expect(page.getByTestId('session-grade-cite-1-2')).toHaveText(/^Diagram (Gateway 1|Service 1|Cache 1|Sql 1)$/)
  expect(await chip1.evaluate(e => e.tagName)).toBe('SPAN')
  await expect(page.getByTestId('session-grade-cite-1-3')).toHaveCount(0)

  // stronger in the right column (DESIGN-100)
  const stronger = page.getByTestId('session-grade-stronger')
  const a = (await item1.boundingBox())!
  const s = (await stronger.boundingBox())!
  const g = (await grade.boundingBox())!
  expect(s.x).toBeGreaterThanOrEqual(a.x + a.width)
  expect(s.y).toBeLessThanOrEqual(g.y + g.height)
  // still in the right column at exactly 1100, and below session-grade at 1099 (DESIGN-100, blind run 6)
  await page.setViewportSize({ width: 1100, height: 800 })
  const a1100 = (await item1.boundingBox())!
  const s1100 = (await stronger.boundingBox())!
  const g1100 = (await grade.boundingBox())!
  expect(s1100.x).toBeGreaterThanOrEqual(a1100.x + a1100.width)
  expect(s1100.y).toBeLessThanOrEqual(g1100.y + g1100.height)
  await page.setViewportSize({ width: 1099, height: 800 })
  const s1099 = (await stronger.boundingBox())!
  const g1099 = (await grade.boundingBox())!
  expect(s1099.y).toBeGreaterThanOrEqual(g1099.y + g1099.height)
  await page.setViewportSize({ width: 1280, height: 800 })

  // the Keep panel (DESIGN-102)
  const keep = page.getByTestId('session-keep')
  await expect(keep).toContainText('Keep what you missed')
  await expect(keep).toContainText(`3 weak spots can become review cards: ${final.missed!.map(m => m.topic).slice(0, 2).join(', ')} and ${final.missed![2].topic}.`)
  await expect(page.getByTestId('session-keep-pips')).toHaveAttribute('data-count', '3')
  await expect(page.getByTestId('session-keep-pips').locator('i')).toHaveCount(3)
  const add = page.getByTestId('session-keep-add')
  await expect(add).toHaveText('ADD · REVIEW CARDS')
  await expect(add).toBeEnabled()
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
  await expect(add).toHaveAttribute('data-accent', 'primary')
  await expect(page.getByRole('button', { name: 'Redo this prompt' })).toHaveCount(0)
  expect(await redos(page)).toEqual([]) // nothing written by looking
  await page.screenshot({ path: `${SHOTS}/feat-f3-done-1280.png`, fullPage: true })

  // Add (DESIGN-103, 104)
  await add.click()
  await expect(page.getByTestId('session-keep-done')).toHaveText('Added 3 review cards.')
  await expect(add).toHaveCount(0)
  const kept = (await redos(page)).sort((x, y) => x.id.localeCompare(y.id))
  expect(kept.map(r => r.id)).toEqual([`keep-${row.id}-1`, `keep-${row.id}-2`, `keep-${row.id}-3`])
  for (const [i, r] of kept.entries()) {
    expect(r).toMatchObject({ ticketId: RL, source: 'design_missed', stage: 0, piece: { ...final.missed![i], sessionId: row.id } })
    expect(r.closedAt).toBeUndefined()
  }
  expect((await sessions(page))[0].keptAt).toBeGreaterThan(0)
  await resumeAndGo(page, () => page.reload())
  await expect(page.getByTestId('session-keep-done')).toHaveText('Added 3 review cards.')
  await expect(page.getByTestId('session-keep-pips')).toHaveAttribute('data-count', '3')
  await expect(page.getByTestId('session-keep-add')).toHaveCount(0)
  expect(await redos(page)).toHaveLength(3)
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(0)

  // Review the next day: a check card with the question, then the stored answer (REVIEW-23, 24)
  const due = Date.parse(kept[0].due as string) // a local date
  await page.clock.setFixedTime(due + 3 * 3_600_000)
  await resumeAndGo(page, () => page.goto('/review'))
  await expect(page.getByTestId('review-count')).toHaveAttribute('data-count', '3')
  const card = page.getByTestId('review-card')
  await expect(card).toHaveAttribute('data-kind', 'check')
  await expect(page.getByTestId('review-card-kind')).toHaveText('Design')
  await expect(page.getByTestId('review-card-question')).toHaveText(kept[0].piece!.question)
  await page.getByTestId('review-answer').fill('my attempt')
  await page.getByTestId('review-reveal').click()
  await expect(page.getByTestId('review-stored-answer')).toHaveText(kept[0].piece!.answer)
  check()
})

test('F3 a due redesign keeps the accent: Add is quiet, and kept cards do not block the design_rubric redo', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  await aiSessionDone(page, true)
  const [row] = await sessions(page)
  expect(row.redesignDue).toBeGreaterThan(0)
  await expect(page.locator('[data-accent="primary"]')).toHaveCount(1)
  await expect(page.getByTestId('session-redesign')).toHaveAttribute('data-accent', 'primary')
  const add = page.getByTestId('session-keep-add')
  await expect(add).toBeVisible()
  await expect(add).toBeEnabled()
  await expect(add).not.toHaveAttribute('data-accent', 'primary')
  const [addBg, redoBg] = await Promise.all([add, page.getByTestId('session-redesign')].map(l => l.evaluate(e => getComputedStyle(e).backgroundColor)))
  expect(addBg).not.toBe(redoBg)
  await page.screenshot({ path: `${SHOTS}/feat-f3-redesign-due-1280.png`, fullPage: true })
  // the one-open-redo rule counts design_rubric rows only
  expect((await redos(page)).filter(r => r.source === 'design_rubric' && r.closedAt === undefined)).toHaveLength(1)
  await add.click()
  await expect(page.getByTestId('session-keep-done')).toBeVisible()
  const all = await redos(page)
  expect(all.filter(r => r.source === 'design_rubric' && r.closedAt === undefined)).toHaveLength(1)
  expect(all.filter(r => r.source === 'design_missed' && r.closedAt === undefined)).toHaveLength(3)
  check()
})

test('F3 old and unmatched data: a grade without the new fields shows its note and no chips or Keep panel; a gone diagram label is plain text', async ({ page }) => {
  const check = guard(page)
  await begin(page)
  const base = {
    designId: RL, at: Date.now() - 3_600_000, phase: 'done', endedAt: Date.now() - 60_000, minutes: 45, mode: 'ai-partner', view: '2d',
    canvas: { layout: 'manual', nodes: [{ id: 'queue-1', kind: 'queue', label: 'Queue', x: 1, y: 1 }], links: [], zones: [], flows: [] },
    close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: 'DDIA' },
    deepDives: RL_DIVES.map(q => ({ q, answered: 1 })), tradeoffs: [], rubric: 15, rubricBy: 'model', lenses: {},
  }
  const items = (extra: (i: number) => object) => ['Requirements and numbers', 'API and data model', 'High-level design that meets the numbers', 'Two deep dives with real trade-offs', 'Failure modes and operations']
    .map((item, i) => ({ item, points: [4, 2, 3, 4, 2][i], note: `Stored note ${i + 1}.`, ...extra(i) }))
  const final = (perItem: object[], more: object = {}) => ({ done: true, score: 15, perItem, oneThingToStudy: 'x', deepDives: [2, 1, 1, 1], lenses: {}, ...more })
  await putDesignSession(page, { ...base, id: 'old-1', interview: { messages: [], final: final(items(() => ({}))) } })
  await putDesignSession(page, {
    ...base, id: 'new-1', designId: 'd-cache', interview: {
      messages: [],
      final: final(items(i => ({ feedback: `Paragraph ${i + 1}.`, evidence: i === 0 ? [{ source: 'diagram', target: 'queue' }, { source: 'diagram', target: 'Ghost cache' }, { source: 'notes', target: 'open' }] : [] })), { missed: [{ topic: 'one topic', question: 'q?', answer: 'a.' }] }),
    },
  })
  await resumeAndGo(page, () => page.goto(`/designs/session/${RL}?session=old-1`))
  await expect(page.getByTestId('session-grade-item-1').locator('p')).toHaveText('Stored note 1.')
  await expect(page.locator('[data-testid^="session-grade-cite-"]')).toHaveCount(0)
  await expect(page.getByTestId('session-keep')).toHaveCount(0)
  await resumeAndGo(page, () => page.goto('/designs/session/d-cache?session=new-1'))
  await expect(page.getByTestId('session-grade-cite-1-1')).toHaveText('Diagram queue')
  await expect(page.getByTestId('session-grade-cite-1-2')).toHaveText('Ghost cache') // matches nothing drawn: plain text, still a chip
  await expect(page.getByTestId('session-grade-cite-1-3')).toHaveText('Notes Open questions')
  await expect(page.getByTestId('session-keep')).toContainText('1 weak spot can become a review card: one topic.')
  check()
})

test('F3 at 375 the done view does not scroll sideways', async ({ page }) => {
  const check = guard(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await begin(page)
  await aiSessionDone(page)
  await expect(page.getByTestId('session-keep')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // below 1100 the stronger list sits under the feedback
  const g = (await page.getByTestId('session-grade').boundingBox())!
  const s = (await page.getByTestId('session-grade-stronger').boundingBox())!
  expect(s.y).toBeGreaterThanOrEqual(g.y + g.height)
  await page.getByTestId('session-keep').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/feat-f3-done-375.png`, fullPage: true })
  check()
})

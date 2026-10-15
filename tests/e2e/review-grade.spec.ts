import { expect, test } from './fixtures'
import { appDbName, IST, idbAll, onboard } from './helpers'

type Ticket = { id: string; kind: string; status: string; explain?: string[]; explainAnswers?: string[]; archived?: boolean }
type Redo = { id: string; ticketId: string; stage: number; passed: boolean[]; closedAt?: number; due: number | string }

// R1 Review (REVIEW-05..09, REVIEW-17): a due learning check is answered first, revealed, graded "Got it", and the queue, the nav badge and
// the data agree (closed redo, empty state, badge gone). Runs in the default project on Dexie and in `real` against dojo-server
// (tests/e2e/real/subset.ts). One redo is seeded on a plan watch ticket that carries an explain question and a stored answer: the
// redo is normally created by a failed explain check (AI), which is not what this spec is about.
test('R1 Review: a due check card is answered first, revealed and graded Got it; the badge, the queue and the data agree', async ({ page }) => {
  await page.clock.setFixedTime(IST('2026-10-06T21:10:00'))
  await onboard(page, '2026-10-05')
  const t = (await idbAll<Ticket>(page, 'tickets')).find(x => x.kind === 'watch' && !x.archived && (x.explain?.length ?? 0) > 0 && (x.explainAnswers?.[0] ?? '').trim() !== '')!
  expect(t, 'a plan watch ticket with an explain question and a reference answer').toBeTruthy()
  const dbName = await appDbName(page)
  const redo = { id: 'r-e2e-review', ticketId: t.id, source: 'check_failed', createdAt: IST('2026-10-02T10:00:00').getTime(), stage: 0, due: IST('2026-10-05T10:00:00').getTime(), passed: [], helpCost: 0, refunded: 0 }
  await page.evaluate(({ dbName, redo }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dbName)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const idb = req.result
      const tx = idb.transaction('redos', 'readwrite')
      tx.objectStore('redos').put(redo)
      tx.oncomplete = () => { idb.close(); resolve() }
      tx.onerror = () => { idb.close(); reject(tx.error) }
    }
  }), { dbName, redo })
  if (dbName === 'dojo-disk') {
    // served by dojo-server (the `real` project): the disk is the truth the reload hydrates from, so the seeded redo goes there as well
    const status = await page.evaluate(async redo => {
      const res = await fetch('/db/ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': localStorage.getItem('dojo.writer') ?? '' },
        body: JSON.stringify({ clientId: 'e2e-seed', ops: [{ tbl: 'redos', op: 'put', id: redo.id, doc: redo, at: new Date().toISOString(), opId: 'e2e-seed-1' }] }),
      })
      return res.status
    }, redo)
    expect(status).toBe(200)
  }
  await page.reload()

  await page.getByTestId('shell-nav-review').click()
  await expect(page).toHaveURL(/\/review$/)
  await expect(page.getByTestId('review-count')).toHaveAttribute('data-count', '1')
  await expect(page.getByTestId('shell-review-badge')).toHaveAttribute('data-count', '1')
  await expect(page.getByTestId('review-card')).toHaveAttribute('data-ticket-id', t.id)
  await expect(page.getByTestId('review-card')).toHaveAttribute('data-kind', 'check')
  // answer first (REVIEW-05/06): the stored answer is not on the page and Reveal needs a non-space character
  const stored = t.explainAnswers![0].trim()
  await expect(page.getByTestId('review-reveal')).toBeDisabled()
  expect(await page.locator('body').innerText()).not.toContain(stored)
  await page.getByTestId('review-answer').fill('   ')
  await expect(page.getByTestId('review-reveal')).toBeDisabled()
  await page.getByTestId('review-answer').fill('my own words')
  await expect(page.getByTestId('review-reveal')).toBeEnabled()
  await page.getByTestId('review-reveal').click()
  await expect(page.getByTestId('review-your-answer')).toHaveText('my own words')
  await expect(page.getByTestId('review-stored-answer')).toContainText(stored)
  for (const g of ['missed', 'close', 'got']) await expect(page.getByTestId(`review-grade-${g}`)).toBeVisible()

  // REVIEW-09 / REVIEW-17: Got it closes the redo; the queue is empty and the badge is gone without a reload
  await page.getByTestId('review-grade-got').click()
  await expect(page.getByTestId('review-empty')).toBeVisible()
  await expect(page.getByTestId('shell-review-badge')).toHaveCount(0)
  // Got it on stage 0 advances the redo to stage 1 with a later due day (it closes only after the last stage); either way it is not due today
  await expect.poll(async () => {
    const r = (await idbAll<Redo>(page, 'redos')).find(x => x.id === 'r-e2e-review')!
    return r.closedAt !== undefined || (typeof r.due === 'number' ? r.due : Date.parse(r.due)) > IST('2026-10-06T23:59:59').getTime()
  }).toBe(true)
  expect((await idbAll<Redo>(page, 'redos')).find(x => x.id === 'r-e2e-review')).toMatchObject({ stage: 1, passed: [true] })
  if (dbName === 'dojo-disk') {
    await expect.poll(async () => {
      const st = await page.evaluate(async () => (await fetch('/db/state')).json()) as { tables: { redos?: Redo[] } }
      return st.tables.redos?.find(x => x.id === 'r-e2e-review')?.stage
    }).toBe(1) // the grade reached the disk
  }
  await page.reload()
  await expect(page.getByTestId('review-empty')).toBeVisible()
})

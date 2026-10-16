import { describe, expect, it } from 'vitest'
import { createExplainRedos } from '../../src/data/explainActions'
import { explainRedoId, explainRedos } from '../../src/rules/explainCards'
import { gradeRedo } from '../../src/rules/reviewQueue'
import { isRedoDue } from '../../src/rules/redoQueue'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/planV2'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 11, 4, 10)
const t = mkTicket({ id: 'w1', kind: 'watch', explain: ['What is a weight?', 'What does training change?'], explainAnswers: ['One adjustable number.', 'The weights.'] })

describe('explainRedos', () => {
  it('makes one stage-0 explain redo per question, id ex-<ticket>-<index>, due three local days out, with the question and the model answer', () => {
    const rows = explainRedos(t, 'Neural network basics', NOW)
    expect(rows.map(r => r.id)).toEqual(['ex-w1-0', 'ex-w1-1'])
    expect(rows[0]).toEqual({
      id: 'ex-w1-0', ticketId: 'w1', source: 'explain', createdAt: NOW, stage: 0, due: '2026-11-07',
      passed: [], helpCost: 0, refunded: 0, piece: { topic: 'Neural network basics', question: 'What is a weight?', answer: 'One adjustable number.' },
    })
    expect(explainRedoId('w1', 1)).toBe('ex-w1-1')
  })
  it('skips a question with no model answer, and a ticket with no questions makes none', () => {
    expect(explainRedos({ ...t, explainAnswers: ['Only the first.'] }, 'x', NOW).map(r => r.id)).toEqual(['ex-w1-0'])
    expect(explainRedos(mkTicket({ id: 'x' }), 'x', NOW)).toEqual([])
  })
  it('the due day is local: a pass at 23:50 and one at 00:10 the next day are due three calendar days later', () => {
    expect(explainRedos(t, 'x', at(2026, 11, 4, 23, 50))[0].due).toBe('2026-11-07')
    expect(explainRedos(t, 'x', at(2026, 11, 5, 0, 10))[0].due).toBe('2026-11-08')
    expect(explainRedos(t, 'x', at(2026, 11, 4, 23, 59))[0].due).toBe('2026-11-07')
  })
})

describe('createExplainRedos', () => {
  it('writes the rows and is a no-op the second time (idempotent), even after a card is closed', async () => {
    const d = freshDb()
    expect(await createExplainRedos(d, t, 'Topic', NOW)).toBe(2)
    expect(await createExplainRedos(d, t, 'Topic', NOW + 1000)).toBe(0)
    expect(await d.redos.count()).toBe(2)
    const first = (await d.redos.get('ex-w1-0'))!
    await d.redos.put({ ...first, closedAt: NOW })
    expect(await createExplainRedos(d, t, 'Topic', NOW + 2000)).toBe(0)
    expect((await d.redos.get('ex-w1-0'))!.closedAt).toBe(NOW)
  })
  it('Got it moves a card to 10 days and then 30 days (3, 10, 30), then closes it', () => {
    const [r0] = explainRedos(t, 'x', NOW)
    expect(isRedoDue(r0, at(2026, 11, 6, 23))).toBe(false)
    expect(isRedoDue(r0, at(2026, 11, 7, 0, 1))).toBe(true)
    const r1 = gradeRedo(r0, 'got', at(2026, 11, 7, 9))
    expect(r1.stage).toBe(1)
    expect(new Date(r1.due as number).getDate()).toBe(17)
    const r2 = gradeRedo(r1, 'got', at(2026, 11, 17, 9))
    expect(r2.stage).toBe(2)
    expect([new Date(r2.due as number).getMonth(), new Date(r2.due as number).getDate()]).toEqual([11, 17])
    expect(gradeRedo(r2, 'got', at(2026, 12, 17, 9)).closedAt).toBe(at(2026, 12, 17, 9))
  })
})

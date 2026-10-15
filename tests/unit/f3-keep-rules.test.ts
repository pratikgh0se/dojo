import { describe, expect, it } from 'vitest'
import type { Redo, Ticket } from '../../src/data/types'
import type { DesignSession } from '../../src/data/types'
import { canvasLabels, chipFor, evidenceChips } from '../../src/rules/gradeEvidence'
import { keepAccent, keepCopy, keptCopy, keepRedos, keepState } from '../../src/rules/keepMissed'
import { reviewCards } from '../../src/rules/reviewQueue'
import { emptyNotes } from '../../src/rules/designNotes'

const T0 = new Date('2026-10-13T22:30:00+05:30').getTime()
const MISSED = [
  { topic: 'partition key', question: 'What makes a good partition key?', answer: 'Even spread, ordering kept per key.' },
  { topic: 'tile fetch API', question: 'How does a client fetch a tile?', answer: 'A read call by tile id.' },
  { topic: 'conflict rule', question: 'What does last-writer-wins cost?', answer: 'The earlier edit is lost.' },
]
const canvas = {
  layout: 'manual', links: [], flows: [],
  nodes: [
    { id: 'n1', kind: 'queue', label: 'Queue', x: 1, y: 1 },
    { id: 'n2', kind: 'custom', label: 'Render engine', glyph: 'process', x: 9, y: 1 },
    { id: 'n3', kind: 'table', label: 'Table 1', schemaId: 't1', x: 17, y: 1 },
  ],
  zones: [{ id: 'z1', label: 'Edge', kind: 'system', nodes: ['n1'] }],
  notes: [{ id: 'c1', x: 1, y: 9, text: '  Needs undo  ' }],
}
const notes = { ...emptyNotes(), schema: [{ id: 't1', name: 'layers', cols: [{ name: 'id', type: 'uuid', key: 'PK' as const }] }] }
const session = (over: Partial<DesignSession> = {}): DesignSession => ({
  id: 'ds-1', designId: 'd-ddia', at: 0, phase: 'done', minutes: 45, mode: 'ai-partner', view: '2d', canvas: canvas as never, notes,
  close: {} as never, deepDives: [], tradeoffs: [], rubric: 12, lenses: {},
  interview: { messages: [], final: { done: true, score: 12, perItem: [], oneThingToStudy: '', deepDives: [2, 1, 1, 0], lenses: {} as never, missed: MISSED } },
  ...over,
})

describe('canvasLabels and evidence chips (F3 parse rules)', () => {
  it('lists node, table, frame and sticky-note labels as drawn', () => {
    expect(canvasLabels(session())).toEqual(['Queue', 'Render engine', 'layers', 'Edge', 'Needs undo'])
  })
  it('a notes target shows its section title with the Notes kind', () => {
    expect(chipFor({ source: 'notes', target: 'assumptions' }, [])).toEqual({ kind: 'Notes', title: 'Assumptions and estimates' })
    expect(chipFor({ source: 'notes', target: 'open' }, [])).toEqual({ kind: 'Notes', title: 'Open questions' })
  })
  it('a diagram target that matches a current label (case-insensitive) is a Diagram chip with the target as stored', () => {
    expect(chipFor({ source: 'diagram', target: 'render ENGINE' }, ['Queue', 'Render engine'])).toEqual({ kind: 'Diagram', title: 'render ENGINE' })
  })
  it('a diagram target that matches nothing is kept as plain text with no kind', () => {
    expect(chipFor({ source: 'diagram', target: 'Gone box' }, ['Queue'])).toEqual({ kind: null, title: 'Gone box' })
  })
  it('an unknown notes section is dropped', () => {
    expect(chipFor({ source: 'notes', target: 'nope' }, [])).toBeNull()
  })
  it('evidenceChips keeps order, drops unknown notes sections and treats missing evidence as absent', () => {
    const ev = [{ source: 'notes' as const, target: 'api' }, { source: 'notes' as const, target: 'zzz' }, { source: 'diagram' as const, target: 'queue' }]
    expect(evidenceChips(ev, ['Queue'])).toEqual([{ kind: 'Notes', title: 'API' }, { kind: 'Diagram', title: 'queue' }])
    expect(evidenceChips(undefined, ['Queue'])).toEqual([])
  })
})

describe('keepState and copy (F3 panel)', () => {
  it('shown only with at least one missed entry; counts them', () => {
    expect(keepState(session()).missed).toHaveLength(3)
    expect(keepState(session({ interview: { messages: [] } })).missed).toHaveLength(0)
    expect(keepState(session({ interview: { messages: [], final: { ...session().interview!.final!, missed: [] } } })).missed).toHaveLength(0)
    expect(keepState(session({ mode: 'human-partner' })).missed).toHaveLength(0)
    expect(keepState(session({ mode: 'solo' })).missed).toHaveLength(0)
  })
  it('kept once keptAt is set', () => {
    expect(keepState(session()).kept).toBe(false)
    expect(keepState(session({ keptAt: T0 })).kept).toBe(true)
  })
  it('the copy names the topics with "and" before the last', () => {
    expect(keepCopy(MISSED)).toBe('3 weak spots can become review cards: partition key, tile fetch API and conflict rule.')
    expect(keepCopy(MISSED.slice(0, 2))).toBe('2 weak spots can become review cards: partition key and tile fetch API.')
    expect(keepCopy(MISSED.slice(0, 1))).toBe('1 weak spot can become a review card: partition key.')
    expect(keptCopy(3)).toBe('Added 3 review cards.')
    expect(keptCopy(1)).toBe('Added 1 review card.')
  })
  it('the Add button takes the accent only when no redesign is due (DESIGN-74 amended)', () => {
    expect(keepAccent(session())).toBe(true)
    expect(keepAccent(session({ redesignDue: T0 }))).toBe(false)
  })
})

describe('keepRedos (what Add writes)', () => {
  it('one design_missed redo per entry: fixed ids, design ticket, stage 0, due the next local day, the piece', () => {
    const r = keepRedos(session(), T0)
    expect(r.map(x => x.id)).toEqual(['keep-ds-1-1', 'keep-ds-1-2', 'keep-ds-1-3'])
    for (const [i, x] of r.entries()) {
      expect(x).toMatchObject({
        ticketId: 'd-ddia', source: 'design_missed', stage: 0, due: '2026-10-14', createdAt: T0, passed: [], helpCost: 0, refunded: 0,
        piece: { ...MISSED[i], sessionId: 'ds-1' },
      })
      expect(x.closedAt).toBeUndefined()
    }
  })
  it('nothing for a session with no missed entries', () => {
    expect(keepRedos(session({ interview: { messages: [] } }), T0)).toEqual([])
  })
  it('the interview word is never stored in a learner-facing piece', () => {
    const s = session({ interview: { messages: [], final: { ...session().interview!.final!, missed: [{ topic: 'interview habits', question: 'How was your interview?', answer: 'Calm.' }] } } })
    expect(keepRedos(s, T0)[0].piece).toMatchObject({ topic: 'session habits', question: 'How was your session?' })
  })
})

describe('review cards for design_missed redos', () => {
  const design: Ticket = { id: 'd-ddia', title: 'Design a collaborative photo editor', kind: 'design', status: 'done' } as Ticket
  const redo = (over: Partial<Redo>): Redo => ({ id: 'keep-ds-1-1', ticketId: 'd-ddia', source: 'design_missed', createdAt: T0, stage: 0, due: '2026-10-14', passed: [], helpCost: 0, refunded: 0, ...over })
  const nowMs = new Date('2026-10-14T09:00:00+05:30').getTime()
  it('is a check card: prompt is the question, stored is the answer, lane and kind label Design', () => {
    const [c] = reviewCards({ redos: [redo({ piece: { ...MISSED[0], sessionId: 'ds-1' } })], tickets: [design], nowMs })
    expect(c).toMatchObject({
      redoId: 'keep-ds-1-1', kind: 'check', ticketKind: 'design', lane: 'design', title: design.title,
      prompt: MISSED[0].question, stored: MISSED[0].answer, stage: 0, ageDays: 0, dueDay: '2026-10-14',
    })
  })
  it('is not due before its day', () => {
    expect(reviewCards({ redos: [redo({ piece: { ...MISSED[0], sessionId: 'ds-1' } })], tickets: [design], nowMs: T0 })).toEqual([])
  })
  it('a design_rubric redo on the same ticket still replays', () => {
    const cards = reviewCards({ redos: [redo({ id: 'r9', source: 'design_rubric', due: '2026-10-01' }), redo({ piece: { ...MISSED[1], sessionId: 'ds-1' }, id: 'keep-ds-1-2' })], tickets: [design], nowMs })
    expect(cards.map(c => [c.redoId, c.kind])).toEqual([['r9', 'replay'], ['keep-ds-1-2', 'check']])
  })
})

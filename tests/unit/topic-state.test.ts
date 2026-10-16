import { describe, expect, it } from 'vitest'
import type { CheckAttemptRow, Ticket } from '../../src/data/types'
import { nextStepLine, topicState, TOPIC_WORD, type LabDefs } from '../../src/rules/topicState'
import { mkReview, mkRun } from '../helpers/labRows'
import { mkTicket } from '../helpers/planV2'

const LAB = 'b1-tokensim'
const defs: LabDefs = {
  [LAB]: {
    closingTicket: 'ai.b1.build.12',
    milestones: [
      { ticket: 'ai.b1.build', checkIds: ['c1'] }, { ticket: 'ai.t01.build', checkIds: ['c2'] }, { ticket: 'ai.t06.build', checkIds: ['c3'] },
      { ticket: 'ai.t07.build', checkIds: ['c4'] }, { ticket: 'ai.t18.build', checkIds: ['c5'] },
    ],
  },
  u1: { closingTicket: 'ai.u1.build.3', milestones: [{ ticket: 'ai.u1.build', checkIds: ['u'] }] },
}
const t = (id: string, node: string, over: Partial<Ticket> = {}) => mkTicket({ id, node, area: 'x', ...over })
const read = (id: string, node: string, status: Ticket['status'] = 'done', over: Partial<Ticket> = {}) => t(id, node, { kind: 'read', status, ...over })
const build = (id: string, node: string, lab: string, status: Ticket['status'] = 'done') => t(id, node, { kind: 'build', status, lab: { id: lab, gpu: 'none' } })
const attempt = (ticketId: string, at: number, passed: boolean): CheckAttemptRow => ({ id: `ca-${ticketId}-${at}`, ticketId, at, answers: [], feedback: [], passed })
type Over = { attempts?: CheckAttemptRow[]; runs?: ReturnType<typeof mkRun>[]; reviews?: ReturnType<typeof mkReview>[]; defs?: LabDefs }
const st = (node: string, tickets: Ticket[], over: Over = {}) =>
  topicState({ id: node }, tickets, over.attempts ?? [], over.runs ?? [], over.reviews ?? [], over.defs ?? defs)

describe('topicState: learning and learned', () => {
  const rows: [string, Ticket[], ReturnType<typeof st>][] = [
    ['no tickets', [], null],
    ['all todo', [read('r', 'N', 'todo'), read('r2', 'N', 'todo')], null],
    ['a blocked ticket is not started', [read('r', 'N', 'blocked')], null],
    ['one doing', [read('r', 'N', 'doing')], 'learning'],
    ['one done of two', [read('r', 'N'), read('r2', 'N', 'todo')], 'learning'],
    ['all learn tickets done, none carries explain', [read('r', 'N'), read('r2', 'N')], 'learned'],
    ['a watch ticket counts as learn too', [t('w', 'N', { kind: 'watch', status: 'done' })], 'learned'],
    ['a writeup alone is neither learn nor build: learning', [t('wu', 'N', { kind: 'writeup', status: 'done' })], 'learning'],
    ['archived tickets are ignored', [read('r', 'N', 'done', { archived: true })], null],
    ['another node is ignored', [read('r', 'M')], null],
  ]
  for (const [name, tickets, want] of rows) it(name, () => expect(st('N', tickets)).toBe(want))

  it('a ticket with explain needs a passing newest check', () => {
    const r = read('r', 'N', 'done', { explain: ['q'] })
    expect(st('N', [r])).toBe('learning')
    expect(st('N', [r], { attempts: [attempt('r', 1, true)] })).toBe('learned')
    expect(st('N', [r], { attempts: [attempt('r', 1, true), attempt('r', 2, false)] })).toBe('learning')
    expect(st('N', [r], { attempts: [attempt('r', 1, false), attempt('r', 2, true)] })).toBe('learned')
    expect(st('N', [r], { attempts: [attempt('other', 5, true)] })).toBe('learning')
  })
  it('every explain-carrying learn ticket needs its own pass', () => {
    const a = read('a', 'N', 'done', { explain: ['q'] })
    const b = read('b', 'N', 'done', { explain: ['q'] })
    expect(st('N', [a, b], { attempts: [attempt('a', 1, true)] })).toBe('learning')
    expect(st('N', [a, b], { attempts: [attempt('a', 1, true), attempt('b', 1, true)] })).toBe('learned')
  })
})

describe('topicState: built and proven', () => {
  const tickets = [read('ai.u1.learn', 'U1'), build('ai.u1.build', 'U1', 'u1')]
  const pass = mkRun('u1', 10, { u: 'pass' })
  const fail = mkRun('u1', 10, { u: 'fail' })
  it('learned until the milestone passes', () => {
    expect(st('U1', tickets)).toBe('learned')
    expect(st('U1', tickets, { runs: [fail] })).toBe('learned')
  })
  it('built once a stored run has the milestone checks at pass', () => {
    expect(st('U1', tickets, { runs: [pass] })).toBe('built')
  })
  it('is monotonic: a later failing run does not un-pass the milestone', () => {
    expect(st('U1', tickets, { runs: [pass, mkRun('u1', 20, { u: 'fail' })] })).toBe('built')
  })
  it('only the node lab runs count', () => {
    expect(st('U1', tickets, { runs: [mkRun('other', 10, { u: 'pass' })] })).toBe('learned')
  })
  it('proven needs a passing newest review; a later not-yet drops it back to built', () => {
    const runs = [pass]
    expect(st('U1', tickets, { runs, reviews: [mkReview('u1', 1, true)] })).toBe('proven')
    expect(st('U1', tickets, { runs, reviews: [mkReview('u1', 1, false)] })).toBe('built')
    expect(st('U1', tickets, { runs, reviews: [mkReview('u1', 1, true), mkReview('u1', 2, false)] })).toBe('built')
    expect(st('U1', tickets, { runs, reviews: [mkReview('u1', 1, false), mkReview('u1', 2, true)] })).toBe('proven')
    expect(st('U1', tickets, { runs, reviews: [mkReview(LAB, 1, true)] })).toBe('built')
  })
  it('built needs the learn tickets learned when the node has them', () => {
    const open = [read('ai.u1.learn', 'U1', 'todo'), build('ai.u1.build', 'U1', 'u1')]
    expect(st('U1', open, { runs: [pass] })).toBe('learning')
  })
  it('a node with no learn tickets can be built', () => {
    expect(st('U1', [build('ai.u1.build', 'U1', 'u1')], { runs: [pass] })).toBe('built')
  })
  it('a build ticket without a lab never makes a node built', () => {
    expect(st('N', [read('r', 'N'), t('b', 'N', { kind: 'build', status: 'done' })])).toBe('learned')
  })
  it('a node with two labs is built only when both milestones pass and proven only when both are reviewed', () => {
    const two = [build('ai.u1.build', 'N', 'u1'), build('ai.t01.build', 'N', LAB)]
    const runs = [mkRun('u1', 1, { u: 'pass' }), mkRun(LAB, 2, { c2: 'pass' })]
    expect(st('N', two, { runs: [runs[0]] })).toBe('learning')
    expect(st('N', two, { runs })).toBe('built')
    expect(st('N', two, { runs, reviews: [mkReview('u1', 3, true)] })).toBe('built')
    expect(st('N', two, { runs, reviews: [mkReview('u1', 3, true), mkReview(LAB, 4, true)] })).toBe('proven')
  })
})

describe('topicState: a lab the server does not know', () => {
  it('caps the node at learning and never throws', () => {
    const tickets = [read('r', 'U1'), build('ai.u1.build', 'U1', 'u1')]
    const runs = [mkRun('u1', 1, { u: 'pass' })]
    expect(st('U1', tickets, { runs, defs: {} })).toBe('learning')
    expect(st('U1', [read('r', 'U1', 'todo'), build('ai.u1.build', 'U1', 'u1', 'todo')], { defs: {} })).toBeNull()
    expect(st('U1', tickets, { runs, defs: { u1: { closingTicket: 'x', milestones: [] } } })).toBe('learning')
  })
})

describe('topicState: B1 spans five nodes', () => {
  const nodes = ['B1', 'T01', 'T06', 'T07', 'T18']
  const ids: Record<string, string> = { B1: 'ai.b1.build', T01: 'ai.t01.build', T06: 'ai.t06.build', T07: 'ai.t07.build', T18: 'ai.t18.build' }
  const all = [...nodes.flatMap(n => [read(`${n}.learn`, n), build(ids[n], n, LAB)]), t('ai.b1.writeup', 'B1', { kind: 'writeup', status: 'done' })]
  const every = mkRun(LAB, 10, { c1: 'pass', c2: 'pass', c3: 'pass', c4: 'pass', c5: 'pass' })
  const all5 = (tickets: Ticket[], over: Over = {}) => Object.fromEntries(nodes.map(n => [n, st(n, tickets, over)]))
  const same = (s: string) => Object.fromEntries(nodes.map(n => [n, s]))
  it('every milestone passed, no review: all five are built', () => { expect(all5(all, { runs: [every] })).toEqual(same('built')) })
  it('one passing review makes all five proven', () => { expect(all5(all, { runs: [every], reviews: [mkReview(LAB, 20, true)] })).toEqual(same('proven')) })
  it('a not-yet review leaves all five built', () => { expect(all5(all, { runs: [every], reviews: [mkReview(LAB, 20, false)] })).toEqual(same('built')) })
  it('a node whose own milestone has not passed stays learned', () => {
    const four = mkRun(LAB, 10, { c1: 'pass', c2: 'pass', c3: 'pass', c4: 'pass', c5: 'fail' })
    expect(all5(all, { runs: [four], reviews: [mkReview(LAB, 20, true)] })).toEqual({ ...same('proven'), T18: 'learned' })
  })
  it('milestones can pass in different runs', () => {
    const early = mkRun(LAB, 1, { c1: 'pass', c2: 'pass', c3: 'fail', c4: 'fail', c5: 'fail' })
    const late = mkRun(LAB, 2, { c1: 'fail', c2: 'fail', c3: 'pass', c4: 'pass', c5: 'pass' })
    expect(all5(all, { runs: [early, late] })).toEqual(same('built'))
  })
  it('a lab finished by "mark done without checks" has no run, so its nodes stop at learned', () => { expect(all5(all)).toEqual(same('learned')) })
  it('the u1 node is not proven by a b1-tokensim review', () => {
    const withU1 = [...all, read('ai.u1.learn', 'U1'), build('ai.u1.build', 'U1', 'u1')]
    expect(st('U1', withU1, { runs: [every], reviews: [mkReview(LAB, 20, true)] })).toBe('learned')
  })
})

describe('nextStepLine', () => {
  const closing = t('ai.b1.build.12', 'X', { kind: 'build', status: 'done', title: 'Pass the check: report', lab: { id: LAB, gpu: 'none' } })
  const one = { [LAB]: { ...defs[LAB], milestones: [defs[LAB].milestones[0]] } }
  const step = (node: string, tickets: Ticket[], over: Over = {}) => {
    const state = st(node, tickets, over)
    return nextStepLine({ id: node }, state, tickets, over.runs ?? [], over.reviews ?? [], over.defs ?? defs)
  }
  it('names the next open ticket while nothing or something is started', () => {
    expect(step('N', [read('r', 'N', 'todo', { title: 'Read the thing' }), read('r2', 'N', 'todo', { title: 'Second' })])).toBe('Read the thing')
    expect(step('N', [read('r', 'N', 'done'), read('r2', 'N', 'todo', { title: 'Second' })])).toBe('Second')
  })
  it('says Build it with the first lab ticket whose milestone is open when learned', () => {
    const ts = [read('r', 'U1'), t('ai.u1.build', 'U1', { kind: 'build', status: 'todo', title: 'Write the schema', lab: { id: 'u1', gpu: 'none' } })]
    expect(step('U1', ts)).toBe('Build it: Write the schema')
  })
  it('says Request the review on the closing ticket title when built', () => {
    const ts = [read('r', 'B1'), build('ai.b1.build', 'B1', LAB), closing]
    expect(step('B1', ts, { runs: [mkRun(LAB, 1, { c1: 'pass' })], defs: one })).toBe('Request the review on Pass the check: report')
  })
  it('says Proven when proven', () => {
    const ts = [read('r', 'B1'), build('ai.b1.build', 'B1', LAB), closing]
    expect(step('B1', ts, { runs: [mkRun(LAB, 1, { c1: 'pass' })], reviews: [mkReview(LAB, 2, true)], defs: one })).toBe('Proven')
  })
  it('is null when learned with nothing left to open and no lab', () => { expect(step('N', [read('r', 'N')])).toBeNull() })
  it('uses the four state words', () => { expect(Object.values(TOPIC_WORD)).toEqual(['Learning', 'Learned', 'Built', 'Proven']) })
})

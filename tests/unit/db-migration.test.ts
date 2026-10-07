import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { createDb, DB_VERSION, DEFAULT_SETTINGS, getSettings, SCHEMA_V1, SCHEMA_V2 } from '../../src/data/db'
import type {
  AiLogRow, Artifact, AtlasRun, BankItem, BlankTest, DesignSession, GradeRow, PictureRow, Redo, RungUse, Session, StageCell,
} from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const NEW_TABLES = [
  'aiLog', 'artifacts', 'atlasRuns', 'bankItems', 'blankTests', 'designSessions',
  'grades', 'pictures', 'redos', 'rungUses', 'stageCells',
]
const dbName = () => `mig-${Math.random().toString(36).slice(2)}`

async function seedV1(name: string) {
  const v1 = new Dexie(name)
  v1.version(1).stores(SCHEMA_V1)
  await v1.open()
  const ticket = mkTicket({ id: 'p127', kind: 'problem', difficulty: 'M', status: 'done', doneAt: 5, xp: 10, sprint: 2 })
  const session: Session = { id: 's1', ticketId: 'p127', start: 1, end: 5, minutes: 30, outcome: 'solved', xpDelta: 10 }
  await v1.table('tickets').put(ticket)
  await v1.table('sessions').put(session)
  await v1.table('events').add({ t: 'tick', id: 'p127', at: 5, xp: 10 })
  await v1.table('settings').put({ ...DEFAULT_SETTINGS, startDate: '2026-10-05', theme: 'light' })
  v1.close()
  return { ticket, session }
}

describe('schema v2 migration (Review Focus #1)', () => {
  it('keeps v1 exactly and declares every new table in v2', () => {
    expect(SCHEMA_V1).toEqual({
      tickets: 'id, sprint, status, track, kind',
      sessions: 'id, ticketId, start',
      events: '++seq, t, id, at',
      settings: 'id',
    })
    expect(DB_VERSION).toBe(7) // v3 only adds the _outbox/_meta sync tables, v4 the checkAttempts and reviews tables, v5 the runner's code table, v6/v7 re-key it by (ticketId, lang) (SCHEMA_V2 is unchanged)
    expect(SCHEMA_V2.tickets).toBe('id, sprint, status, track, kind, origin')
    expect(Object.keys(SCHEMA_V2).sort()).toEqual([...Object.keys(SCHEMA_V1), ...NEW_TABLES].sort())
  })

  it('upgrades a real v1 database without losing a row', async () => {
    const name = dbName()
    const { ticket, session } = await seedV1(name)
    const d = createDb(name)
    await d.open()
    expect(d.verno).toBe(7)
    expect(await d.tickets.get('p127')).toEqual(ticket)
    expect(await d.sessions.get('s1')).toEqual(session)
    expect(await d.events.toArray()).toEqual([{ seq: 1, t: 'tick', id: 'p127', at: 5, xp: 10 }])
    expect(await getSettings(d)).toMatchObject({ startDate: '2026-10-05', theme: 'light' })
    for (const t of [...NEW_TABLES, '_outbox', '_meta']) expect(await d.table(t).count(), t).toBe(0)
    d.close()
  })

  it('indexes pre-existing tickets by origin after the upgrade', async () => {
    const name = dbName()
    await seedV1(name)
    const d = createDb(name)
    expect(await d.tickets.where('origin').equals('plan').primaryKeys()).toEqual(['p127'])
    expect(await d.tickets.where('origin').equals('mine').count()).toBe(0)
    d.close()
  })

  it('round-trips one row through every new table', async () => {
    const d = createDb(dbName())
    const canvas = { layout: 'manual' as const, nodes: [{ id: 'gateway-1', kind: 'gateway', label: 'Gateway 1', x: 1, y: 1 }], links: [] }
    const rung: RungUse = { id: 'r1', ticketId: 'p200', attemptStart: 1, cycleId: 'cyc1', rung: 2, at: 2, cost: 2, applied: 2, refunded: 0, level: 1 }
    const redo: Redo = { id: 'rd1', ticketId: 'p200', source: 'gave_up', createdAt: 3, stage: 0, due: 4, passed: [], helpCost: 10, refunded: 0 }
    const log: AiLogRow = { job: 'hint', at: 5, ms: 0, provider: 'fake', ok: false, code: 'timeout', ticketId: 'p200', error: 'fake hint unavailable' }
    const pic: PictureRow = { key: 'p200', json: { title: 't', structures: {}, steps: [] }, source: 'model', createdAt: 6 }
    const run: AtlasRun = { key: 'bfs', kind: 'predict', at: 8, asked: 10, correct: 9 }
    const solved: Session = { id: 's2', ticketId: 'p1', start: 1, end: 7, minutes: 20, outcome: 'solved', xpDelta: 5, approach: 'Hash map', rungs: [], redoId: 'rd1' }
    const ds: DesignSession = {
      id: 'ds1', designId: 'd-ratelimit', at: 9, phase: 'drawing', minutes: 0, mode: 'solo', view: '2d', canvas,
      close: { tradeoff: { chose: '', over: '', because: '' }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: null, readNext: '' },
      deepDives: [{ q: 'a', answered: null }, { q: 'b', answered: null }, { q: 'c', answered: null }, { q: 'd', answered: null }],
      tradeoffs: [], rubric: null, lenses: {},
    }
    const art: Artifact = {
      id: 'art-stage-00', title: 'Setup', block: 1, stage: 0, status: 'measured', statusAt: { 'not started': 1, measured: 10 },
      measures: [{ name: 'loss', value: 1.98, unit: '', at: 10, sprint: 1 }], grade: 4, gradedAt: 11,
      gradeFeedback: ['ok'], gradeMissing: [], commitFound: true,
    }
    const cell: StageCell = { id: '0:build', stage: 0, cell: 'build', at: 12, evidence: 'c0ffee1', via: 'commit' }
    const blank: BlankTest = { id: 'bt1', stage: 1, piece: 'backward pass', at: 13, minutes: 25, outcome: 'not_yet', redoId: 'rd2' }
    const grade: GradeRow = { id: 'g1', targetKind: 'artifact', targetId: 'art-stage-00', at: 14, score: 4, max: 5, passed: true, feedback: [], missing: [], commitFound: true, provider: 'fake' }
    const bank: BankItem = {
      id: 'mine:mine-abc', bank: 'mine', key: 'mine-abc', name: 'Circular Kadane', pattern: 'DP · TABULATION', difficulty: 'H',
      status: 'todo', addedAt: 15, input: 'Kadane on a circular array', inputKind: 'text', source: 'Text',
    }
    await d.rungUses.put(rung)
    await d.redos.put(redo)
    const seq = await d.aiLog.add(log)
    await d.pictures.put(pic)
    const runSeq = await d.atlasRuns.add(run)
    await d.sessions.put(solved)
    await d.designSessions.put(ds)
    await d.artifacts.put(art)
    await d.stageCells.put(cell)
    await d.blankTests.put(blank)
    await d.grades.put(grade)
    await d.bankItems.put(bank)
    expect(await d.rungUses.get('r1')).toEqual(rung)
    expect(await d.redos.where('due').belowOrEqual(4).primaryKeys()).toEqual(['rd1'])
    expect(await d.aiLog.get(seq)).toEqual({ ...log, seq })
    expect(await d.pictures.get('p200')).toEqual(pic)
    expect(await d.atlasRuns.where('kind').equals('predict').toArray()).toEqual([{ ...run, seq: runSeq }])
    expect(await d.atlasRuns.where('key').equals('bfs').count()).toBe(1)
    expect(await d.sessions.get('s2')).toEqual(solved)
    expect(await d.designSessions.where('designId').equals('d-ratelimit').first()).toEqual(ds)
    expect(await d.artifacts.where('status').equals('measured').first()).toEqual(art)
    expect(await d.stageCells.where('stage').equals(0).first()).toEqual(cell)
    expect(await d.blankTests.get('bt1')).toEqual(blank)
    expect(await d.grades.where('targetId').equals('art-stage-00').first()).toEqual(grade)
    expect(await d.bankItems.where('bank').equals('mine').first()).toEqual(bank)
    d.close()
  })
})

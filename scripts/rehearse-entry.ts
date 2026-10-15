import 'fake-indexeddb/auto'
import { createDb, getSettings, type DojoDB } from '../src/data/db'
import { runFlatMigration } from '../src/data/flatMigration'
import { fromDiskDocs } from '../src/data/sync/diskIds'
import type { SyncGate } from '../src/data/sync/middleware'
import { isPlanV2, type PlanV2 } from '../src/data/planV2'
import { checkFlatInvariants, renameTargetsOf } from '../src/rules/flatInvariants'
import { FLAT_TABLES, type FlatState } from '../src/rules/flatState'
import { idMapOf, planToTickets } from '../src/rules/planTickets'
import { groupSize, groupSizeResult } from './migration-group'

async function readState(d: DojoDB): Promise<FlatState> {
  const out: Record<string, unknown> = {}
  for (const name of FLAT_TABLES) out[name] = await d.table(name).toArray()
  out.settings = await getSettings(d)
  return out as unknown as FlatState
}

export async function rehearse(docs: Record<string, unknown[]>, planJson: unknown, now: number) {
  if (!isPlanV2(planJson)) throw new Error('the plan is not a plan v2 (planFormat: 2)')
  const plan = planJson as PlanV2
  const gate: SyncGate = { bypass: true }
  const d = createDb(`rehearse-${Date.now()}`, gate)
  for (const name of FLAT_TABLES) {
    const rows = fromDiskDocs(name, docs[name] ?? [])
    if (rows.length) await d.table(name).bulkPut(rows)
  }
  const stored = (docs.settings ?? [])[0]
  if (stored) await d.settings.put(stored as never)
  await d._outbox.clear()
  gate.bypass = false

  const before = await readState(d)
  const first = await runFlatMigration(d, plan, { now, backup: async () => 'rehearsal-copy', gate })
  const after = await readState(d)
  const outboxAfterFirst = await d._outbox.count()
  const group = groupSize(await d._outbox.toArray())
  const second = await runFlatMigration(d, plan, { now: now + 1, gate })
  const secondWrites = (await d._outbox.count()) - outboxAfterFirst
  const planIds = new Set(planToTickets(plan).map(c => c.id))
  const results = [
    ...checkFlatInvariants(before, after, planIds, first.report?.codeMerged ?? 0, renameTargetsOf(before, idMapOf(plan), planIds)),
    groupSizeResult(group),
    { name: 'second run writes nothing', ok: secondWrites === 0 && second.writes === 0, detail: `${secondWrites} outbox rows` },
  ]
  const count = (s: FlatState) => ({ tickets: s.tickets.length, live: s.tickets.filter(t => !t.archived).length, sessions: s.sessions.length, redos: s.redos.length })
  return { results, report: first.report, codeMerged: first.report?.codeMerged ?? 0, writes: first.writes, groupRows: group.rows, groupBytes: group.bytes, before: count(before), after: count(after) }
}

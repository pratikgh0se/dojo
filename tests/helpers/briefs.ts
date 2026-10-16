import { fakeOutput } from '../../src/ai/fake'
import type { BriefContext, BriefOutput } from '../../src/ai/types'
import type { DojoDB } from '../../src/data/db'
import type { Brief, Ticket } from '../../src/data/types'
import { aiTicketOf } from '../../src/rules/rungContent'

const briefContext = (t: Ticket): BriefContext => ({ kind: t.kind, learning: t.kind === 'watch' || t.kind === 'read', estMin: t.brief?.minutes ?? t.estMin })
/** A fresh draft from a job's output (a retired `split` key is never stored). */
const toBrief = (out: BriefOutput): Brief => { const { split: _split, ...rest } = out as BriefOutput & { split?: unknown }; return { ...rest, status: 'draft', source: 'ai' } }

/**
 * Gives a ticket the fake AI's draft brief directly, whatever its kind (R2 W7: the drafting action is gone, so every test brief is seeded here).
 */
export async function seedBrief(d: DojoDB, ticketId: string, over: Partial<Brief> = {}): Promise<void> {
  const t = (await d.tickets.get(ticketId))!
  const out = fakeOutput('brief', { ticket: aiTicketOf(t), context: briefContext(t) })
  await d.tickets.put({ ...t, brief: { ...toBrief(out), ...over } })
}

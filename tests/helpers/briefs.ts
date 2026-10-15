import { fakeOutput } from '../../src/ai/fake'
import type { DojoDB } from '../../src/data/db'
import type { Brief } from '../../src/data/types'
import { briefContext, toBrief } from '../../src/rules/brief'
import { aiTicketOf } from '../../src/rules/rungContent'

/**
 * Gives a ticket the fake AI's draft brief directly, whatever its kind. `draftBrief` only drafts problem, design and task
 * tickets (spec 3.2); watch, read, build and stage fixtures get their brief seeded here instead.
 */
export async function seedBrief(d: DojoDB, ticketId: string, over: Partial<Brief> = {}): Promise<void> {
  const t = (await d.tickets.get(ticketId))!
  const out = fakeOutput('brief', { ticket: aiTicketOf(t), context: briefContext(t) })
  await d.tickets.put({ ...t, brief: { ...toBrief(out), ...over } })
}

import { explainRedos } from '../rules/explainCards'
import type { DojoDB } from './db'
import type { Ticket } from './types'

/** Write the explain cards of a passed check. An id that exists (open or closed) is left alone, so a repeat writes nothing. Returns the rows added. */
export async function createExplainRedos(d: DojoDB, t: Pick<Ticket, 'id' | 'explain' | 'explainAnswers'>, topic: string, nowMs: number): Promise<number> {
  return d.transaction('rw', d.redos, async () => {
    let added = 0
    for (const r of explainRedos(t, topic, nowMs)) {
      if (await d.redos.get(r.id)) continue
      await d.redos.add(r)
      added += 1
    }
    return added
  })
}

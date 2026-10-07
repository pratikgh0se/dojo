import type { JobName, JobRequest, JobResult } from '../ai/types'
import type { DojoDB } from './db'

// The client, the fake provider and every output validator load in a chunk of their own (they stay out of the
// entry bundle). Fetching starts as soon as this module is evaluated, so the first AI call rarely waits for it.
const loadClient = () => import('../ai/client')
void loadClient().catch(() => { /* callJob reports it when a job actually needs the client */ })

/** Every AI call in the app: foundation runJob (never throws) plus one aiLog row (best effort). */
export async function callJob<J extends JobName>(d: DojoDB, job: J, request: JobRequest<J>, at: number): Promise<JobResult<J>> {
  const { runJob } = await loadClient()
  const r = await runJob(job, request)
  try {
    await d.aiLog.add({
      job, at, ms: r.ms, provider: r.provider, ok: r.ok,
      ...(r.ok ? {} : { code: r.code, error: r.error }),
      ...(request.ticket ? { ticketId: request.ticket.id } : {}),
    })
  } catch {
    // the log is diagnostics only; the learner's flow never depends on it
  }
  return r
}

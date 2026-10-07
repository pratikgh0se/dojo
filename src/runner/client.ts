// Client of GET /tools/packs/<id> (any browser) and POST /tools/run-go (writer token) on dojo-server.
import { READ_ONLY_MESSAGE, writerHeaders } from '../data/writer'
import { cleanStep } from './steps'
import type { PublicPack, RunMode, RunResult } from './types'

/** C-RUNNER §1 and C-VISUAL §5: exactly these tickets have a problem pack. */
export const PACK_IDS = [
  'p91', 'p198', 'p322', 'p62', 'p1143',
  'p743', 'p207', 'p802', 'p684', 'p1584', 'p877', 'p55', 'p875', 'p153', 'p3', 'p11', 'p206', 'p56', 'p215', 'p543',
] as const
export const hasPack = (ticketId: string): boolean => (PACK_IDS as readonly string[]).includes(ticketId)

export const NO_SERVER_MESSAGE = 'The code runner needs the Dojo server. Open Dojo from the Dojo app.'

type Fetch = typeof fetch
const defaultFetch: Fetch = (i, n) => globalThis.fetch(i, n)

export async function fetchPack(id: string, f: Fetch = defaultFetch): Promise<PublicPack | null> {
  try {
    const res = await f(`/tools/packs/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const body = (await res.json()) as PublicPack
    return typeof body?.starter === 'string' && Array.isArray(body.cases) ? body : null
  } catch {
    return null
  }
}

export type RunOutcome = { ok: true; result: RunResult } | { ok: false; message: string }

export async function runCode(req: { pack: string; code: string; mode: RunMode }, f: Fetch = defaultFetch): Promise<RunOutcome> {
  let res: Response
  try {
    res = await f('/tools/run-go', { method: 'POST', headers: { 'Content-Type': 'application/json', ...writerHeaders() }, body: JSON.stringify(req) })
  } catch {
    return { ok: false, message: NO_SERVER_MESSAGE }
  }
  let body: (Partial<RunResult> & { error?: unknown; message?: string }) | null = null
  try { body = await res.json() } catch { body = null }
  if (res.ok && body && typeof body.status === 'string') {
    // G4 M2: the server's steps get the same check as the Python frame's
    const steps = Array.isArray(body.steps) ? body.steps.map(cleanStep) : []
    return { ok: true, result: { ...(body as RunResult), steps } }
  }
  const code = typeof body?.error === 'string' ? body.error : (body?.error as { code?: string } | undefined)?.code
  if (res.status === 403 && code === 'not_writer') return { ok: false, message: READ_ONLY_MESSAGE }
  if (res.status === 409) return { ok: false, message: 'A run is already in flight. Wait for it to finish.' }
  if (res.status === 413) return { ok: false, message: 'Your code is over 64 KiB.' }
  if (res.status === 404 && !body) return { ok: false, message: NO_SERVER_MESSAGE }
  return { ok: false, message: body?.message ?? `The run failed (HTTP ${res.status}).` }
}

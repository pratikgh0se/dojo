// Client of the /labs/* routes on dojo-server (writer only). Never throws: every failure resolves to { ok: false, code, message }.
// The messages are the plain lines of contracts/labs.md "Exact copy"; the server sends the same ones.
import type { LabBundleFile } from '../ai/types'
import { READ_ONLY_MESSAGE, writerHeaders } from './writer'

export const NO_SERVER_MESSAGE = 'Labs need the Dojo server. Open Dojo from the Dojo app.'

export type LabCallResult<T> = ({ ok: true } & T) | { ok: false; code: string; message: string }
type Fetch = typeof fetch
const defaultFetch: Fetch = (i, n) => globalThis.fetch(i, n)

/** `GET /labs/info` without `ok`: everything the app may know about a lab. It carries no hint text and no reference file. */
export interface LabInfo {
  title: string
  /** the lab's folder inside the repo, e.g. `labs/t-lab` */
  path: string
  repo: string
  version: number
  timeoutSec: number
  tickets: string[]
  /** the lab's last build ticket: the ticketId of its Review cards and the "Request the review on ..." line */
  closingTicket: string
  milestones: { ticket: string; checkIds: string[] }[]
  rubric: { id: string; text: string }[]
}
export interface LabSetupReply { status: 'created' | 'exists'; path: string; baseCommit: string | null }
export interface LabHintReply { text: string; ref?: { file: string; from: number; to: number; code: string } }
export interface LabBundle { rubric: { id: string; text: string }[]; writeup: string; files: LabBundleFile[] }

async function call<T>(method: 'GET' | 'POST', path: string, body: unknown, f: Fetch): Promise<LabCallResult<T>> {
  let res: Response
  try {
    res = await f(path, method === 'GET'
      ? { headers: writerHeaders() }
      : { method, headers: { 'Content-Type': 'application/json', ...writerHeaders() }, body: JSON.stringify(body) })
  } catch {
    return { ok: false, code: 'no_server', message: NO_SERVER_MESSAGE }
  }
  let json: { ok?: unknown; error?: { code?: unknown; message?: unknown } } | null = null
  try { json = await res.json() } catch { json = null }
  if (json && json.ok === true) return json as unknown as LabCallResult<T>
  const code = typeof json?.error?.code === 'string' ? json.error.code : null
  if (res.status === 403 && code === 'not_writer') return { ok: false, code: 'not_writer', message: READ_ONLY_MESSAGE }
  if (res.status === 404 && !json) return { ok: false, code: 'no_server', message: NO_SERVER_MESSAGE }
  return { ok: false, code: code ?? 'server_error', message: typeof json?.error?.message === 'string' ? json.error.message : `The lab request failed (HTTP ${res.status}).` }
}

export const labInfoCall = (labId: string, f: Fetch = defaultFetch) => call<LabInfo>('GET', `/labs/info?labId=${encodeURIComponent(labId)}`, null, f)
export const labSetupCall = (labId: string, labsRoot: string, f: Fetch = defaultFetch) => call<LabSetupReply>('POST', '/labs/setup', { labId, labsRoot }, f)
export const labRunCall = (labId: string, labsRoot: string, f: Fetch = defaultFetch) => call<{ run: unknown }>('POST', '/labs/run', { labId, labsRoot }, f)
export const labHintCall = (labId: string, ticketId: string, rung: 1 | 2 | 3, f: Fetch = defaultFetch) => call<LabHintReply>('POST', '/labs/hint', { labId, ticketId, rung }, f)
export const labBundleCall = (labId: string, labsRoot: string, f: Fetch = defaultFetch) => call<{ bundle: LabBundle }>('POST', '/labs/bundle', { labId, labsRoot }, f)

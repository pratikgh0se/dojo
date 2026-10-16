// A stand-in for the /labs/* routes: each route answers with a function of its parsed request; every call is recorded.
import type { LabInfo } from '../../src/data/labClient'

export const INFO: LabInfo = {
  title: 'Tiny lab', path: 'labs/t-lab', repo: 'ai-platform-lab', version: 1, timeoutSec: 3,
  tickets: ['tlab.build.1', 'tlab.build.2', 'tlab.build.3'], closingTicket: 'tlab.build.3',
  milestones: [{ ticket: 'tlab.build.1', checkIds: ['c1'] }, { ticket: 'tlab.build.2', checkIds: ['c2'] }, { ticket: 'tlab.build.3', checkIds: ['c3'] }],
  rubric: [{ id: 'r1', text: 'States the problem.' }, { id: 'r2', text: 'Shows every check ran.' }, { id: 'r3', text: 'Explains the approach.' }, { id: 'r4', text: 'Names a change.' }],
}

type Handler = (body: Record<string, unknown>) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>
export interface Call { path: string; method: string; body: Record<string, unknown>; headers: Record<string, string> }

export function labServer(handlers: Record<string, Handler>) {
  const calls: Call[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x')
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : Object.fromEntries(url.searchParams)
    calls.push({ path: url.pathname, method: init?.method ?? 'GET', body, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) })
    const h = handlers[url.pathname]
    if (!h) return new Response(JSON.stringify({ ok: false, error: { code: 'unknown_route', message: 'no route' } }), { status: 404 })
    const out = await h(body)
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200 })
  }) as typeof fetch
  return { f, calls }
}

export const ok = (extra: Record<string, unknown>) => ({ json: { ok: true, ...extra } })
export const err = (status: number, code: string, message: string) => ({ status, json: { ok: false, error: { code, message } } })
export const RUN_PASS = { at: 1000, ms: 50, exit: 0, timedOut: false, tail: '', results: { checks: [{ id: 'c1', name: 'One', status: 'pass', detail: 'ok' }], summary: { pass: 1, fail: 0, skip: 0 } } }

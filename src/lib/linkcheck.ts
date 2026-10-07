// Client of POST /tools/linkcheck (dojo-server, writer token). The server does the probing;
// this only chunks the URLs (the server takes at most 50) and turns failures into a message.
import { READ_ONLY_MESSAGE, writerHeaders } from '../data/writer'

export interface LinkResult { url: string; ok: boolean; status: number }
export type LinkCheckOutcome = { ok: true; results: LinkResult[] } | { ok: false; message: string }
export const LINKCHECK_CHUNK = 50

const isWeb = (u: string) => /^https?:\/\//i.test(u)

export async function checkLinks(urls: readonly string[], f: typeof fetch = (i, n) => globalThis.fetch(i, n)): Promise<LinkCheckOutcome> {
  const web = [...new Set(urls.filter(isWeb))]
  const results: LinkResult[] = []
  for (let i = 0; i < web.length; i += LINKCHECK_CHUNK) {
    let res: Response
    try {
      res = await f('/tools/linkcheck', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...writerHeaders() }, body: JSON.stringify({ urls: web.slice(i, i + LINKCHECK_CHUNK) }),
      })
    } catch {
      return { ok: false, message: 'The link check needs the Dojo server. Open Dojo from the Dojo app.' }
    }
    let body: { ok?: boolean; results?: LinkResult[]; error?: { code?: string; message?: string } } | null = null
    try { body = await res.json() } catch { body = null }
    if (res.status === 403 && body?.error?.code === 'not_writer') return { ok: false, message: READ_ONLY_MESSAGE }
    if (!res.ok || !body?.ok || !Array.isArray(body.results)) return { ok: false, message: body?.error?.message ?? `The link check failed (HTTP ${res.status}).` }
    results.push(...body.results)
  }
  return { ok: true, results }
}

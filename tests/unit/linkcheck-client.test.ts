import { describe, expect, it } from 'vitest'
import { checkLinks, LINKCHECK_CHUNK } from '../../src/lib/linkcheck'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('checkLinks', () => {
  it('posts the http(s) URLs once each and returns the results', async () => {
    const calls: { url: string; body: { urls: string[] } }[] = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) })
      return json(200, { ok: true, results: calls[0].body.urls.map(u => ({ url: u, ok: true, status: 200 })) })
    }) as unknown as typeof fetch
    const r = await checkLinks(['https://a.test/x', 'https://a.test/x', 'mailto:a@b.c', 'http://b.test'], f)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/tools/linkcheck')
    expect(calls[0].body.urls).toEqual(['https://a.test/x', 'http://b.test'])
    expect(r).toEqual({ ok: true, results: [{ url: 'https://a.test/x', ok: true, status: 200 }, { url: 'http://b.test', ok: true, status: 200 }] })
  })
  it('splits more than 50 URLs into chunks', async () => {
    let n = 0
    const f = (async (_u: string, init: RequestInit) => {
      n++
      return json(200, { ok: true, results: (JSON.parse(init.body as string).urls as string[]).map(u => ({ url: u, ok: true, status: 200 })) })
    }) as unknown as typeof fetch
    const r = await checkLinks(Array.from({ length: LINKCHECK_CHUNK + 5 }, (_, i) => `https://a.test/${i}`), f)
    expect(n).toBe(2)
    expect(r.ok && r.results).toHaveLength(LINKCHECK_CHUNK + 5)
  })
  it('makes no request when there is nothing to check', async () => {
    let n = 0
    const f = (async () => { n++; return json(200, {}) }) as unknown as typeof fetch
    expect(await checkLinks(['mailto:x'], f)).toEqual({ ok: true, results: [] })
    expect(n).toBe(0)
  })
  it('reports no server, a read-only browser and a server refusal as messages', async () => {
    const down = (async () => { throw new TypeError('offline') }) as unknown as typeof fetch
    expect(await checkLinks(['https://a.test'], down)).toEqual({ ok: false, message: 'The link check needs the Dojo server. Open Dojo from the Dojo app.' })
    const ro = (async () => json(403, { ok: false, error: { code: 'not_writer', message: 'x' } })) as unknown as typeof fetch
    expect(await checkLinks(['https://a.test'], ro)).toEqual({ ok: false, message: 'Read-only: open Dojo from the Dojo app to make changes' })
    const bad = (async () => json(400, { ok: false, error: { code: 'url_not_allowed', message: 'nope' } })) as unknown as typeof fetch
    expect(await checkLinks(['https://a.test'], bad)).toEqual({ ok: false, message: 'nope' })
    const junk = (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch
    expect(await checkLinks(['https://a.test'], junk)).toEqual({ ok: false, message: 'The link check failed (HTTP 502).' })
  })
})

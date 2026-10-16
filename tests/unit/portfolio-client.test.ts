import { describe, expect, it, vi } from 'vitest'
import { NO_SERVER_MESSAGE, exportLab, publishLab } from '../../src/data/portfolioClient'
import { READ_ONLY_MESSAGE } from '../../src/data/writer'

const reply = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? 'not json' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

describe('exportLab / publishLab', () => {
  it('POSTs JSON with the writer token and returns the body without "ok"', async () => {
    const f = reply(200, { ok: true, title: 'T', files: [], gh: { ok: true, user: 'u' } })
    const r = await exportLab({ labId: 'pf-a', labsRoot: '~/labs', kind: 'repo', text: 'x' }, f)
    expect(r).toEqual({ ok: true, value: { title: 'T', files: [], gh: { ok: true, user: 'u' } } })
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(url).toBe('/portfolio/export')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ labId: 'pf-a', labsRoot: '~/labs', kind: 'repo', text: 'x' })
  })
  it('maps a server error to code and message and keeps the leak hits', async () => {
    const hits = [{ file: 'labs/pf-a/notes.txt', line: 3, rule: 'email', text: 'x@y.com' }]
    const r = await publishLab({ labId: 'pf-a', labsRoot: '~/labs', kind: 'repo', files: [] }, reply(422, { ok: false, error: { code: 'leak_found', message: 'Fix it.', hits } }))
    expect(r).toEqual({ ok: false, code: 'leak_found', message: 'Fix it.', hits })
  })
  it('says read-only for not_writer, and "needs the server" when nothing answers', async () => {
    expect(await exportLab({ labId: 't', labsRoot: '~/labs' }, reply(403, { ok: false, error: { code: 'not_writer', message: 'x' } }))).toMatchObject({ ok: false, code: 'not_writer', message: READ_ONLY_MESSAGE })
    expect(await exportLab({ labId: 't', labsRoot: '~/labs' }, vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)).toEqual({ ok: false, code: 'no_server', message: NO_SERVER_MESSAGE })
    expect(await exportLab({ labId: 't', labsRoot: '~/labs' }, reply(404))).toMatchObject({ ok: false, code: 'no_server' })
  })
})

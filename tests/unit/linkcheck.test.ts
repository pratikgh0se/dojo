// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'
import { checkOne, ipv6Bytes, isBlockedAddress, linkCheck, MAX_URLS, urlBlocked, urlProblem, urlShapeProblem } from '../../server/linkcheck.mjs'

describe('the SSRF guard', () => {
  it('blocks private, link-local and loopback addresses except 127.0.0.1', () => {
    for (const a of ['169.254.169.254', '169.254.0.1', '10.0.0.1', '10.255.255.255', '192.168.1.1', '172.16.0.1', '172.31.9.9', '127.0.0.2', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '[::1]', '::ffff:10.0.0.1', '::ffff:169.254.169.254', 'not-an-ip']) {
      expect(isBlockedAddress(a), a).toBe(true)
    }
    for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '172.15.0.1', '198.20.0.1', '2606:4700::1111']) {
      expect(isBlockedAddress(a), a).toBe(false)
    }
  })
  it('loopback is blocked by default, and 127.0.0.1 alone is allowed behind the explicit test flag', () => {
    for (const a of ['127.0.0.1', '::ffff:127.0.0.1', '[::ffff:7f00:1]']) expect(isBlockedAddress(a), a).toBe(true)
    for (const a of ['127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::7f00:1']) expect(isBlockedAddress(a, { allowLoopback: true }), a).toBe(false)
    for (const a of ['127.0.0.2', '::ffff:127.0.0.2', '::1']) expect(isBlockedAddress(a, { allowLoopback: true }), a).toBe(true)
  })
  it('judges every IPv6 form that embeds an IPv4 address by the IPv4 inside (hex-mapped, v4-compatible, NAT64, 6to4)', () => {
    for (const a of ['::ffff:c0a8:101', '::ffff:a9fe:a9fe', '::ffff:7f00:2', '::7f00:2', '::a00:1', '64:ff9b::a00:1', '64:ff9b::192.168.0.1', '2002:c0a8:101::1', '2002:a9fe:a9fe::', 'fec0::1', 'fe80::1', '::ffff:198.18.0.1', '198.18.0.1', '198.19.255.255', 'fc00::1', 'ff02::1']) {
      expect(isBlockedAddress(a), a).toBe(true)
    }
    for (const a of ['::ffff:5db8:d822', '64:ff9b::5db8:d822', '2002:5db8:d822::1', '2001:db8::1']) expect(isBlockedAddress(a), a).toBe(false)
  })
  it('urlShapeProblem only judges shape; urlBlocked only the IP literal', () => {
    expect(urlShapeProblem('http://192.168.1.1/')).toBeNull()
    expect(urlShapeProblem('file:///x')).not.toBeNull()
    expect(urlBlocked('http://192.168.1.1/')).toBe(true)
    expect(urlBlocked('https://example.com/')).toBe(false)
    expect(urlBlocked('http://127.0.0.1/', { allowLoopback: true })).toBe(false)
  })
  it('blocks SIIT, local-use NAT64, Teredo and discard whatever they embed', () => {
    for (const a of ['::ffff:0:c000:201', '::ffff:0:8.8.8.8', '64:ff9b:1::1', '64:ff9b:1:2::5db8:d822', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100::1', '100::ffff']) expect(isBlockedAddress(a), a).toBe(true)
    for (const a of ['100:0:0:1::1', '2001:1::1', '2001:db8::1']) expect(isBlockedAddress(a), a).toBe(false)
  })
  it('parses IPv6 to 16 bytes', () => {
    expect(ipv6Bytes('::1')).toEqual([...Array(15).fill(0), 1])
    expect(ipv6Bytes('::ffff:1.2.3.4')).toEqual([...Array(10).fill(0), 255, 255, 1, 2, 3, 4])
    expect(ipv6Bytes('2001:db8::8:800:200c:417a')?.length).toBe(16)
    expect(ipv6Bytes('1.2.3.4')).toBeNull()
  })
  it('refuses non-http(s) schemes and literal private hosts before any request', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'data:text/html,hi', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'https://192.168.0.1/x', 'http://[::1]/', 'http://[::ffff:192.168.1.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[::ffff:127.0.0.2]/', 'http://[::7f00:2]/', 'http://[fec0::1]/', 'http://127.0.0.1:8080/', 'http://2130706433:9/', 'http://2130706434:9/', 'http://0x7f000002/', 'http://user:pw@example.com/', 'nope', '', 5]) {
      expect(urlProblem(u as string), String(u)).not.toBeNull()
    }
    for (const u of ['https://example.com/a?b=1', 'http://localhost:3000/']) expect(urlProblem(u), u).toBeNull()
    for (const u of ['http://127.0.0.1:8080/x', 'http://[::ffff:7f00:1]/']) expect(urlProblem(u, { allowLoopback: true }), u).toBeNull()
  })
})

const LB = { allowLoopback: true }
let target: http.Server
let base = ''
let hits: string[] = []
beforeEach(async () => {
  hits = []
  target = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    const path = req.url ?? ''
    if (path === '/ok') { res.writeHead(200); return res.end('hello') }
    if (path === '/gone') { res.writeHead(404); return res.end('no') }
    if (path === '/nohead') { res.writeHead(req.method === 'HEAD' ? 405 : 200); return res.end('x') }
    if (path === '/redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); return res.end() }
    if (path === '/slow') return void setTimeout(() => { res.writeHead(200); res.end() }, 1500)
    res.writeHead(500); res.end()
  })
  await new Promise<void>(r => target.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`
})
afterEach(async () => {
  target.closeAllConnections()
  await new Promise(r => target.close(r))
})

describe('checkOne', () => {
  it('200 is ok, 404 is broken (HEAD first, then one GET)', async () => {
    expect(await checkOne(`${base}/ok`, 5000, LB)).toEqual({ url: `${base}/ok`, ok: true, status: 200 })
    expect(hits).toEqual(['HEAD /ok'])
    hits = []
    expect(await checkOne(`${base}/gone`, 5000, LB)).toEqual({ url: `${base}/gone`, ok: false, status: 404 })
    expect(hits).toEqual(['HEAD /gone', 'GET /gone'])
  })
  it('falls back to GET when the server refuses HEAD', async () => {
    expect(await checkOne(`${base}/nohead`, 5000, LB)).toMatchObject({ ok: true, status: 200 })
    expect(hits).toEqual(['HEAD /nohead', 'GET /nohead'])
  })
  it('never follows a redirect (a 3xx is a live link, and the Location is not visited)', async () => {
    expect(await checkOne(`${base}/redirect`, 5000, LB)).toMatchObject({ ok: true, status: 302 })
  })
  it('a server that answers too slowly is broken after the timeout', async () => {
    const t0 = Date.now()
    expect(await checkOne(`${base}/slow`, 300, LB)).toEqual({ url: `${base}/slow`, ok: false, status: 0 })
    expect(Date.now() - t0).toBeLessThan(1200)
  })
  it('a hostname that resolves to a blocked address is refused at connect time', async () => {
    expect(await checkOne('http://metadata.invalid.test/', 5000, LB)).toMatchObject({ ok: false, status: 0 })
  })
})

describe('linkCheck', () => {
  it('returns one result per URL, in order', async () => {
    const r = await linkCheck({ urls: [`${base}/gone`, `${base}/ok`] }, LB)
    expect(r.map((x: { ok: boolean }) => x.ok)).toEqual([false, true])
  })
  it('refuses more than 50 URLs, a missing list and any disallowed URL, without probing', async () => {
    const many = Array.from({ length: MAX_URLS + 1 }, (_, i) => `${base}/ok?${i}`)
    await expect(linkCheck({ urls: many })).rejects.toMatchObject({ status: 400, code: 'too_many_urls' })
    await expect(linkCheck({})).rejects.toMatchObject({ status: 400, code: 'bad_request' })
    await expect(linkCheck({ urls: [`${base}/ok`, 'file:///etc/passwd'] })).rejects.toMatchObject({ status: 400, code: 'url_not_allowed' })
    expect(hits).toEqual([])
    expect(await linkCheck({ urls: Array.from({ length: MAX_URLS }, (_, i) => `${base}/ok?${i}`) }, LB)).toHaveLength(MAX_URLS)
  })
  it('the cap of 10 probes is shared by parallel requests', async () => {
    let now = 0, peak = 0
    const slow = http.createServer((_q, res) => { now++; peak = Math.max(peak, now); setTimeout(() => { now--; res.writeHead(200); res.end() }, 60) })
    await new Promise<void>(r => slow.listen(0, '127.0.0.1', r))
    const b = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`
    const batch = (k: number) => linkCheck({ urls: Array.from({ length: 20 }, (_, i) => `${b}/${k}-${i}`) }, LB)
    await Promise.all([batch(1), batch(2), batch(3)])
    slow.closeAllConnections()
    await new Promise(r => slow.close(r))
    expect(peak).toBeLessThanOrEqual(10)
  })
  it('the server refuses loopback unless started with --linkcheck-allow-loopback; an env var does not turn it on', async () => {
    const cfg = readServerConfig(['--fake'], { DOJO_HOME: '/tmp/x-not-used', DOJO_PORT: '0', DOJO_LINKCHECK_ALLOW_LOOPBACK: '1' })
    expect(cfg.linkcheckAllowLoopback).toBe(false)
    expect(readServerConfig(['--fake', '--linkcheck-allow-loopback'], { DOJO_HOME: '/tmp/x-not-used', DOJO_PORT: '0' }).linkcheckAllowLoopback).toBe(true)
  })
  it('a private or loopback target is answered {ok:false, status:0} and never probed (no test flag: 127.0.0.1 too)', async () => {
    expect(await linkCheck({ urls: [`${base}/ok`, 'http://192.168.1.1/', 'http://[::ffff:192.168.1.1]/'] })).toEqual([
      { url: `${base}/ok`, ok: false, status: 0 }, { url: 'http://192.168.1.1/', ok: false, status: 0 }, { url: 'http://[::ffff:192.168.1.1]/', ok: false, status: 0 },
    ])
    expect(hits).toEqual([])
  })
  it('never runs more than 10 probes at once', async () => {
    let now = 0, peak = 0
    const slow = http.createServer((_q, res) => { now++; peak = Math.max(peak, now); setTimeout(() => { now--; res.writeHead(200); res.end() }, 80) })
    await new Promise<void>(r => slow.listen(0, '127.0.0.1', r))
    const b = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`
    await linkCheck({ urls: Array.from({ length: 30 }, (_, i) => `${b}/${i}`) }, LB)
    slow.closeAllConnections()
    await new Promise(r => slow.close(r))
    expect(peak).toBeLessThanOrEqual(10)
    expect(peak).toBeGreaterThan(1)
  })
})

describe('POST /tools/linkcheck on dojo-server', () => {
  let home: string, dist: string, s: ReturnType<typeof createDojoServer>, dojo = ''
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-lc-'))
    dist = mkdtempSync(join(tmpdir(), 'dojo-lc-dist-'))
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    s = createDojoServer(readServerConfig(['--fake', '--linkcheck-allow-loopback', '--dist', dist], { DOJO_HOME: home, DOJO_PORT: '0' }))
    dojo = `http://127.0.0.1:${await s.listen(0)}`
  })
  afterEach(async () => {
    await s.close()
    rmSync(home, { recursive: true, force: true })
    rmSync(dist, { recursive: true, force: true })
  })
  const token = () => readFileSync(join(home, 'writer.token'), 'utf8').trim()
  const post = (body: unknown, headers: Record<string, string> = { 'X-Dojo-Writer': token() }) =>
    fetch(`${dojo}/tools/linkcheck`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('checks links for the writer: {ok, results:[{url, ok, status}]}', async () => {
    const r = await post({ urls: [`${base}/ok`, `${base}/gone`] })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, results: [{ url: `${base}/ok`, ok: true, status: 200 }, { url: `${base}/gone`, ok: false, status: 404 }] })
  })
  it('403 not_writer without the token, or with a wrong one, and nothing is probed', async () => {
    for (const h of [{} as Record<string, string>, { 'X-Dojo-Writer': 'nope' }]) {
      const r = await post({ urls: [`${base}/ok`] }, h)
      expect(r.status).toBe(403)
      expect((await r.json()).error.code).toBe('not_writer')
    }
    expect(hits).toEqual([])
  })
  it('refuses with the /db envelope: bad scheme, private IP, too many, foreign origin, wrong type, GET', async () => {
    for (const urls of [['file:///etc/passwd'], ['ftp://x.test/'], ['javascript:alert(1)']]) {
      const r = await post({ urls })
      expect(r.status).toBe(400)
      expect(await r.json()).toMatchObject({ ok: false, error: { code: 'url_not_allowed' } })
    }
    // BR-16: private targets are answered per URL, and nothing is sent
    const priv = await post({ urls: ['http://192.168.1.1/', 'http://[::ffff:192.168.1.1]/', 'http://169.254.169.254/', 'http://10.1.1.1/'] })
    expect(priv.status).toBe(200)
    expect((await priv.json()).results).toEqual(['http://192.168.1.1/', 'http://[::ffff:192.168.1.1]/', 'http://169.254.169.254/', 'http://10.1.1.1/'].map(url => ({ url, ok: false, status: 0 })))
    const many = await post({ urls: Array.from({ length: 51 }, () => `${base}/ok`) })
    expect(many.status).toBe(400)
    expect((await many.json()).error.code).toBe('too_many_urls')
    const evil = await post({ urls: [] }, { 'X-Dojo-Writer': token(), Origin: 'https://evil.example' })
    expect(evil.status).toBe(403)
    expect((await evil.json()).error.code).toBe('forbidden_origin')
    const text = await fetch(`${dojo}/tools/linkcheck`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Dojo-Writer': token() }, body: '{}' })
    expect(text.status).toBe(415)
    expect((await fetch(`${dojo}/tools/linkcheck`)).status).toBe(405)
    expect(hits).toEqual([])
  })
})

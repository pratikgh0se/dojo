// POST /tools/linkcheck (briefs spec §1): the only outbound network use the Dojo server has.
// SSRF guard, kept simple: http(s) only, no private or link-local addresses (127.0.0.1 is allowed),
// at most 50 URLs, 10 at a time, 5 s per URL. Redirects are never followed. Node standard library only.
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

export const MAX_URLS = 50
export const MAX_PARALLEL = 10
export const TIMEOUT_MS = 5000
const MAX_URL_LENGTH = 2048

export class LinkCheckError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** IPv6 text to 16 bytes (handles "::" and a dotted-quad tail), or null when it is not a valid address. */
export function ipv6Bytes(text) {
  let a = text
  if (isIP(a) !== 6) return null
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (tail) {
    const q = tail[1].split('.').map(Number)
    a = a.slice(0, -tail[1].length) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16)
  }
  const [head, rest, extra] = a.split('::')
  if (extra !== undefined) return null
  const groups = x => (x ? x.split(':').map(g => parseInt(g, 16)) : [])
  const h = groups(head)
  const r = rest === undefined ? [] : groups(rest)
  const fill = rest === undefined ? [] : Array(8 - h.length - r.length).fill(0)
  const all = [...h, ...fill, ...r]
  if (all.length !== 8) return null
  return all.flatMap(g => [g >> 8, g & 255])
}

function blockedV4(p, q, r, s, allowLoopback) {
  if (allowLoopback && p === 127 && q === 0 && r === 0 && s === 1) return false
  return (
    p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) ||
    (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) ||
    (p === 198 && (q === 18 || q === 19)) || p >= 224
  )
}

/**
 * True when the address must not be probed: private, link-local, loopback (127.0.0.1 only with `allowLoopback`,
 * which tests turn on), and every IPv6 form that embeds an IPv4 address (::ffff:0:0/96, ::/96, 64:ff9b::/96,
 * 2002::/16) is judged by the IPv4 inside it.
 */
export function isBlockedAddress(addr, { allowLoopback = false } = {}) {
  let a = String(addr).toLowerCase()
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1)
  const kind = isIP(a)
  if (kind === 4) {
    const [p, q, r, s] = a.split('.').map(Number)
    return blockedV4(p, q, r, s, allowLoopback)
  }
  if (kind !== 6) return true
  const b = ipv6Bytes(a)
  if (!b) return true
  const zero = (from, to) => b.slice(from, to).every(x => x === 0)
  // never worth probing, whatever they embed: SIIT (::ffff:0:0:0/96), local-use NAT64 (64:ff9b:1::/48), Teredo (2001::/32), discard (100::/64)
  if (zero(0, 8) && b[8] === 255 && b[9] === 255 && b[10] === 0 && b[11] === 0) return true
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0x00 && b[5] === 0x01) return true
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true
  if (b[0] === 0x01 && b[1] === 0 && zero(2, 8)) return true
  if (zero(0, 10) && b[10] === 255 && b[11] === 255) return blockedV4(b[12], b[13], b[14], b[15], allowLoopback) // ::ffff:0:0/96
  if (zero(0, 12)) return blockedV4(b[12], b[13], b[14], b[15], allowLoopback) // ::/96 (also :: and ::1)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return blockedV4(b[12], b[13], b[14], b[15], allowLoopback) // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(b[2], b[3], b[4], b[5], allowLoopback) // 2002::/16 (6to4)
  if ((b[0] === 0xfe && (b[1] & 0xc0) === 0x80) || (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0)) return true // fe80::/10, fec0::/10
  if ((b[0] & 0xfe) === 0xfc || b[0] === 0xff) return true // fc00::/7, ff00::/8
  return false
}

/** Why a URL is not a URL this check may even consider (bad shape, not http(s), credentials), or null. */
export function urlShapeProblem(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return 'not a usable URL'
  let u
  try { u = new URL(raw) } catch { return 'not a valid URL' }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${u.protocol} URLs are not allowed (http and https only)`
  if (u.username || u.password) return 'URLs with credentials are not allowed'
  return null
}

/** True when the URL's host is an IP literal that must not be probed (private, link-local, loopback, ...). */
export function urlBlocked(raw, opts) {
  const u = new URL(raw)
  const host = u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname
  return isIP(host) !== 0 && isBlockedAddress(host, opts)
}

/** Why a URL is refused before any request, or null (shape problems and private literal hosts). */
export function urlProblem(raw, opts) {
  return urlShapeProblem(raw) ?? (urlBlocked(raw, opts) ? 'private and link-local addresses are not allowed' : null)
}

/** dns.lookup that refuses to hand back a blocked address, so a hostname cannot point the probe inward. */
const guardedLookup = opts => (hostname, options, cb) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err)
    const ok = addrs.filter(x => !isBlockedAddress(x.address, opts))
    if (ok.length === 0) return cb(new Error('resolves to a private or link-local address'))
    if (options && options.all) return cb(null, ok)
    cb(null, ok[0].address, ok[0].family)
  })
}

function probe(url, method, ms, opts) {
  return new Promise(resolve => {
    const lib = url.protocol === 'https:' ? https : http
    let done = false
    const finish = status => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(status)
    }
    const req = lib.request(url, { method, lookup: guardedLookup(opts), headers: { 'User-Agent': 'Dojo-linkcheck', Accept: '*/*' } }, res => {
      finish(res.statusCode ?? 0)
      res.destroy() // headers are enough; never download the body
    })
    const timer = setTimeout(() => { finish(0); req.destroy() }, ms)
    req.on('error', () => finish(0))
    req.end()
  })
}

/** One process-wide cap on probes in flight, across every POST, so parallel requests cannot multiply it. */
let active = 0
const waiting = []
async function gated(fn) {
  if (active >= MAX_PARALLEL) await new Promise(r => waiting.push(r))
  active++
  try { return await fn() } finally { active--; waiting.shift()?.() }
}

const isOk = status => status >= 200 && status < 400

/** One URL: HEAD, and a GET when the HEAD did not succeed. 5 s for both together. */
export async function checkOne(raw, timeoutMs = TIMEOUT_MS, opts = {}) {
  const started = Date.now()
  const url = new URL(raw)
  let status = await probe(url, 'HEAD', timeoutMs, opts)
  if (!isOk(status)) {
    const left = timeoutMs - (Date.now() - started)
    if (left > 0) {
      const g = await probe(url, 'GET', left, opts)
      if (g !== 0 || status === 0) status = g
    }
  }
  return { url: raw, ok: isOk(status), status }
}

/** The route body: `{urls}` in, `[{url, ok, status}]` out, in order. Throws LinkCheckError for a refused request. */
export async function linkCheck(body, { timeoutMs = TIMEOUT_MS, parallel = MAX_PARALLEL, allowLoopback = false } = {}) {
  const opts = { allowLoopback }
  const urls = body && typeof body === 'object' ? body.urls : undefined
  if (!Array.isArray(urls)) throw new LinkCheckError(400, 'bad_request', 'body needs {"urls": [...]}')
  if (urls.length > MAX_URLS) throw new LinkCheckError(400, 'too_many_urls', `at most ${MAX_URLS} URLs per request`)
  for (const u of urls) {
    const problem = urlShapeProblem(u)
    if (problem) throw new LinkCheckError(400, 'url_not_allowed', `${String(u).slice(0, 200)}: ${problem}`)
  }
  const results = new Array(urls.length)
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const i = next++
      // a private or link-local target is answered, never probed (briefs Addendum 4, BR-16)
      results[i] = urlBlocked(urls[i], opts) ? { url: urls[i], ok: false, status: 0 } : await gated(() => checkOne(urls[i], timeoutMs, opts))
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, worker))
  return results
}

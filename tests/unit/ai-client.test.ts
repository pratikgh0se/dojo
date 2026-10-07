import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiConfig, runJob, type AiConfig } from '../../src/ai/client'
import { fakeOutput } from '../../src/ai/fake'
import type { AiTicket, JobRequest } from '../../src/ai/types'
import { setNow } from '../../src/lib/clock'
import { READ_ONLY_MESSAGE } from '../../src/data/writer'

const T: AiTicket = { id: 'p200', title: 'Number of Islands', track: 'dsa' }
const HINT: JobRequest<'hint'> = { ticket: T, context: { level: 1 } }
const FAKE: AiConfig = { provider: 'fake', helperUrl: 'http://127.0.0.1:8788' }
const HELPER: AiConfig = { provider: 'helper', helperUrl: 'http://127.0.0.1:8788' }
const store = (o: Record<string, string>) => ({ getItem: (k: string) => o[k] ?? null })
const res = (status: number, body: string) => ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response

afterEach(() => {
  vi.useRealTimers()
})

describe('aiConfig (spec §4.3)', () => {
  it('defaults to the fake provider and the local helper port', () => {
    expect(aiConfig({})).toEqual({ provider: 'fake', helperUrl: 'http://127.0.0.1:8788' })
    expect(aiConfig({ VITE_DOJO_AI: 'HELPER' }).provider).toBe('fake')
  })
  it('selects the helper and its port or URL', () => {
    expect(aiConfig({ VITE_DOJO_AI: 'helper', VITE_DOJO_AI_PORT: '8899' })).toEqual({ provider: 'helper', helperUrl: 'http://127.0.0.1:8899' })
    expect(aiConfig({ VITE_DOJO_AI: 'helper', VITE_DOJO_HELPER_URL: 'http://127.0.0.1:9000/', VITE_DOJO_AI_PORT: '8899' }).helperUrl).toBe('http://127.0.0.1:9000')
    expect(aiConfig({ VITE_DOJO_AI_PORT: 'x' }).helperUrl).toBe('http://127.0.0.1:8788')
  })
  it('same-origin helper URL resolves to window.location.origin (installed app)', () => {
    const c = aiConfig({ VITE_DOJO_AI: 'helper', VITE_DOJO_HELPER_URL: 'same-origin' })
    expect(c).toEqual({ provider: 'helper', helperUrl: window.location.origin })
    expect(c.helperUrl).not.toContain('8788')
  })
  it('reads import.meta.env by default (fake in tests)', () => {
    expect(aiConfig().provider).toBe('fake')
  })
})

describe('runJob with the fake provider', () => {
  it('returns the fake output and never calls fetch (ladder H-49)', async () => {
    setNow(() => 1000)
    const fetchImpl = vi.fn()
    const r = await runJob('hint', HINT, { config: FAKE, fetchImpl, storage: null })
    expect(r).toEqual({ ok: true, job: 'hint', provider: 'fake', ms: 0, output: fakeOutput('hint', HINT) })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('honours the fail hook with its code, before any variant', async () => {
    const r = await runJob('hint', HINT, { config: FAKE, storage: store({ 'dojo-ai-fake-fail': '*:timeout', 'dojo:fake-ai-hint': 'default' }) })
    expect(r).toMatchObject({ ok: false, code: 'timeout', error: 'fake hint unavailable' })
  })
  it('honours the error and low variants', async () => {
    const req: JobRequest<'grade'> = { ticket: { id: 'art-stage-00', title: 'Setup', track: 'ai' }, context: {} }
    expect(await runJob('grade', req, { config: FAKE, storage: store({ 'dojo:fake-ai-grade': 'error' }) }))
      .toMatchObject({ ok: false, code: 'claude_failed', error: 'fake grade unavailable' })
    const low = await runJob('grade', req, { config: FAKE, storage: store({ 'dojo:fake-ai-grade': 'low' }) })
    expect(low.ok && low.output.score).toBe(2)
  })
  it('surfaces the classify input trigger', async () => {
    const r = await runJob('classify', { ticket: null, context: { input: '__fail_classify__' } }, { config: FAKE, storage: null })
    expect(r).toMatchObject({ ok: false, code: 'claude_failed', error: 'fake classify failure' })
  })
  it('waits for the delay hook', async () => {
    vi.useFakeTimers()
    let done = false
    const p = runJob('hint', HINT, { config: FAKE, storage: store({ 'dojo-ai-fake-delay-ms': '1500' }) }).then(r => { done = true; return r })
    await vi.advanceTimersByTimeAsync(1499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).ok).toBe(true)
  })
})

describe('runJob with the helper provider (ladder contract §7; Review Focus #3)', () => {
  it('posts {ticket, context} and returns the envelope output', async () => {
    let t = 1000
    setNow(() => t)
    const fetchImpl = vi.fn(async () => {
      t += 250
      return res(200, JSON.stringify({ ok: true, job: 'hint', ticketId: 'p200', output: { hint: 'stub hint' }, ms: 240, mode: 'claude' }))
    })
    const r = await runJob('hint', HINT, { config: HELPER, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r).toEqual({ ok: true, job: 'hint', provider: 'helper', ms: 250, output: { hint: 'stub hint' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8788/ai/hint')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Dojo-Writer': 'test-writer' }) // tests/setup.ts's token (SEC-D-06)
    expect(JSON.parse(String(init.body))).toEqual({ ticket: T, context: { level: 1 } })
  })
  it('SEC-D-06: the writer token goes with every job; a 403 not_writer reads as the read-only message', async () => {
    const before = localStorage.getItem('dojo.writer')
    localStorage.setItem('dojo.writer', 'tok-123')
    try {
      const fetchImpl = vi.fn(async () => res(200, JSON.stringify({ ok: true, output: { hint: 'h' } })))
      await runJob('hint', HINT, { config: HELPER, fetchImpl: fetchImpl as unknown as typeof fetch })
      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
      expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Dojo-Writer': 'tok-123' })
    } finally { if (before === null) localStorage.removeItem('dojo.writer'); else localStorage.setItem('dojo.writer', before) }
    const refused = async () => res(403, JSON.stringify({ ok: false, error: { code: 'not_writer', message: 'only the Dojo app may run AI jobs' } }))
    expect(await runJob('hint', HINT, { config: HELPER, fetchImpl: refused })).toMatchObject({ ok: false, code: 'bad_request', error: READ_ONLY_MESSAGE })
  })
  it('maps an error envelope to its code and message', async () => {
    const fetchImpl = async () => res(429, JSON.stringify({ ok: false, error: { code: 'busy', message: '2 jobs in flight' } }))
    expect(await runJob('hint', HINT, { config: HELPER, fetchImpl })).toMatchObject({ ok: false, code: 'busy', error: '2 jobs in flight' })
  })
  it('M2: maps a 413 too_large envelope to its code and message', async () => {
    const fetchImpl = async () => res(413, JSON.stringify({ ok: false, error: { code: 'too_large', message: 'body is over 65536 bytes' } }))
    expect(await runJob('hint', HINT, { config: HELPER, fetchImpl })).toMatchObject({ ok: false, code: 'too_large', error: 'body is over 65536 bytes' })
  })
  it('maps an unknown error code or a non-JSON body to claude_failed with the raw text', async () => {
    const odd = async () => res(500, JSON.stringify({ ok: false, error: { code: 'meltdown', message: 'x' } }))
    expect(await runJob('hint', HINT, { config: HELPER, fetchImpl: odd })).toMatchObject({ ok: false, code: 'claude_failed' })
    const html = async () => res(500, '<html>boom</html>')
    expect(await runJob('hint', HINT, { config: HELPER, fetchImpl: html })).toMatchObject({ ok: false, code: 'claude_failed', error: 'HTTP 500: <html>boom</html>' })
  })
  it('maps a refused connection to helper_unreachable', async () => {
    const down = async () => { throw new TypeError('Failed to fetch') }
    const r = await runJob('hint', HINT, { config: HELPER, fetchImpl: down })
    expect(r).toMatchObject({ ok: false, code: 'helper_unreachable', error: 'helper unreachable at http://127.0.0.1:8788: Failed to fetch' })
  })
  it('rejects output that fails validation as invalid_output', async () => {
    const bad = async () => res(200, JSON.stringify({ ok: true, output: { title: 't', structures: {}, steps: [] } }))
    const r = await runJob('picture', { ticket: T, context: {} }, { config: HELPER, fetchImpl: bad })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.code).toBe('invalid_output')
    expect(!r.ok && r.error).toMatch(/^invalid picture output: /)
  })
  it('never rejects, even when fetch throws synchronously', async () => {
    const sync = (() => { throw new Error('sync boom') }) as unknown as typeof fetch
    await expect(runJob('hint', HINT, { config: HELPER, fetchImpl: sync })).resolves.toMatchObject({ ok: false, code: 'helper_unreachable' })
  })
})

// C-PYTHON §3: the page's side of the Python frame: untrusted messages, the sandboxed iframe, the budgets.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRunRequest, localResult, parseFrameMessage, parseResult } from '../../src/runner/py/protocol'
import { createPyClient, iframeFrame, START_FAILED, type FrameHandle } from '../../src/runner/py/pyClient'
import type { PublicPack, RunResult } from '../../src/runner/types'

const PACK: PublicPack = {
  id: 'p91', title: 'Decode Ways', fn: 'numDecodings', signature: 'func numDecodings(s string) int', starter: '', examples: 2,
  cases: [1, 2, 3, 4, 5].map(i => ({ id: i, call: `numDecodings("${i}")`, expected: i })),
}
const OKR: RunResult = { status: 'ok', cases: [{ id: 1, call: 'c', expected: 1, got: 1, pass: true }], errors: [], stdout: '', steps: [], truncated: false, ms: 1 }
const env = (data: unknown) => ({ dojo: 'py', ...(data as object) })

describe('protocol', () => {
  it('builds Run (the examples) and Submit (all cases) from the pack', () => {
    const run = buildRunRequest('a', PACK, 'code', 'run')
    expect(run).toEqual({ type: 'run', id: 'a', code: 'code', fn: 'numDecodings', sig: 'def numDecodings(s: str) -> int:', cases: [{ id: 1, call: 'numDecodings("1")', expected: 1 }, { id: 2, call: 'numDecodings("2")', expected: 2 }] })
    expect(buildRunRequest('b', PACK, 'c', 'submit').cases).toHaveLength(5)
  })

  it('accepts only well-formed frame messages', () => {
    expect(parseFrameMessage(env({ type: 'hello' }))).toEqual({ type: 'hello' })
    expect(parseFrameMessage(env({ type: 'ready' }))).toEqual({ type: 'ready' })
    expect(parseFrameMessage(env({ type: 'state', id: 'x', state: 'loading' }))).toEqual({ type: 'state', id: 'x', state: 'loading' })
    expect(parseFrameMessage(env({ type: 'result', id: 'x', result: OKR }))).toEqual({ type: 'result', id: 'x', result: OKR })
    for (const bad of [
      null, 'hello', 5, [], {}, { type: 'hello' }, { dojo: 'other', type: 'hello' }, env({ type: 'nope' }), env({}), env({ type: 'state', id: 'x', state: 'weird' }),
      env({ type: 'state', state: 'running' }), env({ type: 'result', id: 'x' }), env({ type: 'result', id: 3, result: OKR }),
    ]) expect(parseFrameMessage(bad), JSON.stringify(bad)).toBeNull()
  })

  it('rejects a result with any wrong part, and extra fields never pass through', () => {
    expect(parseResult({ ...OKR, status: 'weird' })).toBeNull()
    expect(parseResult({ ...OKR, cases: [{ id: 1 }] })).toBeNull()
    expect(parseResult({ ...OKR, errors: [{ line: '3', col: 0, message: 'x' }] })).toBeNull()
    expect(parseResult({ ...OKR, stdout: 5 })).toBeNull()
    expect(parseResult({ ...OKR, steps: [{ op: 'set', t: 0, i: 0, j: 0, v: 1, deps: [[0]] }] })?.steps).toEqual([{ op: 'unshown' }])
    expect(parseResult({ ...OKR, steps: new Array(20001).fill({ op: 'exit', v: 1 }) })).toBeNull()
    expect(parseResult({ ...OKR, ms: NaN })).toBeNull()
    const withExtra = parseResult({ ...OKR, __proto__: { x: 1 }, evil: '<img src=x onerror=alert(1)>' }) as unknown as Record<string, unknown>
    expect(withExtra.evil).toBeUndefined()
    expect(parseResult({ ...OKR, steps: [{ op: 'set', t: 0, i: 0, j: 1, v: 2, deps: [[0, 0]], rule: '{0}', case: 1 }, { op: 'link', fn: 'f', table: 'dp' }] })).not.toBeNull()
  })

  it('C-VISUAL: family steps are checked against stepShape and rebuilt from their known fields', () => {
    const r = parseResult({ ...OKR, steps: [{ op: 'graph', sid: 0, act: 'new', name: 'g', directed: true, case: 1, evil: 'x' }, { op: 'heap', sid: 1, act: 'push', key: 1, prio: 2 }] })
    expect(r?.steps).toEqual([{ op: 'graph', sid: 0, act: 'new', name: 'g', directed: true, case: 1 }, { op: 'heap', sid: 1, act: 'push', key: 1, prio: 2 }])
    // Addendum 3: a bad step is kept as "not shown", never dropping the run or orphaning the steps after it
    expect(parseResult({ ...OKR, steps: [{ op: 'graph', sid: 0, act: 'explode', case: 1 }, { op: 'exit', v: 1 }] })?.steps).toEqual([{ op: 'unshown', kind: 'graph', case: 1 }, { op: 'exit', v: 1 }])
    expect(parseResult({ ...OKR, steps: [{ op: 'heap', sid: 0, act: 'new', name: 'x'.repeat(5000) }] })?.steps).toEqual([{ op: 'unshown', kind: 'heap' }])
    expect(parseResult({ ...OKR, steps: [{ op: 'eval', code: 'x' }, 7] })?.steps).toEqual([{ op: 'unshown' }, { op: 'unshown' }])
  })

  it('C-VISUAL §5: expected values pass through as arrays and bools', () => {
    const pack: PublicPack = { ...PACK, id: 'p802', fn: 'eventualSafeNodes', cases: [{ id: 1, call: 'eventualSafeNodes([[]])', expected: [0] }, { id: 2, call: 'x', expected: true }] }
    expect(buildRunRequest('a', pack, 'c', 'run').cases.map(c => c.expected)).toEqual([[0], true])
  })

  it('a local result lists the calls without answers', () => {
    const r = localResult('timeout', [{ id: 1, call: 'f(1)', expected: 2 }])
    expect(r).toMatchObject({ status: 'timeout', errors: [], steps: [], cases: [{ id: 1, call: 'f(1)', expected: 2, got: null, pass: false }] })
  })
})

describe('the iframe', () => {
  afterEach(() => { document.body.innerHTML = '' })
  it('is sandboxed with allow-scripts only (never allow-same-origin), hidden, and points at the runner page', () => {
    const f = iframeFrame(document)
    const el = document.querySelector('iframe')!
    expect(el.getAttribute('sandbox')).toBe('allow-scripts')
    expect(el.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(el.getAttribute('src')).toBe('/pyrunner/frame.html')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    f.destroy()
    expect(document.querySelector('iframe')).toBeNull()
  })
})

/** A frame stand-in: `window` is the page itself, so `event.source` checks can be both passed and failed. */
function fakeFrame() {
  const posted: unknown[] = []
  const w = { postMessage: (m: unknown) => { posted.push(m) } } as unknown as Window
  let destroyed = 0
  const state = { created: false }
  const handle: FrameHandle = { window: w, destroy: () => { destroyed += 1 } }
  const make = () => { state.created = true; return handle }
  /** The frame page loads and says hello (only once the client has created it). */
  const hello = async () => { await vi.waitFor(() => expect(state.created).toBe(true)); say(env({ type: 'hello' })) }
  const say = (data: unknown, source: Window | null = w) => window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource | null }))
  return { handle, make, hello, posted, say, w, destroyed: () => destroyed }
}

describe('the client', () => {
  it('creates no frame until the first run, then runs through postMessage', async () => {
    const made = vi.fn()
    const f = fakeFrame()
    const client = createPyClient({ makeFrame: () => { made(); return f.make() } })
    expect(made).not.toHaveBeenCalled()
    expect(client.everReady).toBe(false)
    const loading = vi.fn()
    const p = client.run({ pack: PACK, code: 'x = 1', mode: 'run' }, { onLoading: loading })
    await f.hello()
    await vi.waitFor(() => expect(f.posted).toHaveLength(1))
    const sent = f.posted[0] as { dojo: string; type: string; id: string; cases: unknown[] }
    expect(sent).toMatchObject({ dojo: 'py', type: 'run', cases: [{ id: 1 }, { id: 2 }] })
    f.say(env({ type: 'state', id: sent.id, state: 'loading' }))
    expect(loading).toHaveBeenCalledTimes(1)
    f.say(env({ type: 'ready' }))
    f.say(env({ type: 'state', id: sent.id, state: 'running' }))
    f.say(env({ type: 'result', id: sent.id, result: OKR }))
    expect(await p).toEqual({ ok: true, result: OKR })
    expect(client.everReady).toBe(true)
    // the frame is reused
    const p2 = client.run({ pack: PACK, code: 'x', mode: 'submit' })
    await vi.waitFor(() => expect(f.posted).toHaveLength(2))
    expect((f.posted[1] as { cases: unknown[] }).cases).toHaveLength(5)
    f.say(env({ type: 'result', id: (f.posted[1] as { id: string }).id, result: OKR }))
    await p2
    expect(made).toHaveBeenCalledTimes(1)
    client.dispose()
  })

  it('ignores messages from any other source and for any other run', async () => {
    const f = fakeFrame()
    const client = createPyClient({ makeFrame: f.make })
    const p = client.run({ pack: PACK, code: 'x', mode: 'run' })
    await f.hello()
    await vi.waitFor(() => expect(f.posted).toHaveLength(1))
    const id = (f.posted[0] as { id: string }).id
    f.say(env({ type: 'result', id, result: { ...OKR, stdout: 'forged' } }), window) // the page itself, not the frame
    f.say(env({ type: 'result', id, result: { ...OKR, stdout: 'forged' } }), null)
    f.say(env({ type: 'result', id: 'someone-else', result: { ...OKR, stdout: 'wrong run' } }))
    let settled = false
    void p.then(() => { settled = true })
    await new Promise(r => setTimeout(r, 20))
    expect(settled).toBe(false)
    f.say(env({ type: 'result', id, result: OKR }))
    expect(await p).toEqual({ ok: true, result: OKR })
    client.dispose()
  })

  it('serialises runs: a second waits for the first', async () => {
    const f = fakeFrame()
    const client = createPyClient({ makeFrame: f.make })
    const p1 = client.run({ pack: PACK, code: 'a', mode: 'run' })
    const p2 = client.run({ pack: PACK, code: 'b', mode: 'run' })
    await f.hello()
    await vi.waitFor(() => expect(f.posted).toHaveLength(1))
    await new Promise(r => setTimeout(r, 10))
    expect(f.posted).toHaveLength(1)
    f.say(env({ type: 'result', id: (f.posted[0] as { id: string }).id, result: OKR }))
    await p1
    await vi.waitFor(() => expect(f.posted).toHaveLength(2))
    f.say(env({ type: 'result', id: (f.posted[1] as { id: string }).id, result: OKR }))
    await p2
    client.dispose()
  })

  it('a frame that never says hello fails the run, and the next run builds a new frame', async () => {
    const frames = [fakeFrame(), fakeFrame()]
    let k = 0
    const client = createPyClient({ makeFrame: () => frames[k++].make(), timers: { hello: 150 } })
    expect(await client.run({ pack: PACK, code: 'x', mode: 'run' })).toEqual({ ok: false, message: START_FAILED })
    expect(frames[0].destroyed()).toBe(1)
    const p = client.run({ pack: PACK, code: 'x', mode: 'run' })
    await frames[1].hello()
    await vi.waitFor(() => expect(frames[1].posted).toHaveLength(1))
    frames[1].say(env({ type: 'result', id: (frames[1].posted[0] as { id: string }).id, result: OKR }))
    expect((await p).ok).toBe(true)
    client.dispose()
  })

  it('a frame stuck after "running" is destroyed and reported as a timeout', async () => {
    const f = fakeFrame()
    const client = createPyClient({ makeFrame: f.make, timers: { backstop: 30 } })
    const p = client.run({ pack: PACK, code: 'while True: pass', mode: 'run' })
    await f.hello()
    await vi.waitFor(() => expect(f.posted).toHaveLength(1))
    f.say(env({ type: 'state', id: (f.posted[0] as { id: string }).id, state: 'running' }))
    const out = await p
    expect(out).toMatchObject({ ok: true, result: { status: 'timeout', cases: [{ id: 1, got: null }, { id: 2 }] } })
    expect(f.destroyed()).toBe(1)
    client.dispose()
  })

  it('L2: an unreadable or over-cap result for the current run ends it at once, not after the backstop', async () => {
    const f = fakeFrame()
    const client = createPyClient({ makeFrame: f.make, timers: { backstop: 60_000 } })
    const p = client.run({ pack: PACK, code: 'x', mode: 'run' })
    await f.hello()
    await vi.waitFor(() => expect(f.posted).toHaveLength(1))
    const id = (f.posted[0] as { id: string }).id
    f.say(env({ type: 'result', id, result: { ...OKR, steps: new Array(20001).fill({ op: 'exit', v: 1 }) } }))
    expect(await p).toMatchObject({ ok: true, result: { status: 'output_limit', cases: [{ id: 1, got: null }, { id: 2 }] } })
    const p2 = client.run({ pack: PACK, code: 'x', mode: 'run' })
    await vi.waitFor(() => expect(f.posted).toHaveLength(2))
    f.say(env({ type: 'result', id: (f.posted[1] as { id: string }).id, result: { nonsense: true } }))
    expect(await p2).toMatchObject({ ok: true, result: { status: 'runtime_error', errors: [{ message: expect.stringMatching(/unreadable/) }] } })
    client.dispose()
  })

  it('L-a: code over 64 KiB is refused with a message, and no frame is started for it', async () => {
    const made = vi.fn()
    const client = createPyClient({ makeFrame: () => { made(); return fakeFrame().handle } })
    expect(await client.run({ pack: PACK, code: 'x'.repeat(64 * 1024 + 1), mode: 'run' })).toEqual({ ok: false, message: 'Your code is over 64 KiB.' })
    expect(made).not.toHaveBeenCalled()
    client.dispose()
  })

  it('a run that never leaves "loading" gives up after the load budget', async () => {
    const f = fakeFrame()
    const client = createPyClient({ makeFrame: f.make, timers: { load: 30 } })
    const p = client.run({ pack: PACK, code: 'x', mode: 'run' })
    await f.hello()
    expect(await p).toEqual({ ok: false, message: START_FAILED })
    client.dispose()
  })
})

// UAT r3 J4: identical warm Python runs took 70 ms, then 3 s, then 70 ms…: every run waited for the next worker's
// Pyodide load. The frame (public/pyrunner/frame.js) now keeps a spare runtime warm and compiles the WebAssembly
// once. It still never gives a worker a second run (security review M2). Driven here with stand-in workers.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

class FakeWorker {
  static all: FakeWorker[] = []
  sent: Array<Record<string, unknown>> = []
  terminated = false
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  constructor() { FakeWorker.all.push(this) }
  postMessage(m: Record<string, unknown>) { this.sent.push(m) }
  terminate() { this.terminated = true }
  reply(data: unknown) { this.onmessage?.({ data }) }
  runs() { return this.sent.filter(m => m.type === 'run') }
}

const flush = () => new Promise(r => setTimeout(r, 0))
const CASES = [{ id: 1, call: 'f(1)', expected: 1 }]
const runMsg = (id: string) => ({ dojo: 'py', type: 'run', id, code: 'def f(x): return x', fn: 'f', sig: 'def f(x)', cases: CASES })
const okResult = { status: 'ok', errors: [], stdout: '', steps: [], truncated: false, ms: 1, cases: [{ id: 1, got: 1 }] }

function loadFrame() {
  FakeWorker.all = []
  const toPage: Array<Record<string, unknown>> = []
  const parent = { postMessage: (m: Record<string, unknown>) => toPage.push(m) }
  let onMessage: ((e: { source: unknown; data: unknown }) => void) | null = null
  const win = { parent, addEventListener: (_t: string, f: typeof onMessage) => { onMessage = f } }
  const module = { compiled: true }
  let compiles = 0
  const wasmApi = { Module: Object, compileStreaming: async () => { compiles++; return module } }
  const fetchStub = async () => ({ ok: true, status: 200, text: async () => '/* worker */' })
  class URLStub extends URL { static createObjectURL() { return 'blob:worker' } }
  const judge = (cases: Array<{ id: number }>, r: { cases: Array<{ got: unknown }> }) => ({ status: 'passed', judged: cases.length, got: r.cases[0]?.got })
  const src = readFileSync(resolve(process.cwd(), 'public/pyrunner/frame.js'), 'utf8')
  new Function('window', 'self', 'location', 'fetch', 'Worker', 'URL', 'WebAssembly', src)(
    win, { dojoJudge: { judge } }, { href: 'http://127.0.0.1:1/pyrunner/frame.html' }, fetchStub, FakeWorker, URLStub, wasmApi,
  )
  const page = (data: unknown) => onMessage!({ source: parent, data })
  return { toPage, page, module, compiles: () => compiles }
}

describe('Python runner frame: a warm spare, one run per worker', () => {
  it('serves back-to-back runs from a ready spare, never reuses a worker, and compiles the WebAssembly once', async () => {
    const f = loadFrame()
    expect(f.toPage).toEqual([{ dojo: 'py', type: 'hello' }])
    f.page(runMsg('r1'))
    await flush()
    expect(f.toPage.at(-1)).toEqual({ dojo: 'py', type: 'state', id: 'r1', state: 'loading' })
    expect(FakeWorker.all).toHaveLength(1) // one runtime loads at a time
    const [a] = FakeWorker.all
    expect(a.sent[0]).toMatchObject({ type: 'init', wasm: f.module })
    a.reply({ type: 'ready' })
    expect(a.runs()).toHaveLength(1)
    expect(f.toPage.at(-1)).toEqual({ dojo: 'py', type: 'state', id: 'r1', state: 'running' })
    await flush()
    expect(FakeWorker.all).toHaveLength(2) // the spare starts once the first is ready
    const b = FakeWorker.all[1]
    b.reply({ type: 'ready' })
    a.reply({ type: 'result', id: 'r1', result: okResult })
    expect(f.toPage.at(-1)).toMatchObject({ type: 'result', id: 'r1', result: { status: 'passed' } })
    expect(a.terminated).toBe(true) // M2: dropped after its one run
    await flush()
    expect(FakeWorker.all).toHaveLength(3) // a new spare loads behind b

    // the next run starts at once on the warm spare: no "loading"
    const before = f.toPage.length
    f.page(runMsg('r2'))
    expect(f.toPage.slice(before)).toEqual([{ dojo: 'py', type: 'state', id: 'r2', state: 'running' }])
    expect(b.runs()).toHaveLength(1)
    b.reply({ type: 'result', id: 'r2', result: okResult })
    expect(b.terminated).toBe(true)
    expect(FakeWorker.all.every(w => w.runs().length <= 1)).toBe(true)
    expect(f.compiles()).toBe(1)
  })

  it('a run that arrives while every runtime is loading waits for the first ready one', async () => {
    const f = loadFrame()
    f.page(runMsg('r1'))
    await flush()
    const [a] = FakeWorker.all
    a.reply({ type: 'ready' })
    await flush()
    const b = FakeWorker.all[1]
    a.reply({ type: 'result', id: 'r1', result: okResult })
    f.page(runMsg('r2')) // b is still loading
    expect(f.toPage.at(-1)).toEqual({ dojo: 'py', type: 'state', id: 'r2', state: 'loading' })
    b.reply({ type: 'ready' })
    expect(b.runs()).toHaveLength(1)
    expect(f.toPage.at(-1)).toEqual({ dojo: 'py', type: 'state', id: 'r2', state: 'running' })
  })

  it('a runtime that cannot start ends the waiting run with the reason, and a spare that dies idle is just dropped', async () => {
    const f = loadFrame()
    f.page(runMsg('r1'))
    await flush()
    FakeWorker.all[0].reply({ type: 'fatal', message: 'Python could not start: boom' })
    expect(f.toPage.at(-1)).toMatchObject({ type: 'result', id: 'r1', result: { status: 'runtime_error', errors: [{ message: 'Python could not start: boom' }] } })
    f.page(runMsg('r2'))
    await flush()
    const a = FakeWorker.all[1]
    a.reply({ type: 'ready' })
    await flush()
    const spare = FakeWorker.all[2]
    spare.reply({ type: 'fatal', message: 'x' })
    a.reply({ type: 'result', id: 'r2', result: okResult })
    expect(f.toPage.at(-1)).toMatchObject({ type: 'result', id: 'r2', result: { status: 'passed' } })
  })
})

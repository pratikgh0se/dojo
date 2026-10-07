// C-PYTHON §3: Dojo's side of the Python runner. A hidden iframe (sandbox="allow-scripts", never
// allow-same-origin, so an opaque origin) holds the Pyodide worker; it is created on the first Python run
// and not before, so the entry bundle and a Go-only session never pay for it. Each run is a postMessage;
// only messages whose `source` is that frame's own window are read, and each is checked as untrusted data.
import type { RunOutcome } from '../client'
import type { PublicPack, RunMode } from '../types'
import { buildRunRequest, CODE_TOO_LONG, FRAME_URL, MAX_CODE, localResult, parseFrameMessage, STEP_LIMIT, type RunRequest } from './protocol'

export const HELLO_MS = 30_000
export const LOAD_MS = 90_000
/** The frame enforces 3 s; the page waits a little longer, then gives up on the frame itself. */
export const BACKSTOP_MS = 7_000
export const START_FAILED = 'Python could not start. Reload Dojo and try again.'

/** The frame as the client uses it; the default is an iframe, tests pass a stand-in. */
export interface FrameHandle { window: Window | null; destroy(): void }

export interface PyTimers { hello: number; load: number; backstop: number }
export interface PyClientOptions {
  makeFrame?: () => FrameHandle
  win?: Window
  timers?: Partial<PyTimers>
}

export interface PyHooks { onLoading?: () => void; onRunning?: () => void }
export interface PyClient {
  /** True once the runtime has loaded at least once (so later runs never say "Loading Python…"). */
  readonly everReady: boolean
  run(req: { pack: PublicPack; code: string; mode: RunMode }, hooks?: PyHooks): Promise<RunOutcome>
  dispose(): void
}

export function iframeFrame(doc: Document = document): FrameHandle {
  const f = doc.createElement('iframe')
  f.setAttribute('sandbox', 'allow-scripts') // no allow-same-origin: an opaque origin
  f.setAttribute('aria-hidden', 'true')
  f.setAttribute('tabindex', '-1')
  f.setAttribute('title', 'Python runner')
  f.setAttribute('data-testid', 'py-frame')
  f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
  f.src = FRAME_URL
  doc.body.appendChild(f)
  return { get window() { return f.contentWindow }, destroy() { f.remove() } }
}

let nextId = 0
const newId = () => `py-${Date.now().toString(36)}-${++nextId}`

export function createPyClient(opts: PyClientOptions = {}): PyClient {
  const win = opts.win ?? window
  const make = opts.makeFrame ?? (() => iframeFrame())
  const t: PyTimers = { hello: HELLO_MS, load: LOAD_MS, backstop: BACKSTOP_MS, ...opts.timers }
  let frame: FrameHandle | null = null
  let hello: Promise<boolean> | null = null
  let helloDone: ((ok: boolean) => void) | null = null
  let everReady = false
  let busy: Promise<unknown> = Promise.resolve()
  let cur: { id: string; req: RunRequest; settle: (r: RunOutcome) => void; onLoading?: () => void; onRunning?: () => void; timer: ReturnType<typeof setTimeout> | null } | null = null

  const onMessage = (ev: MessageEvent) => {
    if (!frame || ev.source === null || ev.source !== frame.window) return // not our frame: not for us
    const m = parseFrameMessage(ev.data)
    if (!m) {
      // A result for the run in flight that fails the checks ends that run now (L2), not after the backstop.
      const d = ev.data as { dojo?: unknown; type?: unknown; id?: unknown; result?: { steps?: unknown } } | null
      if (cur && d && d.dojo === 'py' && d.type === 'result' && d.id === cur.id) {
        const c = cur
        if (c.timer) clearTimeout(c.timer)
        cur = null
        const big = Array.isArray(d.result?.steps) && d.result.steps.length > STEP_LIMIT
        c.settle({ ok: true, result: big ? localResult('output_limit', c.req.cases) : localResult('runtime_error', c.req.cases, 'The Python runner sent an unreadable result') })
      }
      return
    }
    if (m.type === 'hello') helloDone?.(true)
    else if (m.type === 'ready') everReady = true
    else if (m.type === 'state' && cur && m.id === cur.id) {
      if (m.state === 'loading') cur.onLoading?.()
      else { cur.onRunning?.(); armBackstop(cur.id, t.backstop) }
    } else if (m.type === 'result' && cur && m.id === cur.id) {
      const c = cur
      if (c.timer) clearTimeout(c.timer)
      cur = null
      c.settle({ ok: true, result: m.result })
    }
  }
  win.addEventListener('message', onMessage)

  function armBackstop(id: string, ms: number) {
    if (!cur || cur.id !== id) return
    if (cur.timer) clearTimeout(cur.timer)
    cur.timer = setTimeout(() => {
      if (!cur || cur.id !== id) return
      const c = cur
      cur = null
      teardown() // the frame itself is stuck: the next run builds a new one
      c.settle({ ok: true, result: localResult('timeout', c.req.cases) })
    }, ms)
  }

  function teardown() {
    frame?.destroy()
    frame = null
    hello = null
    helloDone = null
    everReady = false
  }

  function ensureFrame(): Promise<boolean> {
    if (hello) return hello
    hello = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), t.hello)
      helloDone = ok => { clearTimeout(timer); resolve(ok) }
    })
    frame = make()
    return hello
  }

  async function runOne(req: { pack: PublicPack; code: string; mode: RunMode }, hooks: PyHooks): Promise<RunOutcome> {
    if (req.code.length > MAX_CODE) return { ok: false, message: CODE_TOO_LONG } // no frame is started for it
    const ok = await ensureFrame()
    const w = frame?.window
    if (!ok || !w) {
      teardown()
      return { ok: false, message: START_FAILED }
    }
    const msg = buildRunRequest(newId(), req.pack, req.code, req.mode)
    return new Promise<RunOutcome>(settle => {
      cur = { id: msg.id, req: msg, settle, onLoading: hooks.onLoading, onRunning: hooks.onRunning, timer: null }
      // Until the runtime reports it is running the code, only the (long) load budget applies.
      cur.timer = setTimeout(() => {
        if (!cur || cur.id !== msg.id) return
        cur = null
        teardown()
        settle({ ok: false, message: START_FAILED })
      }, t.load)
      w.postMessage({ dojo: 'py', ...msg }, '*') // an opaque origin cannot be named as a target
    })
  }

  return {
    get everReady() { return everReady },
    run(req, hooks = {}) {
      // One run at a time: a second call waits for the first.
      const p = busy.then(() => runOne(req, hooks))
      busy = p.catch(() => undefined)
      return p
    },
    dispose() {
      win.removeEventListener('message', onMessage)
      if (cur) { const c = cur; cur = null; if (c.timer) clearTimeout(c.timer); c.settle({ ok: false, message: START_FAILED }) }
      teardown()
    },
  }
}

let shared: PyClient | null = null
/** The app's one client. The frame is not created until the first run. */
export function pyClient(): PyClient {
  return (shared ??= createPyClient())
}

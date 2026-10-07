// The runner frame (C-PYTHON §3). Opaque origin (sandbox="allow-scripts", no allow-same-origin): it owns
// the Pyodide workers, enforces the 3 s wall time by terminating it, and relays results to the page by
// postMessage. Every message from the page is untrusted data and is checked before use.
(() => {
  'use strict'
  const parentWin = window.parent
  const BASE = new URL('/pyodide/', location.href).href
  const ASSETS = new URL('/pyrunner/', location.href).href
  const WALL_MS = 3000
  const MAX_CODE = 64 * 1024
  const MAX_CASES = 20
  const MAX_TEXT = 4096

  // UAT r3 J4: a worker still serves exactly one run (security review M2), but a spare runtime is kept warm
  // behind the one the next run will use, so back-to-back runs never wait for Pyodide to load again. At most
  // one runtime loads at a time, and the WebAssembly module is compiled once per frame and shared.
  const KEEP = 2
  let workerSource = null
  let wasm = null // Promise<WebAssembly.Module | null>
  let pool = [] // { w, state: 'loading' | 'ready' | 'busy', dead } in start order; the first ready one serves the next run
  let job = null // { id, req, timer, sent, entry }

  const judge = self.dojoJudge.judge
  const send = m => parentWin.postMessage(Object.assign({ dojo: 'py' }, m), '*')
  const str = (v, max) => typeof v === 'string' && v.length <= max
  /** C-VISUAL §5: an expected value is a number, a bool, a short string, or a small array of them. */
  const value = (v, depth) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || str(v, MAX_TEXT) ||
    (Array.isArray(v) && depth < 4 && v.length <= 1000 && v.every(x => value(x, depth + 1)))
  const caseList = cases => Array.isArray(cases) && cases.length > 0 && cases.length <= MAX_CASES &&
    cases.every(c => c && typeof c === 'object' && Number.isInteger(c.id) && str(c.call, MAX_TEXT) && value(c.expected, 0))

  /** The request, rebuilt from validated fields only (never the page's own object). */
  function readRun(m) {
    if (!m || m.type !== 'run' || !str(m.id, 64) || !str(m.code, MAX_CODE) || !str(m.fn, 128) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.fn) || !str(m.sig, 256) || !caseList(m.cases)) return null
    return { id: m.id, code: m.code, fn: m.fn, sig: m.sig, cases: m.cases.map(c => ({ id: c.id, call: c.call, expected: JSON.parse(JSON.stringify(c.expected)) })) }
  }

  const unrun = (cases, status, errors) => ({
    status, errors: errors || [], stdout: '', steps: [], truncated: false, ms: 0,
    cases: cases.map(c => ({ id: c.id, call: c.call, expected: c.expected, got: null, pass: false })),
  })

  function kill(entry) {
    entry.dead = true
    pool = pool.filter(x => x !== entry)
    if (entry.w) { try { entry.w.terminate() } catch (e) { /* gone */ } }
  }

  /** Pyodide's WebAssembly, compiled once for every worker of this frame (null: each worker compiles its own). */
  function compiled() {
    if (!wasm) {
      wasm = (typeof WebAssembly === 'object' && WebAssembly.compileStreaming
        ? WebAssembly.compileStreaming(fetch(BASE + 'pyodide.asm.wasm'))
        : Promise.resolve(null)).catch(() => null)
    }
    return wasm
  }

  function spawn() {
    const entry = { w: null, state: 'loading', dead: false }
    pool.push(entry)
    void (async () => {
      try {
        if (workerSource === null) {
          const res = await fetch(ASSETS + 'worker.js')
          if (!res.ok) throw new Error('worker.js: HTTP ' + res.status)
          workerSource = await res.text()
        }
        const mod = await compiled()
        if (entry.dead) return
        const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
        const w = new Worker(url)
        entry.w = w
        w.onmessage = e => onWorker(entry, e.data)
        w.onerror = e => { e.preventDefault(); onFatal(entry, 'the Python worker crashed') }
        w.onmessageerror = () => onFatal(entry, 'the Python worker sent an unreadable message')
        w.postMessage({ type: 'init', base: BASE, assets: ASSETS, wasm: mod })
      } catch (e) {
        onFatal(entry, 'Python could not start: ' + (e && e.message ? e.message : e))
      }
    })()
  }

  /** Keeps KEEP runtimes (a busy one counts), starting the next only when none is still loading. */
  function topUp() {
    if (pool.length < KEEP && !pool.some(x => x.state === 'loading')) spawn()
  }

  function finish(result) {
    if (!job) return
    clearTimeout(job.timer)
    const id = job.id
    job = null
    send({ type: 'result', id, result })
  }

  function onFatal(entry, message) {
    if (entry.dead) return
    kill(entry)
    // the run it was serving, or a run still waiting for a runtime, ends with the reason
    if (job && (job.entry === entry || !job.sent)) finish(unrun(job.req.cases, 'runtime_error', [{ line: 1, col: 0, message }]))
  }

  function dispatch() {
    if (!job || job.sent) return
    const entry = pool.find(x => x.state === 'ready')
    if (!entry) return
    job.sent = true
    job.entry = entry
    entry.state = 'busy' // it serves this run and is then dropped
    send({ type: 'state', id: job.id, state: 'running' })
    // the worker is told the calls only, never what they should return
    entry.w.postMessage({ type: 'run', id: job.id, code: job.req.code, fn: job.req.fn, sig: job.req.sig, cases: job.req.cases.map(c => ({ id: c.id, call: c.call })) })
    // The wall time counts from the moment the code starts, not while the runtime loads.
    job.timer = setTimeout(onTimeout, WALL_MS)
  }

  function onTimeout() {
    if (!job) return
    const cases = job.req.cases
    kill(job.entry) // the next run gets a fresh runtime
    finish(unrun(cases, 'timeout'))
    topUp()
  }

  function onWorker(entry, m) {
    if (entry.dead || !m || typeof m !== 'object') return
    if (m.type === 'ready') {
      if (entry.state !== 'loading') return
      entry.state = 'ready'
      send({ type: 'ready' })
      dispatch()
      topUp()
    } else if (m.type === 'fatal') {
      onFatal(entry, String(m.message || 'Python could not start'))
    } else if (m.type === 'result' && job && job.entry === entry && m.id === job.id) {
      finish(judge(job.req.cases, m.result)) // the verdict is made here, from the frame's own cases
      // Security review M2: a worker serves exactly one run. Learner code can patch builtins, json or sys.modules,
      // so it is dropped now; the spare serves the next run, and a new spare starts loading behind it.
      kill(entry)
      topUp()
    }
  }

  window.addEventListener('message', e => {
    if (e.source !== parentWin) return
    const d = e.data
    if (!d || typeof d !== 'object' || d.dojo !== 'py') return
    // A well-formed request whose code is over the cap is answered, not dropped (it would hang the page).
    if (d.type === 'run' && str(d.id, 64) && typeof d.code === 'string' && d.code.length > MAX_CODE && caseList(d.cases)) {
      send({ type: 'result', id: d.id, result: unrun(d.cases.map(c => ({ id: c.id, call: c.call, expected: c.expected })), 'compile_error', [{ line: 1, col: 0, message: 'Your code is over 64 KiB' }]) })
      return
    }
    const req = readRun(d)
    if (!req) return
    if (job) {
      send({ type: 'result', id: req.id, result: unrun(req.cases, 'runtime_error', [{ line: 1, col: 0, message: 'a run is already in flight' }]) })
      return
    }
    job = { id: req.id, req, timer: null, sent: false, entry: null }
    if (pool.length === 0) spawn()
    dispatch()
    if (!job || !job.sent) send({ type: 'state', id: req.id, state: 'loading' })
  })

  send({ type: 'hello' })
})()

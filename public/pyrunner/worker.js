// The Pyodide worker (C-PYTHON §3). It is created by frame.js from a blob inside the sandboxed frame.
// Order matters: load Pyodide and the Python files first (they need the network), THEN remove every way
// out before any learner code runs. The opaque origin and the frame's CSP are the real guards; this is
// the belt over those braces.
'use strict'
const post = self.postMessage.bind(self)
const MAX_MESSAGE = 12 * 1024 * 1024
let pyodide = null
let harness = null

/** Everything that could reach the network, storage or another context, removed from the global chain. */
const BLOCKED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts',
  'indexedDB', 'IDBFactory', 'caches', 'CacheStorage', 'BroadcastChannel', 'Worker', 'SharedWorker',
  'RTCPeerConnection', 'FileReaderSync', 'MessageChannel', 'MessagePort',
]

function lockdown() {
  for (let o = self; o; o = Object.getPrototypeOf(o)) {
    for (const name of BLOCKED) {
      if (!Object.prototype.hasOwnProperty.call(o, name)) continue
      let gone = false
      try { gone = delete o[name] } catch (e) { /* not configurable */ }
      if (!gone || Object.prototype.hasOwnProperty.call(o, name)) {
        try { Object.defineProperty(o, name, { value: undefined, configurable: false, writable: false }) } catch (e) { /* frozen */ }
      }
    }
  }
  // The only line out of the worker is the closure above; learner code finds no postMessage to call.
  try { Object.defineProperty(self, 'postMessage', { value: undefined, configurable: false, writable: false }) } catch (e) { /* ignore */ }
  try { Object.defineProperty(self, 'close', { value: undefined, configurable: false, writable: false }) } catch (e) { /* ignore */ }
}

async function init(m) {
  const base = String(m.base)
  const assets = String(m.assets)
  importScripts(base + 'pyodide.js')
  // UAT r3 J4: the frame compiles pyodide.asm.wasm once and hands every worker the module; instantiating it is
  // a fraction of compiling it again. A fresh instance (its own memory) per worker, so nothing is shared at run time.
  if (typeof WebAssembly === 'object' && m.wasm instanceof WebAssembly.Module) {
    const mod = m.wasm
    WebAssembly.instantiateStreaming = async (_response, imports) => ({ module: mod, instance: await WebAssembly.instantiate(mod, imports) })
  }
  // `js` (what Python's `import js` sees) is an empty object, not the worker's global scope.
  pyodide = await self.loadPyodide({ indexURL: base, stdout: () => {}, stderr: () => {}, jsglobals: {} })
  const [tk, py] = await Promise.all(['dojo_tk.py', 'dojo_harness.py'].map(async f => {
    const r = await fetch(assets + f)
    if (!r.ok) throw new Error(f + ': HTTP ' + r.status)
    return r.text()
  }))
  pyodide.FS.writeFile('/dojo_harness.py', py)
  pyodide.runPython('import sys\nsys.path.insert(0, "/")\nimport dojo_harness')
  harness = pyodide.pyimport('dojo_harness')
  harness.set_tk_source(tk)
  lockdown()
}

function unrun(cases, status, message) {
  return {
    status, stdout: '', steps: [], truncated: false, ms: 0,
    errors: message ? [{ line: 1, col: 0, message }] : [],
    cases: [],
  }
}

function run(m) {
  let result
  try {
    const raw = harness.run(m.code, JSON.stringify(m.cases), m.fn, m.sig)
    // An over-cap answer is not parsed or relayed: it is "Output too large" (the frame caps it again).
    result = raw.length > MAX_MESSAGE ? unrun(m.cases, 'output_limit') : JSON.parse(raw)
  } catch (e) {
    const text = String((e && e.message) || e)
    result = /memory|allocat|RangeError/i.test(text) ? unrun(m.cases, 'memory_limit') : unrun(m.cases, 'runtime_error', text.split('\n').filter(Boolean).pop() || 'the Python runner failed')
  }
  post({ type: 'result', id: m.id, result })
}

self.onmessage = async e => {
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.type === 'init' && pyodide === null) {
    try {
      await init(m)
      post({ type: 'ready' })
    } catch (err) {
      post({ type: 'fatal', message: 'Python could not start: ' + String((err && err.message) || err) })
    }
  } else if (m.type === 'run' && harness !== null) {
    run(m)
  }
}

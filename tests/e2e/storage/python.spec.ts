import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'
import { entryChunks, ENTRY_BUDGET_BYTES } from '../../../scripts/bundle-check.mjs'
import { frameCsp } from '../../../server/runner/pyframe.mjs'
import { randomUUID } from 'node:crypto'
import { openApp, reopen, rows } from './briefs-helpers'
import { ServerHarness } from './harness'

// C-PYTHON (Part 4b): the in-browser Python runner on Do, through dojo-server with a writer token.
// Python needs no toolchain and no run route; everything runs in a sandboxed frame's worker.
let srv: ServerHarness
test.beforeEach(async () => { srv = new ServerHarness(); await srv.start() })
test.afterEach(async () => { await srv.dispose() })
test.describe.configure({ timeout: 120_000 })

const P91_OK = `def numDecodings(s: str) -> int:
    prev2, prev1 = 1, (0 if s[0] == '0' else 1)
    for i in range(2, len(s) + 1):
        cur = 0
        if s[i - 1] != '0':
            cur += prev1
        if s[i - 2] == '1' or (s[i - 2] == '2' and s[i - 1] <= '6'):
            cur += prev2
        prev2, prev1 = prev1, cur
    return prev1
`
const P91_WRONG = 'def numDecodings(s: str) -> int:\n    if len(s) <= 2: return len(s)\n    return len(s) + 1\n'
const P91_TABLE = `from dojo import tk

def numDecodings(s: str) -> int:
    t = tk.Table("dp", 1, len(s) + 1)
    t.Set(0, 0, 1)
    t.Set(0, 1, 0 if s[0] == '0' else 1)
    for i in range(2, len(s) + 1):
        one = s[i - 1] != '0'
        two = s[i - 2] == '1' or (s[i - 2] == '2' and s[i - 1] <= '6')
        if one and two:
            t.Set(0, i, t.Get(0, i - 1) + t.Get(0, i - 2), tk.Dep(0, i - 1), tk.Dep(0, i - 2), tk.Rule("{0} + {1}"))
        elif one:
            t.Set(0, i, t.Get(0, i - 1), tk.Dep(0, i - 1), tk.Rule("{0}"))
        elif two:
            t.Set(0, i, t.Get(0, i - 2), tk.Dep(0, i - 2), tk.Rule("{0}"))
        else:
            t.Set(0, i, 0)
    return t.Get(0, len(s))
`
const P91_MEMO = `from dojo import tk

memo = {}

def f(s, i):
    if i in memo:
        tk.Hit("f", i)
        return memo[i]
    tk.Enter("f", i)
    if i <= 1:
        v = 0 if (i == 1 and s[0] == '0') else 1
    else:
        v = 0
        if s[i - 1] != '0':
            v += f(s, i - 1)
        if s[i - 2] == '1' or (s[i - 2] == '2' and s[i - 1] <= '6'):
            v += f(s, i - 2)
    memo[i] = v
    tk.Exit(v)
    return v

def numDecodings(s: str) -> int:
    memo.clear()
    tk.Link("f", "dp")
    tk.Table("dp", 1, len(s) + 1)
    return f(s, len(s))
`
// The classic solution of every pack, from the tester's own knowledge (PY-12).
const CLASSIC: Record<string, string> = {
  p91: P91_OK,
  p198: 'def rob(nums: list[int]) -> int:\n    a = b = 0\n    for x in nums:\n        a, b = b, max(b, a + x)\n    return b\n',
  p322: 'def coinChange(coins: list[int], amount: int) -> int:\n    INF = amount + 1\n    dp = [0] + [INF] * amount\n    for a in range(1, amount + 1):\n        for c in coins:\n            if c <= a:\n                dp[a] = min(dp[a], dp[a - c] + 1)\n    return dp[amount] if dp[amount] <= amount else -1\n',
  p62: 'def uniquePaths(m: int, n: int) -> int:\n    row = [1] * n\n    for _ in range(1, m):\n        for j in range(1, n):\n            row[j] += row[j - 1]\n    return row[-1]\n',
  p1143: 'def longestCommonSubsequence(text1: str, text2: str) -> int:\n    dp = [[0] * (len(text2) + 1) for _ in range(len(text1) + 1)]\n    for i in range(1, len(text1) + 1):\n        for j in range(1, len(text2) + 1):\n            if text1[i - 1] == text2[j - 1]:\n                dp[i][j] = dp[i - 1][j - 1] + 1\n            else:\n                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])\n    return dp[-1][-1]\n',
}

async function openDo(page: Page, id: string) {
  await page.goto(`/do/${id}`)
  await expect(page.getByTestId('code-panel')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Code' })).toBeVisible()
}
const language = (page: Page, name: 'Go' | 'Python') => page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name })
async function useLanguage(page: Page, name: 'Go' | 'Python') {
  await language(page, name).check()
  await expect(language(page, name)).toBeChecked()
}
/** Types the code in the current language and waits until its code row on disk holds exactly that text. */
async function setCode(page: Page, code: string, lang: 'go' | 'py') {
  await page.getByRole('textbox', { name: 'Code' }).fill(code)
  const id = new URL(page.url()).pathname.split('/').pop()
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === id && r.lang === lang)?.source, { timeout: 5000 }).toBe(code)
}
const status = (page: Page) => page.getByTestId('run-status')
const run = (page: Page) => page.getByRole('button', { name: 'Run', exact: true }).click()
const submit = (page: Page) => page.getByRole('button', { name: 'Submit', exact: true }).click()

/** Every request a context makes, workers and frames included. */
function record(ctx: BrowserContext) {
  const seen: { url: string; method: string; failed?: string; status?: number }[] = []
  const at = new Map<Request, number>()
  ctx.on('request', (r: Request) => { at.set(r, seen.length); seen.push({ url: r.url(), method: r.method() }) })
  ctx.on('requestfailed', (r: Request) => { const k = at.get(r); if (k !== undefined) seen[k].failed = r.failure()?.errorText ?? 'failed' })
  ctx.on('response', r => { const k = at.get(r.request()); if (k !== undefined) seen[k].status = r.status() })
  return seen
}

test('PY-01/PY-13-gate: a correct Python p91 Submit passes 5/5 and opens Solved', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled()
  await expect(language(page, 'Go')).toBeChecked() // the default
  await useLanguage(page, 'Python')
  await expect(page.getByRole('textbox', { name: 'Code' })).toContainText('def numDecodings(s: str) -> int:')
  await setCode(page, P91_OK, 'py')
  await run(page)
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled() // Run never opens the gate
  await submit(page)
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 60_000 })
  for (let k = 1; k <= 5; k++) await expect(page.getByTestId(`run-case-${k}`)).toHaveAttribute('data-pass', 'true')
  await expect(page.getByTestId('do-outcome-solved')).toBeEnabled()
  await expect(page.getByTestId('do-outcome-help')).toBeEnabled()
  await ctx.close()
})

test('PY-02/PY-03/PY-04: a wrong answer diffs, a syntax error and an exception name their lines', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await useLanguage(page, 'Python')
  await setCode(page, P91_WRONG, 'py')
  await run(page)
  await expect(status(page)).toHaveText('Failed 1/2', { timeout: 60_000 })
  await expect(page.getByTestId('run-case-1')).toHaveAttribute('data-pass', 'true')
  await expect(page.getByTestId('run-case-2')).toHaveAttribute('data-pass', 'false')
  await expect(page.getByTestId('run-diff')).toHaveText('numDecodings("226"): expected 3, got 4')

  await setCode(page, 'def numDecodings(s: str) -> int:\n    x = 1\n    return (x +\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Compile error', { timeout: 60_000 })
  await expect(page.getByTestId('run-error').first()).toHaveText(/^line 3:/)

  await setCode(page, 'def numDecodings(s: str) -> int:\n    raise ValueError("boom")\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Runtime error', { timeout: 60_000 })
  await expect(page.getByTestId('run-error')).toHaveText('line 2: ValueError: boom')

  // every case runs: only "12" raises, "226" still returns and passes
  await setCode(page, 'def numDecodings(s: str) -> int:\n    if s == "12":\n        raise ValueError("boom")\n    return 3\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Runtime error', { timeout: 60_000 })
  await expect(page.getByTestId('run-case-2')).toHaveAttribute('data-pass', 'true')
  await expect(page.getByTestId('run-error')).toHaveText('line 3: ValueError: boom')

  await setCode(page, 'x = 1\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Compile error', { timeout: 60_000 })
  await expect(page.getByTestId('run-error')).toHaveText('Define a function named numDecodings: def numDecodings(s: str) -> int:')
  await ctx.close()
})

test('PY-05/PY-06: a loop times out within 10 s and the next run passes; 5 MiB of prints is "Output too large"', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await useLanguage(page, 'Python')
  await setCode(page, 'def numDecodings(s: str) -> int:\n    while True:\n        pass\n', 'py')
  const t0 = Date.now()
  await run(page)
  await expect(status(page)).toHaveText('Timed out after 3 s', { timeout: 10_000 })
  expect(Date.now() - t0).toBeLessThan(10_000)
  await setCode(page, P91_OK, 'py')
  await run(page)
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })

  await setCode(page, 'def numDecodings(s: str) -> int:\n    for _ in range(5 * 1024):\n        print("x" * 1024)\n    return 0\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Output too large', { timeout: 30_000 })
  await setCode(page, 'def numDecodings(s: str) -> int:\n    print("y" * (5 * 1024 * 1024))\n    return 0\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Output too large', { timeout: 30_000 })
  await setCode(page, 'def numDecodings(s: str) -> int:\n    x = [0] * (2 ** 29)\n    return 0\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Out of memory', { timeout: 30_000 })
  await setCode(page, P91_OK, 'py')
  await run(page)
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })
  await ctx.close()
})

test('PY-07: learner Python cannot reach Dojo, the network or the page, and the run still completes', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await page.evaluate(() => { (window as unknown as { __canary: number }).__canary = 41 })
  await openDo(page, 'p91')
  await page.evaluate(() => { (window as unknown as { __canary: number }).__canary = 42 })
  await useLanguage(page, 'Python')
  const token = `canary${Date.now()}`
  const program = `import js
import urllib.request
import socket

def attempt(name, f):
    try:
        r = f()
        print(name + ": REACHED " + repr(r)[:60])
    except BaseException as e:
        print(name + ": " + type(e).__name__)

def numDecodings(s):
    attempt("js.fetch", lambda: js.fetch("/db/state?${token}=fetch"))
    attempt("js.indexedDB", lambda: js.indexedDB.open("dojo-disk"))
    attempt("js.localStorage", lambda: js.localStorage)
    attempt("js.XMLHttpRequest", lambda: js.XMLHttpRequest.new())
    attempt("js.WebSocket", lambda: js.WebSocket.new("ws://127.0.0.1:${new URL(srv.url).port}/db/state?${token}=ws"))
    attempt("js.parent.document", lambda: js.parent.document)
    attempt("js.document", lambda: js.document)
    attempt("js.window", lambda: js.window)
    attempt("urllib", lambda: urllib.request.urlopen("${srv.url}/db/state?${token}=urllib", timeout=3).read())
    attempt("socket", lambda: socket.create_connection(("127.0.0.1", ${new URL(srv.url).port}), timeout=3))
    from pyodide.http import pyfetch
    attempt("pyfetch", lambda: pyfetch("/db/state?${token}=pyfetch"))
    return 0
`
  await setCode(page, program, 'py')
  // let the app's own sync settle, then compare disk state and watch the network around the run
  await page.getByTestId('save-status').filter({ hasText: 'Saved' }).waitFor()
  const before = await (await fetch(`${srv.url}/db/state`)).text()
  const seen = record(ctx)
  await run(page)
  await expect(status(page)).not.toHaveText(/Loading|Running/, { timeout: 60_000 })
  await expect(status(page)).toHaveText('Failed 0/2') // finished: it returns 0
  const out = await page.getByTestId('run-stdout').innerText()
  console.log(out)
  expect(out).not.toContain('REACHED')
  for (const name of ['js.fetch', 'js.indexedDB', 'js.localStorage', 'js.XMLHttpRequest', 'js.WebSocket', 'js.parent.document', 'js.document', 'js.window', 'urllib', 'socket', 'pyfetch']) {
    expect(out, name).toContain(`${name}: `)
  }
  // nothing the run did reached the server
  expect(seen.filter(r => r.url.includes(token)), 'canary requests').toEqual([])
  const toApp = seen.filter(r => r.url.startsWith(srv.url) && !/\/(pyodide|pyrunner)\//.test(r.url)).map(r => `${r.method} ${new URL(r.url).pathname}`)
  console.log('requests during the run (other than the runner assets):', JSON.stringify(toApp))
  expect(toApp.filter(x => !x.startsWith('GET /db/health'))).toEqual([])
  // Dojo's data and page are untouched
  await page.waitForTimeout(500)
  expect(await (await fetch(`${srv.url}/db/state`)).text()).toBe(before)
  expect(await page.evaluate(() => (window as unknown as { __canary: number }).__canary)).toBe(42)
  await expect(page.getByTestId('code-panel')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('dojo.writer'))).toBeTruthy()
  // the frame is sandboxed: an opaque origin, scripts only
  const sandbox = await page.locator('iframe[data-testid="py-frame"]').getAttribute('sandbox')
  expect(sandbox).toBe('allow-scripts')
  await ctx.close()
})

test('PY-07 (walls): a sandboxed frame with the runner CSP, and its blob worker, reach nothing even with every JS global intact', async ({ browser }) => {
  // The runner's lockdown of fetch & co. is a belt. This probe has NO lockdown: a frame with exactly the
  // runner's sandbox attribute and CSP header, and a blob worker like the real one, calling the raw APIs.
  const { ctx, page } = await openApp(browser, srv)
  const token = `probe${Date.now()}`
  const probe = `
    const out = {}
    const tryit = async (name, f) => { try { const r = await f(); out[name] = 'REACHED ' + String(r).slice(0, 40) } catch (e) { out[name] = e.name } }
    const suite = ${'`'}(async () => {
      const out = {}
      const tryit = async (name, f) => { try { const r = await f(); out[name] = 'REACHED ' + String(r).slice(0, 40) } catch (e) { out[name] = e.name } }
      await tryit('fetch', () => fetch('/db/state?${token}=wf'))
      await tryit('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', '/db/state?${token}=wx'); x.onload = () => ok(x.status); x.onerror = () => no(new Error('xhr')); x.send() }))
      await tryit('indexedDB', () => new Promise((ok, no) => { const r = indexedDB.open('dojo-disk'); r.onsuccess = () => ok('opened'); r.onerror = () => no(new Error('idb')) }))
      await tryit('import', () => import('/db/state?${token}=wi'))
      await tryit('importScripts', () => importScripts('/db/state?${token}=ws'))
      await tryit('ws', () => new Promise((ok, no) => { const w = new WebSocket('ws://' + location.host + '/db/state?${token}=ww'); w.onopen = () => ok('open'); w.onerror = () => no(new Error('ws')) }))
      postMessage(out)
      })()
    ${'`'}
    ;(async () => {
      await tryit('fetch', () => fetch('/db/state?${token}=f'))
      await tryit('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', '/db/state?${token}=x'); x.onload = () => ok(x.status); x.onerror = () => no(new Error('xhr')); x.send() }))
      await tryit('indexedDB', () => new Promise((ok, no) => { const r = indexedDB.open('dojo-disk'); r.onsuccess = () => ok('opened'); r.onerror = () => no(new Error('idb')) }))
      await tryit('localStorage', () => localStorage.getItem('dojo.writer'))
      await tryit('cookie', () => document.cookie)
      await tryit('parent.document', () => window.parent.document.title)
      await tryit('parent.localStorage', () => window.parent.localStorage.length)
      await tryit('top.location', () => window.top.location.href)
      await tryit('import', () => import('/db/state?${token}=i'))
      await tryit('script', () => new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/db/state?${token}=s'; s.onload = () => ok('loaded'); s.onerror = () => no(new Error('script')); document.head.appendChild(s) }))
      const w = new Worker(URL.createObjectURL(new Blob([suite], { type: 'text/javascript' })))
      const worker = await new Promise(ok => { w.onmessage = e => ok(e.data); w.onerror = e => ok({ error: String(e.message) }); setTimeout(() => ok({ timeout: true }), 8000) })
      parent.postMessage({ probe: true, out, worker }, '*')
    })()
  `
  await page.route('**/pyrunner/probe.html', route => route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': frameCsp(srv.url), 'access-control-allow-origin': '*' }, body: '<!doctype html><script src="/pyrunner/probe.js"></script>' }))
  await page.route('**/pyrunner/probe.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: probe }))
  await page.evaluate(() => { (window as unknown as { __probe: unknown }).__probe = null; window.addEventListener('message', e => { if (e.data?.probe) (window as unknown as { __probe: unknown }).__probe = e.data }) })
  const before = await (await fetch(`${srv.url}/db/state`)).text()
  const seen = record(ctx)
  await page.evaluate(() => { const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.src = '/pyrunner/probe.html'; document.body.appendChild(f) })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __probe: unknown }).__probe), { timeout: 20_000 }).not.toBeNull()
  const got = (await page.evaluate(() => (window as unknown as { __probe: { out: Record<string, string>; worker: Record<string, string> } }).__probe))
  console.log('PROBE frame', JSON.stringify(got.out), 'worker', JSON.stringify(got.worker))
  for (const [k, v] of [...Object.entries(got.out), ...Object.entries(got.worker)]) expect(v, k).not.toMatch(/REACHED/)
  expect(Object.keys(got.out)).toEqual(expect.arrayContaining(['fetch', 'xhr', 'indexedDB', 'localStorage', 'cookie', 'parent.document', 'parent.localStorage', 'top.location', 'import', 'script']))
  expect(Object.keys(got.worker)).toEqual(expect.arrayContaining(['fetch', 'xhr', 'indexedDB', 'import', 'importScripts', 'ws']))
  for (const k of ['indexedDB', 'localStorage', 'cookie', 'parent.document', 'parent.localStorage', 'top.location']) expect(got.out[k], k).toMatch(/Error$/)
  const probed = seen.filter(r => r.url.includes(token))
  console.log('PROBE requests recorded', JSON.stringify(probed))
  expect(probed.filter(r => r.status !== undefined || !r.failed), 'no probe request got a response').toEqual([])
  expect(await (await fetch(`${srv.url}/db/state`)).text()).toBe(before)
  await ctx.close()
})

test('attack M1: learner code that patches the harness, reads its frames or runs JS cannot forge a pass or open the gate', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await useLanguage(page, 'Python')
  const forge = `import sys, builtins

def attempt(name, f):
    try:
        r = f()
        print(name + ": OK " + repr(r)[:80])
    except BaseException as e:
        print(name + ": " + type(e).__name__)

def patch_harness():
    import dojo_harness
    dojo_harness._same = lambda a, b: True
    dojo_harness.run = lambda *a, **k: '{"status":"ok","cases":[],"errors":[],"stdout":"","steps":[],"truncated":false,"ms":1}'
    return "patched"

def run_js_forge():
    from pyodide.code import run_js
    return run_js('JSON.parse = () => ({status: "ok", cases: [], errors: [], stdout: "", steps: [], truncated: false, ms: 1}); self.postMessage = () => 1; 7')

def pyodide_js_eval():
    import pyodide_js
    return pyodide_js.eval("1 + 1")

def function_ctor():
    import pyodide_js
    F = pyodide_js.__proto__.constructor.constructor   # Function, reached through the Pyodide API object
    return F("return 40 + 2")()

def frames():
    f = sys._getframe(1)
    names = []
    while f:
        names.append(sorted(f.f_locals.keys()))
        f = f.f_back
    return str(names).count("expected")

def numDecodings(s):
    attempt("patch_harness", patch_harness)
    attempt("run_js", run_js_forge)
    attempt("pyodide_js.eval", pyodide_js_eval)
    attempt("function_ctor", function_ctor)
    attempt("frames_with_expected", frames)
    return -7   # wrong on every case
`
  await setCode(page, forge, 'py')
  await submit(page)
  await expect(status(page)).toHaveText('Failed 0/5', { timeout: 60_000 })
  for (let k = 1; k <= 5; k++) await expect(page.getByTestId(`run-case-${k}`)).toHaveAttribute('data-pass', 'false')
  const out = await page.getByTestId('run-stdout').innerText()
  console.log('ATTACK M1 stdout:', JSON.stringify(out))
  expect(out).not.toMatch(/run_js: OK|pyodide_js\.eval: OK|function_ctor: OK/)
  expect(out).toMatch(/function_ctor: ModuleNotFoundError/) // pyodide_js is hidden; (without that, new Function() is refused by the frame CSP: no unsafe-eval)
  expect(out).toMatch(/frames_with_expected: OK 0/) // `expected` is not in any frame of the worker
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled()
  await expect(page.getByTestId('do-outcome-help')).toBeDisabled()
  await ctx.close()
})

test('attack M2: nothing a run patches survives into the next run', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await useLanguage(page, 'Python')
  await setCode(page, `import builtins, json, sys
builtins.LEAK = 1
builtins.len = lambda x: 0
json.dumps = lambda *a, **k: "garbage"
sys.modules["leak"] = sys
def numDecodings(s):
    return 0
`, 'py')
  await run(page)
  await expect(status(page)).toHaveText(/^(Runtime error|Failed 0\/2)$/, { timeout: 60_000 })
  // run 2: correct code, which also reports what it can see of run 1
  await setCode(page, P91_OK.replace('def numDecodings(s: str) -> int:\n', 'import builtins, json, sys\ndef numDecodings(s: str) -> int:\n    print(hasattr(builtins, "LEAK"), builtins.len([1]), json.dumps(1), "leak" in sys.modules)\n'), 'py')
  await run(page)
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })
  await expect(page.getByTestId('run-stdout')).toHaveText(/^False 1 1 False\n/)
  // run 3: wrong code still fails
  await setCode(page, P91_WRONG, 'py')
  await run(page)
  await expect(status(page)).toHaveText('Failed 1/2', { timeout: 60_000 })
  await expect(page.getByTestId('do-outcome-solved')).toBeDisabled()
  await ctx.close()
})

test('L-a/L-b: code over 64 KiB is refused with a message; a frame answers an over-cap request; a huge answer is "Output too large"', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await useLanguage(page, 'Python')
  await page.getByRole('textbox', { name: 'Code' }).fill('# ' + 'x'.repeat(65 * 1024) + '\ndef numDecodings(s: str) -> int:\n    return 0\n')
  await run(page)
  await expect(status(page)).toHaveText('Your code is over 64 KiB.')
  await expect(page.locator('iframe[data-testid="py-frame"]')).toHaveCount(0)
  // the frame itself answers a well-formed request that is over the cap (a bypassing page cannot hang on it)
  const reply = await page.evaluate(async () => {
    const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.src = '/pyrunner/frame.html'; document.body.appendChild(f)
    return new Promise<unknown>(ok => {
      window.addEventListener('message', e => {
        if (e.data?.type === 'hello') f.contentWindow!.postMessage({ dojo: 'py', type: 'run', id: 'big', code: 'x'.repeat(70 * 1024), fn: 'f', sig: 'def f(s)', cases: [{ id: 1, call: 'f("a")', expected: 1 }] }, '*')
        if (e.data?.type === 'result') ok(e.data)
      })
      setTimeout(() => ok('timeout'), 15000)
    })
  }) as { id: string; result: { status: string; errors: { message: string }[] } }
  expect(reply.id).toBe('big')
  expect(reply.result.status).toBe('compile_error')
  expect(reply.result.errors[0].message).toBe('Your code is over 64 KiB')
  await setCode(page, 'def numDecodings(s: str) -> int:\n    return "x" * (20 * 1024 * 1024)\n', 'py')
  await run(page)
  await expect(status(page)).toHaveText('Output too large', { timeout: 30_000 })
  await ctx.close()
})

test('PY-08: a bottom-up Python solution draws the same table and recurrence as Go', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await useLanguage(page, 'Python')
  await setCode(page, P91_TABLE, 'py')
  await submit(page)
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 60_000 })
  const view = page.getByTestId('dp-view')
  const counter = view.getByTestId('dp-step-counter')
  const text = (await counter.textContent())!
  const N = Number(/Step (\d+) \/ (\d+)/.exec(text)![2])
  expect(text).toBe(`Step ${N} / ${N}`)
  const want = 'dp[3] = dp[2] + dp[1] = 2 + 1 = 3'
  await view.getByRole('slider', { name: 'Step' }).fill('1')
  let found = false
  for (let k = 1; k <= N; k++) {
    if ((await view.getByTestId('dp-recurrence').textContent()) === want) { found = true; break }
    await view.getByRole('button', { name: 'Next step' }).click()
  }
  expect(found).toBe(true)
  await expect(view.getByTestId('dp-cell-0-3')).toHaveAttribute('data-state', 'current')
  await expect(view.getByTestId('dp-cell-0-2')).toHaveAttribute('data-dep', 'true')
  await expect(view.getByTestId('dp-cell-0-1')).toHaveAttribute('data-dep', 'true')
  await expect(view.getByTestId('dp-cell-0-3')).toHaveText('3')
  await expect(view.getByTestId('dp-cell-0-4')).toHaveCount(0)
  await expect(view.getByTestId('dp-cell-0-0')).toHaveAttribute('data-state', 'set')
  await view.getByRole('button', { name: 'Next step' }).click()
  await expect(view.getByTestId('dp-recurrence')).toHaveText('')
  await ctx.close()
})

test('PY-09: a top-down Python solution draws the call tree, cache hits and the cell links', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  await useLanguage(page, 'Python')
  await setCode(page, P91_MEMO, 'py')
  await submit(page)
  await expect(status(page)).toHaveText('Passed 5/5', { timeout: 60_000 })
  const tree = page.getByTestId('dp-tree')
  const nodes = tree.locator('[data-testid^="dp-node-"]')
  expect(await tree.locator('[data-hit="true"]').count()).toBeGreaterThan(0)
  await expect(tree.locator('[data-hit="true"]').first()).toHaveText(/^f\(\d+\) \(cached\)$/)
  await expect(nodes.filter({ hasText: /^f\(3\)/ }).first()).toHaveText('f(3) → 3')
  await page.getByTestId('dp-cell-0-1').click()
  await expect(page.getByTestId('dp-cell-0-1')).toHaveAttribute('aria-pressed', 'true')
  const f1 = nodes.filter({ hasText: /^f\(1\)/ })
  expect(await f1.count()).toBeGreaterThan(1)
  for (const n of await f1.all()) await expect(n).toHaveAttribute('data-linked', 'true')
  await expect(nodes.filter({ hasText: /^f\(2\)/ }).first()).toHaveAttribute('data-linked', 'false')
  await nodes.filter({ hasText: /^f\(2\)/ }).first().click()
  await expect(page.getByTestId('dp-cell-0-2')).toHaveAttribute('data-linked', 'true')
  await ctx.close()
})

test('PY-10: each language keeps its own source after a reload and in a fresh context, and the panel reopens on the last choice', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p198')
  const go = 'package main\n\n// my go\nfunc rob(nums []int) int {\n\treturn len(nums)\n}\n'
  const py = 'def rob(nums: list[int]) -> int:\n    # my python\n    return len(nums)\n'
  await setCode(page, go, 'go')
  await useLanguage(page, 'Python')
  await expect(page.getByRole('textbox', { name: 'Code' })).toContainText('def rob(nums: list[int]) -> int:')
  await setCode(page, py, 'py')
  await expect.poll(async () => (await rows(srv, 'code')).filter(r => r.ticketId === 'p198').map(r => [r.lang, !!r.lastLang]).sort()).toEqual([['go', false], ['py', true]])
  const goRow = (await rows(srv, 'code')).find(r => r.ticketId === 'p198' && r.lang === 'go')!
  expect(goRow.source).toBe(go)
  expect(typeof goRow.updatedAt).toBe('number')
  await page.reload()
  await expect(language(page, 'Python')).toBeChecked() // the last-chosen language
  await expect(page.getByRole('textbox', { name: 'Code' })).toContainText('# my python')
  await useLanguage(page, 'Go')
  await expect(page.getByRole('textbox', { name: 'Code' })).toContainText('// my go')
  await expect.poll(async () => (await rows(srv, 'code')).find(r => r.ticketId === 'p198' && r.lang === 'go')?.lastLang).toBe(true)
  const fresh = await reopen(browser, srv)
  await openDo(fresh.page, 'p198')
  await expect(language(fresh.page, 'Go')).toBeChecked()
  await expect(fresh.page.getByRole('textbox', { name: 'Code' })).toContainText('// my go')
  await useLanguage(fresh.page, 'Python')
  await expect(fresh.page.getByRole('textbox', { name: 'Code' })).toContainText('# my python')
  await fresh.ctx.close()
  await ctx.close()
})

test('PY-15: a Part 4a-style Go row (id = ticketId, no lang, no lastLang) opens on Go intact, and the next save writes <ticketId>:go', async ({ browser }) => {
  const legacy = { ticketId: 'p198', source: 'package main\n\n// from part 4a\nfunc rob(nums []int) int {\n\treturn 0\n}\n', updatedAt: 1_700_000_000_000 }
  const res = await fetch(`${srv.url}/db/ops`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': srv.token() },
    body: JSON.stringify({ clientId: 'part-4a', ops: [{ opId: randomUUID(), tbl: 'code', op: 'put', id: 'p198', doc: legacy, at: new Date().toISOString() }] }),
  })
  expect(res.ok).toBe(true)
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p198')
  await expect(language(page, 'Go')).toBeChecked()
  await expect(page.getByRole('textbox', { name: 'Code' })).toContainText('// from part 4a')
  const next = legacy.source.replace('return 0', 'return 1')
  await setCode(page, next, 'go')
  const mine = (await rows(srv, 'code')).filter(r => r.ticketId === 'p198' && r.lang === 'go')
  expect(mine).toHaveLength(1)
  expect(mine[0].source).toBe(next)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Code' })).toContainText('return 1')
  await ctx.close()
})

test('PY-11: the first Python run says "Loading Python…" and no request leaves the app origin', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  await openDo(page, 'p91')
  const seen = record(ctx)
  await useLanguage(page, 'Python')
  await page.waitForTimeout(300)
  expect(seen.filter(r => /\/pyodide\//.test(r.url)), 'choosing Python loads nothing').toEqual([])
  await setCode(page, P91_OK, 'py')
  await run(page)
  await expect(status(page)).toHaveText('Loading Python…')
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })
  await run(page)
  await expect(status(page)).not.toHaveText('Loading Python…')
  await expect(status(page)).toHaveText('Passed 2/2', { timeout: 60_000 })
  expect(seen.some(r => r.url.includes('/pyodide/pyodide.asm.wasm'))).toBe(true)
  const allowed = new Set([new URL(srv.url).origin]) // fonts are self-hosted
  const foreign = seen.map(r => r.url).filter(u => /^https?:/.test(u) && !allowed.has(new URL(u).origin))
  expect(foreign).toEqual([])
  await ctx.close()
})

test('PY-12: every pack passes a Python Submit 5/5 with its classic solution', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, srv)
  for (const id of ['p91', 'p198', 'p322', 'p62', 'p1143']) {
    await openDo(page, id)
    if (!(await language(page, 'Python').isChecked())) await useLanguage(page, 'Python')
    await setCode(page, CLASSIC[id], 'py')
    await submit(page)
    await expect(status(page), id).toHaveText('Passed 5/5', { timeout: 60_000 })
    await expect(page.getByTestId('do-outcome-solved')).toBeEnabled()
  }
  await ctx.close()
})

test('PY-13: a read-only browser gets the Read-only toast on a Python Run, and the runtime does not start', async ({ browser }) => {
  const w = await openApp(browser, srv)
  await w.ctx.close()
  const ctx = await browser.newContext({ baseURL: srv.url, timezoneId: 'Asia/Kolkata' })
  const seen = record(ctx)
  const page = await ctx.newPage()
  await page.goto('/do/p322')
  await expect(page.getByTestId('readonly-banner')).toBeVisible()
  await expect(page.getByTestId('code-panel')).toBeVisible()
  await useLanguage(page, 'Python')
  const toasts = page.getByTestId('toast')
  await run(page)
  await expect(toasts).toHaveCount(1)
  await expect(toasts.first()).toHaveText(/^Read-only/)
  await expect(toasts).toHaveCount(0)
  await submit(page)
  await expect(toasts).toHaveCount(1)
  await expect(toasts.first()).toHaveText(/^Read-only/)
  await page.waitForTimeout(500)
  expect(seen.filter(r => /\/(pyodide|pyrunner)\//.test(r.url))).toEqual([])
  await expect(page.locator('iframe')).toHaveCount(0)
  await ctx.close()
})

test('PY-14: the entry chunk stays within 480,000 B, and Python loads only on a Python run', async ({ browser }) => {
  const dist = process.env.DOJO_E2E_DIST!
  const entries = entryChunks(readFileSync(join(dist, 'index.html'), 'utf8'))
  expect(entries.length).toBeGreaterThan(0)
  for (const f of entries) expect(statSync(join(dist, f)).size, f).toBeLessThanOrEqual(ENTRY_BUDGET_BYTES)
  expect(ENTRY_BUDGET_BYTES).toBe(480_000)
  const { ctx, page } = await openApp(browser, srv)
  const seen = record(ctx)
  await openDo(page, 'p91')
  await page.waitForTimeout(300)
  expect(seen.filter(r => /\/(pyodide|pyrunner)\//.test(r.url))).toEqual([])
  await ctx.close()
})

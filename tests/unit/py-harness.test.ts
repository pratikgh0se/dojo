// @vitest-environment node
// C-PYTHON §1/§2/§3: the Python harness and dojo.tk, run for real in Pyodide under Node.
import { describe, expect, it } from 'vitest'
import { diffText, errorText, statusText } from '../../src/runner/status'
import { runPy } from '../helpers/pyRun'

const OK = `def numDecodings(s: str) -> int:
    prev2, prev1 = 1, (0 if s[0] == '0' else 1)
    for i in range(2, len(s) + 1):
        cur = 0
        if s[i-1] != '0':
            cur += prev1
        if s[i-2] == '1' or (s[i-2] == '2' and s[i-1] <= '6'):
            cur += prev2
        prev2, prev1 = prev1, cur
    return prev1
`

describe('cases', () => {
  it('passes a correct solution on all five p91 cases', async () => {
    const r = await runPy(OK, 'p91', 5)
    expect(r.status).toBe('ok')
    expect(statusText(r)).toBe('Passed 5/5')
    expect(r.cases.map(c => [c.id, c.got, c.pass])).toEqual([[1, 2, true], [2, 3, true], [3, 0, true], [4, 2, true], [5, 4, true]])
    expect(r.cases[1]).toMatchObject({ call: 'numDecodings("226")', expected: 3 })
    expect(r.errors).toEqual([])
    expect(r.truncated).toBe(false)
  })

  it('PY-02: the wrong p91 fails 1/2 with the pinned diff', async () => {
    const r = await runPy('def numDecodings(s):\n    if len(s) <= 2: return len(s)\n    return len(s) + 1\n')
    expect(statusText(r)).toBe('Failed 1/2')
    expect(r.cases.map(c => c.pass)).toEqual([true, false])
    expect(diffText(r.cases[1])).toBe('numDecodings("226"): expected 3, got 4')
  })

  it('parses array and multi-argument calls from the pack text', async () => {
    const r = await runPy('def coinChange(coins, amount):\n    return len(coins) * 100 + amount\n', 'p322', 2)
    expect(r.cases.map(c => c.got)).toEqual([311, 101 * 1 + 2])
    const l = await runPy('def longestCommonSubsequence(text1, text2):\n    return len(text1) + len(text2)\n', 'p1143', 2)
    expect(l.cases.map(c => [c.call, c.got])).toEqual([['longestCommonSubsequence("abcde", "ace")', 8], ['longestCommonSubsequence("abc", "abc")', 6]])
  })

  it('shows nothing for a function that returns None, and ints for whole floats', async () => {
    const none = await runPy('def numDecodings(s):\n    pass\n')
    expect(none.cases.map(c => c.got)).toEqual([null, null])
    expect(statusText(none)).toBe('Failed 0/2')
    const fl = await runPy('def numDecodings(s):\n    return {"12": 2.0, "226": 3.5}[s]\n')
    expect(fl.cases.map(c => [c.got, c.pass])).toEqual([[2, true], [3.5, false]])
    const b = await runPy('def numDecodings(s):\n    return True\n')
    expect(b.cases.map(c => c.pass)).toEqual([false, false])
  })
})

describe('errors', () => {
  it('PY-03: a SyntaxError is a compile error at the learner line', async () => {
    const r = await runPy('def numDecodings(s):\n    x = 1\n    return (x +\n')
    expect(r.status).toBe('compile_error')
    expect(statusText(r)).toBe('Compile error')
    expect(r.errors).toHaveLength(1)
    expect(errorText(r.errors[0])).toMatch(/^line 3: /)
    expect(r.cases.every(c => !c.pass && c.got === null)).toBe(true)
  })

  it('an IndentationError is a compile error too', async () => {
    const r = await runPy('def numDecodings(s):\nreturn 1\n')
    expect(r.status).toBe('compile_error')
    expect(errorText(r.errors[0])).toMatch(/^line 2: .*indent/i)
  })

  it('PY-04: an exception is a runtime error with the learner line and type', async () => {
    const r = await runPy('def numDecodings(s):\n    raise ValueError("boom")\n')
    expect(r.status).toBe('runtime_error')
    expect(statusText(r)).toBe('Runtime error')
    expect(r.errors.map(errorText)).toEqual(['line 2: ValueError: boom']) // both cases raised the same: listed once
    expect(r.cases.every(c => c.got === null)).toBe(true)
  })

  it('every case runs: one that raises does not stop the next; distinct errors are each listed once', async () => {
    const r = await runPy('def numDecodings(s):\n    if s == "12":\n        raise KeyError("a")\n    if s == "226":\n        return 3\n    return 0\n', 'p91', 5)
    expect(r.status).toBe('runtime_error')
    expect(r.cases.map(c => [c.got, c.pass])).toEqual([[null, false], [3, true], [0, true], [0, false], [0, false]])
    expect(r.errors.map(errorText)).toEqual(["line 3: KeyError: 'a'"])
    const two = await runPy('def numDecodings(s):\n    if s == "12":\n        raise KeyError("a")\n    raise ValueError(s)\n', 'p91', 3)
    expect(two.errors.map(errorText)).toEqual(["line 3: KeyError: 'a'", 'line 4: ValueError: 226', 'line 4: ValueError: 06'])
  })

  it('maps the line through helpers', async () => {
    const r = await runPy('def helper(s):\n    return 1 // (len(s) - 3)\n\ndef numDecodings(s):\n    return helper(s) + 2\n')
    expect(r.status).toBe('runtime_error')
    expect(errorText(r.errors[0])).toMatch(/^line 2: ZeroDivisionError: /)
    expect(r.cases.map(c => c.got)).toEqual([1, null])
  })

  it('a missing function is a compile error naming the signature; an error at module level is a runtime error', async () => {
    const miss = await runPy('x = 1\n')
    expect(miss.status).toBe('compile_error')
    expect(miss.errors.map(errorText)).toEqual(['Define a function named numDecodings: def numDecodings(s: str) -> int:'])
    const top = await runPy('import nope_not_a_module\ndef numDecodings(s):\n    return 0\n')
    expect(top.status).toBe('runtime_error')
    expect(top.errors[0]).toMatchObject({ line: 1 })
    expect(top.errors[0].message).toMatch(/^ModuleNotFoundError: /)
  })

  it('a MemoryError is memory_limit ("Out of memory")', async () => {
    const r = await runPy('def numDecodings(s):\n    x = [0] * (2 ** 29)\n    return 0\n')
    expect(r.status).toBe('memory_limit')
    expect(statusText(r)).toBe('Out of memory')
  })

  it('SystemExit and bare except cannot end the run quietly', async () => {
    const r = await runPy('import sys\ndef numDecodings(s):\n    sys.exit(3)\n')
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0].message).toBe('SystemExit: 3')
  })
})

describe('stdout', () => {
  it('collects prints, and stderr, in order', async () => {
    const r = await runPy('import sys\ndef numDecodings(s):\n    print("hi", s)\n    print("err", file=sys.stderr)\n    return 0\n')
    expect(r.stdout).toBe('hi 12\nerr\nhi 226\nerr\n')
  })

  it('Addendum 2 Q2: past 64 KiB the first 64 KiB are kept, then "… (output truncated)"', async () => {
    const r = await runPy('def numDecodings(s):\n    print("y" * (100 * 1024), end="")\n    return 0\n', 'p91', 1)
    expect(r.status).toBe('ok')
    expect(r.stdout).toBe(`${'y'.repeat(64 * 1024)}\n… (output truncated)`)
  })

  it('PY-06: more than 1 MiB is output_limit, even when the learner swallows the error', async () => {
    const r = await runPy('def numDecodings(s):\n    print("x" * (5 * 1024 * 1024))\n    return 0\n')
    expect(r.status).toBe('output_limit')
    expect(statusText(r)).toBe('Output too large')
    expect(r.stdout.length).toBeLessThanOrEqual(64 * 1024 + 32)
    expect(r.stdout.endsWith('\n… (output truncated)')).toBe(true)
    const swallowed = await runPy('def numDecodings(s):\n    try:\n        print("x" * (2 * 1024 * 1024))\n    except BaseException:\n        pass\n    return 3\n')
    expect(swallowed.status).toBe('output_limit')
  })

  it('exactly under the cap is fine', async () => {
    const r = await runPy('def numDecodings(s):\n    print("x" * 1000)\n    return 0\n')
    expect(r.status).toBe('ok')
  })

  it('input() ends with EOFError, not a hang', async () => {
    const r = await runPy('def numDecodings(s):\n    return int(input())\n')
    expect(r.errors[0].message).toMatch(/^EOFError/)
  })
})

describe('isolation inside the program', () => {
  it('pyodide.http and urllib fail inside the program; js is importable', async () => {
    const r = await runPy(`import js, urllib.request
def numDecodings(s):
    out = []
    for name, f in [
        ("pyfetch", lambda: __import__("pyodide.http", fromlist=["pyfetch"]).pyfetch("/db/state")),
        ("urllib", lambda: urllib.request.urlopen("http://127.0.0.1:8985/db/state", timeout=1)),
    ]:
        try:
            f()
            out.append(name + ": reached")
        except Exception as e:
            out.append(name + ": " + type(e).__name__)
    print("|".join(out))
    return 0
`)
    expect(r.status).toBe('ok')
    expect(r.stdout.split('\n')[0]).toBe('pyfetch: OSError|urllib: URLError')
  })
})

describe('pyodide_js is hidden from learner code (L-c)', () => {
  it('cannot be imported, and the run still finishes with its output', async () => {
    const r = await runPy(`def numDecodings(s):
    out = []
    for name in ["pyodide_js", "pyodide_js.FS", "micropip"]:
        try:
            __import__(name)
            out.append(name + ": imported")
        except BaseException as e:
            out.append(name + ": " + type(e).__name__)
    try:
        from pyodide_js import loadPackage
        out.append("from: imported")
    except BaseException as e:
        out.append("from: " + type(e).__name__)
    print("|".join(out))
    return 2 if s == "12" else 3
`)
    expect(r.status).toBe('ok')
    expect(r.stdout.split('\n')[0]).toBe('pyodide_js: ModuleNotFoundError|pyodide_js.FS: ModuleNotFoundError|micropip: ModuleNotFoundError|from: ModuleNotFoundError')
    expect(r.cases.map(c => c.pass)).toEqual([true, true])
  })
  it('the toolkit and stdlib still work after hiding it', async () => {
    const r = await runPy('import json, math\nfrom dojo import tk\ndef numDecodings(s):\n    t = tk.Table("a", 1, 2)\n    t.Set(0, 1, 5)\n    return int(math.sqrt(4)) + len(json.dumps([1])) - 3\n')
    expect(r.status).toBe('ok')
    expect(r.steps.length).toBeGreaterThan(0)
  })
})

describe('dojo.tk events (C-PYTHON §2)', () => {
  const TABLE = `from dojo import tk
def numDecodings(s):
    t = tk.Table("dp", 1, len(s) + 1)
    t.Set(0, 0, 1)
    t.Set(0, 1, 1)
    for i in range(2, len(s) + 1):
        t.Set(0, i, t.Get(0, i - 1) + t.Get(0, i - 2), tk.Dep(0, i - 1), tk.Dep(0, i - 2), tk.Rule("{0} + {1}"))
    return t.Get(0, len(s))
`
  it('records table, set (deps, rule), get in program order, with case markers', async () => {
    const r = await runPy(TABLE)
    expect(r.steps.slice(0, 5)).toEqual([
      { op: 'table', t: 0, rows: 1, cols: 3, name: 'dp', case: 1 },
      { op: 'set', t: 0, i: 0, j: 0, v: 1, deps: [] },
      { op: 'set', t: 0, i: 0, j: 1, v: 1, deps: [] },
      { op: 'get', t: 0, i: 0, j: 1, v: 1 },
      { op: 'get', t: 0, i: 0, j: 0, v: 1 },
    ])
    expect(r.steps[5]).toEqual({ op: 'set', t: 0, i: 0, j: 2, v: 2, deps: [[0, 1], [0, 0]], rule: '{0} + {1}' })
    const second = r.steps.find(s => s.op === 'table' && s.t === 1)
    expect(second).toMatchObject({ name: 'dp', cols: 4, case: 2 })
  })

  it('records enter, hit, exit and link', async () => {
    const r = await runPy(`from dojo import tk
memo = {}
def f(i):
    if i in memo:
        tk.Hit("f", i)
        return memo[i]
    tk.Enter("f", i)
    v = 1 if i <= 1 else f(i - 1) + f(i - 2)
    memo[i] = v
    tk.Exit(v)
    return v
def numDecodings(s):
    memo.clear()
    tk.Link("f", "dp")
    tk.Table("dp", 1, 5)
    return f(len(s))
`)
    expect(r.steps[0]).toEqual({ op: 'link', fn: 'f', table: 'dp', case: 1 })
    expect(r.steps[1]).toMatchObject({ op: 'table', name: 'dp' })
    expect(r.steps[2]).toEqual({ op: 'enter', fn: 'f', args: [2] })
    expect(r.steps.some(s => s.op === 'hit')).toBe(true)
    expect(r.steps.filter(s => s.op === 'exit').length).toBeGreaterThan(0)
    const r5 = await runPy(`from dojo import tk
def numDecodings(s):
    tk.Enter("g", 1, 2)
    tk.Hit("g", 1, 2)
    tk.Exit(7)
    return 0
`)
    expect(r5.steps.slice(0, 3)).toEqual([{ op: 'enter', fn: 'g', args: [1, 2], case: 1 }, { op: 'hit', fn: 'g', args: [1, 2] }, { op: 'exit', v: 7 }])
  })

  it('caps events at 20000, marks truncated, and the run still finishes ok', async () => {
    const r = await runPy('from dojo import tk\ndef numDecodings(s):\n    t = tk.Table("dp", 1, 10)\n    for i in range(30000):\n        t.Set(0, i % 10, i)\n    return t.Get(0, 0)\n')
    expect(r.steps).toHaveLength(20000)
    expect(r.truncated).toBe(true)
    expect(r.status).toBe('ok')
  })

  it('an out-of-range cell is an IndexError at the learner line; Grid records nothing (C-VISUAL §1)', async () => {
    const r = await runPy('from dojo import tk\ndef numDecodings(s):\n    t = tk.Table("dp", 1, 3)\n    t.Set(0, 3, 1)\n    return 0\n')
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0]).toMatchObject({ line: 4 })
    expect(r.errors[0].message).toBe('IndexError: tk: Set dp[0][3] is outside the 1x3 table')
    const o = await runPy('from dojo import tk\ndef numDecodings(s):\n    g = tk.Grid(2, 2); g.Set(1, 1, 5); g.Visit(0, 0)\n    return g.Get(1, 1)\n')
    expect(o.cases[0].got).toBe(5)
    expect(o.steps).toEqual([])
    // the Part 4a placeholders are replaced (C-VISUAL §1)
    const gone = await runPy('from dojo import tk\ndef numDecodings(s):\n    return int(hasattr(tk, "NewQueue")) + int(hasattr(tk, "NewHeap"))\n')
    expect(gone.cases[0].got).toBe(0)
  })

  it('a fresh run starts from a fresh toolkit (no leaked events or table ids)', async () => {
    await runPy(TABLE)
    const r = await runPy(TABLE)
    expect(r.steps[0]).toMatchObject({ op: 'table', t: 0 })
  })
})

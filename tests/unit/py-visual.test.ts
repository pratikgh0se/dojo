// @vitest-environment node
// C-VISUAL §1–§2 and §5 in Python: dojo.tk's families, the list and tree types, null in calls, array results
// and the judge, run for real in Pyodide under Node.
import { describe, expect, it } from 'vitest'
import { diffText, errorText, statusText } from '../../src/runner/status'
import { loadJudge, pyodide, runPy, runWorker } from '../helpers/pyRun'

/** Runs `body` with a fresh dojo.tk bound to `tk`; it sets `result`, returned as JSON (with tk's events as `events`). */
async function withTk(body: string): Promise<{ result: unknown; events: Record<string, unknown>[]; truncated: boolean }> {
  const p = await pyodide()
  p.globals.set('_body', body)
  return JSON.parse(p.runPython(`
import json, types
tk = types.ModuleType("tk_test")
exec(_tk_src, tk.__dict__)
_ns = {"tk": tk, "result": None}
exec(_body, _ns)
json.dumps({"result": _ns["result"], "events": tk._st.events, "truncated": tk._st.truncated})
`) as string)
}

/** The exception a snippet raises, as "Type: message". */
async function raises(body: string): Promise<string> {
  const r = await withTk(`try:\n${body.split('\n').map(l => `    ${l}`).join('\n')}\n    result = "no error"\nexcept Exception as e:\n    result = "%s: %s" % (type(e).__name__, e)\n`)
  return r.result as string
}

describe('working structures (§1)', () => {
  it('Heap: min by (prio, key), the pinned sift rules, Pop and Peek return (key, prio)', async () => {
    const r = await withTk(`
h = tk.Heap("pq")
for k, p in [(5, 5), (3, 3), (4, 3), (1, 9), (2, 3)]:
    h.Push(k, p)
arr = [list(x) for x in h._a]
peek = h.Peek()
order = [h.Pop() for _ in range(h.Len())]
t = tk.Heap("t")
for k, p in [(0, 0), (1, 1), (1, 1), (9, 9)]:
    t.Push(k, p)
t.Pop()
result = {"arr": arr, "peek": list(peek), "order": [list(x) for x in order], "tie": [list(x) for x in t._a]}
`)
    // _a holds (prio, key)
    expect(r.result).toEqual({
      arr: [[3, 2], [3, 3], [3, 4], [9, 1], [5, 5]], peek: [2, 3],
      order: [[2, 3], [3, 3], [4, 3], [5, 5], [1, 9]], tie: [[1, 1], [9, 9], [1, 1]],
    })
    expect(r.events.slice(0, 2)).toEqual([{ op: 'heap', sid: 0, act: 'new', name: 'pq' }, { op: 'heap', sid: 0, act: 'push', key: 5, prio: 5 }])
    expect(await raises('h = tk.Heap("pq")\nh.Pop()')).toBe('IndexError: tk: Pop on an empty heap pq')
    expect(await raises('h = tk.Heap("pq")\nh.Peek()')).toBe('IndexError: tk: Peek on an empty heap pq')
  })

  it('Addendum 4: a DSU has at most 5,000,000 elements, built sparsely (no list of n)', async () => {
    expect(await raises('tk.DSU("u", 5000001)')).toBe('ValueError: tk: dsu u size 5000001 is over 5000000')
    const r = await withTk('import time\nt0 = time.time()\nu = tk.DSU("u", 5000000)\nok = u.Union(4999999, 1)\nresult = [ok, u.Find(1), time.time() - t0 < 0.05, len(u._parent)]')
    expect(r.result).toEqual([true, 4999999, true, 1])
  })

  it('Queue: FIFO, Pop on empty raises', async () => {
    const r = await withTk('q = tk.Queue("q")\nq.Push(1)\nq.Push(2)\nresult = [q.Pop(), q.Len()]')
    expect(r.result).toEqual([1, 1])
    expect(r.events.map(e => e.act)).toEqual(['new', 'push', 'push', 'pop'])
    expect(await raises('q = tk.Queue("q")\nq.Pop()')).toBe('IndexError: tk: Pop on an empty queue q')
  })

  it('DSU: union by size, b\'s root under a\'s on a tie, full path compression', async () => {
    const r = await withTk(`
uf = tk.DSU("uf", 6)
a = uf.Union(1, 2)
p1 = [uf._parent.get(i, i) for i in range(6)]
uf.Union(3, 1)
uf.Union(4, 5)
uf.Union(5, 2)
p2 = [uf._parent.get(i, i) for i in range(6)]
f = uf.Find(5)
p3 = [uf._parent.get(i, i) for i in range(6)]
result = [a, p1, p2, f, p3, uf.Union(2, 3)]
`)
    expect(r.result).toEqual([true, [0, 1, 1, 3, 4, 5], [0, 1, 1, 1, 1, 4], 1, [0, 1, 1, 1, 1, 1], false])
    expect(r.events.map(e => e.act)).toEqual(['new', 'union', 'union', 'union', 'union', 'find', 'union'])
    expect(await raises('uf = tk.DSU("uf", 6)\nuf.Find(6)')).toBe('IndexError: tk: 6 is outside dsu uf (0..5)')
  })
})

describe('recorders and misuse (§1–§2)', () => {
  it('the pinned Pointer misuse, and the other array checks', async () => {
    expect(await raises('a = tk.Chars("s", "abcabcbb")\na.Pointer("lo", 99)')).toBe('IndexError: tk: pointer lo → 99 is outside s (-1..8)')
    expect(await raises('a = tk.Chars("s", "abcabcbb")\na.Set(8, 1)')).toBe('IndexError: tk: index 8 is outside s (0..7)')
    expect(await raises('a = tk.Chars("s", "abcabcbb")\na.Pointer("a b", 1)')).toBe('ValueError: tk: pointer label "a b" must match [A-Za-z0-9_]{1,16}')
    expect(await raises('a = tk.Chars("s", "abcabcbb")\na.Window(0, 9)')).toBe('IndexError: tk: window [0..9] is outside s (-1..8)')
    const r = await withTk('v = [3, 1]\na = tk.Array("a", v)\nv[0] = 9\na.Swap(0, 1)\na.Pointer("lo", None)\nc = tk.Chars("s", "ab")\nc.Set(0, "z")')
    expect(r.events).toEqual([
      { op: 'array', sid: 0, act: 'new', name: 'a', values: [3, 1], chars: false },
      { op: 'array', sid: 0, act: 'swap', i: 0, j: 1 },
      { op: 'array', sid: 0, act: 'pointer', label: 'lo', i: -1 },
      { op: 'array', sid: 1, act: 'new', name: 's', values: [97, 98], chars: true },
      { op: 'array', sid: 1, act: 'set', i: 0, v: 122 },
    ])
  })

  it('list and tree misuse', async () => {
    expect(await raises('l = tk.List("l")\nl.Node(0, 1)\nl.Next(0, 5)')).toBe('ValueError: tk: list l has no node 5')
    expect(await raises('l = tk.List("l")\nl.Pointer("p", 3)')).toBe('ValueError: tk: list l has no node 3')
    expect(await raises('t = tk.Tree("t")\nt.Node(1, 2, 0, "L")')).toBe('ValueError: tk: tree t has no node 0 (the parent of 1)')
    expect(await raises('t = tk.Tree("t")\nt.Node(0, 1, None, "")\nt.Node(1, 2, 0, "L")\nt.Node(2, 3, 0, "L")')).toBe('ValueError: tk: tree t: the L side of 0 is already taken')
    expect(await raises('t = tk.Tree("t")\nt.Visit(4)')).toBe('ValueError: tk: tree t has no node 4')
    expect(await raises('g = tk.Graph("g", True)\ng.Mark(1, "x" * 65)')).toBe('ValueError: tk: mark label of 65 characters is longer than 64')
    expect(await raises('t = tk.Tree("t")\nt.Node(0, 1)\nt.Mark(0, "x" * 65)')).toBe('ValueError: tk: mark label of 65 characters is longer than 64')
    expect(await raises('iv = tk.Intervals("iv", [[1, 2]])\niv.Mark(0, "é" * 64)')).toBe('no error')
    expect(await raises('g = tk.GameTable("g")\ng.Set("0-0", "tie")')).toBe('ValueError: tk: outcome "tie" must be win, lose or draw')
    expect(await raises('g = tk.GameTable("g")\ng.Set("a b", "win")')).toBe('ValueError: tk: game state "a b" must match [A-Za-z0-9,._-]{1,32}')
    const r = await withTk('l = tk.List("l")\nl.Node(0, 1)\nl.Next(0, None)\nl.Pointer("curr", None)\nt = tk.Tree("t")\nt.Node(0, 1, -1, "")')
    expect(r.events.slice(2)).toEqual([
      { op: 'list', sid: 0, act: 'next', id: 0, next: -1 }, { op: 'list', sid: 0, act: 'pointer', label: 'curr', id: -1 },
      { op: 'tree', sid: 1, act: 'new', name: 't' }, { op: 'tree', sid: 1, act: 'node', id: 0, val: 1, parent: -1, side: '' },
    ])
  })

  it('Addendum 3: names are at most 64 characters; ints beyond 2^53 cannot be drawn', async () => {
    for (const ctor of ['tk.Graph(N, True)', 'tk.Heap(N)', 'tk.Queue(N)', 'tk.DSU(N, 1)', 'tk.Array(N, [])', 'tk.Chars(N, "")', 'tk.Search(N, 0, 1)', 'tk.List(N)', 'tk.Intervals(N, [])', 'tk.Tree(N)', 'tk.GameTable(N)']) {
      expect(await raises(`N = "n" * 65\n${ctor}`), ctor).toBe('ValueError: tk: name of 65 characters is longer than 64')
    }
    expect(await raises('tk.Heap("é" * 64)')).toBe('no error')
    expect(await raises('h = tk.Heap("h")\nh.Push(1, 2 ** 60)')).toBe('ValueError: tk: 1152921504606846976 is too large to draw (beyond ±2^53)')
    expect(await raises('h = tk.Heap("h")\nh.Push(1, 2.0 ** 60)')).toBe('ValueError: tk: 1152921504606846976 is too large to draw (beyond ±2^53)')
  })

  it('graph, search, intervals and game events have the Go fields', async () => {
    const r = await withTk(`
g = tk.Graph("g", False)
g.Edge(1, 2, 5)
g.Edge(3, 1)
g.Edge(2, 1, 7)
n = g.Neighbors(1)
g.Relax(1, 2, 5)
g.Mark(2, "in 1")
s = tk.Search("k", 1, 6)
s.Mid(3, 0)
s.Lo(4)
iv = tk.Intervals("in", [[1, 3], (2, 6)])
iv.Add(8, 10)
iv.Set(0, 1, 6)
gt = tk.GameTable("g", "0-0")
gt.Set("0-0", "win", 3)
gt.Set("1-1", "draw")
result = n
`)
    expect(r.result).toEqual([2, 3])
    expect(r.events).toEqual([
      { op: 'graph', sid: 0, act: 'new', name: 'g', directed: false },
      { op: 'graph', sid: 0, act: 'edge', u: 1, v: 2, w: 5 },
      { op: 'graph', sid: 0, act: 'edge', u: 3, v: 1 },
      { op: 'graph', sid: 0, act: 'edge', u: 2, v: 1, w: 7 },
      { op: 'graph', sid: 0, act: 'relax', u: 1, v: 2, d: 5 },
      { op: 'graph', sid: 0, act: 'mark', u: 2, label: 'in 1' },
      { op: 'search', sid: 1, act: 'new', name: 'k', lo: 1, hi: 6 },
      { op: 'search', sid: 1, act: 'mid', m: 3, pred: false },
      { op: 'search', sid: 1, act: 'lo', v: 4 },
      { op: 'intervals', sid: 2, act: 'new', name: 'in', items: [[1, 3], [2, 6]] },
      { op: 'intervals', sid: 2, act: 'add', s: 8, e: 10 },
      { op: 'intervals', sid: 2, act: 'set', i: 0, s: 1, e: 6 },
      { op: 'game', sid: 3, act: 'new', name: 'g', states: ['0-0'] },
      { op: 'game', sid: 3, act: 'set', state: '0-0', outcome: 'win', value: 3 },
      { op: 'game', sid: 3, act: 'set', state: '1-1', outcome: 'draw' },
    ])
  })

  it('one cap for DP and family events; working structures work past it', async () => {
    const r = await withTk(`
t = tk.Table("dp", 1, 1)
for i in range(15000):
    t.Set(0, 0, i)
g = tk.Graph("g", True)
for i in range(15000):
    g.Visit(i % 10)
h = tk.Heap("h")
h.Push(1, 1)
result = h.Len()
`)
    expect(r.result).toBe(1)
    expect(r.events).toHaveLength(20000)
    expect(r.truncated).toBe(true)
    expect(r.events[19999]).toMatchObject({ op: 'graph', act: 'visit' })
  })
})

describe('the harness: new types, null, arrays (§5)', () => {
  it('VF-13: unchanged p206 and p56 fail with the pinned diffs', async () => {
    const l = await runPy('def reverseList(head: ListNode | None) -> ListNode | None:\n    return head\n', 'p206', 2)
    expect(statusText(l)).toBe('Failed 0/2')
    expect(diffText(l.cases[0])).toBe('reverseList([1,2,3,4,5]): expected [5,4,3,2,1], got [1,2,3,4,5]')
    const m = await runPy('def merge(intervals):\n    return intervals\n', 'p56', 1)
    expect(diffText(m.cases[0])).toBe('merge([[1,3],[2,6],[8,10],[15,18]]): expected [[1,6],[8,10],[15,18]], got [[1,3],[2,6],[8,10],[15,18]]')
  })

  it('VF-13: p543 passes without defining TreeNode, parsing null in the call', async () => {
    const code = `def diameterOfBinaryTree(root: TreeNode | None) -> int:
    best = 0
    def h(n):
        nonlocal best
        if n is None:
            return 0
        l, r = h(n.left), h(n.right)
        best = max(best, l + r)
        return 1 + max(l, r)
    h(root)
    return best
`
    const r = await runPy(code, 'p543', 5)
    expect(statusText(r)).toBe('Passed 5/5')
  })

  it('a returned list with a cycle gives "cycle"; tuples compare as arrays; a bool never equals a number', async () => {
    const c = await runPy('def reverseList(head):\n    n = head\n    while n.next:\n        n = n.next\n    n.next = head\n    return head\n', 'p206', 2)
    expect(c.cases.map(x => [x.got, x.pass])).toEqual([['cycle', false], ['cycle', false]])
    const t = await runPy('def findRedundantConnection(edges):\n    return (2, 3) if len(edges) == 3 else (1.0, 4.0)\n', 'p684', 2)
    expect(t.cases.map(x => x.pass)).toEqual([true, true])
    const b = await runPy('def canFinish(numCourses, prerequisites):\n    return 1\n', 'p207', 1)
    expect(b.cases[0].pass).toBe(false)
    const e = await runPy('def reverseList(head):\n    return None\n', 'p206', 5)
    expect(e.cases[2]).toMatchObject({ got: [], pass: true })
  })

  it('a result beyond 2^53 is shown exactly, as text, and fails cleanly', async () => {
    const r = await runPy('def numDecodings(s):\n    return 2 ** 60 + 1\n', 'p91', 1)
    expect(r.status).toBe('ok')
    expect(r.cases[0]).toMatchObject({ got: '1152921504606846977', pass: false })
    const a = await runPy('def eventualSafeNodes(graph):\n    return [-(2 ** 60), 3]\n', 'p802', 1)
    expect(a.cases[0].got).toEqual(['-1152921504606846976', 3])
    const f = await runPy('def numDecodings(s):\n    return 2.0 ** 60\n', 'p91', 1)
    expect(f.cases[0]).toMatchObject({ got: '1152921504606846976', pass: false })
  })

  it('Addendum 3: a plain list returned for a ListNode or TreeNode result fails with "not a ListNode"', async () => {
    const l = await runPy('def reverseList(head):\n    return [5, 4, 3, 2, 1]\n', 'p206', 1)
    expect(l.cases[0]).toMatchObject({ got: 'not a ListNode', pass: false })
  })

  it('the worker never sees expected; the judge compares arrays and bools', async () => {
    const w = await runWorker('def canFinish(numCourses, prerequisites):\n    return True\n', 'p207', 2)
    expect(JSON.stringify(w)).not.toContain('expected')
    const j = loadJudge()
    expect(j.judge([{ id: 1, call: 'f()', expected: [1, [2]] }], { status: 'ok', cases: [{ id: 1, got: [1, [2]] }], errors: [], stdout: '', steps: [], truncated: false, ms: 0 }).cases[0].pass).toBe(true)
    expect(j.judge([{ id: 1, call: 'f()', expected: true }], { status: 'ok', cases: [{ id: 1, got: 1 }], errors: [], stdout: '', steps: [], truncated: false, ms: 0 }).cases[0].pass).toBe(false)
    expect(j.judge([{ id: 1, call: 'f()', expected: [] }], { status: 'ok', cases: [{ id: 1, got: null }], errors: [], stdout: '', steps: [], truncated: false, ms: 0 }).cases[0].pass).toBe(false)
  })

  it('VF-14 (Python): the pinned misuse is a runtime error at the learner\'s line, steps kept', async () => {
    const r = await runPy('from dojo import tk\n\ndef lengthOfLongestSubstring(s):\n    a = tk.Chars("s", s)\n    a.Pointer("lo", 0)\n    a.Pointer("lo", 99)\n    return 0\n', 'p3', 2)
    expect(statusText(r)).toBe('Runtime error')
    expect(r.errors.map(errorText)).toEqual(['line 6: IndexError: tk: pointer lo → 99 is outside s (-1..8)', 'line 6: IndexError: tk: pointer lo → 99 is outside s (-1..5)'])
    expect(r.steps.map(s => `${s.op} ${(s as { act?: string }).act}`)).toEqual(['array new', 'array pointer', 'array new', 'array pointer'])
  })
})

/** The tester's own classic solutions (VF-12, Python). */
export const PY_SOLUTIONS: Record<string, string> = {
  p743: `import heapq
def networkDelayTime(times, n, k):
    adj = {}
    for u, v, w in times:
        adj.setdefault(u, []).append((v, w))
    dist = {}
    pq = [(0, k)]
    while pq:
        d, u = heapq.heappop(pq)
        if u in dist:
            continue
        dist[u] = d
        for v, w in adj.get(u, []):
            if v not in dist:
                heapq.heappush(pq, (d + w, v))
    return max(dist.values()) if len(dist) == n else -1
`,
  p207: `def canFinish(numCourses, prerequisites):
    indeg = [0] * numCourses
    adj = [[] for _ in range(numCourses)]
    for a, b in prerequisites:
        adj[b].append(a)
        indeg[a] += 1
    q = [i for i in range(numCourses) if indeg[i] == 0]
    done = 0
    while q:
        u = q.pop()
        done += 1
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    return done == numCourses
`,
  p802: `def eventualSafeNodes(graph):
    color = [0] * len(graph)
    def safe(u):
        if color[u]:
            return color[u] == 2
        color[u] = 1
        if all(safe(v) for v in graph[u]):
            color[u] = 2
            return True
        return False
    return [i for i in range(len(graph)) if safe(i)]
`,
  p684: `def findRedundantConnection(edges):
    parent = list(range(len(edges) + 1))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    last = None
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra == rb:
            last = [a, b]
        else:
            parent[rb] = ra
    return last
`,
  p1584: `def minCostConnectPoints(points):
    n = len(points)
    best = [float("inf")] * n
    best[0] = 0
    seen = [False] * n
    total = 0
    for _ in range(n):
        u = min((i for i in range(n) if not seen[i]), key=lambda i: best[i])
        seen[u] = True
        total += best[u]
        for v in range(n):
            if not seen[v]:
                best[v] = min(best[v], abs(points[u][0] - points[v][0]) + abs(points[u][1] - points[v][1]))
    return total
`,
  p877: `from functools import lru_cache
def stoneGame(piles):
    @lru_cache(None)
    def best(i, j):
        if i > j:
            return 0
        return max(piles[i] - best(i + 1, j), piles[j] - best(i, j - 1))
    return best(0, len(piles) - 1) > 0
`,
  p55: `def canJump(nums):
    reach = 0
    for i, x in enumerate(nums):
        if i > reach:
            return False
        reach = max(reach, i + x)
    return True
`,
  p875: `def minEatingSpeed(piles, h):
    lo, hi = 1, max(piles)
    while lo < hi:
        mid = (lo + hi) // 2
        if sum((p + mid - 1) // mid for p in piles) <= h:
            hi = mid
        else:
            lo = mid + 1
    return lo
`,
  p153: `def findMin(nums):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] > nums[hi]:
            lo = mid + 1
        else:
            hi = mid
    return nums[lo]
`,
  p3: `def lengthOfLongestSubstring(s):
    last = {}
    lo = best = 0
    for i, c in enumerate(s):
        if last.get(c, -1) >= lo:
            lo = last[c] + 1
        last[c] = i
        best = max(best, i - lo + 1)
    return best
`,
  p11: `def maxArea(height):
    l, r, best = 0, len(height) - 1, 0
    while l < r:
        best = max(best, min(height[l], height[r]) * (r - l))
        if height[l] < height[r]:
            l += 1
        else:
            r -= 1
    return best
`,
  p206: `def reverseList(head):
    prev = None
    while head:
        head.next, prev, head = prev, head, head.next
    return prev
`,
  p56: `def merge(intervals):
    out = []
    for s, e in sorted(intervals):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out
`,
  p215: `import heapq
def findKthLargest(nums, k):
    return heapq.nlargest(k, nums)[-1]
`,
  p543: `def diameterOfBinaryTree(root):
    best = 0
    def h(n):
        nonlocal best
        if not n:
            return 0
        l, r = h(n.left), h(n.right)
        best = max(best, l + r)
        return 1 + max(l, r)
    h(root)
    return best
`,
}

describe('VF-12 (Python): every visual pack passes 5/5 with a classic solution', () => {
  it.each(Object.keys(PY_SOLUTIONS))('%s', async id => {
    const r = await runPy(PY_SOLUTIONS[id], id, 5)
    expect(statusText(r), JSON.stringify(r.cases)).toBe('Passed 5/5')
  })
})

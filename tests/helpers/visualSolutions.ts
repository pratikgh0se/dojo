// C-VISUAL §7: the VF-01..VF-10 solutions, in Go and Python, written as the scenarios describe them. Shared by
// the model's unit tests (Python, in Pyodide) and the e2e (Go and Python, through the real page).

export const GO_VF: Record<string, [pack: string, code: string]> = {
  vf01: ['p743', `package main

import "dojo/tk"

func networkDelayTime(times [][]int, n int, k int) int {
	g := tk.Graph("g", true)
	for i := 1; i <= n; i++ {
		g.Node(i)
	}
	adj := make([][][2]int, n+1)
	for _, t := range times {
		g.Edge(t[0], t[1], t[2])
		adj[t[0]] = append(adj[t[0]], [2]int{t[1], t[2]})
	}
	dist := make([]int, n+1)
	for i := range dist {
		dist[i] = 1 << 60
	}
	pq := tk.Heap("pq")
	dist[k] = 0
	g.Dist(k, 0)
	pq.Push(k, 0)
	for pq.Len() > 0 {
		u, d := pq.Pop()
		if d > dist[u] {
			continue
		}
		g.Visit(u)
		for _, e := range adj[u] {
			if nd := d + e[1]; nd < dist[e[0]] {
				dist[e[0]] = nd
				g.Relax(u, e[0], nd)
				pq.Push(e[0], nd)
			}
		}
	}
	best := 0
	for i := 1; i <= n; i++ {
		if dist[i] == 1<<60 {
			return -1
		}
		if dist[i] > best {
			best = dist[i]
		}
	}
	return best
}
`],
  vf02: ['p207', `package main

import (
	"fmt"
	"dojo/tk"
)

func canFinish(numCourses int, prerequisites [][]int) bool {
	g := tk.Graph("g", true)
	indeg := make([]int, numCourses)
	for _, p := range prerequisites {
		g.Edge(p[1], p[0])
		indeg[p[0]]++
	}
	q := tk.Queue("q")
	for i := 0; i < numCourses; i++ {
		g.Mark(i, fmt.Sprintf("in %d", indeg[i]))
	}
	for i := 0; i < numCourses; i++ {
		if indeg[i] == 0 {
			q.Push(i)
		}
	}
	done := 0
	for q.Len() > 0 {
		u := q.Pop()
		g.Visit(u)
		done++
		for _, v := range g.Neighbors(u) {
			indeg[v]--
			g.Mark(v, fmt.Sprintf("in %d", indeg[v]))
			if indeg[v] == 0 {
				q.Push(v)
			}
		}
	}
	return done == numCourses
}
`],
  vf03: ['p684', `package main

import "dojo/tk"

func findRedundantConnection(edges [][]int) []int {
	uf := tk.DSU("uf", len(edges)+1)
	var last []int
	for _, e := range edges {
		if !uf.Union(e[0], e[1]) {
			last = e
		}
	}
	return last
}
`],
  vf04: ['p215', `package main

import "dojo/tk"

func findKthLargest(nums []int, k int) int {
	h := tk.Heap("h")
	for _, x := range nums {
		h.Push(x, x)
		if h.Len() > k {
			h.Pop()
		}
	}
	key, _ := h.Peek()
	return key
}
`],
  vf05: ['p3', `package main

import "dojo/tk"

func lengthOfLongestSubstring(s string) int {
	a := tk.Chars("s", s)
	last := map[byte]int{}
	lo, best := 0, 0
	for i := 0; i < len(s); i++ {
		if j, ok := last[s[i]]; ok && j >= lo {
			lo = j + 1
		}
		last[s[i]] = i
		a.Pointer("lo", lo)
		a.Pointer("hi", i)
		a.Window(lo, i)
		if i-lo+1 > best {
			best = i - lo + 1
		}
	}
	return best
}
`],
  vf06: ['p875', `package main

import "dojo/tk"

func minEatingSpeed(piles []int, h int) int {
	hi := 1
	for _, p := range piles {
		if p > hi {
			hi = p
		}
	}
	lo := 1
	s := tk.Search("k", lo, hi)
	for lo < hi {
		mid := (lo + hi) / 2
		hours := 0
		for _, p := range piles {
			hours += (p + mid - 1) / mid
		}
		ok := hours <= h
		s.Mid(mid, ok)
		if ok {
			hi = mid
			s.Hi(mid)
		} else {
			lo = mid + 1
			s.Lo(mid + 1)
		}
	}
	return lo
}
`],
  vf07: ['p206', `package main

import "dojo/tk"

func reverseList(head *ListNode) *ListNode {
	l := tk.List("l")
	ids := map[*ListNode]int{}
	n := 0
	for p := head; p != nil; p = p.Next {
		ids[p] = n
		l.Node(n, p.Val)
		n++
	}
	for p := head; p != nil; p = p.Next {
		if p.Next != nil {
			l.Next(ids[p], ids[p.Next])
		} else {
			l.Next(ids[p], -1)
		}
	}
	id := func(p *ListNode) int {
		if p == nil {
			return -1
		}
		return ids[p]
	}
	var prev *ListNode
	curr := head
	l.Pointer("prev", -1)
	l.Pointer("curr", id(curr))
	for curr != nil {
		next := curr.Next
		curr.Next = prev
		l.Next(id(curr), id(prev))
		prev, curr = curr, next
		l.Pointer("prev", id(prev))
		l.Pointer("curr", id(curr))
	}
	return prev
}
`],
  vf08: ['p56', `package main

import (
	"sort"
	"dojo/tk"
)

func merge(intervals [][]int) [][]int {
	sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })
	in := tk.Intervals("in", intervals)
	out := tk.Intervals("out", nil)
	res := [][]int{}
	for i, iv := range intervals {
		if n := len(res); n > 0 && iv[0] <= res[n-1][1] {
			if iv[1] > res[n-1][1] {
				res[n-1][1] = iv[1]
			}
			out.Set(n-1, res[n-1][0], res[n-1][1])
			in.Mark(i, "merged")
		} else {
			res = append(res, []int{iv[0], iv[1]})
			out.Add(iv[0], iv[1])
			in.Mark(i, "new")
		}
	}
	return res
}
`],
  vf09: ['p543', `package main

import (
	"fmt"
	"dojo/tk"
)

func diameterOfBinaryTree(root *TreeNode) int {
	t := tk.Tree("t")
	next, best := 0, 0
	var dfs func(n *TreeNode, parent int, side string) int
	dfs = func(n *TreeNode, parent int, side string) int {
		if n == nil {
			return 0
		}
		id := next
		next++
		t.Node(id, n.Val, parent, side)
		t.Visit(id)
		l := dfs(n.Left, id, "L")
		r := dfs(n.Right, id, "R")
		if l+r > best {
			best = l + r
		}
		h := l + 1
		if r > l {
			h = r + 1
		}
		t.Mark(id, fmt.Sprintf("h=%d", h))
		return h
	}
	dfs(root, -1, "")
	return best
}
`],
  vf10: ['p877', `package main

import (
	"fmt"
	"dojo/tk"
)

func stoneGame(piles []int) bool {
	gt := tk.GameTable("g")
	memo := map[[2]int]int{}
	var best func(i, j int) int
	best = func(i, j int) int {
		if v, ok := memo[[2]int{i, j}]; ok {
			tk.Hit("best", i, j)
			return v
		}
		tk.Enter("best", i, j)
		v := piles[i]
		if i < j {
			a, b := piles[i]-best(i+1, j), piles[j]-best(i, j-1)
			v = a
			if b > a {
				v = b
			}
		}
		memo[[2]int{i, j}] = v
		outcome := "lose"
		if v > 0 {
			outcome = "win"
		}
		gt.Set(fmt.Sprintf("%d-%d", i, j), outcome, v)
		tk.Exit(v)
		return v
	}
	return best(0, len(piles)-1) > 0
}
`],
}

export const PY_VF: Record<string, [pack: string, code: string]> = {
  vf01: ['p743', `from dojo import tk

def networkDelayTime(times, n, k):
    g = tk.Graph("g", True)
    for i in range(1, n + 1):
        g.Node(i)
    adj = [[] for _ in range(n + 1)]
    for u, v, w in times:
        g.Edge(u, v, w)
        adj[u].append((v, w))
    INF = float("inf")
    dist = [INF] * (n + 1)
    pq = tk.Heap("pq")
    dist[k] = 0
    g.Dist(k, 0)
    pq.Push(k, 0)
    while pq.Len() > 0:
        u, d = pq.Pop()
        if d > dist[u]:
            continue
        g.Visit(u)
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                g.Relax(u, v, d + w)
                pq.Push(v, d + w)
    best = max(dist[1:])
    return -1 if best == INF else best
`],
  vf02: ['p207', `from dojo import tk

def canFinish(numCourses, prerequisites):
    g = tk.Graph("g", True)
    indeg = [0] * numCourses
    for a, b in prerequisites:
        g.Edge(b, a)
        indeg[a] += 1
    q = tk.Queue("q")
    for i in range(numCourses):
        g.Mark(i, "in %d" % indeg[i])
    for i in range(numCourses):
        if indeg[i] == 0:
            q.Push(i)
    done = 0
    while q.Len() > 0:
        u = q.Pop()
        g.Visit(u)
        done += 1
        for v in g.Neighbors(u):
            indeg[v] -= 1
            g.Mark(v, "in %d" % indeg[v])
            if indeg[v] == 0:
                q.Push(v)
    return done == numCourses
`],
  vf03: ['p684', `from dojo import tk

def findRedundantConnection(edges):
    uf = tk.DSU("uf", len(edges) + 1)
    last = None
    for a, b in edges:
        if not uf.Union(a, b):
            last = [a, b]
    return last
`],
  vf04: ['p215', `from dojo import tk

def findKthLargest(nums, k):
    h = tk.Heap("h")
    for x in nums:
        h.Push(x, x)
        if h.Len() > k:
            h.Pop()
    return h.Peek()[0]
`],
  vf05: ['p3', `from dojo import tk

def lengthOfLongestSubstring(s):
    a = tk.Chars("s", s)
    last = {}
    lo = best = 0
    for i, c in enumerate(s):
        if last.get(c, -1) >= lo:
            lo = last[c] + 1
        last[c] = i
        a.Pointer("lo", lo)
        a.Pointer("hi", i)
        a.Window(lo, i)
        best = max(best, i - lo + 1)
    return best
`],
  vf06: ['p875', `from dojo import tk

def minEatingSpeed(piles, h):
    lo, hi = 1, max(piles)
    s = tk.Search("k", lo, hi)
    while lo < hi:
        mid = (lo + hi) // 2
        ok = sum((p + mid - 1) // mid for p in piles) <= h
        s.Mid(mid, ok)
        if ok:
            hi = mid
            s.Hi(mid)
        else:
            lo = mid + 1
            s.Lo(mid + 1)
    return lo
`],
  vf07: ['p206', `from dojo import tk

def reverseList(head):
    l = tk.List("l")
    ids = {}
    p = head
    while p:
        ids[id(p)] = len(ids)
        l.Node(ids[id(p)], p.val)
        p = p.next
    p = head
    while p:
        l.Next(ids[id(p)], ids[id(p.next)] if p.next else -1)
        p = p.next
    nid = lambda x: ids[id(x)] if x else None
    prev, curr = None, head
    l.Pointer("prev", None)
    l.Pointer("curr", nid(curr))
    while curr:
        nxt = curr.next
        curr.next = prev
        l.Next(nid(curr), nid(prev))
        prev, curr = curr, nxt
        l.Pointer("prev", nid(prev))
        l.Pointer("curr", nid(curr))
    return prev
`],
  vf08: ['p56', `from dojo import tk

def merge(intervals):
    intervals = sorted(intervals)
    inp = tk.Intervals("in", intervals)
    out = tk.Intervals("out", [])
    res = []
    for i, (s, e) in enumerate(intervals):
        if res and s <= res[-1][1]:
            res[-1][1] = max(res[-1][1], e)
            out.Set(len(res) - 1, res[-1][0], res[-1][1])
            inp.Mark(i, "merged")
        else:
            res.append([s, e])
            out.Add(s, e)
            inp.Mark(i, "new")
    return res
`],
  vf09: ['p543', `from dojo import tk

def diameterOfBinaryTree(root):
    t = tk.Tree("t")
    state = {"next": 0, "best": 0}
    def dfs(n, parent, side):
        if n is None:
            return 0
        i = state["next"]
        state["next"] += 1
        t.Node(i, n.val, parent, side)
        t.Visit(i)
        l = dfs(n.left, i, "L")
        r = dfs(n.right, i, "R")
        state["best"] = max(state["best"], l + r)
        h = 1 + max(l, r)
        t.Mark(i, "h=%d" % h)
        return h
    dfs(root, -1, "")
    return state["best"]
`],
  vf10: ['p877', `from dojo import tk

def stoneGame(piles):
    gt = tk.GameTable("g")
    memo = {}
    def best(i, j):
        if (i, j) in memo:
            tk.Hit("best", i, j)
            return memo[(i, j)]
        tk.Enter("best", i, j)
        v = piles[i]
        if i < j:
            v = max(piles[i] - best(i + 1, j), piles[j] - best(i, j - 1))
        memo[(i, j)] = v
        gt.Set("%d-%d" % (i, j), "win" if v > 0 else "lose", v)
        tk.Exit(v)
        return v
    return best(0, len(piles) - 1) > 0
`],
}

/** UAT cu-5 P2-1: Python solutions for the problems the cu-5 lane stepped through beyond VF-01..VF-10. */
export const PY_MORE: Record<string, [pack: string, code: string]> = {
  /** p802: a directed graph alone in the band (a Mark per safe node). */
  g802: ['p802', `from dojo import tk

def eventualSafeNodes(graph):
    g = tk.Graph("g", True)
    for u, outs in enumerate(graph):
        g.Node(u)
        for v in outs:
            g.Edge(u, v)
    color = [0] * len(graph)
    def safe(u):
        if color[u] > 0:
            return color[u] == 2
        color[u] = 1
        g.Visit(u)
        for v in graph[u]:
            if color[v] == 1 or not safe(v):
                return False
        color[u] = 2
        g.Mark(u, "safe")
        return True
    return [u for u in range(len(graph)) if safe(u)]
`],
  /** p1584: Kruskal, an undirected graph beside a union-find. */
  k1584: ['p1584', `from dojo import tk

def minCostConnectPoints(points):
    n = len(points)
    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            edges.append((abs(points[i][0] - points[j][0]) + abs(points[i][1] - points[j][1]), i, j))
    edges.sort()
    g = tk.Graph("mst", False)
    uf = tk.DSU("uf", n)
    total = 0
    for w, i, j in edges:
        if uf.Union(i, j):
            g.Edge(i, j, w)
            total += w
    return total
`],
  /** p153: an array with moving pointers and a window. */
  a153: ['p153', `from dojo import tk

def findMin(nums):
    a = tk.Array("a", nums)
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        a.Pointer("lo", lo)
        a.Pointer("hi", hi)
        a.Pointer("mid", mid)
        a.Window(lo, hi)
        if nums[mid] > nums[hi]:
            lo = mid + 1
        else:
            hi = mid
    a.Pointer("lo", lo)
    return nums[lo]
`],
  /** p11: two pointers closing in on an array. */
  a11: ['p11', `from dojo import tk

def maxArea(height):
    a = tk.Array("h", height)
    l, r = 0, len(height) - 1
    best = 0
    while l < r:
        a.Pointer("l", l)
        a.Pointer("r", r)
        a.Window(l, r)
        best = max(best, min(height[l], height[r]) * (r - l))
        if height[l] < height[r]:
            l += 1
        else:
            r -= 1
    return best
`],
}

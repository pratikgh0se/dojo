package tk

// The visual families (C-VISUAL §1–§2). Heap, Queue and DSU really work; Graph, Array/Chars, Search,
// List, Intervals, Tree and GameTable only record what the learner tells them. Every constructor and
// every operation listed in C-VISUAL §2 is one event, sharing the MaxEvents cap with the DP events.
// Working structures keep working past the cap; only the recording stops.
//
// A family event is one wire line, `V <json>`, whose JSON object is the step exactly as the page
// receives it: {"op":<family>,"sid":<structure id>,"act":<action>,...fields}. Structure ids count every
// structure of the run, of any kind, from 0.
//
// Misuse (an index out of range, a bad label or state, an unknown outcome, a List or Tree id with no
// Node, a Tree side already taken, an empty Pop or Peek) panics with a message starting "tk:".

import (
	"strconv"
	"unicode/utf8"
)

func itoa(v int) string { return strconv.Itoa(v) }

func misuse(msg string) { panic("tk: " + msg) }

// fam starts a family event line; false when the cap is reached (nothing is written then).
func fam(op string, s int, act string) bool {
	if !begin() {
		return false
	}
	buf = append(buf, `V {"op":"`...)
	buf = append(buf, op...)
	buf = append(buf, `","sid":`...)
	buf = strconv.AppendInt(buf, int64(s), 10)
	buf = append(buf, `,"act":"`...)
	buf = append(buf, act...)
	buf = append(buf, '"')
	return true
}

func key(k string) { buf = append(buf, ',', '"'); buf = append(buf, k...); buf = append(buf, '"', ':') }
func fInt(k string, v int) { key(k); buf = strconv.AppendInt(buf, int64(v), 10) }
func fStr(k string, v string) { key(k); buf = appendJSON(buf, v) }
func fBool(k string, v bool) { key(k); buf = strconv.AppendBool(buf, v) }
func fInts(k string, v []int) {
	key(k)
	buf = appendInts(buf, v)
}
func appendInts(b []byte, v []int) []byte {
	b = append(b, '[')
	for i, x := range v {
		if i > 0 {
			b = append(b, ',')
		}
		b = strconv.AppendInt(b, int64(x), 10)
	}
	return append(b, ']')
}
func fIntss(k string, v [][]int) {
	key(k)
	buf = append(buf, '[')
	for i, x := range v {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = appendInts(buf, x)
	}
	buf = append(buf, ']')
}
func fStrs(k string, v []string) {
	key(k)
	buf = append(buf, '[')
	for i, x := range v {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = appendJSON(buf, x)
	}
	buf = append(buf, ']')
}
func famEnd() { buf = append(buf, '}'); emit() }

func newID() int { structs++; return structs - 1 }

func okLabel(s string) bool {
	if len(s) < 1 || len(s) > 16 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !('A' <= c && c <= 'Z' || 'a' <= c && c <= 'z' || '0' <= c && c <= '9' || c == '_') {
			return false
		}
	}
	return true
}

func okState(s string) bool {
	if len(s) < 1 || len(s) > 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !('A' <= c && c <= 'Z' || 'a' <= c && c <= 'z' || '0' <= c && c <= '9' || c == ',' || c == '.' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func checkLabel(label string) {
	if !okLabel(label) {
		misuse("pointer label " + quote(label) + " must match [A-Za-z0-9_]{1,16}")
	}
}

// checkMark: mark labels (Graph, Intervals, Tree) are free text of at most 64 characters (C-VISUAL Addendum 1 Q2).
func checkMark(label string) {
	if n := utf8.RuneCountInString(label); n > 64 {
		misuse("mark label of " + itoa(n) + " characters is longer than 64")
	}
}

// checkName: structure names are at most 64 characters (C-VISUAL Addendum 3).
// maxSafe is 2^53 - 1: a larger int cannot be drawn exactly by the page (C-VISUAL Addendum 4).
const maxSafe = 1<<53 - 1

// safe: every int in a toolkit call lies within ±2^53.
func safe(vs ...int) {
	for _, v := range vs {
		if v > maxSafe || v < -maxSafe {
			misuse(itoa(v) + " is too large to draw (beyond ±2^53)")
		}
	}
}

func checkName(name string) {
	if n := utf8.RuneCountInString(name); n > 64 {
		misuse("name of " + itoa(n) + " characters is longer than 64")
	}
}

func checkState(state string) {
	if !okState(state) {
		misuse("game state " + quote(state) + " must match [A-Za-z0-9,._-]{1,32}")
	}
}

// ---------------------------------------------------------------- Graph

// GraphT records a graph the learner draws: nodes are ints, auto-created by Edge, Visit, Dist, Relax and Mark.
type GraphT struct {
	id       int
	name     string
	directed bool
	adj      map[int][]int
	edges    map[[2]int]bool
}

// Graph creates a graph (directed or undirected) named name.
func Graph(name string, directed bool) *GraphT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	g := &GraphT{id: newID(), name: name, directed: directed, adj: map[int][]int{}, edges: map[[2]int]bool{}}
	if fam("graph", g.id, "new") {
		fStr("name", name)
		fBool("directed", directed)
		famEnd()
	}
	return g
}

func (g *GraphT) node(u int) {
	safe(u)
	if u < 0 {
		misuse("graph node " + itoa(u) + " must not be negative")
	}
	if _, ok := g.adj[u]; !ok {
		g.adj[u] = nil
	}
}

// Node adds node u.
func (g *GraphT) Node(u int) {
	mu.Lock()
	defer mu.Unlock()
	g.node(u)
	if fam("graph", g.id, "node") {
		fInt("u", u)
		famEnd()
	}
}

// Edge adds the edge u→v (u—v when undirected), with at most one weight.
func (g *GraphT) Edge(u, v int, w ...int) {
	mu.Lock()
	defer mu.Unlock()
	safe(w...)
	if len(w) > 1 {
		misuse("Edge takes at most one weight")
	}
	g.node(u)
	g.node(v)
	k := [2]int{u, v}
	if !g.directed && v < u {
		k = [2]int{v, u}
	}
	if !g.edges[k] {
		g.edges[k] = true
		g.adj[u] = append(g.adj[u], v)
		if !g.directed && u != v {
			g.adj[v] = append(g.adj[v], u)
		}
	}
	if fam("graph", g.id, "edge") {
		fInt("u", u)
		fInt("v", v)
		if len(w) == 1 {
			fInt("w", w[0])
		}
		famEnd()
	}
}

func (g *GraphT) one(act string, u int, extra func()) {
	mu.Lock()
	defer mu.Unlock()
	g.node(u)
	if fam("graph", g.id, act) {
		fInt("u", u)
		if extra != nil {
			extra()
		}
		famEnd()
	}
}

// Visit marks u visited.
func (g *GraphT) Visit(u int) { g.one("visit", u, nil) }

// Dist sets u's distance to d.
func (g *GraphT) Dist(u, d int) { safe(d); g.one("dist", u, func() { fInt("d", d) }) }

// Mark labels u.
func (g *GraphT) Mark(u int, label string) {
	checkMark(label)
	g.one("mark", u, func() { fStr("label", label) })
}

// Relax records that v's distance became d through the edge from u.
func (g *GraphT) Relax(u, v, d int) {
	mu.Lock()
	defer mu.Unlock()
	safe(d)
	g.node(u)
	g.node(v)
	if fam("graph", g.id, "relax") {
		fInt("u", u)
		fInt("v", v)
		fInt("d", d)
		famEnd()
	}
}

// Neighbors returns u's out-neighbours in insertion order (both directions when undirected). Not an event.
func (g *GraphT) Neighbors(u int) []int {
	mu.Lock()
	defer mu.Unlock()
	return append([]int(nil), g.adj[u]...)
}

// ---------------------------------------------------------------- Heap

type heapItem struct{ key, prio int }

func (a heapItem) less(b heapItem) bool { return a.prio < b.prio || a.prio == b.prio && a.key < b.key }

// HeapT is a binary min-heap of (key, prio), ordered by (prio, key).
type HeapT struct {
	id    int
	name  string
	items []heapItem
}

// Heap creates an empty min-heap named name.
func Heap(name string) *HeapT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	h := &HeapT{id: newID(), name: name}
	if fam("heap", h.id, "new") {
		fStr("name", name)
		famEnd()
	}
	return h
}

// Push adds key with priority prio: it is appended, then sifts up while its parent is strictly greater.
func (h *HeapT) Push(key, prio int) {
	mu.Lock()
	defer mu.Unlock()
	safe(key, prio)
	it := heapItem{key, prio}
	h.items = append(h.items, it)
	for i := len(h.items) - 1; i > 0; {
		p := (i - 1) / 2
		if !it.less(h.items[p]) {
			break
		}
		h.items[i], h.items[p] = h.items[p], h.items[i]
		i = p
	}
	if fam("heap", h.id, "push") {
		fInt("key", key)
		fInt("prio", prio)
		famEnd()
	}
}

// Pop removes and returns the smallest (key, prio). The last item moves to slot 0 and sifts down to the
// smaller child (the left one on a tie) while that child is strictly smaller.
func (h *HeapT) Pop() (int, int) {
	mu.Lock()
	defer mu.Unlock()
	if len(h.items) == 0 {
		misuse("Pop on an empty heap " + h.name)
	}
	top := h.items[0]
	last := len(h.items) - 1
	h.items[0] = h.items[last]
	h.items = h.items[:last]
	for i := 0; ; {
		l, r := 2*i+1, 2*i+2
		if l >= len(h.items) {
			break
		}
		c := l
		if r < len(h.items) && h.items[r].less(h.items[l]) {
			c = r
		}
		if !h.items[c].less(h.items[i]) {
			break
		}
		h.items[c], h.items[i] = h.items[i], h.items[c]
		i = c
	}
	if fam("heap", h.id, "pop") {
		fInt("key", top.key)
		fInt("prio", top.prio)
		famEnd()
	}
	return top.key, top.prio
}

// Peek returns the smallest (key, prio) without removing it. Not an event.
func (h *HeapT) Peek() (int, int) {
	mu.Lock()
	defer mu.Unlock()
	if len(h.items) == 0 {
		misuse("Peek on an empty heap " + h.name)
	}
	return h.items[0].key, h.items[0].prio
}

// Len is the number of items. Not an event.
func (h *HeapT) Len() int {
	mu.Lock()
	defer mu.Unlock()
	return len(h.items)
}

// ---------------------------------------------------------------- Queue

// QueueT is a FIFO of ints.
type QueueT struct {
	id    int
	name  string
	items []int
}

// Queue creates an empty queue named name.
func Queue(name string) *QueueT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	q := &QueueT{id: newID(), name: name}
	if fam("queue", q.id, "new") {
		fStr("name", name)
		famEnd()
	}
	return q
}

// Push appends v.
func (q *QueueT) Push(v int) {
	mu.Lock()
	defer mu.Unlock()
	safe(v)
	q.items = append(q.items, v)
	if fam("queue", q.id, "push") {
		fInt("v", v)
		famEnd()
	}
}

// Pop removes and returns the front.
func (q *QueueT) Pop() int {
	mu.Lock()
	defer mu.Unlock()
	if len(q.items) == 0 {
		misuse("Pop on an empty queue " + q.name)
	}
	v := q.items[0]
	q.items = q.items[1:]
	if fam("queue", q.id, "pop") {
		fInt("v", v)
		famEnd()
	}
	return v
}

// Len is the number of items. Not an event.
func (q *QueueT) Len() int {
	mu.Lock()
	defer mu.Unlock()
	return len(q.items)
}

// ---------------------------------------------------------------- Union-find

// DSUT is a union-find over 0..n-1 with full path compression and union by size.
type DSUT struct {
	id     int
	name   string
	parent []int
	size   []int
}

// DSU creates n singleton sets named name.
func DSU(name string, n int) *DSUT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	if n < 0 {
		misuse("dsu " + name + " size " + itoa(n) + " must not be negative")
	}
	if n > 5_000_000 {
		misuse("dsu " + name + " size " + itoa(n) + " is over 5000000") // C-VISUAL Addendum 4
	}
	d := &DSUT{id: newID(), name: name, parent: make([]int, n), size: make([]int, n)}
	for i := range d.parent {
		d.parent[i], d.size[i] = i, 1
	}
	if fam("dsu", d.id, "new") {
		fStr("name", name)
		fInt("n", n)
		famEnd()
	}
	return d
}

func (d *DSUT) check(x int) {
	if x < 0 || x >= len(d.parent) {
		misuse(itoa(x) + " is outside dsu " + d.name + " (0.." + itoa(len(d.parent)-1) + ")")
	}
}

func (d *DSUT) find(x int) int {
	r := x
	for d.parent[r] != r {
		r = d.parent[r]
	}
	for d.parent[x] != r {
		x, d.parent[x] = d.parent[x], r
	}
	return r
}

// Union joins a's and b's sets: false if they were already one. The smaller set's root goes under the
// larger one's; on equal sizes, b's root goes under a's.
func (d *DSUT) Union(a, b int) bool {
	mu.Lock()
	defer mu.Unlock()
	d.check(a)
	d.check(b)
	ra, rb := d.find(a), d.find(b)
	joined := ra != rb
	if joined {
		if d.size[ra] < d.size[rb] {
			ra, rb = rb, ra
		}
		d.parent[rb] = ra
		d.size[ra] += d.size[rb]
	}
	if fam("dsu", d.id, "union") {
		fInt("a", a)
		fInt("b", b)
		famEnd()
	}
	return joined
}

// Find returns x's root, compressing the path.
func (d *DSUT) Find(x int) int {
	mu.Lock()
	defer mu.Unlock()
	d.check(x)
	r := d.find(x)
	if fam("dsu", d.id, "find") {
		fInt("x", x)
		famEnd()
	}
	return r
}

// ---------------------------------------------------------------- Array / Chars

// ArrayT records an array (its own copy of the values) with pointers and a window.
type ArrayT struct {
	id    int
	name  string
	vals  []int
	chars bool
}

func newArray(name string, vals []int, chars bool) *ArrayT {
	a := &ArrayT{id: newID(), name: name, vals: vals, chars: chars}
	if fam("array", a.id, "new") {
		fStr("name", name)
		fInts("values", vals)
		fBool("chars", chars)
		famEnd()
	}
	return a
}

// Array creates an array named name holding a copy of values.
func Array(name string, values []int) *ArrayT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	safe(values...)
	return newArray(name, append([]int{}, values...), false)
}

// Chars creates an array of the characters of s.
func Chars(name string, s string) *ArrayT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	vals := []int{}
	for _, r := range s {
		vals = append(vals, int(r))
	}
	return newArray(name, vals, true)
}

func (a *ArrayT) check(i int) {
	if i < 0 || i >= len(a.vals) {
		misuse("index " + itoa(i) + " is outside " + a.name + " (0.." + itoa(len(a.vals)-1) + ")")
	}
}

// Set writes v at i.
func (a *ArrayT) Set(i, v int) {
	mu.Lock()
	defer mu.Unlock()
	safe(v)
	a.check(i)
	a.vals[i] = v
	if fam("array", a.id, "set") {
		fInt("i", i)
		fInt("v", v)
		famEnd()
	}
}

// Swap exchanges the values at i and j.
func (a *ArrayT) Swap(i, j int) {
	mu.Lock()
	defer mu.Unlock()
	a.check(i)
	a.check(j)
	a.vals[i], a.vals[j] = a.vals[j], a.vals[i]
	if fam("array", a.id, "swap") {
		fInt("i", i)
		fInt("j", j)
		famEnd()
	}
}

// Pointer places the pointer label at i (-1..n).
func (a *ArrayT) Pointer(label string, i int) {
	mu.Lock()
	defer mu.Unlock()
	checkLabel(label)
	if i < -1 || i > len(a.vals) {
		misuse("pointer " + label + " → " + itoa(i) + " is outside " + a.name + " (-1.." + itoa(len(a.vals)) + ")")
	}
	if fam("array", a.id, "pointer") {
		fStr("label", label)
		fInt("i", i)
		famEnd()
	}
}

// Window highlights lo..hi (empty when hi < lo); both ends lie in -1..n.
func (a *ArrayT) Window(lo, hi int) {
	mu.Lock()
	defer mu.Unlock()
	n := len(a.vals)
	if lo < -1 || lo > n || hi < -1 || hi > n {
		misuse("window [" + itoa(lo) + ".." + itoa(hi) + "] is outside " + a.name + " (-1.." + itoa(n) + ")")
	}
	if fam("array", a.id, "window") {
		fInt("lo", lo)
		fInt("hi", hi)
		famEnd()
	}
}

// ---------------------------------------------------------------- Binary search

// SearchT records a binary search: lo and hi move through Lo and Hi; Mid records a probe.
type SearchT struct {
	id   int
	name string
}

// Search creates a search over [lo..hi].
func Search(name string, lo, hi int) *SearchT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	safe(lo, hi)
	s := &SearchT{id: newID(), name: name}
	if fam("search", s.id, "new") {
		fStr("name", name)
		fInt("lo", lo)
		fInt("hi", hi)
		famEnd()
	}
	return s
}

// Mid records the probe m and its predicate.
func (s *SearchT) Mid(m int, pred bool) {
	mu.Lock()
	defer mu.Unlock()
	safe(m)
	if fam("search", s.id, "mid") {
		fInt("m", m)
		fBool("pred", pred)
		famEnd()
	}
}

func (s *SearchT) move(act string, v int) {
	mu.Lock()
	defer mu.Unlock()
	safe(v)
	if fam("search", s.id, act) {
		fInt("v", v)
		famEnd()
	}
}

// Lo moves lo to v.
func (s *SearchT) Lo(v int) { s.move("lo", v) }

// Hi moves hi to v.
func (s *SearchT) Hi(v int) { s.move("hi", v) }

// ---------------------------------------------------------------- Linked list

// ListT records a linked list: nodes by id, next links and pointers (-1 = nil).
type ListT struct {
	id    int
	name  string
	nodes map[int]bool
}

// List creates an empty list drawing.
func List(name string) *ListT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	l := &ListT{id: newID(), name: name, nodes: map[int]bool{}}
	if fam("list", l.id, "new") {
		fStr("name", name)
		famEnd()
	}
	return l
}

func (l *ListT) has(id int) {
	if !l.nodes[id] {
		misuse("list " + l.name + " has no node " + itoa(id))
	}
}

// Node adds (or rewrites) node id with value val.
func (l *ListT) Node(id, val int) {
	mu.Lock()
	defer mu.Unlock()
	safe(id, val)
	if id < 0 {
		misuse("list " + l.name + " node id " + itoa(id) + " must not be negative")
	}
	l.nodes[id] = true
	if fam("list", l.id, "node") {
		fInt("id", id)
		fInt("val", val)
		famEnd()
	}
}

// Next links id to next (-1 = nil).
func (l *ListT) Next(id, next int) {
	mu.Lock()
	defer mu.Unlock()
	l.has(id)
	if next != -1 {
		l.has(next)
	}
	if fam("list", l.id, "next") {
		fInt("id", id)
		fInt("next", next)
		famEnd()
	}
}

// Pointer points label at id (-1 = nil).
func (l *ListT) Pointer(label string, id int) {
	mu.Lock()
	defer mu.Unlock()
	checkLabel(label)
	if id != -1 {
		l.has(id)
	}
	if fam("list", l.id, "pointer") {
		fStr("label", label)
		fInt("id", id)
		famEnd()
	}
}

// ---------------------------------------------------------------- Intervals

// IntervalsT records a list of [start, end] intervals.
type IntervalsT struct {
	id   int
	name string
	n    int
}

// Intervals creates an interval list holding items (each [start, end]).
func Intervals(name string, items [][]int) *IntervalsT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	for k, it := range items {
		if len(it) != 2 {
			misuse("interval " + itoa(k) + " of " + name + " must be [start, end]")
		}
		safe(it...)
	}
	iv := &IntervalsT{id: newID(), name: name, n: len(items)}
	if fam("intervals", iv.id, "new") {
		fStr("name", name)
		fIntss("items", items)
		famEnd()
	}
	return iv
}

func (iv *IntervalsT) check(i int) {
	if i < 0 || i >= iv.n {
		misuse("index " + itoa(i) + " is outside " + iv.name + " (0.." + itoa(iv.n-1) + ")")
	}
}

// Add appends [s, e].
func (iv *IntervalsT) Add(s, e int) {
	mu.Lock()
	defer mu.Unlock()
	safe(s, e)
	iv.n++
	if fam("intervals", iv.id, "add") {
		fInt("s", s)
		fInt("e", e)
		famEnd()
	}
}

// Set rewrites interval i as [s, e].
func (iv *IntervalsT) Set(i, s, e int) {
	mu.Lock()
	defer mu.Unlock()
	safe(s, e)
	iv.check(i)
	if fam("intervals", iv.id, "set") {
		fInt("i", i)
		fInt("s", s)
		fInt("e", e)
		famEnd()
	}
}

// Mark labels interval i.
func (iv *IntervalsT) Mark(i int, label string) {
	mu.Lock()
	defer mu.Unlock()
	iv.check(i)
	checkMark(label)
	if fam("intervals", iv.id, "mark") {
		fInt("i", i)
		fStr("label", label)
		famEnd()
	}
}

// ---------------------------------------------------------------- Tree

type treeNode struct{ left, right bool }

// TreeT records a binary tree: nodes by id with a parent and a side.
type TreeT struct {
	id    int
	name  string
	nodes map[int]*treeNode
	root  bool
}

// Tree creates an empty tree drawing.
func Tree(name string) *TreeT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	t := &TreeT{id: newID(), name: name, nodes: map[int]*treeNode{}}
	if fam("tree", t.id, "new") {
		fStr("name", name)
		famEnd()
	}
	return t
}

func (t *TreeT) has(id int) {
	if t.nodes[id] == nil {
		misuse("tree " + t.name + " has no node " + itoa(id))
	}
}

// Node adds node id with value val under parent on side "L" or "R" (the root: parent -1, side "").
func (t *TreeT) Node(id, val, parent int, side string) {
	mu.Lock()
	defer mu.Unlock()
	safe(id, val, parent)
	if id < 0 {
		misuse("tree " + t.name + " node id " + itoa(id) + " must not be negative")
	}
	if t.nodes[id] != nil {
		misuse("tree " + t.name + " already has node " + itoa(id))
	}
	if parent == -1 {
		if side != "" {
			misuse("tree " + t.name + ": the root's side must be \"\"")
		}
		if t.root {
			misuse("tree " + t.name + " already has a root")
		}
		t.root = true
	} else {
		p := t.nodes[parent]
		if p == nil {
			misuse("tree " + t.name + " has no node " + itoa(parent) + " (the parent of " + itoa(id) + ")")
		}
		switch side {
		case "L":
			if p.left {
				misuse("tree " + t.name + ": the L side of " + itoa(parent) + " is already taken")
			}
			p.left = true
		case "R":
			if p.right {
				misuse("tree " + t.name + ": the R side of " + itoa(parent) + " is already taken")
			}
			p.right = true
		default:
			misuse("tree " + t.name + ": side " + quote(side) + " must be \"L\" or \"R\"")
		}
	}
	t.nodes[id] = &treeNode{}
	if fam("tree", t.id, "node") {
		fInt("id", id)
		fInt("val", val)
		fInt("parent", parent)
		fStr("side", side)
		famEnd()
	}
}

// Visit marks node id visited.
func (t *TreeT) Visit(id int) {
	mu.Lock()
	defer mu.Unlock()
	t.has(id)
	if fam("tree", t.id, "visit") {
		fInt("id", id)
		famEnd()
	}
}

// Mark labels node id.
func (t *TreeT) Mark(id int, label string) {
	mu.Lock()
	defer mu.Unlock()
	t.has(id)
	checkMark(label)
	if fam("tree", t.id, "mark") {
		fInt("id", id)
		fStr("label", label)
		famEnd()
	}
}

// ---------------------------------------------------------------- Game table

// GameTableT records the outcome of game states ("win", "lose" or "draw", with an optional value).
type GameTableT struct {
	id   int
	name string
}

// GameTable creates a game table, declaring states in order.
func GameTable(name string, states ...string) *GameTableT {
	mu.Lock()
	defer mu.Unlock()
	checkName(name)
	for _, s := range states {
		checkState(s)
	}
	gt := &GameTableT{id: newID(), name: name}
	if fam("game", gt.id, "new") {
		fStr("name", name)
		fStrs("states", states)
		famEnd()
	}
	return gt
}

// Set records state's outcome ("win", "lose" or "draw") and at most one value.
func (gt *GameTableT) Set(state, outcome string, value ...int) {
	mu.Lock()
	defer mu.Unlock()
	checkState(state)
	if outcome != "win" && outcome != "lose" && outcome != "draw" {
		misuse("outcome " + quote(outcome) + " must be win, lose or draw")
	}
	if len(value) > 1 {
		misuse("Set takes at most one value")
	}
	safe(value...)
	if fam("game", gt.id, "set") {
		fStr("state", state)
		fStr("outcome", outcome)
		if len(value) == 1 {
			fInt("value", value[0])
		}
		famEnd()
	}
}

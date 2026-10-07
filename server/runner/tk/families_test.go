//go:build dojo_wiretest

package tk

// Run with: go test -tags dojo_wiretest ./tk/ (the tag leaves out wire's real init, which needs the runner).

import (
	"bufio"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// keepFD3 holds the toolkit's own writer on fd 3: dropped, its file's finalizer would close fd 3, which
// the test binary uses for itself.
var keepFD3 = out

// capture resets the toolkit and returns a function that yields the family events written since.
func capture(t *testing.T) func() []map[string]any {
	t.Helper()
	var b bytes.Buffer
	mu.Lock()
	out = bufio.NewWriter(&b)
	events, truncated, structs = 0, false, 0
	mu.Unlock()
	return func() []map[string]any {
		mu.Lock()
		out.Flush()
		mu.Unlock()
		var evs []map[string]any
		for _, l := range strings.Split(b.String(), "\n") {
			l = strings.TrimSpace(l)
			if !strings.HasPrefix(l, "V ") {
				continue
			}
			var m map[string]any
			if err := json.Unmarshal([]byte(l[2:]), &m); err != nil {
				t.Fatalf("bad event line %q: %v", l, err)
			}
			evs = append(evs, m)
		}
		return evs
	}
}

func panics(t *testing.T, want string, f func()) {
	t.Helper()
	defer func() {
		t.Helper()
		r := recover()
		if r == nil {
			t.Fatalf("no panic, want %q", want)
		}
		if s, _ := r.(string); s != want {
			t.Fatalf("panic %q, want %q", r, want)
		}
	}()
	f()
}

func TestHeapSiftOrder(t *testing.T) {
	evs := capture(t)
	h := Heap("pq")
	for _, kp := range [][2]int{{5, 5}, {3, 3}, {4, 3}, {1, 9}, {2, 3}} {
		h.Push(kp[0], kp[1])
	}
	// (3,3) (2,3) (4,3) (1,9) (5,5): push 2 (3) sifts up past 3? (3,3) vs (3,2): key 2 < 3, so yes.
	got := []string{}
	for _, it := range h.items {
		got = append(got, itemText(it))
	}
	if strings.Join(got, " ") != "2(3) 3(3) 4(3) 1(9) 5(5)" {
		t.Fatalf("heap = %v", got)
	}
	if k, p := h.Peek(); k != 2 || p != 3 {
		t.Fatalf("peek = %d %d", k, p)
	}
	order := []string{}
	for h.Len() > 0 {
		k, p := h.Pop()
		order = append(order, itemText(heapItem{k, p}))
	}
	if strings.Join(order, " ") != "2(3) 3(3) 4(3) 5(5) 1(9)" {
		t.Fatalf("pop order = %v", order)
	}
	e := evs()
	if len(e) != 11 || e[0]["act"] != "new" || e[1]["act"] != "push" || e[10]["act"] != "pop" {
		t.Fatalf("events = %v", e)
	}
	if e[0]["op"] != "heap" || e[0]["name"] != "pq" || e[1]["key"] != 5.0 || e[1]["prio"] != 5.0 {
		t.Fatalf("events = %v", e)
	}
	panics(t, "tk: Pop on an empty heap pq", func() { h.Pop() })
	panics(t, "tk: Peek on an empty heap pq", func() { h.Peek() })
}

func itemText(it heapItem) string {
	return strings.TrimSpace(strings.Join([]string{itoa(it.key), "(", itoa(it.prio), ")"}, ""))
}

// Pop moves the last item to slot 0 and sifts down to the smaller child, the left one on a tie.
func TestHeapPopTieGoesLeft(t *testing.T) {
	capture(t)
	h := Heap("h")
	h.Push(0, 0)
	h.Push(1, 1)
	h.Push(1, 1) // equal to its sibling
	h.Push(9, 9)
	h.Pop()
	// last (9,9) to slot 0; children (1,1) (1,1): left wins → [1 9 1]
	if itemText(h.items[0]) != "1(1)" || itemText(h.items[1]) != "9(9)" || itemText(h.items[2]) != "1(1)" {
		t.Fatalf("heap = %v", h.items)
	}
}

func TestQueue(t *testing.T) {
	evs := capture(t)
	q := Queue("q")
	q.Push(1)
	q.Push(2)
	if q.Pop() != 1 || q.Len() != 1 {
		t.Fatal("fifo")
	}
	q.Pop()
	panics(t, "tk: Pop on an empty queue q", func() { q.Pop() })
	if e := evs(); len(e) != 5 || e[3]["v"] != 1.0 || e[4]["v"] != 2.0 {
		t.Fatalf("events = %v", e)
	}
}

func TestDSU(t *testing.T) {
	evs := capture(t)
	uf := DSU("uf", 6)
	if !uf.Union(1, 2) { // equal sizes: 2's root under 1's
		t.Fatal("union")
	}
	if uf.parent[2] != 1 {
		t.Fatalf("parent = %v", uf.parent)
	}
	uf.Union(3, 1) // size(3)=1 < size(1)=2: 3 under 1
	if uf.parent[3] != 1 {
		t.Fatalf("parent = %v", uf.parent)
	}
	uf.Union(4, 5) // 5 under 4
	uf.Union(5, 2) // roots 4 (size 2) and 1 (size 3): 4 under 1
	if uf.parent[4] != 1 || uf.parent[5] != 4 {
		t.Fatalf("parent = %v", uf.parent)
	}
	if uf.Find(5) != 1 || uf.parent[5] != 1 { // full path compression
		t.Fatalf("parent = %v", uf.parent)
	}
	if uf.Union(2, 3) {
		t.Fatal("already joined")
	}
	panics(t, "tk: 6 is outside dsu uf (0..5)", func() { uf.Find(6) })
	panics(t, "tk: -1 is outside dsu uf (0..5)", func() { uf.Union(-1, 0) })
	e := evs()
	if len(e) != 7 || e[0]["n"] != 6.0 || e[1]["act"] != "union" || e[5]["act"] != "find" || e[5]["x"] != 5.0 {
		t.Fatalf("events = %v", e)
	}
}

func TestArrayAndMisuse(t *testing.T) {
	evs := capture(t)
	src := []int{3, 1, 2}
	a := Array("a", src)
	src[0] = 99 // the array keeps its own copy
	a.Set(0, 7)
	a.Swap(0, 2)
	a.Pointer("lo", -1)
	a.Pointer("hi", 3)
	a.Window(0, 1)
	s := Chars("s", "abcabcbb")
	panics(t, "tk: pointer lo → 99 is outside s (-1..8)", func() { s.Pointer("lo", 99) })
	panics(t, "tk: index 8 is outside s (0..7)", func() { s.Set(8, 1) })
	panics(t, "tk: index -1 is outside s (0..7)", func() { s.Swap(-1, 0) })
	panics(t, `tk: pointer label "a b" must match [A-Za-z0-9_]{1,16}`, func() { s.Pointer("a b", 0) })
	panics(t, `tk: pointer label "" must match [A-Za-z0-9_]{1,16}`, func() { s.Pointer("", 0) })
	panics(t, "tk: window [0..9] is outside s (-1..8)", func() { s.Window(0, 9) })
	e := evs()
	if len(e) != 7 {
		t.Fatalf("events = %v", e)
	}
	if v := e[0]["values"].([]any); v[0] != 3.0 || e[0]["chars"] != false {
		t.Fatalf("new = %v", e[0])
	}
	if e[6]["chars"] != true || e[6]["values"].([]any)[0] != float64('a') {
		t.Fatalf("chars = %v", e[6])
	}
	if e[3]["label"] != "lo" || e[3]["i"] != -1.0 || e[5]["lo"] != 0.0 || e[5]["hi"] != 1.0 {
		t.Fatalf("events = %v", e)
	}
}

func TestGraph(t *testing.T) {
	evs := capture(t)
	g := Graph("g", false)
	g.Edge(1, 2, 5)
	g.Edge(3, 1)
	g.Edge(2, 1, 7) // the same undirected edge: no new neighbour
	g.Visit(4)
	if n := g.Neighbors(1); len(n) != 2 || n[0] != 2 || n[1] != 3 {
		t.Fatalf("neighbors(1) = %v", n)
	}
	if n := g.Neighbors(4); len(n) != 0 {
		t.Fatalf("neighbors(4) = %v", n)
	}
	d := Graph("d", true)
	d.Edge(1, 2)
	if len(d.Neighbors(2)) != 0 || len(d.Neighbors(1)) != 1 {
		t.Fatal("directed")
	}
	panics(t, "tk: Edge takes at most one weight", func() { d.Edge(1, 2, 3, 4) })
	panics(t, "tk: graph node -1 must not be negative", func() { d.Visit(-1) })
	g.Dist(1, 0)
	g.Relax(1, 2, 5)
	g.Mark(2, "in 1")
	g.Node(9)
	long := strings.Repeat("x", 65)
	panics(t, "tk: mark label of 65 characters is longer than 64", func() { g.Mark(1, long) })
	g.Mark(1, strings.Repeat("é", 64)) // 64 characters is fine (not an event counted below: checked after)
	e := evs()[:11]
	if len(e) != 11 || e[0]["directed"] != false || e[1]["w"] != 5.0 || e[2]["w"] != nil {
		t.Fatalf("events = %v", e)
	}
	if e[8]["act"] != "relax" || e[8]["d"] != 5.0 || e[9]["label"] != "in 1" || e[10]["act"] != "node" {
		t.Fatalf("events = %v", e)
	}
}

func TestSearchListIntervalsTreeGame(t *testing.T) {
	evs := capture(t)
	s := Search("k", 1, 6)
	s.Mid(3, false)
	s.Lo(4)
	s.Hi(6)
	l := List("l")
	l.Node(0, 1)
	l.Node(1, 2)
	l.Next(0, 1)
	l.Next(1, -1)
	l.Pointer("curr", 0)
	l.Pointer("prev", -1)
	panics(t, "tk: list l has no node 5", func() { l.Next(5, 0) })
	panics(t, "tk: list l has no node 7", func() { l.Next(0, 7) })
	panics(t, "tk: list l has no node 3", func() { l.Pointer("p", 3) })
	panics(t, `tk: pointer label "bad-label" must match [A-Za-z0-9_]{1,16}`, func() { l.Pointer("bad-label", 0) })
	iv := Intervals("in", [][]int{{1, 3}, {2, 6}})
	iv.Add(8, 10)
	iv.Set(0, 1, 6)
	iv.Mark(1, "merged")
	panics(t, "tk: index 3 is outside in (0..2)", func() { iv.Mark(3, "x") })
	tr := Tree("t")
	tr.Node(0, 1, -1, "")
	tr.Node(1, 2, 0, "L")
	tr.Visit(1)
	tr.Mark(1, "h=1")
	panics(t, "tk: tree t has no node 5 (the parent of 2)", func() { tr.Node(2, 3, 5, "L") })
	panics(t, "tk: tree t: the L side of 0 is already taken", func() { tr.Node(2, 3, 0, "L") })
	panics(t, `tk: tree t: side "X" must be "L" or "R"`, func() { tr.Node(2, 3, 0, "X") })
	panics(t, "tk: tree t already has a root", func() { tr.Node(2, 3, -1, "") })
	panics(t, "tk: tree t already has node 1", func() { tr.Node(1, 3, 0, "R") })
	panics(t, "tk: tree t has no node 4", func() { tr.Visit(4) })
	gt := GameTable("g", "0-0", "0-1")
	gt.Set("0-1", "win", 3)
	gt.Set("1-1", "draw")
	panics(t, `tk: outcome "tie" must be win, lose or draw`, func() { gt.Set("0-0", "tie") })
	panics(t, `tk: game state "a b" must match [A-Za-z0-9,._-]{1,32}`, func() { gt.Set("a b", "win") })
	panics(t, `tk: game state "x y" must match [A-Za-z0-9,._-]{1,32}`, func() { GameTable("h", "x y") })
	panics(t, "tk: Set takes at most one value", func() { gt.Set("0-0", "win", 1, 2) })
	e := evs()
	want := []string{"search new", "search mid", "search lo", "search hi", "list new", "list node", "list node", "list next", "list next", "list pointer", "list pointer",
		"intervals new", "intervals add", "intervals set", "intervals mark", "tree new", "tree node", "tree node", "tree visit", "tree mark", "game new", "game set", "game set"}
	if len(e) != len(want) {
		t.Fatalf("events = %v", e)
	}
	for k, w := range want {
		if e[k]["op"].(string)+" "+e[k]["act"].(string) != w {
			t.Fatalf("event %d = %v, want %s", k, e[k], w)
		}
	}
	if e[1]["pred"] != false || e[0]["lo"] != 1.0 || e[0]["hi"] != 6.0 || e[8]["next"] != -1.0 || e[10]["id"] != -1.0 {
		t.Fatalf("events = %v", e)
	}
	if e[17]["parent"] != 0.0 || e[17]["side"] != "L" || e[16]["side"] != "" || e[21]["value"] != 3.0 || e[22]["value"] != nil {
		t.Fatalf("events = %v", e)
	}
	if s := e[20]["states"].([]any); len(s) != 2 || s[1] != "0-1" {
		t.Fatalf("game new = %v", e[20])
	}
}

// One cap for DP and family events; working structures keep working past it.
func TestSharedCap(t *testing.T) {
	evs := capture(t)
	tb := Table("dp", 1, 1)
	for i := 0; i < 15000; i++ {
		tb.Set(0, 0, i)
	}
	g := Graph("g", true)
	for i := 0; i < 15000; i++ {
		g.Visit(i % 10)
	}
	h := Heap("h")
	h.Push(1, 1)
	if h.Len() != 1 {
		t.Fatal("heap must work past the cap")
	}
	if Events() != MaxEvents || !truncated {
		t.Fatalf("events = %d truncated = %v", Events(), truncated)
	}
	if n := len(evs()); n != MaxEvents-15001 {
		t.Fatalf("family events = %d", n)
	}
}

// Addendum 3: structure names are at most 64 characters.
func TestNameLength(t *testing.T) {
	capture(t)
	long := strings.Repeat("n", 65)
	want := "tk: name of 65 characters is longer than 64"
	for _, f := range []func(){
		func() { Graph(long, true) }, func() { Heap(long) }, func() { Queue(long) }, func() { DSU(long, 1) }, func() { Array(long, nil) },
		func() { Chars(long, "") }, func() { Search(long, 0, 1) }, func() { List(long) }, func() { Intervals(long, nil) }, func() { Tree(long) },
		func() { GameTable(long) },
	} {
		panics(t, want, f)
	}
	Heap(strings.Repeat("é", 64))
}

// Addendum 4: ints in toolkit calls lie within ±2^53; a DSU has at most 5,000,000 elements.
func TestSafeInts(t *testing.T) {
	capture(t)
	big := 1 << 53
	want := "tk: 9007199254740992 is too large to draw (beyond ±2^53)"
	h := Heap("h")
	tb := Table("dp", 1, 1)
	for _, f := range []func(){
		func() { h.Push(1, big) }, func() { h.Push(-big, 1) }, func() { Graph("g", true).Dist(1, big) }, func() { Array("a", []int{big}) },
		func() { Search("s", 0, big) }, func() { tb.Set(0, 0, big) }, func() { Enter("f", big) }, func() { Exit(big) },
		func() { GameTable("g").Set("a", "win", big) }, func() { Intervals("i", [][]int{{0, big}}) },
	} {
		if f == nil {
			continue
		}
		func() {
			defer func() {
				r := recover()
				if s, _ := r.(string); s != want && s != "tk: -9007199254740992 is too large to draw (beyond ±2^53)" {
					t.Fatalf("panic %v", r)
				}
			}()
			f()
		}()
	}
	h.Push(1, 1<<53-1)
	panics(t, want, func() { Dep(big, 0) })
	panics(t, "tk: dsu u size 5000001 is over 5000000", func() { DSU("u", 5_000_001) })
	DSU("u", 5_000_000)
}

func TestStructureIDs(t *testing.T) {
	evs := capture(t)
	Heap("a")
	Queue("a")
	Graph("a", true)
	e := evs()
	if e[0]["sid"] != 0.0 || e[1]["sid"] != 1.0 || e[2]["sid"] != 2.0 {
		t.Fatalf("events = %v", e)
	}
}

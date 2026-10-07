// Package tk is the Dojo step toolkit (C-RUNNER §3, C-VISUAL §1–§2). Every call below is one event, written in program
// order as one compact line to file descriptor 3, which the Dojo harness reads. The learner's own
// stdout is never touched. Events are capped at MaxEvents; past that a single "Z" line marks the run
// as truncated and the rest are dropped (the program itself keeps running normally).
//
// Wire lines (space separated; names and formats are JSON strings). Each line starts with the run's
// key and a space (see internal/wire); the runner drops lines without it.
//
//	T id rows cols "name"          table created            (event)
//	S id i j v rule nd [di dj]...  cell written; rule -1=none (event)
//	G id i j v                     cell read                (event)
//	R rid "format"                 rule text, defined once  (not an event)
//	F fid "fn"                     function name, once      (not an event)
//	E fid n a1..an                 call entered             (event)
//	H fid n a1..an                 cache hit (a leaf)       (event)
//	X v                            return from latest Enter (event)
//	L "fn" "table"                 fn(a)->(0,a), fn(a,b)->(a,b) (event)
//	Z                              truncated                (not an event)
//	C id                           case id starts           (not an event; the runner marks the
//	                               case's first event with it, so the view can reset its call stack)
//	V {json}                       a family event (families.go): the step as the page receives it (event)
//
// Each event line is written out as it happens (at most MaxEvents writes per run, which costs
// nothing measurable), so a run that times out, is killed, calls os.Exit or overflows its stack
// still shows every step up to the failure. The toolkit is safe for concurrent use.
package tk

import (
	"bufio"
	"os"
	"strconv"
	"sync"

	"dojo/tk/internal/wire"
)

// MaxEvents is the cap on events per run.
const MaxEvents = 20000

var (
	mu        sync.Mutex
	out       = bufio.NewWriterSize(os.NewFile(3, "dojo-events"), 64*1024)
	events    int
	truncated bool
	buf       []byte
	rules     = map[string]int{}
	fns       = map[string]int{}
	tables    int
	structs   int
)

// begin reports whether one more event may be written, marking the run truncated past the cap.
func begin() bool {
	if events >= MaxEvents {
		if !truncated {
			truncated = true
			out.Write(append(wire.Frame(nil), "Z\n"...))
			out.Flush() // the capped run is complete: nothing after this is kept
		}
		return false
	}
	events++
	buf = wire.Frame(buf[:0])
	return true
}

func num(v int)    { buf = append(buf, ' '); buf = strconv.AppendInt(buf, int64(v), 10) }
func str(s string) { buf = append(buf, ' '); buf = appendJSON(buf, s) }

// appendJSON appends s as a JSON string (invalid UTF-8 becomes U+FFFD).
func appendJSON(b []byte, s string) []byte {
	const hex = "0123456789abcdef"
	b = append(b, '"')
	for _, r := range s {
		switch {
		case r == '"' || r == '\\':
			b = append(b, '\\', byte(r))
		case r < 0x20:
			b = append(b, '\\', 'u', '0', '0', hex[r>>4], hex[r&15])
		default:
			b = append(b, string(r)...)
		}
	}
	return append(b, '"')
}

// emit writes the event line and flushes it at once (see the package comment).
func emit() { buf = append(buf, '\n'); out.Write(buf); out.Flush() }

// def writes a definition line (not an event) for a name, once, and returns its id.
func def(m map[string]int, tag byte, s string) int {
	if id, ok := m[s]; ok {
		return id
	}
	id := len(m)
	m[s] = id
	line := append(wire.Frame(nil), tag, ' ')
	line = strconv.AppendInt(line, int64(id), 10)
	line = append(line, ' ')
	line = appendJSON(line, s)
	line = append(line, '\n')
	out.Write(line)
	return id
}

// Flush writes buffered events. The harness calls it after each case (and when one panics).
func Flush() {
	mu.Lock()
	out.Flush()
	mu.Unlock()
}

// caseStart writes the (internal, uncounted) marker for case id. Called by DojoHarness.
func caseStart(id int) {
	mu.Lock()
	defer mu.Unlock()
	line := append(wire.Frame(nil), 'C', ' ')
	line = strconv.AppendInt(line, int64(id), 10)
	out.Write(append(line, '\n'))
	out.Flush()
}

// Events reports how many events were written (for tests).
func Events() int { return events }

// Opt is an option for Tab.Set: a dependency (Dep) or a recurrence format (Rule).
type Opt struct {
	dep    bool
	i, j   int
	rule   string
	isRule bool
}

// Dep names a cell this value came from. Repeat it for several deps; their order is the {0}, {1}… order.
func Dep(i, j int) Opt { safe(i, j); return Opt{dep: true, i: i, j: j} }

// Rule is the recurrence format; {0}, {1}… are the deps in order, e.g. tk.Rule("{0} + {1}").
func Rule(format string) Opt { return Opt{rule: format, isRule: true} }

// Tab is a DP table (rows = 1 for a 1-D table).
type Tab struct {
	id         int
	name       string
	rows, cols int
	vals       []int
}

// Table creates a table of rows×cols cells, all unset.
func Table(name string, rows, cols int) *Tab {
	mu.Lock()
	defer mu.Unlock()
	if rows < 0 || cols < 0 {
		panic("tk.Table: rows and cols must not be negative")
	}
	safe(rows, cols)
	t := &Tab{id: tables, name: name, rows: rows, cols: cols, vals: make([]int, rows*cols)}
	tables++
	if begin() {
		buf = append(buf, 'T')
		num(t.id)
		num(rows)
		num(cols)
		str(name)
		emit()
	}
	return t
}

func (t *Tab) at(i, j int, op string) int {
	if i < 0 || i >= t.rows || j < 0 || j >= t.cols {
		panic("tk: " + op + " " + t.name + "[" + strconv.Itoa(i) + "][" + strconv.Itoa(j) + "] is outside the " +
			strconv.Itoa(t.rows) + "x" + strconv.Itoa(t.cols) + " table")
	}
	return i*t.cols + j
}

// Set writes v at (i, j). Options: tk.Dep(i, j) (repeatable) and tk.Rule(format).
func (t *Tab) Set(i, j int, v int, opts ...Opt) {
	mu.Lock()
	defer mu.Unlock()
	k := t.at(i, j, "Set")
	safe(v)
	t.vals[k] = v
	if events >= MaxEvents {
		begin()
		return
	}
	rule := -1
	for _, o := range opts {
		if o.isRule {
			rule = def(rules, 'R', o.rule)
		}
	}
	if !begin() {
		return
	}
	buf = append(buf, 'S')
	num(t.id)
	num(i)
	num(j)
	num(v)
	num(rule)
	nd := 0
	for _, o := range opts {
		if o.dep {
			nd++
		}
	}
	num(nd)
	for _, o := range opts {
		if o.dep {
			num(o.i)
			num(o.j)
		}
	}
	emit()
}

// Get reads (i, j); an unset cell reads 0.
func (t *Tab) Get(i, j int) int {
	mu.Lock()
	defer mu.Unlock()
	v := t.vals[t.at(i, j, "Get")]
	if begin() {
		buf = append(buf, 'G')
		num(t.id)
		num(i)
		num(j)
		num(v)
		emit()
	}
	return v
}

// Rows and Cols report the table's size.
func (t *Tab) Rows() int { return t.rows }
func (t *Tab) Cols() int { return t.cols }

func call(tag byte, fn string, args []int) {
	mu.Lock()
	defer mu.Unlock()
	safe(args...)
	if events >= MaxEvents {
		begin()
		return
	}
	id := def(fns, 'F', fn)
	if !begin() {
		return
	}
	buf = append(buf, tag)
	num(id)
	num(len(args))
	for _, a := range args {
		num(a)
	}
	emit()
}

// Enter marks a call fn(args...) in a top-down solution.
func Enter(fn string, args ...int) { call('E', fn, args) }

// Hit marks a cache hit for fn(args...); it is a leaf (no Exit).
func Hit(fn string, args ...int) { call('H', fn, args) }

// Exit returns v from the latest Enter.
func Exit(v int) {
	mu.Lock()
	defer mu.Unlock()
	safe(v)
	if begin() {
		buf = append(buf, 'X')
		num(v)
		emit()
	}
}

// Link maps fn(a) to cell (0,a) and fn(a,b) to cell (a,b) of the named table.
func Link(fn, table string) {
	mu.Lock()
	defer mu.Unlock()
	if begin() {
		buf = append(buf, 'L')
		str(fn)
		str(table)
		emit()
	}
}

// GridT is a rows×cols grid of ints. It records nothing (C-VISUAL §1: Grid drawing is left out).
type GridT struct {
	rows, cols int
	v          []int
}

// Grid makes a rows×cols grid of zeros.
func Grid(rows, cols int) *GridT {
	return &GridT{rows: rows, cols: cols, v: make([]int, rows*cols)}
}

func (g *GridT) at(r, c int) int {
	if r < 0 || r >= g.rows || c < 0 || c >= g.cols {
		panic("tk.Grid: (" + strconv.Itoa(r) + "," + strconv.Itoa(c) + ") is outside the grid")
	}
	return r*g.cols + c
}

// Set writes v at (r, c).
func (g *GridT) Set(r, c, v int) { g.v[g.at(r, c)] = v }

// Get reads (r, c).
func (g *GridT) Get(r, c int) int { return g.v[g.at(r, c)] }

// Visit marks (r, c) as visited.
func (g *GridT) Visit(r, c int) { g.at(r, c) }

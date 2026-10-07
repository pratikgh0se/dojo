"""dojo.tk: the Dojo step toolkit for Python (C-PYTHON section 2).

The same API and the same events as the Go toolkit (C-RUNNER section 3 and Addendum 1):

    t = tk.Table(name, rows, cols)        t.Set(i, j, v, *opts)      t.Get(i, j)
    tk.Dep(i, j)   tk.Rule(fmt)           (options of Set; not events)
    tk.Enter(fn, *args)  tk.Hit(fn, *args)  tk.Exit(v)  tk.Link(fn, table)

Table, Set, Get, Link, Enter, Hit and Exit are events, in program order across every case of the
run, capped at MAX_EVENTS (past that the run is marked truncated and the program keeps running).

The visual families (C-VISUAL sections 1-2) share that cap: Heap, Queue and DSU really work; Graph,
Array/Chars, Search, List, Intervals, Tree and GameTable record what they are told. A family event is
{"op": family, "sid": structure id, "act": action, ...fields}, exactly as the Go toolkit writes it.
Misuse raises (IndexError or ValueError) with a message starting "tk". Grid records nothing.
"""

MAX_EVENTS = 20000


class _State:
    def __init__(self):
        self.events = []
        self.truncated = False
        self.tables = 0
        self.structs = 0
        self.case = None  # the case whose first event is still to come


_st = _State()


def _reset():
    global _st
    _st = _State()


def _case_start(case_id):
    _st.case = case_id


def _begin():
    """True when one more event may be written; marks the run truncated past the cap."""
    if len(_st.events) >= MAX_EVENTS:
        _st.truncated = True
        return False
    return True


def _emit(ev):
    if _st.case is not None:
        ev["case"] = _st.case
        _st.case = None
    _st.events.append(ev)


_MAX_SAFE = (1 << 53) - 1


def _int(v, what):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        if v > _MAX_SAFE or v < -_MAX_SAFE:
            raise ValueError("tk: %d is too large to draw (beyond ±2^53)" % v)
        return v
    if isinstance(v, float) and v.is_integer():
        return _int(int(v), what)  # an integral float is held to the same ±2^53 bound
    raise TypeError("tk: %s must be an int, got %r" % (what, v))


def _name(fn):
    if isinstance(fn, str):
        return fn
    n = getattr(fn, "__name__", None)
    if isinstance(n, str):
        return n
    raise TypeError("tk: fn must be a function name (a string), got %r" % (fn,))


class Opt:
    """An option of Table.Set: a dependency (Dep) or a recurrence format (Rule)."""

    __slots__ = ("dep", "i", "j", "rule", "is_rule")

    def __init__(self, dep=False, i=0, j=0, rule="", is_rule=False):
        self.dep, self.i, self.j, self.rule, self.is_rule = dep, i, j, rule, is_rule


def Dep(i, j=0):
    """A cell this value came from. Repeat it for several deps; their order is the {0}, {1}... order."""
    return Opt(dep=True, i=_int(i, "Dep i"), j=_int(j, "Dep j"))


def Rule(fmt):
    """The recurrence format; {0}, {1}... are the deps in order, e.g. tk.Rule("{0} + {1}")."""
    return Opt(rule=str(fmt), is_rule=True)


class Table:
    """A DP table (rows = 1 for a 1-D table). Prefer tk.Table(name, rows, cols)."""

    def __init__(self, name, rows, cols):
        rows, cols = _int(rows, "rows"), _int(cols, "cols")
        if rows < 0 or cols < 0:
            raise ValueError("tk.Table: rows and cols must not be negative")
        self.name, self.rows, self.cols = str(name), rows, cols
        self.id = _st.tables
        _st.tables += 1
        self._vals = [0] * (rows * cols)
        if _begin():
            _emit({"op": "table", "t": self.id, "rows": rows, "cols": cols, "name": self.name})

    def _at(self, i, j, op):
        i, j = _int(i, "i"), _int(j, "j")
        if i < 0 or i >= self.rows or j < 0 or j >= self.cols:
            raise IndexError("tk: %s %s[%d][%d] is outside the %dx%d table" % (op, self.name, i, j, self.rows, self.cols))
        return i * self.cols + j

    def Set(self, i, j, v, *opts):
        """Writes v at (i, j). Options: tk.Dep(i, j) (repeatable) and tk.Rule(format)."""
        k = self._at(i, j, "Set")
        v = _int(v, "v")
        self._vals[k] = v
        if len(_st.events) >= MAX_EVENTS:
            _begin()
            return
        rule = None
        deps = []
        for o in opts:
            if not isinstance(o, Opt):
                raise TypeError("tk: Set options must be tk.Dep(...) or tk.Rule(...), got %r" % (o,))
            if o.is_rule:
                rule = o.rule
            elif o.dep:
                deps.append([o.i, o.j])
        if not _begin():
            return
        ev = {"op": "set", "t": self.id, "i": int(i), "j": int(j), "v": v, "deps": deps}
        if rule is not None:
            ev["rule"] = rule
        _emit(ev)

    def Get(self, i, j):
        """Reads (i, j); an unset cell reads 0."""
        k = self._at(i, j, "Get")
        v = self._vals[k]
        if _begin():
            _emit({"op": "get", "t": self.id, "i": int(i), "j": int(j), "v": v})
        return v

    def Rows(self):
        return self.rows

    def Cols(self):
        return self.cols


def _call(op, fn, args):
    name = _name(fn)
    vals = [_int(a, "argument") for a in args]
    if _begin():
        _emit({"op": op, "fn": name, "args": vals})


def Enter(fn, *args):
    """Marks a call fn(args...) in a top-down solution."""
    _call("enter", fn, args)


def Hit(fn, *args):
    """Marks a cache hit for fn(args...); it is a leaf (no Exit)."""
    _call("hit", fn, args)


def Exit(v):
    """Returns v from the latest Enter."""
    v = _int(v, "v")
    if _begin():
        _emit({"op": "exit", "v": v})


def Link(fn, table):
    """Maps fn(a) to cell (0, a) and fn(a, b) to cell (a, b) of the named table."""
    name, tname = _name(fn), str(table)
    if _begin():
        _emit({"op": "link", "fn": name, "table": tname})


# ---- structures ----

class Grid:
    """A rows x cols grid of ints. It records nothing (C-VISUAL section 1: Grid drawing is left out)."""

    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        self._v = [0] * (rows * cols)

    def _at(self, r, c):
        if r < 0 or r >= self.rows or c < 0 or c >= self.cols:
            raise IndexError("tk.Grid: (%d,%d) is outside the grid" % (r, c))
        return r * self.cols + c

    def Set(self, r, c, v):
        self._v[self._at(r, c)] = v

    def Get(self, r, c):
        return self._v[self._at(r, c)]

    def Visit(self, r, c):
        self._at(r, c)


# ---- the visual families (C-VISUAL sections 1-2) ----

_LABEL_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_")
_STATE_CHARS = _LABEL_CHARS | frozenset(",.-")


def _new_id():
    _st.structs += 1
    return _st.structs - 1


def _fam(op, sid, act, **fields):
    """Records one family event (fields that are None are left out); nothing past the cap."""
    if not _begin():
        return
    ev = {"op": op, "sid": sid, "act": act}
    for k, v in fields.items():
        if v is not None:
            ev[k] = v
    _emit(ev)


def _nid(v, what):
    """An int where Go uses -1 for "none"; Python also accepts None."""
    return -1 if v is None else _int(v, what)


def _q(s):
    import json
    return json.dumps(s, ensure_ascii=False)


def _label(label):
    label = label if isinstance(label, str) else str(label)
    if not (1 <= len(label) <= 16) or any(c not in _LABEL_CHARS for c in label):
        raise ValueError("tk: pointer label %s must match [A-Za-z0-9_]{1,16}" % _q(label))
    return label


def _state(state):
    state = state if isinstance(state, str) else str(state)
    if not (1 <= len(state) <= 32) or any(c not in _STATE_CHARS for c in state):
        raise ValueError("tk: game state %s must match [A-Za-z0-9,._-]{1,32}" % _q(state))
    return state


def _mark(label):
    """Mark labels (Graph, Intervals, Tree) are free text of at most 64 characters (C-VISUAL Addendum 1 Q2)."""
    label = _text(label)
    if len(label) > 64:
        raise ValueError("tk: mark label of %d characters is longer than 64" % len(label))
    return label


def _sname(name):
    """Structure names are at most 64 characters (C-VISUAL Addendum 3)."""
    name = _text(name)
    if len(name) > 64:
        raise ValueError("tk: name of %d characters is longer than 64" % len(name))
    return name


def _text(v):
    return v if isinstance(v, str) else str(v)


class Graph:
    """A graph the learner draws: tk.Graph(name, directed). Nodes are ints, auto-created by Edge, Visit, Dist, Relax and Mark."""

    def __init__(self, name, directed):
        self.name, self.directed = _sname(name), bool(directed)
        self._adj = {}
        self._edges = set()
        self._s = _new_id()
        _fam("graph", self._s, "new", name=self.name, directed=self.directed)

    def _node(self, u):
        u = _int(u, "node")
        if u < 0:
            raise ValueError("tk: graph node %d must not be negative" % u)
        self._adj.setdefault(u, [])
        return u

    def Node(self, u):
        u = self._node(u)
        _fam("graph", self._s, "node", u=u)

    def Edge(self, u, v, w=None):
        u, v = self._node(u), self._node(v)
        w = None if w is None else _int(w, "weight")
        k = (u, v) if self.directed or u <= v else (v, u)
        if k not in self._edges:
            self._edges.add(k)
            self._adj[u].append(v)
            if not self.directed and u != v:
                self._adj[v].append(u)
        _fam("graph", self._s, "edge", u=u, v=v, w=w)

    def Visit(self, u):
        _fam("graph", self._s, "visit", u=self._node(u))

    def Dist(self, u, d):
        _fam("graph", self._s, "dist", u=self._node(u), d=_int(d, "dist"))

    def Relax(self, u, v, d):
        u, v = self._node(u), self._node(v)
        _fam("graph", self._s, "relax", u=u, v=v, d=_int(d, "dist"))

    def Mark(self, u, label):
        _fam("graph", self._s, "mark", u=self._node(u), label=_mark(label))

    def Neighbors(self, u):
        """Out-neighbours in insertion order (both directions when undirected). Not an event."""
        return list(self._adj.get(_int(u, "node"), []))


class Heap:
    """A binary min-heap of (key, prio), ordered by (prio, key): tk.Heap(name)."""

    def __init__(self, name="heap"):
        self.name = _sname(name)
        self._a = []
        self._s = _new_id()
        _fam("heap", self._s, "new", name=self.name)

    def Push(self, key, prio):
        it = (_int(prio, "prio"), _int(key, "key"))
        a = self._a
        a.append(it)
        i = len(a) - 1
        while i > 0:
            p = (i - 1) // 2
            if not it < a[p]:
                break
            a[i], a[p] = a[p], a[i]
            i = p
        _fam("heap", self._s, "push", key=it[1], prio=it[0])

    def Pop(self):
        a = self._a
        if not a:
            raise IndexError("tk: Pop on an empty heap " + self.name)
        top = a[0]
        last = a.pop()
        if a:
            a[0] = last
            i, n = 0, len(a)
            while True:
                l, r = 2 * i + 1, 2 * i + 2
                if l >= n:
                    break
                c = r if r < n and a[r] < a[l] else l
                if not a[c] < a[i]:
                    break
                a[c], a[i] = a[i], a[c]
                i = c
        _fam("heap", self._s, "pop", key=top[1], prio=top[0])
        return (top[1], top[0])

    def Peek(self):
        if not self._a:
            raise IndexError("tk: Peek on an empty heap " + self.name)
        return (self._a[0][1], self._a[0][0])

    def Len(self):
        return len(self._a)


class Queue:
    """A FIFO of ints: tk.Queue(name)."""

    def __init__(self, name="queue"):
        import collections
        self.name = _sname(name)
        self._items = collections.deque()
        self._s = _new_id()
        _fam("queue", self._s, "new", name=self.name)

    def Push(self, v):
        v = _int(v, "v")
        self._items.append(v)
        _fam("queue", self._s, "push", v=v)

    def Pop(self):
        if not self._items:
            raise IndexError("tk: Pop on an empty queue " + self.name)
        v = self._items.popleft()
        _fam("queue", self._s, "pop", v=v)
        return v

    def Len(self):
        return len(self._items)


class DSU:
    """Union-find over 0..n-1 with full path compression and union by size: tk.DSU(name, n).
    Sparse (C-VISUAL Addendum 4): only touched elements are stored; a missing parent is the element itself."""

    def __init__(self, name, n):
        n = _int(n, "n")
        self.name = _sname(name)
        if n < 0:
            raise ValueError("tk: dsu %s size %d must not be negative" % (self.name, n))
        if n > 5000000:
            raise ValueError("tk: dsu %s size %d is over 5000000" % (self.name, n))
        self._n = n
        self._parent = {}
        self._size = {}
        self._s = _new_id()
        _fam("dsu", self._s, "new", name=self.name, n=n)

    def _check(self, x):
        x = _int(x, "x")
        if x < 0 or x >= self._n:
            raise IndexError("tk: %d is outside dsu %s (0..%d)" % (x, self.name, self._n - 1))
        return x

    def _find(self, x):
        p = self._parent
        r = x
        while p.get(r, r) != r:
            r = p[r]
        while p.get(x, x) != r:
            p[x], x = r, p[x]
        return r

    def Union(self, a, b):
        a, b = self._check(a), self._check(b)
        ra, rb = self._find(a), self._find(b)
        joined = ra != rb
        if joined:
            sa, sb = self._size.get(ra, 1), self._size.get(rb, 1)
            if sa < sb:
                ra, rb = rb, ra
            self._parent[rb] = ra
            self._size[ra] = sa + sb
        _fam("dsu", self._s, "union", a=a, b=b)
        return joined

    def Find(self, x):
        x = self._check(x)
        r = self._find(x)
        _fam("dsu", self._s, "find", x=x)
        return r


class Array:
    """An array the learner draws (its own copy of the values): tk.Array(name, values) or tk.Chars(name, s)."""

    def __init__(self, name, values, _chars=False):
        self.name = _sname(name)
        self._chars = _chars
        self._v = [_int(x, "value") for x in values]
        self._s = _new_id()
        _fam("array", self._s, "new", name=self.name, values=list(self._v), chars=_chars)

    def _check(self, i):
        i = _int(i, "index")
        if i < 0 or i >= len(self._v):
            raise IndexError("tk: index %d is outside %s (0..%d)" % (i, self.name, len(self._v) - 1))
        return i

    def Set(self, i, v):
        i = self._check(i)
        if isinstance(v, str) and len(v) == 1:
            v = ord(v)
        v = _int(v, "v")
        self._v[i] = v
        _fam("array", self._s, "set", i=i, v=v)

    def Swap(self, i, j):
        i, j = self._check(i), self._check(j)
        self._v[i], self._v[j] = self._v[j], self._v[i]
        _fam("array", self._s, "swap", i=i, j=j)

    def Pointer(self, label, i):
        label = _label(label)
        i = _nid(i, "index")
        if i < -1 or i > len(self._v):
            raise IndexError("tk: pointer %s → %d is outside %s (-1..%d)" % (label, i, self.name, len(self._v)))
        _fam("array", self._s, "pointer", label=label, i=i)

    def Window(self, lo, hi):
        lo, hi = _int(lo, "lo"), _int(hi, "hi")
        n = len(self._v)
        if lo < -1 or lo > n or hi < -1 or hi > n:
            raise IndexError("tk: window [%d..%d] is outside %s (-1..%d)" % (lo, hi, self.name, n))
        _fam("array", self._s, "window", lo=lo, hi=hi)


def Chars(name, s):
    """An array of the characters of s."""
    return Array(_sname(name), [ord(c) for c in _text(s)], _chars=True)


class Search:
    """A binary search the learner draws: tk.Search(name, lo, hi); Mid(m, pred); Lo(v); Hi(v)."""

    def __init__(self, name, lo, hi):
        self.name = _sname(name)
        self._s = _new_id()
        _fam("search", self._s, "new", name=self.name, lo=_int(lo, "lo"), hi=_int(hi, "hi"))

    def Mid(self, m, pred):
        _fam("search", self._s, "mid", m=_int(m, "m"), pred=bool(pred))

    def Lo(self, v):
        _fam("search", self._s, "lo", v=_int(v, "v"))

    def Hi(self, v):
        _fam("search", self._s, "hi", v=_int(v, "v"))


class List:
    """A linked list the learner draws: nodes by id, Next links and pointers (-1 or None = nil)."""

    def __init__(self, name):
        self.name = _sname(name)
        self._nodes = set()
        self._s = _new_id()
        _fam("list", self._s, "new", name=self.name)

    def _has(self, i):
        if i not in self._nodes:
            raise ValueError("tk: list %s has no node %d" % (self.name, i))

    def Node(self, id, val):
        id, val = _int(id, "id"), _int(val, "val")
        if id < 0:
            raise ValueError("tk: list %s node id %d must not be negative" % (self.name, id))
        self._nodes.add(id)
        _fam("list", self._s, "node", id=id, val=val)

    def Next(self, id, next):
        id, next = _int(id, "id"), _nid(next, "next")
        self._has(id)
        if next != -1:
            self._has(next)
        _fam("list", self._s, "next", id=id, next=next)

    def Pointer(self, label, id):
        label = _label(label)
        id = _nid(id, "id")
        if id != -1:
            self._has(id)
        _fam("list", self._s, "pointer", label=label, id=id)


class Intervals:
    """A list of [start, end] intervals the learner draws: tk.Intervals(name, items)."""

    def __init__(self, name, items=None):
        self.name = _sname(name)
        rows = []
        for k, it in enumerate(items or []):
            it = list(it)
            if len(it) != 2:
                raise ValueError("tk: interval %d of %s must be [start, end]" % (k, self.name))
            rows.append([_int(it[0], "start"), _int(it[1], "end")])
        self._n = len(rows)
        self._s = _new_id()
        _fam("intervals", self._s, "new", name=self.name, items=rows)

    def _check(self, i):
        i = _int(i, "index")
        if i < 0 or i >= self._n:
            raise IndexError("tk: index %d is outside %s (0..%d)" % (i, self.name, self._n - 1))
        return i

    def Add(self, s, e):
        s, e = _int(s, "start"), _int(e, "end")
        self._n += 1
        _fam("intervals", self._s, "add", s=s, e=e)

    def Set(self, i, s, e):
        i = self._check(i)
        _fam("intervals", self._s, "set", i=i, s=_int(s, "start"), e=_int(e, "end"))

    def Mark(self, i, label):
        i = self._check(i)
        _fam("intervals", self._s, "mark", i=i, label=_mark(label))


class Tree:
    """A binary tree the learner draws: Node(id, val, parent, side) (the root: parent -1 or None, side "")."""

    def __init__(self, name):
        self.name = _sname(name)
        self._nodes = {}
        self._root = False
        self._s = _new_id()
        _fam("tree", self._s, "new", name=self.name)

    def _has(self, i):
        if i not in self._nodes:
            raise ValueError("tk: tree %s has no node %d" % (self.name, i))

    def Node(self, id, val, parent=-1, side=""):
        id, val, parent = _int(id, "id"), _int(val, "val"), _nid(parent, "parent")
        side = "" if side is None else _text(side)
        if id < 0:
            raise ValueError("tk: tree %s node id %d must not be negative" % (self.name, id))
        if id in self._nodes:
            raise ValueError("tk: tree %s already has node %d" % (self.name, id))
        if parent == -1:
            if side != "":
                raise ValueError('tk: tree %s: the root\'s side must be ""' % self.name)
            if self._root:
                raise ValueError("tk: tree %s already has a root" % self.name)
            self._root = True
        else:
            p = self._nodes.get(parent)
            if p is None:
                raise ValueError("tk: tree %s has no node %d (the parent of %d)" % (self.name, parent, id))
            if side not in ("L", "R"):
                raise ValueError('tk: tree %s: side %s must be "L" or "R"' % (self.name, _q(side)))
            if side in p:
                raise ValueError("tk: tree %s: the %s side of %d is already taken" % (self.name, side, parent))
            p.add(side)
        self._nodes[id] = set()
        _fam("tree", self._s, "node", id=id, val=val, parent=parent, side=side)

    def Visit(self, id):
        id = _int(id, "id")
        self._has(id)
        _fam("tree", self._s, "visit", id=id)

    def Mark(self, id, label):
        id = _int(id, "id")
        self._has(id)
        _fam("tree", self._s, "mark", id=id, label=_mark(label))


class GameTable:
    """Game states and their outcomes ("win", "lose" or "draw", with an optional value): tk.GameTable(name, *states)."""

    def __init__(self, name, *states):
        self.name = _sname(name)
        declared = [_state(x) for x in states]
        self._s = _new_id()
        _fam("game", self._s, "new", name=self.name, states=declared)

    def Set(self, state, outcome, value=None):
        state = _state(state)
        outcome = _text(outcome)
        if outcome not in ("win", "lose", "draw"):
            raise ValueError("tk: outcome %s must be win, lose or draw" % _q(outcome))
        _fam("game", self._s, "set", state=state, outcome=outcome, value=None if value is None else _int(value, "value"))

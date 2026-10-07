"""The Dojo runner's side of a Python run (C-PYTHON). Runs inside Pyodide, in the sandboxed worker.

run(code, cases_json, fn_name) compiles the learner's module, calls fn_name once per case with the
arguments read from the case's `call` text (the public pack's own text, for example
`coinChange([1,2,5], 11)`) and returns one JSON string:

    {status, cases: [{id, got}], errors, stdout, steps, truncated, ms}

It never sees `expected`; the frame (judge.js) builds the final cases and decides pass/fail. The wall-clock limit is not here: the
frame terminates the worker. This file only handles output, memory and the error mapping.
"""
import ast
import builtins
import json
import sys
import time
import types

LEARNER_FILE = "<learner>"
STDOUT_CAP = 1 << 20  # 1 MiB of stdout
SHOWN_ON_LIMIT = 64 * 1024  # C-PYTHON Addendum 2 Q2: run-stdout shows the first 64 KiB, then the mark
_TK_SOURCE = ""


class _OutputLimit(BaseException):
    """Raised inside the learner's print once the 1 MiB cap is passed."""


class _Out:
    def __init__(self, cap=STDOUT_CAP):
        self.parts = []
        self.n = 0
        self.cap = cap
        self.exceeded = False
        self.encoding = "utf-8"
        self.errors = "strict"

    def write(self, s):
        if not isinstance(s, str):
            raise TypeError("write() argument must be str, not %s" % type(s).__name__)
        if self.exceeded:
            raise _OutputLimit()
        self.n += len(s)
        if self.n > self.cap:
            self.exceeded = True
            raise _OutputLimit()
        self.parts.append(s)
        return len(s)

    def writelines(self, lines):
        for s in lines:
            self.write(s)

    def flush(self):
        pass

    def isatty(self):
        return False

    def readable(self):
        return False

    def writable(self):
        return True

    def text(self):
        s = "".join(self.parts)
        if self.exceeded or len(s) > SHOWN_ON_LIMIT:
            return s[:SHOWN_ON_LIMIT] + "\n… (output truncated)"
        return s


def set_tk_source(src):
    """The source of dojo.tk, kept so every run gets a fresh copy of the module (and its state)."""
    global _TK_SOURCE
    _TK_SOURCE = src


def _install_dojo():
    pkg = types.ModuleType("dojo")
    pkg.__path__ = []
    tk = types.ModuleType("dojo.tk")
    tk.__file__ = "<dojo.tk>"
    exec(compile(_TK_SOURCE, "<dojo.tk>", "exec"), tk.__dict__)
    pkg.tk = tk
    sys.modules["dojo"] = pkg
    sys.modules["dojo.tk"] = tk
    return tk


def _block_network():
    """pyodide.http and friends: importable, but every use fails inside the program."""
    def deny(*_a, **_k):
        raise OSError("network access is disabled in the Dojo Python runner")

    def make(name):
        m = types.ModuleType(name)

        def __getattr__(attr):
            if attr.startswith("__"):
                raise AttributeError(attr)
            return deny

        m.__getattr__ = __getattr__
        return m

    http = make("pyodide.http")
    sys.modules["pyodide.http"] = http
    sys.modules["pyodide_http"] = make("pyodide_http")
    pkg = sys.modules.get("pyodide")
    if pkg is not None:
        try:
            pkg.http = http
        except Exception:
            pass


def _hide_pyodide_js():
    """pyodide_js is Pyodide's own JS API (FS, loadPackage...): not for learner code. `import` now raises."""
    sys.modules["pyodide_js"] = None


def _no_input(*_a, **_k):
    raise EOFError("EOF when reading a line (the Dojo runner has no stdin)")


def _learner_line(e):
    """The innermost traceback line that is in the learner's own file."""
    line = None
    tb = e.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == LEARNER_FILE:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def _error(e, fallback=1):
    name = type(e).__name__
    text = str(e)
    return {"line": _learner_line(e) or fallback, "col": 0, "message": "%s: %s" % (name, text) if text else name}


def _plain(v, depth=0):
    """A value as JSON: ints, strings, lists; integral floats are ints; anything else is its repr."""
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        # beyond 2^53 a JSON number loses digits in the page: shown (and compared) exactly, as text
        return str(v) if v > (1 << 53) - 1 or v < -((1 << 53) - 1) else v
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):
            return repr(v)
        return _plain(int(v), depth) if v.is_integer() else v  # beyond 2^53 it becomes exact text, like an int
    if depth < 6 and isinstance(v, (list, tuple)):
        return [_plain(x, depth + 1) for x in v[:1000]]
    if depth < 6 and isinstance(v, dict):
        return {str(k): _plain(x, depth + 1) for k, x in list(v.items())[:1000]}
    return repr(v)


class ListNode:
    """C-VISUAL section 5: the list type of the list packs (a module global of the learner's file)."""

    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self):
        return "ListNode(%r)" % (self.val,)


class TreeNode:
    """C-VISUAL section 5: the tree type of the tree packs (a module global of the learner's file)."""

    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

    def __repr__(self):
        return "TreeNode(%r)" % (self.val,)


_JSON_NAMES = {"null": None, "true": True, "false": False}


def _literal(node):
    """A JSON-style literal from a call's text: numbers, strings, lists, null, true and false. Nothing else is
    evaluated (ast.literal_eval does not know null, true or false)."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float, str)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.Name) and node.id in _JSON_NAMES:
        return _JSON_NAMES[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)) and isinstance(node.operand, ast.Constant) \
            and isinstance(node.operand.value, (int, float)) and not isinstance(node.operand.value, bool):
        return -node.operand.value if isinstance(node.op, ast.USub) else node.operand.value
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_literal(x) for x in node.elts]
    raise ValueError("not a literal: " + ast.dump(node))


def _args(call):
    """The arguments of a call text such as `coinChange([1,2,5], 11)` or `diameterOfBinaryTree([1,2,null,3])`."""
    node = ast.parse(call.strip(), mode="eval").body
    if not isinstance(node, ast.Call):
        raise ValueError("not a call: " + call)
    return [_literal(a) for a in node.args]


def _kinds(signature):
    """("list" | "tree" | None) for each parameter and for the result, read from the Python signature's
    annotations (`head: ListNode | None`, `-> TreeNode | None`)."""
    def kind(ann):
        if ann is None:
            return None
        text = ast.unparse(ann) if hasattr(ast, "unparse") else ""
        if "ListNode" in text:
            return "list"
        if "TreeNode" in text:
            return "tree"
        return None
    try:
        fn = ast.parse((signature or "").strip() + "\n    pass\n").body[0]
        if not isinstance(fn, ast.FunctionDef):
            return [], None
        return [kind(a.annotation) for a in fn.args.args], kind(fn.returns)
    except SyntaxError:
        return [], None


def _build_list(vals):
    head = None
    for v in reversed(vals):
        head = ListNode(v, head)
    return head


def _build_tree(vals):
    if not vals or vals[0] is None:
        return None
    root = TreeNode(vals[0])
    queue = [root]
    i, q = 1, 0
    while i < len(vals) and q < len(queue):
        n = queue[q]
        q += 1
        if vals[i] is not None:
            n.left = TreeNode(vals[i])
            queue.append(n.left)
        i += 1
        if i < len(vals) and vals[i] is not None:
            n.right = TreeNode(vals[i])
            queue.append(n.right)
        i += 1
    return root


def _list_out(head):
    """A returned list as an int array, or "cycle" when it loops (any object with .val and .next)."""
    seen = set()
    out = []
    n = head
    while n is not None:
        if id(n) in seen:
            return "cycle"
        seen.add(id(n))
        out.append(getattr(n, "val", None))
        n = getattr(n, "next", None)
    return out


def _tree_out(root):
    """A returned tree as a level-order array with null and no trailing nulls ("cycle" when a node repeats)."""
    seen = set()
    out = []
    queue = [root]
    q = 0
    while q < len(queue):
        n = queue[q]
        q += 1
        if n is None:
            out.append(None)
            continue
        if id(n) in seen:
            return "cycle"
        seen.add(id(n))
        out.append(getattr(n, "val", None))
        queue.append(getattr(n, "left", None))
        queue.append(getattr(n, "right", None))
    while out and out[-1] is None:
        out.pop()
    return out


def _convert_args(args, kinds):
    out = []
    for k, a in enumerate(args):
        kind = kinds[k] if k < len(kinds) else None
        if kind == "list" and isinstance(a, list):
            a = _build_list(a)
        elif kind == "tree" and isinstance(a, list):
            a = _build_tree(a)
        out.append(a)
    return out


def _convert_result(v, kind):
    """C-VISUAL Addendum 3: a list (tree) pack must return a ListNode (TreeNode) chain or None."""
    if kind == "list":
        return _list_out(v) if v is None or hasattr(v, "next") else "not a ListNode"
    if kind == "tree":
        return _tree_out(v) if v is None or (hasattr(v, "left") and hasattr(v, "right")) else "not a TreeNode"
    return v


def _reply(status, cases, errors, out, tk, t0, results=None):
    """What the frame is told. `expected` is never here and no verdict is made here (the learner's code runs
    in this interpreter and could change anything this file decides): the frame judges `got` itself."""
    done = results or {}
    shown = [{"id": c["id"], "got": done[c["id"]]} for c in cases if c["id"] in done]
    steps = tk._st.events if tk is not None else []
    return json.dumps({
        "status": status, "cases": shown, "errors": errors, "stdout": out.text() if out else "",
        "steps": steps, "truncated": bool(tk is not None and tk._st.truncated), "ms": int((time.time() - t0) * 1000),
    }, default=repr)


def run(code, cases_json, fn_name, signature=None):
    t0 = time.time()
    cases = json.loads(cases_json)
    out = _Out()
    tk = None
    real = (sys.stdout, sys.stderr, builtins.input)
    try:
        try:
            module = compile(code, LEARNER_FILE, "exec")
        except SyntaxError as e:  # IndentationError and TabError are SyntaxErrors
            return _reply("compile_error", cases, [{"line": e.lineno or 1, "col": e.offset or 0, "message": e.msg or "invalid syntax"}], None, None, t0)
        except (ValueError, OverflowError, RecursionError, MemoryError) as e:
            return _reply("compile_error", cases, [{"line": 1, "col": 0, "message": str(e) or type(e).__name__}], None, None, t0)

        tk = _install_dojo()
        _block_network()
        _hide_pyodide_js()
        sys.stdout = sys.stderr = out
        builtins.input = _no_input
        ns = {"__name__": "learner", "__file__": LEARNER_FILE, "__builtins__": builtins, "ListNode": ListNode, "TreeNode": TreeNode}
        param_kinds, result_kind = _kinds(signature)
        results = {}
        errors = []
        try:
            exec(module, ns)
        except _OutputLimit:
            pass
        except MemoryError:
            return _reply("memory_limit", cases, [], out, tk, t0, results)
        except BaseException as e:  # noqa: BLE001 - everything the learner can raise, SystemExit included
            if out.exceeded:
                return _reply("output_limit", cases, [], out, tk, t0, results)
            return _reply("runtime_error", cases, [_error(e)], out, tk, t0, results)
        fn = ns.get(fn_name)
        if not callable(fn):
            return _reply("compile_error", cases, [{"line": 1, "col": 0, "message": "Define a function named %s: %s" % (fn_name, signature or fn_name)}], out, tk, t0, results)
        try:
            for c in cases:
                tk._case_start(c["id"])
                try:
                    args = _convert_args(_args(c["call"]), param_kinds)
                    got = _plain(_convert_result(fn(*args), result_kind))
                    results[c["id"]] = got
                except (_OutputLimit, MemoryError):
                    raise
                except BaseException as e:  # noqa: BLE001 - a case that raised: the next case still runs, as in Go
                    err = _error(e)
                    if err not in errors:
                        errors.append(err)
        except _OutputLimit:
            pass
        except MemoryError:
            return _reply("memory_limit", cases, [], out, tk, t0, results)
        if out.exceeded:
            return _reply("output_limit", cases, [], out, tk, t0, results)
        if errors:
            return _reply("runtime_error", cases, errors, out, tk, t0, results)
        if out.exceeded:
            return _reply("output_limit", cases, [], out, tk, t0, results)
        return _reply("ok", cases, [], out, tk, t0, results)
    finally:
        sys.stdout, sys.stderr, builtins.input = real

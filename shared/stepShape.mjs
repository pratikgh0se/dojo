// Shared by the server and the page (app/shared: served by Vite in dev, copied beside server/ on install).
// C-VISUAL §2: the shape of every family step, as the page receives it: {op, sid, act, ...fields}, plus the
// internal `case` marker. One table, shared by the Go runner's event parser (server) and the page's check of
// what the sandboxed Python frame sends (src/runner/py/protocol.ts): a step of any other shape is dropped.
// Field types: int (a finite integer), bool, str, ints (int[]), intss (int[][]), strs (str[]); a name ending
// in `?` is optional.
export const FAMILIES = {
  graph: {
    new: { name: 'str', directed: 'bool' }, node: { u: 'int' }, edge: { u: 'int', v: 'int', 'w?': 'int' }, visit: { u: 'int' },
    dist: { u: 'int', d: 'int' }, relax: { u: 'int', v: 'int', d: 'int' }, mark: { u: 'int', label: 'str' },
  },
  heap: { new: { name: 'str' }, push: { key: 'int', prio: 'int' }, pop: { key: 'int', prio: 'int' } },
  queue: { new: { name: 'str' }, push: { v: 'int' }, pop: { v: 'int' } },
  dsu: { new: { name: 'str', n: 'int' }, union: { a: 'int', b: 'int' }, find: { x: 'int' } },
  array: {
    new: { name: 'str', values: 'ints', chars: 'bool' }, set: { i: 'int', v: 'int' }, swap: { i: 'int', j: 'int' },
    pointer: { label: 'str', i: 'int' }, window: { lo: 'int', hi: 'int' },
  },
  search: { new: { name: 'str', lo: 'int', hi: 'int' }, mid: { m: 'int', pred: 'bool' }, lo: { v: 'int' }, hi: { v: 'int' } },
  list: { new: { name: 'str' }, node: { id: 'int', val: 'int' }, next: { id: 'int', next: 'int' }, pointer: { label: 'str', id: 'int' } },
  intervals: { new: { name: 'str', items: 'intss' }, add: { s: 'int', e: 'int' }, set: { i: 'int', s: 'int', e: 'int' }, mark: { i: 'int', label: 'str' } },
  tree: { new: { name: 'str' }, node: { id: 'int', val: 'int', parent: 'int', side: 'str' }, visit: { id: 'int' }, mark: { id: 'int', label: 'str' } },
  game: { new: { name: 'str', states: 'strs' }, set: { state: 'str', outcome: 'str', 'value?': 'int' } },
}

/** The family ops, in panel order (C-VISUAL §3). */
export const FAMILY_OPS = ['graph', 'heap', 'queue', 'dsu', 'array', 'search', 'list', 'intervals', 'tree', 'game']

const MAX_TEXT = 4096
// C-VISUAL Addendum 4: only safe integers (within ±2^53) can be drawn exactly
const isInt = v => typeof v === 'number' && Number.isSafeInteger(v)
const isStr = v => typeof v === 'string' && v.length <= MAX_TEXT
const CHECK = {
  int: isInt,
  bool: v => typeof v === 'boolean',
  str: isStr,
  ints: v => Array.isArray(v) && v.every(isInt),
  intss: v => Array.isArray(v) && v.every(x => Array.isArray(x) && x.every(isInt)),
  strs: v => Array.isArray(v) && v.every(isStr),
}

/** Whether op names a family. */
export function isFamilyOp(op) {
  return typeof op === 'string' && Object.prototype.hasOwnProperty.call(FAMILIES, op)
}

/**
 * C-VISUAL Addendum 3: what an event the page cannot draw becomes: a step that is "not shown", keeping its
 * family (when it names one) and its case marker, so nothing after it is orphaned.
 */
export function unshownStep(v) {
  const out = { op: 'unshown' }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    if (isFamilyOp(v.op)) out.kind = v.op
    // an unshown step (from the server) keeps a valid family through the page's check
    else if (v.op === 'unshown' && isFamilyOp(v.kind)) out.kind = v.kind
    if (isInt(v.case)) out.case = v.case
  }
  return out
}

/**
 * A family step rebuilt from its known fields only, or null when `v` is not exactly one (an unknown op or
 * action, a missing or mistyped field). `case`, when present, must be an int.
 */
export function familyStep(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || !isFamilyOp(v.op)) return null
  const acts = FAMILIES[v.op]
  if (typeof v.act !== 'string' || !Object.prototype.hasOwnProperty.call(acts, v.act)) return null
  if (!isInt(v.sid) || v.sid < 0 || v.sid > 0x7fffffff) return null
  const out = { op: v.op, sid: v.sid, act: v.act }
  for (const [k, type] of Object.entries(acts[v.act])) {
    const opt = k.endsWith('?')
    const name = opt ? k.slice(0, -1) : k
    const x = v[name]
    if (x === undefined || (opt && x === null)) {
      if (opt) continue
      return null
    }
    if (!CHECK[type](x)) return null
    out[name] = x
  }
  if (v.case !== undefined) {
    if (!isInt(v.case)) return null
    out.case = v.case
  }
  return out
}

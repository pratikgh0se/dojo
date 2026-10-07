// Judges a worker's answer (security review M1/L2). The worker runs learner code in the same interpreter as
// the harness, so nothing it says is trusted except the values it produced: it is never given `expected`,
// and the verdict (`pass`, the case list, the caps) is computed here from the frame's own copy of the cases.
// Loaded by the frame as a classic script; the unit tests load the same file.
(function (root) {
  'use strict'
  var MAX_STEPS = 20000
  var MAX_STDOUT = 1048576 + 64 // 1 MiB of prints, plus the cut marker
  var MAX_MESSAGE = 12 * 1024 * 1024 // the whole result, as JSON
  var MAX_ERRORS = 50
  var MAX_TEXT = 4096
  var STATUSES = ['ok', 'compile_error', 'runtime_error', 'timeout', 'output_limit', 'memory_limit']

  function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) }

  /** A value the page may show for `got`: numbers, short strings, booleans, null, small arrays of them. */
  function cleanValue(v, depth) {
    if (v === null || typeof v === 'boolean') return v
    if (typeof v === 'number') return isFinite(v) ? v : null
    if (typeof v === 'string') return v.length <= MAX_TEXT ? v : v.slice(0, MAX_TEXT)
    if (Array.isArray(v) && depth < 4) return v.slice(0, 1000).map(function (x) { return cleanValue(x, depth + 1) })
    return null
  }

  /**
   * C-VISUAL §5: `got` equals `expected` when numbers are equal (a bool never equals a number), strings and bools
   * are identical, and arrays match element by element (a Python list or tuple is an array).
   */
  function same(g, e) {
    if (Array.isArray(e)) {
      if (!Array.isArray(g) || g.length !== e.length) return false
      for (var i = 0; i < e.length; i++) if (!same(g[i], e[i])) return false
      return true
    }
    if (typeof e === 'number') return typeof g === 'number' && g === e
    if (typeof e === 'boolean' || typeof e === 'string' || e === null) return g === e
    return false
  }

  function bare(cases, status, message) {
    return {
      status: status, stdout: '', steps: [], truncated: false, ms: 0,
      errors: message ? [{ line: 1, col: 0, message: message }] : [],
      cases: cases.map(function (c) { return { id: c.id, call: c.call, expected: c.expected, got: null, pass: false } }),
    }
  }

  /** `cases`: the frame's own [{id, call, expected}]. `w`: whatever the worker posted (untrusted). */
  function judge(cases, w) {
    if (!isObj(w)) return bare(cases, 'runtime_error', 'The Python runner sent an unreadable result')
    var size
    try { size = JSON.stringify(w).length } catch (e) { return bare(cases, 'runtime_error', 'The Python runner sent an unreadable result') }
    if (size > MAX_MESSAGE) return bare(cases, 'output_limit')
    if (!Array.isArray(w.steps) || w.steps.length > MAX_STEPS) return bare(cases, 'output_limit')
    if (typeof w.stdout !== 'string' || w.stdout.length > MAX_STDOUT) return bare(cases, 'output_limit')
    if (STATUSES.indexOf(w.status) < 0) return bare(cases, 'runtime_error', 'The Python runner sent an unreadable result')
    var got = {}
    if (Array.isArray(w.cases)) {
      w.cases.forEach(function (c) { if (isObj(c) && typeof c.id === 'number') got[c.id] = cleanValue(c.got, 0) })
    }
    var errors = []
    if (Array.isArray(w.errors)) {
      w.errors.slice(0, MAX_ERRORS).forEach(function (e) {
        if (isObj(e) && typeof e.message === 'string') {
          errors.push({ line: typeof e.line === 'number' && isFinite(e.line) ? Math.trunc(e.line) : 1, col: typeof e.col === 'number' && isFinite(e.col) ? Math.trunc(e.col) : 0, message: e.message.slice(0, MAX_TEXT) })
        }
      })
    }
    var ran = w.status === 'ok' || w.status === 'runtime_error'
    return {
      status: w.status, errors: errors, stdout: w.stdout, steps: w.steps, truncated: w.truncated === true,
      ms: typeof w.ms === 'number' && isFinite(w.ms) ? w.ms : 0,
      cases: cases.map(function (c) {
        var g = ran && Object.prototype.hasOwnProperty.call(got, c.id) ? got[c.id] : null
        return { id: c.id, call: c.call, expected: c.expected, got: g, pass: g !== null && same(g, c.expected) }
      }),
    }
  }

  root.dojoJudge = { judge: judge, bare: bare, same: same, MAX_STEPS: MAX_STEPS, MAX_STDOUT: MAX_STDOUT, MAX_MESSAGE: MAX_MESSAGE }
})(typeof self !== 'undefined' ? self : globalThis)

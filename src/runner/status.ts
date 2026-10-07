// C-RUNNER §4: the exact texts of run-status, run-diff and run-error.
import type { RunCase, RunError, RunResult } from './types'

export const RUNNING_TEXT = 'Running…'
/**
 * UAT cu-4 P3-17: a Go run is under a second once the build cache is warm, but the first one after a launch or a cleared cache
 * builds the standard library too (3 to 3.5 s). Past SLOW_RUN_MS the status says so, so the wait is never an unexplained "Running…".
 */
export const SLOW_RUN_MS = 1500
export const SLOW_GO_RUN_TEXT = 'Running… the first Go run builds its cache and can take a few seconds'
/** C-PYTHON §1: the first Python run, until the runtime is ready. */
export const LOADING_PYTHON_TEXT = 'Loading Python…'
export const NO_TOOLCHAIN_TEXT = "Go isn't installed: install it with brew install go"
export const STEP_CAP = 20000
export const TRUNCATED_TEXT = `Showing the first ${STEP_CAP} steps`

export function statusText(r: Pick<RunResult, 'status' | 'cases'>): string {
  switch (r.status) {
    case 'ok': {
      const m = r.cases.length
      const n = r.cases.filter(c => c.pass).length
      return n === m ? `Passed ${n}/${m}` : `Failed ${n}/${m}`
    }
    case 'compile_error': return 'Compile error'
    case 'runtime_error': return 'Runtime error'
    case 'timeout': return 'Timed out after 3 s'
    case 'output_limit': return 'Output too large'
    case 'memory_limit': return 'Out of memory'
    case 'no_toolchain': return NO_TOOLCHAIN_TEXT
  }
}

/** A value as the page shows it: numbers and arrays as JSON, nothing as "nothing". */
export function showValue(v: unknown): string {
  return v === null || v === undefined ? 'nothing' : JSON.stringify(v)
}

/** C-PYTHON Addendum 2 Q2: what run-stdout shows, for Go and Python alike. */
export const STDOUT_SHOWN = 64 * 1024
export const STDOUT_TRUNCATED = '… (output truncated)'

/**
 * The program's stdout as run-stdout shows it: the first 64 KiB (counted in code points, as Python counts), then "… (output truncated)" on its own line
 * when there was more (the runner may have cut it already and marked it). Empty when nothing was printed.
 */
export function stdoutText(raw: string): string {
  let s = String(raw ?? '')
  let cut = false
  for (const mark of [`\n${STDOUT_TRUNCATED}`, '\n… (output cut)']) {
    if (s.endsWith(mark)) { s = s.slice(0, -mark.length); cut = true }
  }
  // the first 64 Ki code points (never half a surrogate pair); a string of at most that many UTF-16 units fits
  if (s.length > STDOUT_SHOWN) {
    let i = 0
    for (let n = 0; n < STDOUT_SHOWN && i < s.length; n++) i += (s.codePointAt(i) ?? 0) > 0xffff ? 2 : 1
    if (i < s.length) { s = s.slice(0, i); cut = true }
  }
  return cut ? `${s}\n${STDOUT_TRUNCATED}` : s
}

export function diffText(c: Pick<RunCase, 'call' | 'expected' | 'got'>): string {
  return `${c.call}: expected ${showValue(c.expected)}, got ${showValue(c.got)}`
}

export function errorText(e: Pick<RunError, 'line' | 'message'>): string {
  // cu-final row 14: "Define a function named f" is about the whole program, not a line (the runner reports it as line 1)
  if (e.message.startsWith('Define a function named ')) return e.message
  return `line ${e.line}: ${e.message}`
}

/** "Passed 5/5" on a Submit is what opens the Solved gate (C-RUNNER §4). */
export function passesGate(r: Pick<RunResult, 'status' | 'cases'>, mode: 'run' | 'submit'): boolean {
  return mode === 'submit' && r.status === 'ok' && r.cases.length === 5 && r.cases.every(c => c.pass)
}

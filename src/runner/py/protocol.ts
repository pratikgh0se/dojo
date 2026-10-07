// C-PYTHON §3: the messages between Dojo and the sandboxed Python frame. The frame is an opaque origin that
// runs learner code, so everything it sends is untrusted data: nothing here trusts a field's shape until
// it has been checked, and a bad message is dropped, never repaired.
import { cleanStep } from '../steps'
import { pySignature } from './starters'
import type { PublicPack, RunCase, RunError, RunMode, RunResult, RunStatus, Step } from '../types'

export const FRAME_URL = '/pyrunner/frame.html'
export const STEP_LIMIT = 20000
/** The same 64 KiB as the Go route's code cap (and the frame's). */
export const MAX_CODE = 64 * 1024
export const CODE_TOO_LONG = 'Your code is over 64 KiB.'
const STATUSES: RunStatus[] = ['ok', 'compile_error', 'runtime_error', 'timeout', 'output_limit', 'memory_limit', 'no_toolchain']

/** What the page asks the frame to run. */
/** C-VISUAL §5: an expected value is a number, a bool or an array (of arrays) of them. */
export type Expected = number | boolean | string | Expected[]
export interface RunRequest { type: 'run'; id: string; code: string; fn: string; sig: string; cases: { id: number; call: string; expected: Expected }[] }

export function buildRunRequest(id: string, pack: PublicPack, code: string, mode: RunMode): RunRequest {
  const n = mode === 'submit' ? pack.cases.length : Math.min(pack.examples, pack.cases.length)
  return { type: 'run', id, code, fn: pack.fn, sig: pySignature(pack) ?? pack.signature, cases: pack.cases.slice(0, n).map(c => ({ id: c.id, call: c.call, expected: c.expected as Expected })) }
}

export type FrameMessage =
  | { type: 'hello' }
  | { type: 'ready' }
  | { type: 'state'; id: string; state: 'loading' | 'running' }
  | { type: 'result'; id: string; result: RunResult }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string'

function isCase(c: unknown): c is RunCase {
  return isObj(c) && num(c.id) && str(c.call) && 'expected' in c && 'got' in c && typeof c.pass === 'boolean'
}
function isError(e: unknown): e is RunError {
  return isObj(e) && num(e.line) && num(e.col) && str(e.message)
}
/** A run result as the frame sent it, or null if any part of it is the wrong shape. */
export function parseResult(v: unknown): RunResult | null {
  if (!isObj(v) || !str(v.status) || !(STATUSES as string[]).includes(v.status)) return null
  if (!Array.isArray(v.cases) || !v.cases.every(isCase)) return null
  if (!Array.isArray(v.errors) || !v.errors.every(isError)) return null
  if (!str(v.stdout) || typeof v.truncated !== 'boolean' || !num(v.ms)) return null
  if (!Array.isArray(v.steps) || v.steps.length > STEP_LIMIT) return null
  const steps: Step[] = []
  for (const x of v.steps) steps.push(cleanStep(x))
  const { status, cases, errors, stdout, truncated, ms } = v as unknown as RunResult
  return { status, cases, errors, stdout, steps, truncated, ms }
}

/** A message from the frame, or null when it is not one (wrong envelope, wrong shape, unknown type). */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (!isObj(data) || data.dojo !== 'py' || !str(data.type)) return null
  switch (data.type) {
    case 'hello': return { type: 'hello' }
    case 'ready': return { type: 'ready' }
    case 'state':
      return str(data.id) && (data.state === 'loading' || data.state === 'running') ? { type: 'state', id: data.id, state: data.state } : null
    case 'result': {
      const result = parseResult(data.result)
      return str(data.id) && result ? { type: 'result', id: data.id, result } : null
    }
    default: return null
  }
}

/** A result the page makes itself (the frame is gone or too slow). */
export function localResult(status: RunStatus, cases: RunRequest['cases'], message?: string): RunResult {
  return {
    status, stdout: '', steps: [], truncated: false, ms: 0,
    errors: message ? [{ line: 1, col: 0, message }] : [],
    cases: cases.map(c => ({ id: c.id, call: c.call, expected: c.expected, got: null, pass: false })),
  }
}

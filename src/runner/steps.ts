// The page's check of every step it is given, from the Go server or the Python frame: a DP step checked field by
// field, a family step rebuilt from its known fields (server/runner/stepShape.mjs), or (C-VISUAL Addendum 3) a
// step "not shown" for anything else, so one bad event never drops the run or the steps after it.
import { familyStep, unshownStep } from '../../shared/stepShape.mjs'
import type { Step } from './types'

const OPS = new Set(['table', 'set', 'get', 'enter', 'hit', 'exit', 'link'])
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string'

export function isDpStep(s: unknown): s is Step {
  if (!isObj(s) || !str(s.op) || !OPS.has(s.op)) return false
  if (s.case !== undefined && !num(s.case)) return false
  switch (s.op) {
    case 'table': return num(s.t) && num(s.rows) && num(s.cols) && str(s.name)
    case 'set': return num(s.t) && num(s.i) && num(s.j) && num(s.v) && Array.isArray(s.deps) && s.deps.every(d => Array.isArray(d) && d.length === 2 && num(d[0]) && num(d[1])) && (s.rule === undefined || str(s.rule))
    case 'get': return num(s.t) && num(s.i) && num(s.j) && num(s.v)
    case 'enter': case 'hit': return str(s.fn) && Array.isArray(s.args) && s.args.every(num)
    case 'exit': return num(s.v)
    default: return str(s.fn) && str(s.table)
  }
}

export function cleanStep(s: unknown): Step {
  if (isObj(s) && str(s.op) && !OPS.has(s.op)) return (familyStep(s) ?? unshownStep(s)) as Step
  return isDpStep(s) ? s : (unshownStep(s) as Step)
}

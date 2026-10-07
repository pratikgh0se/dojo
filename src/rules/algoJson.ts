// The <sr-algo>/<sr-algo2> JSON step contract (lab/algo.js and lab/algo2.js headers, Atlas section 04).
// Pure: no DOM, no engine. This is the labs chain's own view of the contract; the AI `picture` job's own
// contract check (limits, op lists, structure-type lists) lives once in ai/engineSpec.ts (ai/validate.ts re-exports it) and is re-exported
// from there instead of duplicated here (Controller addendum 2 dedupe).

export type { SrAlgoJson, SrAlgoStep, SrAlgoStructure } from '../ai/types'
export { PICTURE_LIMITS, SRALGO2_TYPES, SRALGO_OPS, SRALGO2_OPS, SRALGO_TYPES } from '../ai/engineSpec'
import { SRALGO2_TYPES } from '../ai/engineSpec'

export type AlgoEngine = 'algo' | 'algo2'

export interface AlgoStep {
  op: string
  line?: number
  say?: string
  vars?: Record<string, unknown>
  [field: string]: unknown
}

export interface AlgoStructure {
  type: string
  [field: string]: unknown
}

export interface AlgoJson {
  title?: string
  complexity?: string
  intro?: string
  outro?: string
  structures: Record<string, AlgoStructure>
  code?: string[]
  steps: AlgoStep[]
}

/** A structure that uses an algo2-only type decides the engine; otherwise <sr-algo>. */
export function engineFor(json: AlgoJson): AlgoEngine {
  return Object.values(json.structures ?? {}).some(s => (SRALGO2_TYPES as readonly string[]).includes(s.type)) ? 'algo2' : 'algo'
}

/** The same picture with the code panel hidden: both engines skip the panel when `code` is empty. */
export function withoutCode(json: AlgoJson): AlgoJson {
  return { ...json, code: [] }
}

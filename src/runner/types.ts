// C-RUNNER §2: the shapes /tools/run-go and /tools/packs/<id> answer with (the server is server/runner).
export type RunStatus = 'ok' | 'compile_error' | 'runtime_error' | 'timeout' | 'output_limit' | 'memory_limit' | 'no_toolchain'
export type RunMode = 'run' | 'submit'
export interface RunCase { id: number; call: string; expected: unknown; got: unknown; pass: boolean }
export interface RunError { line: number; col: number; message: string }
/** `case` is set on a case's first event (internal; not an extra step): the call tree resets there. */
export type Step = (
  | { op: 'table'; t: number; rows: number; cols: number; name: string }
  | { op: 'set'; t: number; i: number; j: number; v: number; deps: [number, number][]; rule?: string }
  | { op: 'get'; t: number; i: number; j: number; v: number }
  | { op: 'enter' | 'hit'; fn: string; args: number[] }
  | { op: 'exit'; v: number }
  | { op: 'link'; fn: string; table: string }
  | FamilyStep
  /** C-VISUAL Addendum 3: an event the page cannot draw (its family, when it named one) */
  | { op: 'unshown'; kind?: FamilyOp }
) & { case?: number }

/** C-VISUAL §2: a family step, {op, sid (the structure's id in the run), act, ...fields} (server/runner/stepShape.mjs). */
export type FamilyStep =
  | { op: 'graph'; sid: number; act: 'new'; name: string; directed: boolean }
  | { op: 'graph'; sid: number; act: 'node' | 'visit'; u: number }
  | { op: 'graph'; sid: number; act: 'edge'; u: number; v: number; w?: number }
  | { op: 'graph'; sid: number; act: 'dist'; u: number; d: number }
  | { op: 'graph'; sid: number; act: 'relax'; u: number; v: number; d: number }
  | { op: 'graph'; sid: number; act: 'mark'; u: number; label: string }
  | { op: 'heap'; sid: number; act: 'new'; name: string }
  | { op: 'heap'; sid: number; act: 'push' | 'pop'; key: number; prio: number }
  | { op: 'queue'; sid: number; act: 'new'; name: string }
  | { op: 'queue'; sid: number; act: 'push' | 'pop'; v: number }
  | { op: 'dsu'; sid: number; act: 'new'; name: string; n: number }
  | { op: 'dsu'; sid: number; act: 'union'; a: number; b: number }
  | { op: 'dsu'; sid: number; act: 'find'; x: number }
  | { op: 'array'; sid: number; act: 'new'; name: string; values: number[]; chars: boolean }
  | { op: 'array'; sid: number; act: 'set'; i: number; v: number }
  | { op: 'array'; sid: number; act: 'swap'; i: number; j: number }
  | { op: 'array'; sid: number; act: 'pointer'; label: string; i: number }
  | { op: 'array'; sid: number; act: 'window'; lo: number; hi: number }
  | { op: 'search'; sid: number; act: 'new'; name: string; lo: number; hi: number }
  | { op: 'search'; sid: number; act: 'mid'; m: number; pred: boolean }
  | { op: 'search'; sid: number; act: 'lo' | 'hi'; v: number }
  | { op: 'list'; sid: number; act: 'new'; name: string }
  | { op: 'list'; sid: number; act: 'node'; id: number; val: number }
  | { op: 'list'; sid: number; act: 'next'; id: number; next: number }
  | { op: 'list'; sid: number; act: 'pointer'; label: string; id: number }
  | { op: 'intervals'; sid: number; act: 'new'; name: string; items: number[][] }
  | { op: 'intervals'; sid: number; act: 'add'; s: number; e: number }
  | { op: 'intervals'; sid: number; act: 'set'; i: number; s: number; e: number }
  | { op: 'intervals'; sid: number; act: 'mark'; i: number; label: string }
  | { op: 'tree'; sid: number; act: 'new'; name: string }
  | { op: 'tree'; sid: number; act: 'node'; id: number; val: number; parent: number; side: string }
  | { op: 'tree'; sid: number; act: 'visit'; id: number }
  | { op: 'tree'; sid: number; act: 'mark'; id: number; label: string }
  | { op: 'game'; sid: number; act: 'new'; name: string; states: string[] }
  | { op: 'game'; sid: number; act: 'set'; state: string; outcome: string; value?: number }
export type FamilyOp = FamilyStep['op']
export interface RunResult {
  status: RunStatus; cases: RunCase[]; errors: RunError[]; stdout: string; steps: Step[]; truncated: boolean; ms: number
}
export interface PublicPack {
  id: string; title: string; fn: string; signature: string; starter: string; examples: number
  cases: { id: number; call: string; expected: unknown }[]
}

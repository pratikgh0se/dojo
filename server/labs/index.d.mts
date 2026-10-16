import type { LabDef } from './defs.mjs'
export { LabError, LAB_STATUS } from './common.mjs'
export interface LabCheck { id: string; name: string; status: 'pass' | 'fail' | 'skip'; detail: string; metrics?: Record<string, unknown> }
export interface LabResults { checks: LabCheck[]; summary: { pass: number; fail: number; skip: number } }
export interface LabRunReply { at: number; ms: number; exit: number | null; timedOut: boolean; results: LabResults | null; error?: 'no_results' | 'bad_results'; tail: string }
export type LabBundleFile = { path: string; diff: string } | { path: string; note: string }
export interface LabBundleReply { rubric: { id: string; text: string }[]; writeup: string; files: LabBundleFile[] }
export interface LabInfoReply {
  title: string; version: number; repo: string; path: string; timeoutSec: number
  tickets: string[]; closingTicket: string; milestones: { ticket: string; checkIds: string[] }[]; rubric: { id: string; text: string }[]
}
export interface Labs {
  ops: {
    info(q: { labId?: unknown }): Promise<LabInfoReply>
    setup(b: { labId?: unknown; labsRoot?: unknown }): Promise<{ status: 'created' | 'exists'; path: string; baseCommit: string | null }>
    run(b: { labId?: unknown; labsRoot?: unknown }): Promise<{ run: LabRunReply }>
    hint(b: { labId?: unknown; ticketId?: unknown; rung?: unknown }): Promise<{ text: string; ref?: { file: string; from: number; to: number; code: string } }>
    bundle(b: { labId?: unknown; labsRoot?: unknown }): Promise<{ bundle: LabBundleReply }>
  }
  defsRoot: string | null
  abort(): void
  settled(): Promise<void>
}
export function createLabs(o?: { env?: Record<string, string | undefined>; defsRoot?: string | null; log?: (msg: string) => void }): Labs
export type { LabDef }

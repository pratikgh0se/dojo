import type { LabDef } from './defs.mjs'
export function findBaseline(def: LabDef, repoDir: string, env?: Record<string, string | undefined>): Promise<string | null>
export function setupLab(def: LabDef, labsRoot: string, env?: Record<string, string | undefined>): Promise<{ status: 'created' | 'exists'; path: string; baseCommit: string | null }>

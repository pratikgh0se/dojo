import type { LabDef } from './defs.mjs'
import type { LabBundleReply } from './index.mjs'
export const BUNDLE_LIMITS: { writeupBytes: number; diffBytes: number; fileBytes: number; totalBytes: number; maxFiles: number }
export function buildBundle(def: LabDef, labsRoot: string, env?: Record<string, string | undefined>): Promise<LabBundleReply>

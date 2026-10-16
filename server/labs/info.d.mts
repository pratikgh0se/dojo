import type { LabDef } from './defs.mjs'
import type { LabInfoReply } from './index.mjs'
export function labInfo(def: LabDef): LabInfoReply
export function labHint(def: LabDef, ticketId: unknown, rung: unknown): { text: string; ref?: { file: string; from: number; to: number; code: string } }

export interface LabHint { rung: 1 | 2 | 3; text?: string; ref?: { file: string; from: number; to: number } }
export interface LabMilestone { ticket: string; checkIds: string[]; hints: LabHint[] }
export interface LabDef {
  id: string; title: string; lang: 'python'; version: number; repo: string; path: string; timeoutSec: number
  closingTicket: string; tickets: string[]; milestones: LabMilestone[]; rubric: { id: string; text: string }[]
  /** absolute folder of the definition (lab.json, template/, reference/) */
  dir: string
}
export const LAB_LIMITS: { timeoutDefault: number; timeoutMax: number; refMaxLines: number; rubricMin: number; rubricMax: number }
export function validateLabJson(j: unknown, folderId?: string): string[]
export function readInside(base: string, rel: string): string | null
export function checkLabFiles(dir: string, j: { milestones?: LabMilestone[] }): string[]
export function readLabDir(dir: string, folderId?: string): { json: unknown; errors: string[] }
export function defaultDefsRoot(env?: Record<string, string | undefined>, root?: string): string | null
export function loadLab(defsRoot: string | null, id: unknown): LabDef
export function listLabIds(defsRoot: string | null): string[]

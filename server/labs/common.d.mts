export class LabError extends Error { code: string; constructor(code: string, message: string) }
export const LAB_STATUS: Record<string, number>
export const LAB_ID: RegExp
export const LAB_MESSAGES: Record<'bad_root' | 'unknown_lab' | 'busy' | 'not_set_up' | 'make_missing' | 'lab_dirty' | 'git_missing', string>
export function isDir(p: string): boolean
export function findOnPath(bin: string, env?: Record<string, string | undefined>): string | null
export function git(args: string[], opts: { cwd: string; env?: Record<string, string | undefined> }): Promise<{ code: number; stdout: string; stderr: string }>
export function identityArgs(cwd: string, env?: Record<string, string | undefined>): Promise<string[]>
export function jsonBytes(s: string): number

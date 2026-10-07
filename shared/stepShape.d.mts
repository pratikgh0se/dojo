export type FieldType = 'int' | 'bool' | 'str' | 'ints' | 'intss' | 'strs'
export const FAMILIES: Record<string, Record<string, Record<string, FieldType>>>
export const FAMILY_OPS: string[]
export function isFamilyOp(op: unknown): boolean
export function unshownStep(v: unknown): { op: 'unshown'; kind?: string; case?: number }
export function familyStep(v: unknown): Record<string, unknown> | null

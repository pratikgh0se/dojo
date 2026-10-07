export function newId(prefix: string, nowMs: number): string {
  return `${prefix}-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

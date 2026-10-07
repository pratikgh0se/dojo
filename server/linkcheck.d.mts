export const MAX_URLS: number
export const MAX_PARALLEL: number
export const TIMEOUT_MS: number
export class LinkCheckError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string)
}
export function ipv6Bytes(text: string): number[] | null
export function isBlockedAddress(addr: string, opts?: { allowLoopback?: boolean }): boolean
export function urlShapeProblem(raw: unknown): string | null
export function urlBlocked(raw: string, opts?: { allowLoopback?: boolean }): boolean
export function urlProblem(raw: unknown, opts?: { allowLoopback?: boolean }): string | null
export function checkOne(raw: string, timeoutMs?: number, opts?: { allowLoopback?: boolean }): Promise<{ url: string; ok: boolean; status: number }>
export function linkCheck(body: unknown, opts?: { timeoutMs?: number; parallel?: number; allowLoopback?: boolean }): Promise<{ url: string; ok: boolean; status: number }[]>

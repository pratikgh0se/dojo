export const MAX_BODY_BYTES: number
export const MAX_TEXT_CHARS: number
export const PORTFOLIO_STATUS: Record<string, number>
export function createPortfolio(o: {
  loadLab: (id: string) => unknown | Promise<unknown>
  resolveRoot: (raw: string) => string | Promise<string>
  env?: NodeJS.ProcessEnv
}): { handle(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown>; unexpected?: unknown }> }

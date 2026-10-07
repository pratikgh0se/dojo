export const CSP_REPORT_PATH: string
export function appCsp(opts?: { dev?: boolean; report?: boolean }): string
export function cspReportFile(env?: Record<string, string | undefined>): string | null

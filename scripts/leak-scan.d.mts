export interface Hit { file: string; line: number; rule: string; text: string }
export const TOKEN_SHAPES: RegExp[]
export const GENERIC_RULES: { rule: string; test: (line: string) => RegExpExecArray | null }[]
export function looksLikeSecret(text: string): boolean
export function formatHit(h: Hit): string
export function scanTree(dir: string, opts?: { generic?: boolean; files?: RegExp | null; allow?: RegExp[]; extraTerms?: string[] }): Hit[]

export const CONTRACTS: string[]
export const FORBIDDEN: string[]
export const ATTRIBUTES: string[]
export const MIN_FILES: Record<string, number>
export function hooksOf(markdown: string): string[]
export function reservedOf(markdown: string): string[]
export function attributesOf(markdown: string): string[]
export function hookPresent(hook: string, srcText: string): boolean
export function missingHooks(hooks: string[], srcText: string): string[]
export function forbiddenPresent(srcText: string): string[]
export function missingAttributes(srcText: string, attrs?: string[]): string[]
export function retiredPatterns(readme: string): string[]
export function retiredRegex(pattern: string): RegExp
export function retiredRequired(hooks: string[], patterns: string[]): string[]
export function expandAlternatives(name: string): string[]
export function hookEntries(markdown: string): { hook: string; attrs: string[] }[]
export function attributePairsOf(markdown: string): { hook: string; attr: string }[]
export function stripComments(src: string): string
export const INDIRECT: Record<string, { file: string; anchor: string }>
export const ATTR_WINDOW: number
export function hookAnchors(hook: string, text: string): number[]
export function attributeBound(hook: string, attr: string, files: { f: string; text: string }[]): boolean
export function unboundAttributes(pairs: { hook: string; attr: string }[], files: { f: string; text: string }[]): { hook: string; attr: string }[]
export const RETIRED_BY_D2: string[]
export const DEFAULT_FOUNDATION: string
export function testIdsOf(lines: string[]): { ids: string[]; prefixes: string[] }
export function vanishedIds(found: { ids: string[]; prefixes: string[] }, headText: string, patterns: string[], extraRetired?: string[], placeholderPrefixes?: string[]): string[]
export function retiredPlaceholderPrefixes(readme: string): string[]

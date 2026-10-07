export const PY_ASSET_PREFIXES: string[]
export const FRAME_PATH: string
export function isPyAsset(path: string): boolean
export function frameCsp(origin: string): string
export function pyAssetHeaders(path: string, origin: string): Record<string, string>
export function inPyPrefix(path: string): boolean
export function pyAssetPath(path: string): string | null

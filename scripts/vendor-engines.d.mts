export const ATLAS_OPEN: string
export const ATLAS_HEAD: string
export const ATLAS_TAIL: string
export const ENGINE_PATCHES: Record<string, Array<[string, string]>>
export function atlasBlock(html: string): string
export function patchEngine(name: string, src: string): string

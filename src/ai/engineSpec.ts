// The engine constants the AI `picture` contract and the labs' algo.json contract share (lab/algo.js, lab/algo2.js).
// Kept apart from validate.ts so the entry chunk can use them without pulling in every job validator.
export const SRALGO_OPS = ['set', 'swap', 'compare', 'mark', 'clear', 'pointer', 'window', 'push', 'pop', 'shift', 'visit', 'edge', 'label', 'cell', 'cellMark', 'cellHl', 'call', 'ret', 'link', 'say'] as const
export const SRALGO2_OPS = ['link', 'set', 'mark', 'clear', 'pointer', 'seg', 'line', 'range', 'push', 'sketch', 'window', 'move', 'say'] as const
export const SRALGO_TYPES = ['array', 'grid', 'graph', 'tree', 'list', 'stack', 'queue', 'stack-frames', 'hash', 'intervals', 'bits'] as const
export const SRALGO2_TYPES = ['forest', 'plane', 'numberline', 'tape', 'sets'] as const
/** titleChars / complexityChars: SEC-D-01, the engine header's free text stays short (and markup-free, see validatePicture). */
export const PICTURE_LIMITS = { structures: 3, minSteps: 15, maxSteps: 60, codeLines: 8, arrayItems: 12, nodes: 8, gridSide: 8, titleChars: 120, complexityChars: 40 } as const

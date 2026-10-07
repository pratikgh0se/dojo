export const PYODIDE_DIR: string
export const PYODIDE_FILES: string[]
export const PYODIDE_LICENSE: string
export function copyPyodide(outDir: string, from?: string): string[]
export function vendorPyodide(): import('vite').Plugin

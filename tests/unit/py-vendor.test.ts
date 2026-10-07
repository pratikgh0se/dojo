// @vitest-environment node
// C-PYTHON §3: Pyodide is vendored into the build output at /pyodide/, with no CDN reference anywhere.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyPyodide, PYODIDE_FILES, PYODIDE_LICENSE, vendorPyodide } from '../../scripts/vendor-pyodide.mjs'

let dir = ''
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('vendoring Pyodide', () => {
  it('copies the runtime files (and only them, plus the licence) into <out>/pyodide', () => {
    dir = mkdtempSync(join(tmpdir(), 'dojo-vendor-'))
    const copied = copyPyodide(dir)
    expect(PYODIDE_FILES).toEqual(['pyodide.js', 'pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])
    expect(copied).toHaveLength(7)
    for (const f of PYODIDE_FILES) expect(statSync(join(dir, 'pyodide', f)).size, f).toBeGreaterThan(1000)
    expect(existsSync(join(dir, 'pyodide', 'pyodide.js.map'))).toBe(false)
    // the wasm is really WebAssembly
    expect([...readFileSync(join(dir, 'pyodide', 'pyodide.asm.wasm')).subarray(0, 4)]).toEqual([0, 0x61, 0x73, 0x6d])
  })

  it('ships Pyodide\'s licence (MPL-2.0, full text) as <out>/pyodide/LICENSE, identical to the copy in THIRD-PARTY-NOTICES.md', () => {
    dir = mkdtempSync(join(tmpdir(), 'dojo-vendor-'))
    copyPyodide(dir)
    const text = readFileSync(join(dir, 'pyodide', 'LICENSE'), 'utf8')
    expect(text).toBe(readFileSync(PYODIDE_LICENSE, 'utf8'))
    expect(text.startsWith('Mozilla Public License Version 2.0')).toBe(true)
    expect(text).toContain('Exhibit B - "Incompatible With Secondary Licenses" Notice')
    // the notices sit at the repo root, or in app/ once the release extraction roots there
    const where = ['../../THIRD-PARTY-NOTICES.md', '../../../THIRD-PARTY-NOTICES.md'].map(p => new URL(p, import.meta.url)).find(existsSync)!
    const notices = readFileSync(where, 'utf8')
    expect(notices).toContain(text.trim())
  })

  it('the build plugin copies into an absolute --outDir as well as a relative one', () => {
    dir = mkdtempSync(join(tmpdir(), 'dojo-vendor-'))
    const plugin = vendorPyodide() as unknown as { configResolved(c: unknown): void; writeBundle(): void }
    plugin.configResolved({ root: '/some/where/else', build: { outDir: dir } })
    plugin.writeBundle()
    expect(existsSync(join(dir, 'pyodide', 'pyodide.asm.wasm'))).toBe(true)
  })

  it('pins the pyodide version exactly', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.dependencies.pyodide).toMatch(/^\d+\.\d+\.\d+$/)
    expect(JSON.parse(readFileSync(new URL('../../node_modules/pyodide/package.json', import.meta.url), 'utf8')).version).toBe(pkg.dependencies.pyodide)
  })

  it('the runner frame and worker name no origin but their own', () => {
    for (const f of ['frame.html', 'frame.js', 'worker.js']) {
      const p = new URL(`../../public/pyrunner/${f}`, import.meta.url)
      if (!existsSync(p)) continue
      expect(readFileSync(p, 'utf8'), f).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/)
    }
  })
})

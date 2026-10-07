// Runs the Python harness (public/pyrunner) in Pyodide under Node: the same Python files the worker loads.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { loadPyodide, type PyodideInterface } from 'pyodide'
import { loadPacks, publicPack } from '../../server/runner/runner.mjs'
import { PY_SIGNATURES } from '../../src/runner/py/starters'
import type { PublicPack, RunResult } from '../../src/runner/types'

const dir = new URL('../../public/pyrunner/', import.meta.url)
/** judge.js as the frame loads it (a classic script that defines self.dojoJudge). */
export type Judge = { judge(cases: unknown[], worker: unknown): RunResult; bare(cases: unknown[], status: string, message?: string): RunResult; MAX_STEPS: number; MAX_STDOUT: number; MAX_MESSAGE: number }
export function loadJudge(): Judge {
  const ctx: { self?: unknown; dojoJudge?: Judge } = {}
  ctx.self = ctx
  vm.runInNewContext(readFileSync(new URL('judge.js', dir), 'utf8'), ctx)
  return ctx.dojoJudge!
}

let py: Promise<PyodideInterface> | null = null

export const pack = (id: string): PublicPack => publicPack(loadPacks().get(id)!) as PublicPack

/** One Pyodide per test file (about a second to start). */
export function pyodide(): Promise<PyodideInterface> {
  py ??= (async () => {
    const p = await loadPyodide({ indexURL: fileURLToPath(new URL('../../node_modules/pyodide/', import.meta.url)), stdout: () => {}, stderr: () => {} })
    p.FS.writeFile('/dojo_harness.py', readFileSync(new URL('dojo_harness.py', dir), 'utf8'))
    p.runPython('import sys; sys.path.insert(0, "/")\nimport dojo_harness')
    p.globals.set('_tk_src', readFileSync(new URL('dojo_tk.py', dir), 'utf8'))
    p.runPython('dojo_harness.set_tk_source(_tk_src)')
    return p
  })()
  return py
}

/** What the worker answers: the harness's raw JSON (no `expected` went in, no verdict comes out). */
export async function runWorker(code: string, packId = 'p91', n = 2): Promise<Record<string, unknown>> {
  const p = await pyodide()
  const pk = pack(packId)
  p.globals.set('_code', code)
  p.globals.set('_cases', JSON.stringify(pk.cases.slice(0, n).map(c => ({ id: c.id, call: c.call }))))
  p.globals.set('_fn', pk.fn)
  p.globals.set('_sig', PY_SIGNATURES[packId])
  return JSON.parse(p.runPython('dojo_harness.run(_code, _cases, _fn, _sig)') as string)
}

/** Runs `code` against the first `n` cases of the pack: the worker's answer, judged by the frame's judge.js. */
export async function runPy(code: string, packId = 'p91', n = 2): Promise<RunResult> {
  const pk = pack(packId)
  return loadJudge().judge(pk.cases.slice(0, n), await runWorker(code, packId, n))
}

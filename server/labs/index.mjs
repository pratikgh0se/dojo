// The lab module of dojo-server: one object whose `ops` the /labs/* routes call. Each op takes the parsed request
// (the JSON body, or the query for info) and returns the fields of the success reply, or throws LabError.
// Every filesystem path comes from the definition and the validated labs root, never from the request.
import { join } from 'node:path'
import { defaultDefsRoot, loadLab } from './defs.mjs'
import { isDir, LAB_MESSAGES, LabError } from './common.mjs'
import { resolveLabsRoot } from './root.mjs'
import { buildBundle } from './bundle.mjs'
import { labHint, labInfo } from './info.mjs'
import { runChecks } from './run.mjs'
import { setupLab } from './setup.mjs'

export { LAB_STATUS, LabError } from './common.mjs'

export function createLabs({ env = process.env, defsRoot, log = () => {} } = {}) {
  const defs = defsRoot === undefined ? defaultDefsRoot(env) : defsRoot
  const running = new Map() // labId -> the run in flight
  const stopper = new AbortController()
  const def = id => loadLab(defs, id)
  const folder = (d, body) => ({ d, root: resolveLabsRoot(body?.labsRoot, env) })

  const ops = {
    async info(q) {
      return labInfo(def(q?.labId))
    },
    async setup(body) {
      const { d, root } = folder(def(body?.labId), body)
      const r = await setupLab(d, root, env)
      log(`labs setup ${d.id} ${r.status}`)
      return r
    },
    async run(body) {
      const { d, root } = folder(def(body?.labId), body)
      const dir = join(root, d.repo, d.path)
      if (!isDir(dir)) throw new LabError('not_set_up', LAB_MESSAGES.not_set_up)
      if (running.has(d.id)) throw new LabError('busy', LAB_MESSAGES.busy)
      const job = runChecks({ dir, timeoutSec: d.timeoutSec, env, signal: stopper.signal })
      running.set(d.id, job)
      try {
        const run = await job
        log(`labs run ${d.id} exit ${run.exit}${run.timedOut ? ' timeout' : ''}${run.error ? ` ${run.error}` : ''} ${run.ms}ms`)
        return { run }
      } finally {
        running.delete(d.id)
      }
    },
    async hint(body) {
      return labHint(def(body?.labId), body?.ticketId, body?.rung)
    },
    async bundle(body) {
      const { d, root } = folder(def(body?.labId), body)
      return { bundle: await buildBundle(d, root, env) }
    },
  }

  return {
    ops,
    defsRoot: defs,
    /** Server shutdown: stops the check run in flight (its process group is killed). */
    abort() { stopper.abort() },
    /** Resolves when no run is in flight. */
    async settled() { await Promise.allSettled([...running.values()]) },
  }
}

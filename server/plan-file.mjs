// DOJO_PLAN_FILE (launch contract LAUNCH-13, PATH-30): an absolute path to a plan JSON file that GET /data/plan.json
// serves in place of the build's own plan (used to test a plan refresh). One implementation, shared by `npm run dev`
// (scripts/dev.mjs validates it, the Vite plugin in vite.config.ts serves it) and `dojo-server --dist`. Node standard
// library only. The installed app (`--real`) never uses it: dojo-server.mjs ignores the variable there.
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** A bad DOJO_PLAN_FILE. Its message is one line and starts with `DOJO_PLAN_FILE: `, so callers print it as is. */
export class PlanFileError extends Error {
  constructor(message) {
    super(`DOJO_PLAN_FILE: ${message}`)
    this.name = 'PlanFileError'
  }
}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The trimmed DOJO_PLAN_FILE, or null when it is unset or empty. */
export function planFileSetting(env = process.env) {
  const v = env.DOJO_PLAN_FILE
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * The plan file's text, validated: throws a PlanFileError when the path is not absolute, the file cannot be read
 * (missing, a directory, unreadable), it is not valid JSON, it is not an object with a non-empty string `planVersion`,
 * or it is not a plan v2 (`planFormat` 2 with arrays areas, phases, nodes, tickets). A v1 plan (array `sprints`) is not read any more.
 */
export function readPlanFile(path) {
  if (!isAbsolute(path)) throw new PlanFileError(`the path must be absolute, got "${path}"`)
  let text
  try {
    if (!statSync(path).isFile()) throw new PlanFileError(`cannot read ${path}: not a file`)
    text = readFileSync(path, 'utf8')
  } catch (e) {
    if (e instanceof PlanFileError) throw e
    const code = e && e.code ? e.code : 'read error'
    throw new PlanFileError(`cannot read ${path}: ${code}${code === 'ENOENT' ? ' (not found)' : ''}`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new PlanFileError(`${path} is not valid JSON (${e instanceof Error ? e.message : 'parse error'})`.replace(/\s*\n\s*/g, ' '))
  }
  if (!isObject(json)) throw new PlanFileError(`${path} is not a JSON object (a plan)`)
  if (typeof json.planVersion !== 'string' || json.planVersion === '') throw new PlanFileError(`${path} has no planVersion (a non-empty string is required)`)
  const v2 = json.planFormat === 2 && ['areas', 'phases', 'nodes', 'tickets'].every(k => Array.isArray(json[k]))
  if (!v2) throw new PlanFileError(`${path} is not a plan v2 (planFormat 2 with arrays areas, phases, nodes, tickets)`)
  return text
}

/** The plan file named by env.DOJO_PLAN_FILE, read and validated: `{ path, json }`, or null when the variable is unset or empty. */
export function resolvePlanFile(env = process.env) {
  const path = planFileSetting(env)
  if (path === null) return null
  return { path, json: JSON.parse(readPlanFile(path)) }
}

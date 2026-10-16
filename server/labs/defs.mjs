// Lab definitions: the shape of lab.json, its validator, and the loader. Node standard library only.
// A definition lives in <defsRoot>/<labId>/ : lab.json, template/ (what the learner gets) and reference/ (never copied to the learner).
//   plan-src/labs/<labId>/  --plan:build-->  public/data-private/labs/<labId>/  (the server reads this copy)
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDir, LAB_ID, LAB_MESSAGES, LabError } from './common.mjs'

export const LAB_LIMITS = { timeoutDefault: 120, timeoutMax: 900, refMaxLines: 40, rubricMin: 3, rubricMax: 5 }

const KEYS = ['id', 'title', 'lang', 'version', 'repo', 'path', 'timeoutSec', 'closingTicket', 'tickets', 'milestones', 'rubric']
const isStr = v => typeof v === 'string' && v.trim() !== ''
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const REPO = /^[a-z0-9][a-z0-9._-]*$/

/**
 * Pure check of a parsed lab.json. `folderId` is the folder name (a lab id is its folder name); pass it when known.
 * Returns one message per problem; [] means valid.
 */
export function validateLabJson(j, folderId) {
  const e = []
  if (!isObj(j)) return ['lab.json must be an object']
  for (const k of Object.keys(j)) if (!KEYS.includes(k)) e.push(`unknown key "${k}"`)
  if (!isStr(j.id) || !LAB_ID.test(j.id)) e.push('id must match ^[a-z0-9-]+$')
  else if (folderId !== undefined && j.id !== folderId) e.push(`id "${j.id}" must equal the folder name "${folderId}"`)
  if (!isStr(j.title)) e.push('title is required')
  if (j.lang !== 'python') e.push('lang must be "python"')
  if (!Number.isInteger(j.version) || j.version < 1) e.push('version must be a whole number from 1')
  if (!isStr(j.repo) || !REPO.test(j.repo)) e.push('repo must be a folder name such as "ai-platform-lab"')
  if (isStr(j.id) && j.path !== `labs/${j.id}`) e.push(`path must be "labs/${j.id}"`)
  if (j.timeoutSec !== undefined && (!Number.isInteger(j.timeoutSec) || j.timeoutSec < 1 || j.timeoutSec > LAB_LIMITS.timeoutMax)) e.push(`timeoutSec must be a whole number from 1 to ${LAB_LIMITS.timeoutMax}`)
  const tickets = Array.isArray(j.tickets) ? j.tickets : null
  if (!tickets || tickets.length === 0 || !tickets.every(isStr) || new Set(tickets).size !== tickets.length) e.push('tickets must be a non-empty list of unique ticket ids')
  // the lab's LAST build ticket: only the ticketId of its Review cards and the "Request the review on ..." line (ruling R-1)
  if (!isStr(j.closingTicket)) e.push('closingTicket is required')
  else if (tickets && !tickets.includes(j.closingTicket)) e.push('closingTicket must be one of tickets (the last build ticket of the lab)')

  const ms = Array.isArray(j.milestones) ? j.milestones : null
  if (!ms || ms.length === 0) e.push('milestones must be a non-empty list')
  else {
    const seen = new Set()
    ms.forEach((m, i) => {
      const w = `milestones[${i}]`
      if (!isObj(m)) { e.push(`${w} must be an object`); return }
      for (const k of Object.keys(m)) if (!['ticket', 'checkIds', 'hints'].includes(k)) e.push(`${w}: unknown key "${k}"`)
      if (!isStr(m.ticket)) e.push(`${w}.ticket is required`)
      else {
        if (tickets && !tickets.includes(m.ticket)) e.push(`${w}.ticket "${m.ticket}" is not in tickets`)
        if (seen.has(m.ticket)) e.push(`${w}.ticket "${m.ticket}" has two milestones`)
        seen.add(m.ticket)
      }
      if (!Array.isArray(m.checkIds) || m.checkIds.length === 0 || !m.checkIds.every(c => isStr(c) && CHECK_ID.test(c)) || new Set(m.checkIds).size !== m.checkIds.length) e.push(`${w}.checkIds must be a non-empty list of unique check ids`)
      const h = Array.isArray(m.hints) ? m.hints : null
      if (!h || h.length !== 3) e.push(`${w}.hints must hold exactly three hints, rungs 1, 2 and 3`)
      else h.forEach((x, k) => {
        const hw = `${w}.hints[${k}]`
        if (!isObj(x) || x.rung !== k + 1) { e.push(`${hw}.rung must be ${k + 1}`); return }
        if (k < 2) {
          if (!isStr(x.text)) e.push(`${hw}.text is required`)
          for (const key of Object.keys(x)) if (!['rung', 'text'].includes(key)) e.push(`${hw}: unknown key "${key}"`)
        } else {
          if (x.text !== undefined && typeof x.text !== 'string') e.push(`${hw}.text must be a string`)
          const r = x.ref
          if (!isObj(r) || !isStr(r.file) || !Number.isInteger(r.from) || !Number.isInteger(r.to)) e.push(`${hw}.ref must be { file, from, to }`)
          else {
            if (r.file.startsWith('/') || r.file.split('/').includes('..')) e.push(`${hw}.ref.file must be a path inside reference/`)
            if (r.from < 1 || r.to < r.from) e.push(`${hw}.ref lines must satisfy 1 <= from <= to`)
            else if (r.to - r.from + 1 > LAB_LIMITS.refMaxLines) e.push(`${hw}.ref may span at most ${LAB_LIMITS.refMaxLines} lines`)
          }
          for (const key of Object.keys(x)) if (!['rung', 'text', 'ref'].includes(key)) e.push(`${hw}: unknown key "${key}"`)
        }
      })
    })
    if (tickets && tickets.length && !tickets.every(t => seen.has(t))) e.push(`tickets without a milestone: ${tickets.filter(t => !seen.has(t)).join(', ')}`)
  }

  const rb = Array.isArray(j.rubric) ? j.rubric : null
  if (!rb || rb.length < LAB_LIMITS.rubricMin || rb.length > LAB_LIMITS.rubricMax) e.push(`rubric must hold ${LAB_LIMITS.rubricMin} to ${LAB_LIMITS.rubricMax} items`)
  else {
    const ids = new Set()
    rb.forEach((r, i) => {
      if (!isObj(r) || !isStr(r.id) || !/^[a-z0-9-]+$/.test(r.id) || !isStr(r.text)) e.push(`rubric[${i}] must be { id: "a-b", text }`)
      else if (ids.has(r.id)) e.push(`rubric[${i}].id "${r.id}" is used twice`)
      else ids.add(r.id)
      if (isObj(r)) for (const key of Object.keys(r)) if (!['id', 'text'].includes(key)) e.push(`rubric[${i}]: unknown key "${key}"`)
    })
  }
  return e
}

/** Reads a file inside `base` (after symlinks); null when it is missing or points outside. */
export function readInside(base, rel) {
  try {
    const root = realpathSync(base)
    const abs = realpathSync(resolve(root, rel))
    return abs.startsWith(root + sep) ? readFileSync(abs, 'utf8') : null
  } catch { return null }
}

/** Checks the folder around a valid lab.json: the template pieces the engine relies on and the rung-3 excerpts. */
export function checkLabFiles(dir, j) {
  const e = []
  const t = join(dir, 'template')
  const makefile = readInside(t, 'Makefile')
  if (makefile === null) e.push('template/Makefile is missing')
  else if (!/^check:/m.test(makefile)) e.push('template/Makefile has no "check:" target')
  const ignore = readInside(t, '.gitignore')
  if (ignore === null) e.push('template/.gitignore is missing')
  else if (!ignore.split('\n').some(l => l.trim() === '.dojo/' || l.trim() === '.dojo')) e.push('template/.gitignore must list .dojo/')
  for (const f of ['README.md', 'WRITEUP.md']) if (readInside(t, f) === null) e.push(`template/${f} is missing`)
  if (!isDir(join(dir, 'reference'))) e.push('reference/ is missing')
  for (const m of j.milestones ?? []) {
    const r = m.hints?.[2]?.ref
    if (!r) continue
    const text = readInside(join(dir, 'reference'), r.file)
    if (text === null) e.push(`hint ref ${r.file} (ticket ${m.ticket}) is not a file in reference/`)
    else if (r.to > text.split('\n').length) e.push(`hint ref ${r.file}:${r.from}-${r.to} (ticket ${m.ticket}) is past the end of the file`)
  }
  return e
}

/** Parses and validates <dir>/lab.json and its folder. Returns { json, errors }; json is null when it cannot be read. */
export function readLabDir(dir, folderId) {
  let json
  try { json = JSON.parse(readFileSync(join(dir, 'lab.json'), 'utf8')) } catch (err) { return { json: null, errors: [`lab.json: ${err instanceof Error ? err.message : String(err)}`] } }
  const errors = validateLabJson(json, folderId)
  if (errors.length === 0) errors.push(...checkLabFiles(dir, json))
  return { json, errors }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Where the server finds lab definitions: DOJO_LABS_DEFS (tests, dev), else labs-defs/ beside server/ (the installed app), else
 * public/data-private/labs (a source checkout). null when there are none (the public edition): every lab is then unknown.
 */
export function defaultDefsRoot(env = process.env, root = ROOT) {
  if (env.DOJO_LABS_DEFS) return resolve(env.DOJO_LABS_DEFS)
  return [join(root, 'labs-defs'), join(root, 'public', 'data-private', 'labs')].find(isDir) ?? null
}

/** The validated definition of a lab: lab.json with timeoutSec defaulted, plus `dir`. Throws LabError('unknown_lab'). */
export function loadLab(defsRoot, id) {
  if (typeof id !== 'string' || !LAB_ID.test(id) || !defsRoot || !isDir(join(defsRoot, id))) throw new LabError('unknown_lab', LAB_MESSAGES.unknown_lab)
  const dir = join(defsRoot, id)
  const { json, errors } = readLabDir(dir, id)
  if (errors.length) throw new LabError('unknown_lab', LAB_MESSAGES.unknown_lab, errors[0])
  return { ...json, timeoutSec: json.timeoutSec ?? LAB_LIMITS.timeoutDefault, dir }
}

/** Folder names under defsRoot that hold a lab.json, sorted. */
export function listLabIds(defsRoot) {
  if (!defsRoot || !isDir(defsRoot)) return []
  return readdirSync(defsRoot, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(defsRoot, d.name, 'lab.json'))).map(d => d.name).sort()
}

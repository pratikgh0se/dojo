#!/usr/bin/env node
// Rehearses the flat migration on a COPY of a Dojo backup. Reads only the copy; never opens ~/Dojo.
//   node scripts/rehearse-migration.mjs --backup <dojo-....db> [--plan public/data-private/plan.json] [--home <scratch dir>] [--json]
// Refuses any --backup, --plan or --home (or scratch path) that resolves, symlinks included, inside ~/Dojo, or whose file identity (dev+ino of itself or an existing ancestor) equals ~/Dojo (firmlinks and other aliases).
// To check a live snapshot, copy it out of ~/Dojo yourself first and pass a VACUUM INTO snapshot (not a live WAL database).
import { build } from 'esbuild'
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, readlinkSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { identityGuard } from './path-identity.mjs'

const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const die = msg => { console.error(`rehearse-migration: ${msg}`); process.exit(1) }

/**
 * The path as the kernel would resolve it: absolute, symlinks expanded segment by segment, and ".." applied to the
 * already-resolved parent (so "link/.." leaves the link's target, not the link's directory). A tail that does not exist
 * yet is kept as written. Only lstat/readlink metadata is read; nothing is opened. The result is the ONE path that is
 * checked and then used, never the raw argument.
 */
function kernelResolve(p) {
  const pending = (isAbsolute(p) ? p : `${process.cwd()}${sep}${p}`).split(sep).reverse()
  let cur = sep
  let missing = false
  for (let hops = 0; pending.length;) {
    const seg = pending.pop()
    if (seg === '' || seg === '.') continue
    if (seg === '..') { cur = dirname(cur); continue }
    const next = join(cur, seg)
    if (!missing) {
      let st = null
      try { st = lstatSync(next) } catch { missing = true }
      if (st?.isSymbolicLink()) {
        if (++hops > 40) die(`too many symbolic links: ${p}`)
        const target = readlinkSync(next)
        if (isAbsolute(target)) cur = sep
        pending.push(...target.split(sep).reverse())
        continue
      }
    }
    cur = next
  }
  return cur
}

// Every candidate Dojo folder: $HOME-based (homedir() honours HOME) and the account's own home, each lexical and resolved. Compared lowercase (macOS volumes are case-insensitive).
const homes = [...new Set([homedir(), userInfo().homedir])]
const dojoLexical = join(homedir(), 'Dojo')
const dojoRootsRaw = [...new Set(homes.flatMap(h => [join(h, 'Dojo'), kernelResolve(join(h, 'Dojo'))]))]
const dojoRoots = dojoRootsRaw.map(r => r.toLowerCase())
const insideDojo = real => { const x = real.toLowerCase(); return dojoRoots.some(root => x === root || x.startsWith(root + sep)) }
// File identity (dev+ino via stat): a path is inside Dojo if it or any existing ancestor IS a Dojo root, whatever its spelling.
// This catches aliases that lstat/readlink/realpath never report, e.g. macOS firmlinks (/System/Volumes/Data/Users/<u>/Dojo), /.vol, case or Unicode quirks.
const dojoAncestor = identityGuard(dojoRootsRaw)
const refuse = (what, p, real) => die(`refusing ${what} inside ${dojoLexical}: ${p}${real === p ? '' : ` (resolves to ${real})`}. Copy the file out of ~/Dojo first and pass the copy.`)
/** Resolve, check against Dojo (strings, then file identity), and return the resolved path: the caller must use THIS path from here on. */
const safe = (what, p) => { const real = kernelResolve(p); if (insideDojo(real) || dojoAncestor(real)) refuse(what, p, real); return real }

const backupArg = arg('backup')
if (!backupArg) die('--backup <file.db> is required')
const backup = safe('a --backup', backupArg)
const planArg = arg('plan')
const planPath = planArg ? safe('a --plan', planArg) : join(APP, 'public/data-private/plan.json')
const homeArg = arg('home')
const requestedHome = homeArg ? safe('a scratch --home', homeArg) : undefined
const scratchRoot = homeArg ? undefined : safe('a scratch home (TMPDIR)', tmpdir())
if (!existsSync(backup)) die(`no such backup: ${backupArg}`)

// A WAL-mode file is only complete together with its -wal; a plain byte copy of it would silently miss data.
const header = Buffer.alloc(20)
const fd = openSync(backup, 'r')
const got = readSync(fd, header, 0, 20, 0)
closeSync(fd)
if ((got >= 20 && (header[18] === 2 || header[19] === 2)) || existsSync(`${backup}-wal`)) {
  die(`${backupArg} is a live WAL-mode database (or has a -wal file next to it); copy a VACUUM INTO snapshot, not a live database`)
}

const home = requestedHome ?? safe('a scratch home', mkdtempSync(join(scratchRoot, 'dojo-rehearse-')))
if (requestedHome && existsSync(home) && readdirSync(home).length > 0) die(`${home} is not empty`)
mkdirSync(home, { recursive: true })

const copy = join(home, 'dojo.db')
copyFileSync(backup, copy) // the only access to the original: a byte copy
process.env.DOJO_HOME = home

const db = new DatabaseSync(copy, { readOnly: true })
const docs = {}
for (const r of db.prepare('SELECT tbl, doc FROM dojo_docs WHERE deleted = 0').all()) (docs[r.tbl] ??= []).push(JSON.parse(r.doc))
db.close()

if (!existsSync(planPath)) die(`no plan at ${planPath} (pass --plan)`)
const plan = JSON.parse(readFileSync(planPath, 'utf8'))

const out = join(home, 'rehearse.bundle.mjs')
await build({
  entryPoints: [join(APP, 'scripts/rehearse-entry.ts')], absWorkingDir: APP, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' },
})
const { rehearse } = await import(pathToFileURL(out).href)
const r = await rehearse(docs, plan, Date.now())

if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2))
else {
  for (const x of r.results) console.log(`${!x.ok ? 'FAIL' : x.info ? 'INFO' : 'PASS'}  ${x.name}${x.detail ? `  (${x.detail})` : ''}`)
  console.log(`outbox group: ${r.groupRows} rows, ${r.groupBytes} bytes`)
  console.log(`tickets ${r.before.tickets} -> ${r.after.tickets} (live ${r.before.live} -> ${r.after.live}), sessions ${r.before.sessions} -> ${r.after.sessions}, redos ${r.before.redos} -> ${r.after.redos}, writes ${r.writes}, code rows merged ${r.codeMerged}`)
  console.log(JSON.stringify(r.report, null, 2))
}
process.exit(r.results.every(x => x.ok) ? 0 : 1)

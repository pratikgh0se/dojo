#!/usr/bin/env node
// Bare single-class rules (".name {" as a whole selector) defined in more than one CSS file under src/.
// Two chains styling the same bare class name from different files is how merges broke each other
// overnight (.ladder, .ai-loader, .lg). Integration spec §7.   node scripts/css-collisions.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export function bareClasses(css) {
  const out = new Set()
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of text.matchAll(/(?:^|[{}])\s*([^{}@]+)\{/g)) {
    for (const sel of m[1].split(',')) {
      const s = sel.trim()
      if (/^\.[A-Za-z][\w-]*$/.test(s)) out.add(s.slice(1))
    }
  }
  return out
}

export function collisions(files, allow = new Set()) {
  const where = new Map()
  for (const [path, css] of Object.entries(files)) for (const c of bareClasses(css)) where.set(c, [...(where.get(c) ?? []), path])
  return [...where].filter(([c, ps]) => ps.length > 1 && !allow.has(c)).map(([c, ps]) => `.${c}: ${ps.sort().join(', ')}`).sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  const walk = d => readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.css') ? [join(d, n)] : []))
  const found = collisions(Object.fromEntries(walk(src).map(f => [relative(src, f), readFileSync(f, 'utf8')])))
  for (const f of found) console.log(f)
  process.exitCode = found.length ? 1 : 0
}

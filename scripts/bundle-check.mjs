#!/usr/bin/env node
// Entry-chunk budget (integration spec §7). Run after `npm run build`:  npm run bundle:check
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENTRY_BUDGET_BYTES = 480_000

export function entryChunks(indexHtml) {
  return [...indexHtml.matchAll(/<script[^>]*type="module"[^>]*src="\/?(assets\/[^"]+\.js)"/g)].map(m => m[1])
}

export function checkBundle(sizes, budget = ENTRY_BUDGET_BYTES) {
  return Object.entries(sizes).filter(([, n]) => n > budget).map(([f, n]) => `${f} is ${n} bytes (budget ${budget})`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  const entries = entryChunks(readFileSync(join(dist, 'index.html'), 'utf8'))
  const sizes = Object.fromEntries(entries.map(f => [f, statSync(join(dist, f)).size]))
  const all = readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js')).map(f => [f, statSync(join(dist, 'assets', f)).size]).sort((a, b) => b[1] - a[1])
  console.log('largest chunks:')
  for (const [f, n] of all.slice(0, 8)) console.log(`  ${String(n).padStart(9)}  ${f}`)
  const over = checkBundle(sizes)
  for (const o of over) console.error(`OVER BUDGET: ${o}`)
  process.exitCode = over.length ? 1 : 0
}

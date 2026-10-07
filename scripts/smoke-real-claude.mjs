#!/usr/bin/env node
// The overnight program's ONE real `claude -p` call (integration spec §8). Not part of any test run.
// The controller runs it once, from app/:   DOJO_REAL_SMOKE=1 npm run smoke:real
// It starts the helper in real mode on a free 127.0.0.1 port, asks exactly one level-1 hint for
// p200, checks the reply with the app validator, prints it, and stops the helper.
import { fileURLToPath } from 'node:url'
import { createHelper, readConfig } from '../server/helper.mjs'
import { checkOutput } from '../server/gen/ai-shared.mjs'

export const SMOKE_REQUEST = {
  ticket: {
    id: 'p200', title: 'Number of Islands', track: 'dsa',
    text: 'Given a grid of 1s (land) and 0s (water), count the islands; land connects up, down, left and right.',
    pattern: 'Graphs; Island (Matrix Traversal)',
  },
  context: { level: 1 },
}

export async function smoke(env = process.env, log = m => console.log(m)) {
  if (env.DOJO_REAL_SMOKE !== '1') {
    log('Refusing: this spends one real claude call. Set DOJO_REAL_SMOKE=1 to run it.')
    return 2
  }
  // --no-retry: this spends exactly one real claude call (integration spec §8) - an invalid reply
  // must fail the smoke, never spend a second call retrying (claude-runner.mjs's normal retry-once).
  const server = createHelper(readConfig(['--no-retry'], env))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const t0 = Date.now()
    const r = await fetch(`${base}/ai/hint`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(SMOKE_REQUEST) })
    const body = await r.json()
    const problem = body.ok === true ? checkOutput('hint', body.output) : `${body.error?.code}: ${body.error?.message}`
    if (r.status !== 200 || body.ok !== true || body.mode !== 'claude' || problem) {
      log(`SMOKE FAIL (HTTP ${r.status}): ${problem ?? `mode ${body.mode}`}`)
      return 1
    }
    log(`SMOKE OK in ${Date.now() - t0} ms: ${body.output.hint}`)
    return 0
  } finally {
    server.closeAllConnections?.()
    await new Promise(r => server.close(() => r()))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await smoke()

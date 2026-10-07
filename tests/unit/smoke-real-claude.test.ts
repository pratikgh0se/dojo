// @vitest-environment node
// Never spawns the real claude: the success path runs against a stub CLI.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { smoke } from '../../scripts/smoke-real-claude.mjs'

function stub(result: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'dojo-smoke-'))
  const ran = join(dir, 'ran')
  const runs = join(dir, 'runs')
  const reply = join(dir, 'reply.json')
  writeFileSync(reply, JSON.stringify({ type: 'result', result: JSON.stringify(result) }))
  const bin = join(dir, 'claude')
  writeFileSync(bin, `#!/bin/sh\ntouch '${ran}'\necho x >> '${runs}'\ncat > /dev/null\ncat '${reply}'\n`)
  chmodSync(bin, 0o755)
  return { bin, ran, runs }
}

describe('smoke-real-claude', () => {
  it('refuses without DOJO_REAL_SMOKE=1 and spawns nothing', async () => {
    const s = stub({ hint: 'x' })
    const logs: string[] = []
    expect(await smoke({ PATH: process.env.PATH, DOJO_CLAUDE_BIN: s.bin }, m => logs.push(m))).toBe(2)
    expect(existsSync(s.ran)).toBe(false)
    expect(logs.join('\n')).toMatch(/DOJO_REAL_SMOKE=1/)
  })
  it('passes on one valid hint from the CLI', async () => {
    const s = stub({ hint: 'What stays true about a land cell once you have counted it?' })
    const logs: string[] = []
    expect(await smoke({ PATH: process.env.PATH, DOJO_CLAUDE_BIN: s.bin, DOJO_REAL_SMOKE: '1' }, m => logs.push(m))).toBe(0)
    expect(existsSync(s.ran)).toBe(true)
    expect(logs.join('\n')).toMatch(/^SMOKE OK in \d+ ms: What stays true/m)
  })
  it('fails on an invalid reply', async () => {
    const s = stub({ nope: 1 })
    expect(await smoke({ PATH: process.env.PATH, DOJO_CLAUDE_BIN: s.bin, DOJO_REAL_SMOKE: '1' }, () => {})).toBe(1)
  })
  it('M3: spends exactly one real call, even on an invalid reply (no retry)', async () => {
    const s = stub({ nope: 1 })
    expect(await smoke({ PATH: process.env.PATH, DOJO_CLAUDE_BIN: s.bin, DOJO_REAL_SMOKE: '1' }, () => {})).toBe(1)
    expect(readFileSync(s.runs, 'utf8').trim().split('\n')).toHaveLength(1)
  })
})

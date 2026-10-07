// @vitest-environment node
// Integration spec §2.4: every job's schema-conforming reply validates end to end through the real-mode
// helper, with a stub CLI standing in for `claude` (it saves the prompt and prints the example reply).
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHelper, readConfig } from '../../server/helper.mjs'
import { INTERVIEW_FINAL_EXAMPLE, OUTPUT_EXAMPLES } from '../../src/ai/prompts'
import type { JobName } from '../../src/ai/types'
import { validateOutput } from '../../src/ai/validate'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(r => s.close(() => r(null)))))
})

function stubReplying(output: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'dojo-jobstub-'))
  const promptFile = join(dir, 'prompt.txt')
  const replyFile = join(dir, 'reply.json')
  writeFileSync(replyFile, JSON.stringify({ type: 'result', result: JSON.stringify(output) }))
  const bin = join(dir, 'claude')
  writeFileSync(bin, `#!/bin/sh\ncat > '${promptFile}'\ncat '${replyFile}'\n`)
  chmodSync(bin, 0o755)
  return { bin, prompt: () => readFileSync(promptFile, 'utf8') }
}

async function helperWith(bin: string) {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-'))
  // the grade job reads the repo, so a repo it is (UAT cu-5 P2-3: a folder that is not one is refused with its own message)
  execFileSync('git', ['init', '-q', forgeRoot], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
  const s = createHelper({ ...readConfig([], { PATH: process.env.PATH, DOJO_CLAUDE_BIN: bin }), projectRoot: forgeRoot })
  servers.push(s)
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, forgeRoot }
}

const P200 = { id: 'p200', title: 'Number of Islands', track: 'dsa', text: 'Count islands.', pattern: 'Graphs; Island (Matrix Traversal)' }
const DESIGN = { id: 'd-ratelimit', title: 'Distributed rate limiter and API gateway', track: 'design' }
const DIVES = ['Token bucket vs sliding log', 'Where state lives', 'Hot keys', 'Failure of the store']
const TRANSCRIPT = [
  { from: 'interviewer', text: 'Restate: a limiter at the gateway. What are the requirements?' },
  { from: 'you', text: '10k rps per user, 100 ms p99' },
]

type Case = { name: string; job: JobName; body: (forgeRoot: string) => unknown; output: unknown; markers: string[] }
const CASES: Case[] = [
  { name: 'hint', job: 'hint', body: () => ({ ticket: P200, context: { level: 2 } }), output: OUTPUT_EXAMPLES.hint, markers: ['Level: 2', 'Pattern (you may name it): Graphs; Island (Matrix Traversal)'] },
  { name: 'picture', job: 'picture', body: () => ({ ticket: P200, context: { language: 'python', attemptLog: 'grid [[1,1],[0,1]]' } }), output: OUTPUT_EXAMPLES.picture, markers: ['Contract: { title, complexity', "Learner's attempt log: <<<LEARNER_TEXT grid [[1,1],[0,1]] LEARNER_TEXT>>>"] },
  { name: 'diagram', job: 'diagram', body: () => ({ ticket: DESIGN, context: { deepDives: DIVES, refs: [{ label: 'Stripe post', url: 'https://stripe.com/blog/rate-limiters' }] } }), output: OUTPUT_EXAMPLES.diagram, markers: ['1. Token bucket vs sliding log', 'Stripe post https://stripe.com/blog/rate-limiters', 'for Distributed rate limiter and API gateway'] },
  { name: 'interview turn', job: 'interview', body: () => ({ ticket: DESIGN, context: { turn: 1, answers: ['10k rps per user, 100 ms p99'], deepDives: DIVES, transcript: TRANSCRIPT } }), output: OUTPUT_EXAMPLES.interview, markers: ['Interviewer: <<<LEARNER_TEXT Restate: a limiter at the gateway. What are the requirements? LEARNER_TEXT>>>', 'Candidate: <<<LEARNER_TEXT 10k rps per user, 100 ms p99 LEARNER_TEXT>>>', 'ask deep dive 1'] },
  { name: 'interview final', job: 'interview', body: () => ({ ticket: DESIGN, context: { turn: 9, answers: [], deepDives: DIVES, transcript: TRANSCRIPT, final: true } }), output: INTERVIEW_FINAL_EXAMPLE, markers: ['FINAL: grade the whole interview now.', '"perItem"'] },
  { name: 'grade', job: 'grade', body: forgeRoot => ({ ticket: { id: 'art-00', title: 'Stage 00 · Setup', track: 'ai' }, context: { proofNote: 'runs', repoUrl: 'https://github.com/x/forge', repoPath: forgeRoot, commit: 'c0ffee1', stage: 0, stageTitle: 'Setup', rubric: 'exists and runs (1)' } }), output: OUTPUT_EXAMPLES.grade, markers: ['Artifact: Stage 00 · Setup', "Read-only evidence from the learner's repository", '$ git log --oneline -n 20', 'Proof note: <<<LEARNER_TEXT runs LEARNER_TEXT>>>'] },
  { name: 'solution', job: 'solution', body: () => ({ ticket: P200, context: { gave_up: true, attemptLog: 'stuck' } }), output: OUTPUT_EXAMPLES.solution, markers: ['The learner gave up.', "Learner's attempt log: <<<LEARNER_TEXT stuck LEARNER_TEXT>>>"] },
  { name: 'suggest_slide', job: 'suggest_slide', body: () => ({ ticket: null, context: { count: 1, tickets: [{ id: 'p200', title: 'Number of Islands', track: 'dsa', estMin: 50, slidCount: 0 }, { id: 'd-method', title: 'The method', track: 'design', estMin: 90, slidCount: 1 }] } }), output: OUTPUT_EXAMPLES.suggest_slide, markers: ['p200 · Number of Islands · dsa · 50 min', 'Count to slide: 1'] },
  { name: 'classify', job: 'classify', body: () => ({ ticket: null, context: { input: 'https://leetcode.com/problems/longest-substring-without-repeating-characters/' } }), output: OUTPUT_EXAMPLES.classify, markers: ['Input: <<<LEARNER_TEXT https://leetcode.com/problems/longest-substring-without-repeating-characters/ LEARNER_TEXT>>>', 'SIEVE · PRIMES'] },
]

describe('real-mode helper with a stub CLI, every job', () => {
  for (const c of CASES) {
    it(`${c.name}: a schema-conforming reply validates end to end and the prompt carries schema and context`, async () => {
      const stub = stubReplying(c.output)
      const { base, forgeRoot } = await helperWith(stub.bin)
      const r = await fetch(`${base}/ai/${c.job}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.body(forgeRoot)) })
      const body = await r.json()
      expect(r.status, JSON.stringify(body)).toBe(200)
      expect(body).toMatchObject({ ok: true, job: c.job, mode: 'claude' })
      expect(body.output).toEqual(c.output)
      expect(validateOutput(c.job, body.output)).toEqual([])
      const prompt = stub.prompt()
      expect(prompt).toContain(`OUTPUT SCHEMA (${c.job})`)
      for (const m of c.markers) expect(prompt, m).toContain(m)
    })
  }

  it('Review Focus 1: a level-1 hint prompt never contains the pattern', async () => {
    const stub = stubReplying(OUTPUT_EXAMPLES.hint)
    const { base } = await helperWith(stub.bin)
    const r = await fetch(`${base}/ai/hint`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: P200, context: { level: 1 } }) })
    expect(r.status).toBe(200)
    expect(stub.prompt()).not.toContain('Island (Matrix Traversal)')
  })
})

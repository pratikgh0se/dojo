// @vitest-environment node
// UAT cu-5 P2-3: "Request grade" could never succeed in the app. The app's server (dojo-server) points the helper's `home` at
// the data folder (~/Dojo), and the helper expanded "~/projects/forge" against it, so the learner's forge repo was always
// "not inside ~/projects/forge". These tests use a throwaway account home holding a real git repo at projects/forge, a data home
// somewhere else, and a stub CLI that saves the prompt; the real ~/projects/forge and ~/Dojo are never touched.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitRepoProblem } from '../../server/claude-runner.mjs'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'
import { allowedRepoPath, createHelper, readConfig } from '../../server/helper.mjs'
import { OUTPUT_EXAMPLES } from '../../src/ai/prompts'

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => { await Promise.all(closers.splice(0).map(c => c())) })

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim()

/** A throwaway account home with a git repo at projects/forge holding one commit. */
function accountHome() {
  const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'dojo-acct-'))) // macOS's /var is a link to /private/var; the helper speaks real paths
  const forge = join(userHome, 'projects', 'forge')
  mkdirSync(join(forge, 'stages', '01-micrograd'), { recursive: true })
  git(userHome, 'init', '-q', forge)
  writeFileSync(join(forge, 'stages', '01-micrograd', 'engine.py'), 'class Value: pass\n')
  git(forge, 'add', '.')
  git(forge, 'commit', '-q', '-m', 'micrograd engine: Value with a hand-written backward pass')
  return { userHome, forge, sha: git(forge, 'rev-parse', '--short', 'HEAD') }
}

function stub() {
  const dir = mkdtempSync(join(tmpdir(), 'dojo-gradestub-'))
  const promptFile = join(dir, 'prompt.txt')
  const bin = join(dir, 'claude')
  writeFileSync(join(dir, 'reply.json'), JSON.stringify({ type: 'result', result: JSON.stringify(OUTPUT_EXAMPLES.grade) }))
  writeFileSync(bin, `#!/bin/sh\ncat > '${promptFile}'\ncat '${join(dir, 'reply.json')}'\n`)
  chmodSync(bin, 0o755)
  return { bin, prompt: () => readFileSync(promptFile, 'utf8') }
}

const post = (base: string, repoPath: unknown, commit: string, writer = '') =>
  fetch(`${base}/ai/grade`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(writer ? { 'X-Dojo-Writer': writer } : {}) },
    body: JSON.stringify({ ticket: { id: 'art-stage-01', title: 'Stage 01 · micrograd', track: 'ai' }, context: { proofNote: 'engine runs', repoUrl: 'https://github.com/me/forge', repoPath, commit, stage: 1, stageTitle: 'micrograd', rubric: 'r' } }),
  })

describe('grade from a local repo (UAT cu-5 P2-3)', () => {
  it('readConfig names the account home next to the data home', () => {
    expect(readConfig([], {}).userHome).toBe(readConfig([], {}).home)
  })

  it('the app server, whose data home is elsewhere, expands ~ against the account home and reads the commit', async () => {
    const { userHome, forge, sha } = accountHome()
    const dataHome = mkdtempSync(join(tmpdir(), 'dojo-data-'))
    const s = stub()
    const cfg = { ...readServerConfig(['--dist', mkdtempSync(join(tmpdir(), 'dojo-dist-'))], { DOJO_HOME: dataHome, DOJO_PORT: '0', DOJO_CLAUDE_BIN: s.bin, PATH: process.env.PATH }), userHome, projectRoot: forge }
    expect(cfg.home).toBe(dataHome)
    expect(cfg.home).not.toBe(cfg.userHome)
    const server = createDojoServer(cfg)
    closers.push(() => server.close())
    const base = `http://127.0.0.1:${await server.listen(0)}`

    const writer = readFileSync(join(dataHome, 'writer.token'), 'utf8').trim() // SEC-D-06: AI jobs are writer-only
    const r = await post(base, '~/projects/forge', sha, writer)
    const body = await r.json()
    expect(r.status, JSON.stringify(body)).toBe(200)
    expect(body.output).toEqual(OUTPUT_EXAMPLES.grade)
    const prompt = s.prompt()
    expect(prompt).toContain('$ git log --oneline -n 20')
    expect(prompt).toContain('micrograd engine: Value with a hand-written backward pass')
    expect(prompt).toContain(`$ git show --stat ${sha}`)
    expect(prompt).toContain('stages/01-micrograd/engine.py')

    // a folder inside the repo works, and so does the same folder written out in full
    expect((await post(base, '~/projects/forge/stages', sha, writer)).status).toBe(200)
    expect((await post(base, forge, sha, writer)).status).toBe(200)
  })

  it('before the fix: a ~ path expanded against the data home was refused (the helper alone, home = data home, no userHome)', () => {
    const { userHome, forge } = accountHome()
    const dataHome = mkdtempSync(join(tmpdir(), 'dojo-data-'))
    expect(allowedRepoPath('~/projects/forge', forge, dataHome)).toBeNull()
    expect(allowedRepoPath('~/projects/forge', forge, userHome)).not.toBeNull()
  })

  async function helper() {
    const { userHome, forge, sha } = accountHome()
    const s = stub()
    const server = createHelper({ ...readConfig([], { PATH: process.env.PATH, DOJO_CLAUDE_BIN: s.bin }), projectRoot: forge, home: mkdtempSync(join(tmpdir(), 'dojo-data-')), userHome })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    closers.push(() => new Promise(r => server.close(() => r(null))))
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, forge, userHome, sha, s }
  }
  const err = async (r: Response) => (await r.json()).error as { code: string; message: string }

  it('says what is wrong with a folder: outside the forge repo, missing, or not a git repository', async () => {
    const { base, forge, userHome, sha } = await helper()
    for (const bad of ['~/Documents', '/etc', `${forge}ry`, '~/projects/forge/../other']) {
      const r = await post(base, bad, sha)
      expect(r.status, bad).toBe(400)
      expect(await err(r), bad).toMatchObject({ code: 'path_not_allowed', message: 'repoPath must be the project repo (DOJO_PROJECT_REPO) or inside it' })
    }
    const missing = await post(base, '~/projects/forge/not-there', sha)
    expect(missing.status).toBe(400)
    expect(await err(missing)).toMatchObject({ code: 'bad_request', message: `${join(userHome, 'projects', 'forge', 'not-there')} is not a folder on this Mac` })
    // a plain folder under a forge root that is not a repo
    mkdirSync(join(userHome, 'projects', 'plain'), { recursive: true })
    const { base: b2 } = await (async () => {
      const s = stub()
      const root = join(userHome, 'projects', 'plain')
      const server = createHelper({ ...readConfig([], { PATH: process.env.PATH, DOJO_CLAUDE_BIN: s.bin }), projectRoot: root, userHome })
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
      closers.push(() => new Promise(r => server.close(() => r(null))))
      return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
    })()
    const plain = await post(b2, `${userHome}/projects/plain`, sha)
    expect(plain.status).toBe(400)
    expect(await err(plain)).toMatchObject({ code: 'bad_request', message: `${join(userHome, 'projects', 'plain')} is not a git repository` })
  })

  it('gitRepoProblem: a work tree and a sub-folder pass; a missing or plain folder is described', async () => {
    const { forge, userHome } = accountHome()
    expect(await gitRepoProblem(forge)).toBeNull()
    expect(await gitRepoProblem(join(forge, 'stages'))).toBeNull()
    expect(await gitRepoProblem(join(userHome, 'nope'))).toBe(`${join(userHome, 'nope')} is not a folder on this Mac`)
    expect(await gitRepoProblem(userHome)).toBe(`${userHome} is not a git repository`)
  })
})

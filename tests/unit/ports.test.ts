// @vitest-environment node
//
// This file imports vite.config.ts, which pulls in esbuild transitively. esbuild's startup
// environment check fails when it first runs inside a jsdom global realm (a jsdom vs Node
// Uint8Array identity mismatch, unrelated to this project's code), so this file runs in the
// plain Node environment instead of the suite's default jsdom.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dojoBaseUrl, dojoPort, parityBaseUrl, parityPort } from '../../dojoPort'
import config from '../../vite.config'

describe('DOJO_PORT (Review Focus #2)', () => {
  it('defaults to 8790 for dev/test (8787 is the real app only) and 5055 for the prototype server', () => {
    expect(dojoPort({})).toBe(8790)
    expect(dojoBaseUrl({})).toBe('http://127.0.0.1:8790')
    expect(parityPort({})).toBe(5055)
    expect(parityBaseUrl({})).toBe('http://127.0.0.1:5055')
  })

  it('reads DOJO_PORT and DOJO_PARITY_PORT', () => {
    expect(dojoPort({ DOJO_PORT: '8790' })).toBe(8790)
    expect(dojoBaseUrl({ DOJO_PORT: '8790' })).toBe('http://127.0.0.1:8790')
    expect(parityPort({ DOJO_PARITY_PORT: '5090' })).toBe(5090)
    expect(parityBaseUrl({ DOJO_PARITY_PORT: '5090' })).toBe('http://127.0.0.1:5090')
  })

  it('treats an empty value as unset', () => {
    expect(dojoPort({ DOJO_PORT: '' })).toBe(8790)
  })

  it('C3: refuses 8787, which is reserved for the real app (and its ~/Dojo data)', () => {
    expect(() => dojoPort({ DOJO_PORT: '8787' })).toThrow(/8787 is reserved for the real Dojo app/)
  })

  it.each(['abc', '80', '70000', '8790.5', ' 8790'])('rejects %j with a clear error', v => {
    expect(() => dojoPort({ DOJO_PORT: v })).toThrow(`DOJO_PORT must be an integer 1024–65535, got "${v}"`)
  })

  it('rejects a junk DOJO_PARITY_PORT the same way', () => {
    expect(() => parityPort({ DOJO_PARITY_PORT: 'x' })).toThrow('DOJO_PARITY_PORT must be an integer 1024–65535, got "x"')
  })
})

describe('configs take their ports from dojoPort.ts', () => {
  it('Vite serves on dojoPort with strictPort, and Vitest runs at most 2 workers', () => {
    const port = dojoPort(process.env)
    expect(config.server).toMatchObject({ host: '127.0.0.1', port, strictPort: true })
    expect(config.preview).toMatchObject({ host: '127.0.0.1', port, strictPort: true })
    expect(config.test).toMatchObject({ maxWorkers: 2, minWorkers: 1 })
  })

  it.each(['playwright.config.ts', 'playwright.parity.config.ts'])('%s has no hard-coded app port', f => {
    const src = readFileSync(f, 'utf8')
    expect(src).not.toMatch(/8787/)
    expect(src).toContain('dojoBaseUrl(process.env)')
    expect(src).toMatch(/workers: 1,/)
    expect(src).toMatch(/reuseExistingServer: true/)
  })

  it('the parity config and spec take the prototype server port from parityPort', () => {
    expect(readFileSync('playwright.parity.config.ts', 'utf8')).not.toMatch(/5055/)
    expect(readFileSync('tests/parity/today.parity.spec.ts', 'utf8')).not.toMatch(/5055/)
  })

  it('no e2e spec hard-codes the app port', () => {
    for (const f of ['tests/e2e/nav.spec.ts', 'tests/e2e/smoke.spec.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/8787/)
    }
  })
})

describe('C3: dev and tests never use the real app port', () => {
  const dev = (env: Record<string, string>) => spawnSync(process.execPath, ['scripts/dev.mjs'], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10_000 })

  it('dev.mjs defaults vite to 8790 and its disk server to 8789', () => {
    const src = readFileSync('scripts/dev.mjs', 'utf8')
    expect(src).toMatch(/DOJO_PORT \|\| '8790'/)
    expect(src).toMatch(/DOJO_SERVER_PORT \|\| '8789'/)
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/DOJO_SERVER_PORT \|\| 8789/)
  })

  it.each([['DOJO_PORT'], ['DOJO_SERVER_PORT']])('dev.mjs refuses %s=8787 before starting anything', name => {
    const r = dev({ [name]: '8787' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/8787/)
  })

  it('dev.mjs refuses a DOJO_HOME that resolves to ~/Dojo through a symlink or a trailing path (fake HOME)', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'dojo-devguard-'))
    try {
      mkdirSync(join(fakeHome, 'Dojo'))
      symlinkSync(join(fakeHome, 'Dojo'), join(fakeHome, 'link'))
      const cased = process.platform === 'darwin' ? [join(fakeHome, 'DOJO'), join(fakeHome, 'dojo', 'sub')] : []
      for (const home of [join(fakeHome, 'link'), `${join(fakeHome, 'Dojo')}/`, join(fakeHome, 'Dojo', 'sub', '..'), ...cased]) {
        const r = dev({ HOME: fakeHome, DOJO_HOME: home, DOJO_SERVER_PORT: '8899', DOJO_PORT: '8898' })
        expect(r.status, home).toBe(1)
        expect(r.stderr).toMatch(/~\/Dojo/)
      }
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('vite.config refuses DOJO_SERVER_PORT=8787 (its /db proxy target)', async () => {
    const prev = process.env.DOJO_SERVER_PORT
    process.env.DOJO_SERVER_PORT = '8787'
    try {
      const { vi } = await import('vitest')
      vi.resetModules()
      await expect(import('../../vite.config')).rejects.toThrow(/8787/)
    } finally {
      if (prev === undefined) delete process.env.DOJO_SERVER_PORT
      else process.env.DOJO_SERVER_PORT = prev
    }
  })

  it.each(['playwright.config.ts', 'playwright.parity.config.ts'])('%s refuses DOJO_PORT=8787', f => {
    const r = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--list', '-c', f], { env: { ...process.env, DOJO_PORT: '8787' }, encoding: 'utf8', timeout: 60_000 })
    expect(r.status).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/8787 is reserved for the real Dojo app/)
  }, 60_000)
})

// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'

// I-d: only the installed launcher (--real) may open the real ~/Dojo; everything else needs DOJO_HOME.
let tmp: string
afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }) })
const fakeHome = () => {
  tmp = mkdtempSync(join(tmpdir(), 'dojo-home-guard-'))
  mkdirSync(join(tmp, 'Dojo'))
  return tmp
}

describe('dojo-server DOJO_HOME rules', () => {
  it('requires an explicit DOJO_HOME without --real', () => {
    const home = fakeHome()
    expect(() => readServerConfig(['--fake'], { HOME: home })).toThrow(/DOJO_HOME/)
  })

  it('refuses ~/Dojo (also through a symlink or a subdirectory) without --real', () => {
    const home = fakeHome()
    symlinkSync(join(home, 'Dojo'), join(home, 'link'))
    for (const h of [join(home, 'Dojo'), join(home, 'link'), join(home, 'Dojo', 'sub')]) {
      expect(() => readServerConfig(['--fake'], { HOME: home, DOJO_HOME: h }), h).toThrow(/--real/)
    }
  })

  it('--real allows ~/Dojo and is its default', () => {
    const home = fakeHome()
    expect(readServerConfig(['--real'], { HOME: home }).home).toBe(join(home, 'Dojo'))
    expect(readServerConfig(['--real'], { HOME: home, DOJO_HOME: join(home, 'Dojo') }).home).toBe(join(home, 'Dojo'))
  })

  it('any other DOJO_HOME is fine without --real', () => {
    const home = fakeHome()
    expect(readServerConfig(['--fake'], { HOME: home, DOJO_HOME: join(home, 'elsewhere'), DOJO_PORT: '8898' }).home).toBe(join(home, 'elsewhere'))
  })

  it('the desktop app passes --real (it alone opens ~/Dojo) and a free port, never 8787', () => {
    const main = readFileSync('electron/main.mjs', 'utf8')
    expect(main).toContain("['--real', '--dist'")
    expect(main).toContain("DOJO_PORT: '0'")
  })
})

describe('a server that cannot listen touches nothing', () => {
  it('leaves another server\'s .tmp files and database alone when its port is taken', async () => {
    const home = fakeHome()
    const cfg = () => readServerConfig(['--fake'], { HOME: home, DOJO_HOME: join(home, 'data'), DOJO_PORT: '0' })
    const a = createDojoServer(cfg())
    const port = await a.listen(0)
    writeFileSync(join(home, 'data', 'backups', '.tmp-999.db'), 'in progress') // A is mid-backup
    const b = createDojoServer(cfg())
    await expect(b.listen(port)).rejects.toThrow()
    expect(existsSync(join(home, 'data', 'backups', '.tmp-999.db'))).toBe(true)
    await b.close()
    await a.close()
  })
})

describe('I1: the port', () => {
  it('without --real, DOJO_PORT is required and 8787 is refused', () => {
    const home = fakeHome()
    const env = { HOME: home, DOJO_HOME: join(home, 'data') }
    expect(() => readServerConfig(['--fake'], env)).toThrow(/DOJO_PORT/)
    expect(() => readServerConfig(['--fake'], { ...env, DOJO_PORT: '8787' })).toThrow(/8787/)
    expect(readServerConfig(['--fake'], { ...env, DOJO_PORT: '8898' }).dojoPort).toBe(8898)
  })

  it('with --real, 8787 is the default (and a given DOJO_PORT is used)', () => {
    const home = fakeHome()
    expect(readServerConfig(['--real'], { HOME: home }).dojoPort).toBe(8787)
    expect(readServerConfig(['--real'], { HOME: home, DOJO_PORT: '8896' }).dojoPort).toBe(8896)
  })

  it('the header comment states the rule', async () => {
    const { readFileSync } = await import('node:fs')
    const head = readFileSync('server/dojo-server.mjs', 'utf8').split('\n').slice(0, 8).join('\n')
    expect(head).toMatch(/--real/)
    expect(head).not.toMatch(/DOJO_PORT \(default 8787\)/)
  })
})

describe('Minor 10: ~/Dojo in another letter case is still ~/Dojo (APFS is case-insensitive)', () => {
  it.runIf(process.platform === 'darwin')('refuses DOJO_HOME=~/DOJO and ~/dojo/sub without --real', () => {
    const home = fakeHome()
    for (const h of [join(home, 'DOJO'), join(home, 'dojo', 'sub')]) {
      expect(() => readServerConfig(['--fake'], { HOME: home, DOJO_HOME: h, DOJO_PORT: '8898' }), h).toThrow(/--real/)
    }
  })
})

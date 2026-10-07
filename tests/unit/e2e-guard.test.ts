// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNotRealDojo } from '../e2e/guard'

// C3: Playwright's global setup refuses a server whose database lives under the real ~/Dojo.
let home: string
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('assertNotRealDojo', () => {
  it('refuses a dbPath under <home>/Dojo, also through a symlink', () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-guard-'))
    mkdirSync(join(home, 'Dojo'))
    symlinkSync(join(home, 'Dojo'), join(home, 'alias'))
    expect(() => assertNotRealDojo(join(home, 'Dojo', 'dojo.db'), home)).toThrow(/real ~\/Dojo/)
    expect(() => assertNotRealDojo(join(home, 'alias', 'dojo.db'), home)).toThrow(/real ~\/Dojo/)
  })

  it('accepts a temp DOJO_HOME', () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-guard-'))
    mkdirSync(join(home, 'Dojo'))
    expect(() => assertNotRealDojo(join(home, 'Dojo-e2e', 'dojo.db'), home)).not.toThrow()
    expect(() => assertNotRealDojo(join(tmpdir(), 'x', 'dojo.db'), home)).not.toThrow()
  })
})

describe('Minor 10: case-insensitive on macOS', () => {
  it.runIf(process.platform === 'darwin')('refuses <home>/DOJO/dojo.db', () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-guard-'))
    mkdirSync(join(home, 'Dojo'))
    expect(() => assertNotRealDojo(join(home, 'DOJO', 'dojo.db'), home)).toThrow(/real ~\/Dojo/)
  })
})

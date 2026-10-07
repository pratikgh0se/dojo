// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_ID, desktopConfig, ensureElectronDist, FULL_SCREEN_DEFAULT_ARGS, iconPng, parseArgs, setFullScreenDefault, stageApp, swapApp } from '../../scripts/install-app.mjs'
import { uninstall } from '../../scripts/uninstall-app.mjs'
// @ts-expect-error plain .mjs without types
import { resolveHome, toolPath } from '../../electron/env.mjs'

// C-DESKTOP: npm run install:app builds Dojo.app with Electron (the packaged-app scenarios are tests/desktop).
let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'dojo-install-')) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('the Dojo icon', () => {
  it('is a valid 1024 px PNG that sips and iconutil can turn into an .icns', () => {
    const png = iconPng()
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1024)
    const f = join(tmp, 'i.png')
    writeFileSync(f, png)
    expect(execFileSync('sips', ['-g', 'pixelWidth', f]).toString()).toContain('1024')
  })
})

describe('the app bundle', () => {
  it('stages package.json (main electron/main.mjs), electron/, server/, shared/ and the built dist/; no node_modules', () => {
    const stage = join(tmp, 'stage')
    mkdirSync(stage)
    stageApp(stage, { build: true, builder: (out: string) => { mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'index.html'), 'x') } })
    const pkg = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
    expect(pkg).toMatchObject({ name: 'dojo', productName: 'Dojo', main: 'electron/main.mjs', type: 'module' })
    for (const p of ['electron/main.mjs', 'electron/env.mjs', 'server/dojo-server.mjs', 'server/runner/runner.mjs', 'shared', 'dist/index.html']) expect(existsSync(join(stage, p)), p).toBe(true)
    expect(existsSync(join(stage, 'node_modules'))).toBe(false)
  })
  it('the builder config: an unpacked Dojo.app (no asar: the server reads dist/ and opens node:sqlite), no signing identity', () => {
    const c = desktopConfig({ out: join(tmp, 'out'), icon: null }) as { productName: string; asar: boolean; files: string[]; mac: { identity: null; target: { target: string }[] } }
    expect(c.productName).toBe('Dojo')
    expect(c.asar).toBe(false)
    expect(c.files).toEqual(expect.arrayContaining(['electron/**', 'server/**', 'shared/**', 'dist/**']))
    expect(c.mac.identity).toBeNull()
    expect(c.mac.target[0].target).toBe('dir')
  })
  it('ships Electron\'s and Chromium\'s licences in Contents/Resources (L7: electron-builder drops them on macOS)', ctx => {
    // A fresh `npm ci` does not download the Electron runtime (no postinstall in Electron 44; npm 11 blocks install scripts),
    // so fetch it here exactly as `npm run install:app` does; skip with a reason only when that is impossible (offline).
    try { ensureElectronDist({ log: () => {} }) } catch (e) { console.warn(`SKIPPED: Electron runtime unavailable: ${(e as Error).message}`); ctx.skip() }
    const c = desktopConfig({ out: join(tmp, 'out'), icon: null }) as { extraResources: { from: string; to: string }[] }
    expect(c.extraResources.map(r => r.to)).toEqual(['LICENSE.electron.txt', 'LICENSES.chromium.html'])
    for (const r of c.extraResources) expect(existsSync(r.from), r.from).toBe(true)
  }, 300_000)
  // UAT cu-4 P3-12 / ruling 23 K4: View carries our one Toggle Full Screen, so macOS must not add its own (AppKit reads this at launch)
  it('tells macOS not to add a full-screen item of its own: in the Info.plist, and by a defaults write for Dojo\'s own domain', () => {
    const c = desktopConfig({ out: join(tmp, 'out'), icon: null }) as { mac: { extendInfo: Record<string, unknown> } }
    expect(c.mac.extendInfo.NSFullScreenMenuItemEverywhere).toBe(false)
    expect(FULL_SCREEN_DEFAULT_ARGS).toEqual(['write', APP_ID, 'NSFullScreenMenuItemEverywhere', '-bool', 'false'])
    const calls: unknown[][] = []
    expect(setFullScreenDefault((...a: unknown[]) => { calls.push(a) })).toBe(true)
    expect(calls).toEqual([['/usr/bin/defaults', FULL_SCREEN_DEFAULT_ARGS, { stdio: 'ignore' }]])
    expect(setFullScreenDefault(() => { throw new Error('no defaults') })).toBe(false) // best effort: the install never fails on it
  })
  it('swapApp replaces dest/Dojo.app whole and leaves no temp dirs; a data home beside it is never touched', () => {
    const dest = join(tmp, 'Applications'), home = join(tmp, 'Dojo')
    mkdirSync(home)
    writeFileSync(join(home, 'dojo.db'), 'precious')
    const before = statSync(join(home, 'dojo.db')).mtimeMs
    const build = (v: string) => { const b = join(tmp, `built-${v}`, 'Dojo.app'); mkdirSync(join(b, 'Contents'), { recursive: true }); writeFileSync(join(b, 'Contents', 'v'), v); return b }
    const a = swapApp(build('1'), dest)
    expect(readFileSync(join(a, 'Contents', 'v'), 'utf8')).toBe('1')
    swapApp(build('2'), dest)
    expect(readFileSync(join(a, 'Contents', 'v'), 'utf8')).toBe('2')
    expect(readdirSync(dest)).toEqual(['Dojo.app'])
    expect(readFileSync(join(home, 'dojo.db'), 'utf8')).toBe('precious')
    expect(statSync(join(home, 'dojo.db')).mtimeMs).toBe(before)
  })
  it('parseArgs defaults to ~/Applications and ~/Dojo (or DOJO_HOME), with overrides', () => {
    expect(parseArgs([], {})).toEqual({ dest: join(homedir(), 'Applications'), home: join(homedir(), 'Dojo'), build: true, dist: null, icon: true })
    expect(parseArgs(['--dest', '/d', '--home', '/h', '--no-build', '--dist', '/x', '--no-icon'], {})).toEqual({ dest: '/d', home: '/h', build: false, dist: '/x', icon: false })
    expect(parseArgs([], { DOJO_HOME: '/e' }).home).toBe('/e')
  })
  it('uninstall removes only the bundle', () => {
    mkdirSync(join(tmp, 'Dojo.app'))
    writeFileSync(join(tmp, 'dojo.db'), 'x')
    expect(uninstall(tmp).removed).toBe(true)
    expect(existsSync(join(tmp, 'Dojo.app'))).toBe(false)
    expect(existsSync(join(tmp, 'dojo.db'))).toBe(true)
  })
})

describe('the app environment (a GUI app gets no shell PATH)', () => {
  it('the data home: DOJO_HOME, else the home baked into Resources/dojo.json, else ~/Dojo', () => {
    expect(resolveHome({ DOJO_HOME: '/x' }, tmp)).toBe('/x')
    expect(resolveHome({}, tmp)).toBe(join(homedir(), 'Dojo'))
    writeFileSync(join(tmp, 'dojo.json'), JSON.stringify({ home: '/baked' }))
    expect(resolveHome({}, tmp)).toBe('/baked')
  })
  it('toolPath adds the usual install places (Homebrew, /usr/local, ~/.local/bin) to a bare PATH, once each, system dirs last', () => {
    const p = (toolPath({ PATH: '/usr/bin:/bin', SHELL: '/nonexistent' }, '/home/u') as string).split(':')
    for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/home/u/.local/bin', '/usr/bin', '/bin']) expect(p).toContain(d)
    expect(new Set(p).size).toBe(p.length)
    expect(p.indexOf('/opt/homebrew/bin')).toBeLessThan(p.lastIndexOf('/usr/bin'))
  })
})

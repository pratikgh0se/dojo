#!/usr/bin/env node
// `npm run install:app` (C-DESKTOP): builds Dojo as a Mac app with Electron and installs it as ~/Applications/Dojo.app,
// replacing the old bash + Chrome launcher bundle. The app runs the Dojo server inside itself on Electron's Node
// (node:sqlite), on a free port, and opens its one window as the writer. Data stays in ~/Dojo/dojo.db, which install
// never touches. Options: --dest <dir> (default ~/Applications), --home <dir> (default $DOJO_HOME or ~/Dojo: a
// non-default home is baked into the app), --no-build (reuse a prebuilt dist from --dist <dir>), --no-icon.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = resolve(here, '..')
export const APP_ID = 'local.dojo.app'
const electronVersion = () => JSON.parse(readFileSync(join(APP_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version

// --- icon: a 1024px pixel cube, written as a PNG with zlib only, then sips + iconutil make the .icns ---
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
export function iconPng(size = 1024) {
  const bg = [15, 17, 28], main = [255, 138, 42], glow = [255, 181, 69], shade = [184, 80, 26], edge = [26, 29, 43]
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const pad = Math.round(size * 0.2), b = Math.round(size * 0.03), hl = Math.round(size * 0.06)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      let px = bg
      if (x >= pad && x < size - pad && y >= pad && y < size - pad) {
        const dx = x - pad, dy = y - pad, w = size - 2 * pad
        if (dx < b || dy < b || dx >= w - b || dy >= w - b) px = edge
        else if (dx < b + hl || dy < b + hl) px = glow
        else if (dx >= w - b - hl || dy >= w - b - hl) px = shade
        else px = main
      }
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export function makeIcns(outFile) {
  const work = mkdtempSync(join(tmpdir(), 'dojo-icon-'))
  try {
    const png = join(work, 'icon.png')
    writeFileSync(png, iconPng())
    const set = join(work, 'Dojo.iconset')
    mkdirSync(set)
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(s), String(s), png, '--out', join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), png, '--out', join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', outFile], { stdio: 'ignore' })
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * The production build of the web app into outDir (vite). For the app window (`desktop`, the default) the AI helper
 * routes are on the app's own server (VITE_DOJO_AI=helper, VITE_DOJO_HELPER_URL=self), so jobs go to claude -p through
 * it. The storage e2e build (`desktop: false`) keeps the page's fake AI and its test hooks.
 */
export function viteBuild(outDir, { desktop = true } = {}) {
  const ai = desktop ? { VITE_DOJO_AI: 'helper', VITE_DOJO_HELPER_URL: 'self' } : { VITE_DOJO_AI: '', VITE_DOJO_HELPER_URL: '' }
  execFileSync(process.execPath, [join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: APP_ROOT, stdio: 'inherit', env: { ...process.env, ...ai, VITE_DOJO_DISK: '' },
  })
}

/** The electron-builder configuration (an unpacked macOS .app, unsigned by the builder, ad-hoc signed afterwards). */
export function desktopConfig({ out, icon = null }) {
  const electronDist = join(APP_ROOT, 'node_modules', 'electron', 'dist')
  return {
    appId: APP_ID,
    productName: 'Dojo',
    directories: { output: out },
    asar: false, // the server reads dist/ and the runner's packs from plain files and opens node:sqlite
    files: ['package.json', 'electron/**', 'server/**', 'shared/**', 'dist/**'],
    // L7: electron-builder drops Electron's LICENSE and LICENSES.chromium.html from a macOS app; they ship in
    // Dojo.app/Contents/Resources/ instead.
    extraResources: [
      { from: join(electronDist, 'LICENSE'), to: 'LICENSE.electron.txt' },
      { from: join(electronDist, 'LICENSES.chromium.html'), to: 'LICENSES.chromium.html' },
    ],
    electronVersion: electronVersion(),
    electronDist,
    npmRebuild: false,
    mac: {
      target: [{ target: 'dir' }],
      category: 'public.app-category.education',
      identity: null,
      hardenedRuntime: false,
      ...(icon ? { icon } : {}),
      // macOS adds its own "Enter Full Screen" to the View menu unless this is NO; the View menu carries ours (electron/menu.mjs)
      extendInfo: { LSApplicationCategoryType: 'public.app-category.education', NSFullScreenMenuItemEverywhere: false },
    },
  }
}

/** A staging project for the builder: package.json, electron/, server/, shared/ and the built dist/. No node_modules. */
export function stageApp(stage, { build = true, dist = null, builder = viteBuild } = {}) {
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))
  writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'dojo', productName: 'Dojo', version: pkg.version, description: 'Dojo', author: 'Dojo contributors', type: 'module', main: 'electron/main.mjs' }, null, 2))
  for (const d of ['electron', 'server', 'shared']) cpSync(join(APP_ROOT, d), join(stage, d), { recursive: true })
  if (build) builder(join(stage, 'dist'))
  else cpSync(dist ?? join(APP_ROOT, 'dist'), join(stage, 'dist'), { recursive: true })
  return stage
}

/** Builds Dojo.app into a temp dir; returns its path (the caller removes `work`). */
export async function buildDesktopApp({ build = true, dist = null, icon = true, log = console.log } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'dojo-desktop-'))
  const stage = join(work, 'stage'), out = join(work, 'out')
  mkdirSync(stage)
  stageApp(stage, { build, dist })
  let iconFile = null
  if (icon) { try { iconFile = join(work, 'Dojo.icns'); makeIcns(iconFile) } catch (e) { log(`icon skipped (${e.message})`); iconFile = null } }
  const { build: ebuild, Platform } = await import('electron-builder')
  await ebuild({ projectDir: stage, targets: Platform.MAC.createTarget(['dir']), config: desktopConfig({ out, icon: iconFile }) })
  const dir = ['mac-arm64', 'mac', 'mac-universal', 'mac-x64'].map(d => join(out, d, 'Dojo.app')).find(existsSync)
  if (!dir) throw new Error(`electron-builder produced no Dojo.app under ${out}`)
  return { app: dir, work }
}

/** Puts `built` at dest/Dojo.app with renames, so a failure leaves the installed app as it was. */
export function swapApp(built, dest) {
  mkdirSync(dest, { recursive: true })
  const target = join(dest, 'Dojo.app'), old = join(dest, `.old-Dojo-${process.pid}.app`), tmp = join(dest, `.tmp-Dojo-${process.pid}.app`)
  rmSync(tmp, { recursive: true, force: true })
  cpSync(built, tmp, { recursive: true, verbatimSymlinks: true })
  const had = existsSync(target)
  if (had) renameSync(target, old)
  try { renameSync(tmp, target) } catch (e) { if (had) renameSync(old, target); rmSync(tmp, { recursive: true, force: true }); throw e }
  rmSync(old, { recursive: true, force: true })
  return target
}

/** Bakes a non-default data home into the bundle (Resources/dojo.json) and ad-hoc signs it so macOS runs it. */
export function finishBundle(app, home) {
  const res = join(app, 'Contents', 'Resources', 'dojo.json')
  if (home && resolve(home) !== join(homedir(), 'Dojo')) writeFileSync(res, JSON.stringify({ home: resolve(home) }))
  else rmSync(res, { force: true })
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
}

/** The `defaults write` that tells macOS not to add its own full-screen item to Dojo's View menu (which carries ours). */
export const FULL_SCREEN_DEFAULT_ARGS = ['write', APP_ID, 'NSFullScreenMenuItemEverywhere', '-bool', 'false']
/** Writes it before the first launch of the new bundle (AppKit reads it when the app starts). Dojo's own preferences domain only. */
export function setFullScreenDefault(run = execFileSync) {
  try { run('/usr/bin/defaults', FULL_SCREEN_DEFAULT_ARGS, { stdio: 'ignore' }); return true } catch { return false }
}

/** Builds and installs dest/Dojo.app. Only the bundle is replaced: nothing under `home` is touched but logs/. */
export async function installDesktopApp({ dest, home, build = true, dist = null, icon = true, log = console.log }) {
  const { app: built, work } = await buildDesktopApp({ build, dist, icon, log })
  try {
    finishBundle(built, home)
    const app = swapApp(built, dest)
    setFullScreenDefault()
    mkdirSync(join(home, 'logs'), { recursive: true })
    return app
  } finally { rmSync(work, { recursive: true, force: true }) }
}

export function parseArgs(argv, env = process.env) {
  const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  return {
    dest: resolve(val('--dest') ?? join(homedir(), 'Applications')),
    home: resolve(val('--home') ?? env.DOJO_HOME ?? join(homedir(), 'Dojo')),
    build: !argv.includes('--no-build'),
    dist: val('--dist') ? resolve(val('--dist')) : null,
    icon: !argv.includes('--no-icon'),
  }
}

// Symlink-safe (macOS temp dirs live under /var -> /private/var).
function isMain(metaUrl) {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl)) } catch { return false }
}

if (isMain(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2))
  const app = await installDesktopApp(o)
  console.log(`installed ${app} (Electron ${electronVersion()})`)
  console.log(`data stays in ${join(o.home, 'dojo.db')} (never touched by install); the app runs its own server on a free port (never 8787).`)
  console.log('Open Dojo from ~/Applications (or drag it to the Dock). Quitting it (Cmd-Q) or closing its window stops the server.')
  if (!existsSync(join(o.home, 'dojo.db'))) console.log('(no dojo.db yet: it is created on first launch and starts fresh)')
}

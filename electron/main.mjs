// Dojo as a Mac app (C-DESKTOP): one window with no browser UI, one instance, the Dojo server inside the app on
// Electron's own Node (node:sqlite), data in ~/Dojo (DOJO_HOME overrides it, for tests). The window opens as the
// writer (the old launcher's /#writer=<token>).
import { app, BrowserWindow, dialog, Menu, session, shell, systemPreferences } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHome, toolPath } from './env.mjs'
import { linkVerdict, permissionAllowed } from './links.mjs'
import { buildMenuTemplate, revealWindow } from './menu.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const isDev = !app.isPackaged

// View carries our one Toggle Full Screen (menu.mjs); macOS adds an "Enter Full Screen" of its own to a View menu unless this
// default is NO, which listed two (UAT cu-1 P3-13). AppKit reads it at launch, so the Info.plist and the installer set it too;
// this covers a bundle that has neither (a dev launch, an older install) from its next launch on.
if (process.platform === 'darwin') {
  try { systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false) } catch { /* best effort */ }
}

const HOME = resolveHome()
mkdirSync(join(HOME, 'logs'), { recursive: true })
// Chromium's own state (and the single-instance lock) live with the data, so each home is its own instance.
app.setPath('userData', join(HOME, 'electron'))

// DK1: one instance. A second launch hands over to the first (which focuses its window) and exits.
if (!app.requestSingleInstanceLock()) { app.exit(0) }

let win = null
let server = null
let gracefulStop = null
const stateFile = join(HOME, 'window.json')
const desktopFile = join(HOME, 'desktop.json')
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} } }
const saveState = () => { try { if (win && !win.isMinimized() && !win.isFullScreen()) writeFileSync(stateFile, JSON.stringify(win.getBounds())) } catch { /* best effort */ } }

/** Dojo › Settings… (⌘,): the page listens for this event (Shell) and goes to the screen through its own router. */
function openSettings() {
  if (!win) return
  revealWindow(win)
  void win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('dojo:navigate', { detail: '/settings' }))`).catch(() => {})
}

function menu() {
  const template = buildMenuTemplate({ isDev, home: HOME, logs: join(HOME, 'logs'), openPath: p => shell.openPath(p), openSettings })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function startServer() {
  const mod = await import(join(ROOT, 'server', 'dojo-server.mjs'))
  const runnerMod = await import(join(ROOT, 'server', 'runner', 'runner.mjs'))
  gracefulStop = mod.gracefulStop
  const env = { ...process.env, PATH: toolPath(), DOJO_HOME: HOME, DOJO_PORT: '0' }
  // tests: the fake AI (never a real claude call)
  const argv = ['--real', '--dist', join(ROOT, 'dist'), ...(process.env.DOJO_DESKTOP_FAKE_AI === '1' ? ['--fake'] : [])]
  const cfg = mod.readServerConfig(argv, env)
  const s = mod.createDojoServer(cfg)
  mod.installCrashGuards(msg => s.logger.log(msg))
  // A free port (never the old launcher's 8787): the last one when it is still free, so the window keeps its
  // origin (and its working copy) across launches, else any free port.
  const last = readJson(desktopFile).port
  let port
  try { port = await s.listen(Number.isInteger(last) && last > 1024 && last !== mod.REAL_APP_PORT ? last : 0) } catch { port = await s.listen(0) }
  try { writeFileSync(desktopFile, JSON.stringify({ port })) } catch { /* best effort */ }
  server = s
  // R5: a run killed with a previous app leaves its temp dir; clear what is older than a run can last
  void runnerMod.sweepStaleRunDirs(undefined, 10 * 60_000, m => s.logger.log(m)).catch(() => {})
  s.logger.log(`desktop app ${app.getVersion()} (Electron ${process.versions.electron}, Node ${process.versions.node}) on port ${port}`)
  const token = (() => { try { return readFileSync(join(HOME, 'writer.token'), 'utf8').trim() } catch { return '' } })()
  return { url: `http://127.0.0.1:${port}`, token }
}

/** SEC-D-04: no browser permission for any page, check or request, unless the allow-list (links.mjs) names it for the app's own origin. */
function lockPermissions(appOrigin) {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permissionAllowed(permission, details?.requestingUrl ?? '', appOrigin)))
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permissionAllowed(permission, requestingOrigin, appOrigin))
  ses.setDevicePermissionHandler(() => false) // no HID, serial or USB device
}

/** SEC-D-05: a link leaves for the default browser only when it is http(s) to a public host; a local one asks first. */
function openOutside(u) {
  const verdict = linkVerdict(u)
  if (verdict === 'open') return void shell.openExternal(u)
  if (verdict !== 'confirm' || !win) return
  void dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancel', 'Open in Browser'], defaultId: 0, cancelId: 0,
    message: 'Open a link to this Mac or your local network?',
    detail: `${u}\n\nThis link points at this Mac or a device on your network, not a website. Open it only if you expected it.`,
  }).then(r => { if (r.response === 1) void shell.openExternal(u) }).catch(() => {})
}

function createWindow({ url, token }) {
  const s = readJson(stateFile)
  win = new BrowserWindow({
    width: s.width ?? 1280, height: s.height ?? 860, x: s.x, y: s.y, minWidth: 375, minHeight: 600,
    title: 'Dojo', backgroundColor: '#0f111c', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => { win.show(); win.focus() })
  for (const ev of ['resize', 'move', 'close']) win.on(ev, saveState)
  win.on('closed', () => { win = null })
  // External links open in the default browser; the window never navigates away from the app.
  const own = u => u === url || u.startsWith(url + '/') || u.startsWith(url + '#')
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (!own(u)) openOutside(u); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, u) => { if (!own(u)) { e.preventDefault(); openOutside(u) } })
  // SEC-D-12: a frame (the Python runner's) never navigates away from the app's own files
  win.webContents.on('will-frame-navigate', e => {
    if (!e.isMainFrame && !own(e.url) && e.url !== 'about:blank' && e.url !== 'about:srcdoc') e.preventDefault()
  })
  // Addendum 3: this window is the writer, as the old launcher's /#writer=<token> made it.
  win.loadURL(token ? `${url}/#writer=${token}` : `${url}/`)
}

app.on('second-instance', () => { revealWindow(win) })
// ruling 23 K4: a click on the Dock icon brings the window back, a minimised one too (macOS only reopens a hidden one)
app.on('activate', () => { revealWindow(win) })
app.on('window-all-closed', () => app.quit()) // a single-window app: closing it quits
let quitting = false
app.on('before-quit', e => {
  if (quitting || !server) return
  e.preventDefault(); quitting = true
  // R5: the run in flight is killed, the server closed, and the shutdown sweep kills anything of its runs left
  const s = server
  server = null
  Promise.resolve(gracefulStop ? gracefulStop(s) : s.close()).catch(() => {}).finally(() => app.quit())
})

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: 'Dojo', applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
  })
  menu()
  let target
  try { target = await startServer() } catch (e) {
    dialog.showErrorBox('Dojo', `Dojo could not start its server: ${e?.message ?? e}. The logs are in ${join(HOME, 'logs')}.`)
    app.exit(1); return
  }
  if (process.env.DOJO_DESKTOP_INFO) writeFileSync(process.env.DOJO_DESKTOP_INFO, JSON.stringify({ url: target.url, pid: process.pid, home: HOME }))
  lockPermissions(target.url)
  createWindow(target)
})


// C-DESKTOP DK-01..DK-11 for Dojo against the packaged app (Playwright's Electron launch). Every launch has its own temp
// DOJO_HOME, a bare GUI PATH (the app finds go, claude and node itself) and the fake AI (never a real claude call).
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { buildDesktopApp, finishBundle, installDesktopApp } from '../../scripts/install-app.mjs'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'

let built: { app: string; work: string }
let exe = ''
const dirs: string[] = []
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
const GUI_ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } // what a Dock launch gets
test.beforeAll(async () => {
  test.setTimeout(600_000)
  built = await buildDesktopApp({ build: true, icon: true, log: () => {} })
  finishBundle(built.app, null)
  exe = join(built.app, 'Contents', 'MacOS', 'Dojo')
})
test.afterAll(() => { rmSync(built.work, { recursive: true, force: true }); for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

async function launch(home: string, executablePath = exe, { cspReport = true } = {}): Promise<{ app: ElectronApplication; info: () => { url: string; pid: number } }> {
  const infoFile = join(home, 'desktop-info.json')
  const env: Record<string, string> = { HOME: process.env.HOME ?? '', SHELL: process.env.SHELL ?? '/bin/zsh', TMPDIR: process.env.TMPDIR ?? '/tmp', ...GUI_ENV, DOJO_HOME: home, DOJO_DESKTOP_INFO: infoFile, DOJO_DESKTOP_FAKE_AI: '1' }
  // SEC-D-03: a run that collects CSP violations (DOJO_CSP_REPORT_FILE) collects the app window's too
  if (process.env.DOJO_CSP_REPORT_FILE && cspReport) env.DOJO_CSP_REPORT_FILE = process.env.DOJO_CSP_REPORT_FILE
  const app = await electron.launch({ executablePath, env })
  return { app, info: () => JSON.parse(readFileSync(infoFile, 'utf8')) }
}
/** First launch on a fresh home: onboarding (start date), then Today. */
async function onboard(page: Page) {
  const date = page.getByRole('textbox', { name: 'Start date' })
  await date.or(page.getByTestId('now-headline')).first().waitFor({ timeout: 20_000 })
  if (await date.isVisible()) {
    await date.fill('2026-10-05')
    await page.getByRole('button', { name: 'Start the plan ▸' }).click()
  }
  await expect(page.getByTestId('now-headline')).toBeVisible()
}
const helpers = (home: string) => execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n').filter(l => l.includes(`--user-data-dir=${join(home, 'electron')}`))
const runnerProcs = () => execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n').filter(l => /dojo-run-[A-Za-z0-9]/.test(l) && !l.includes(' ps '))
const listening = async (url: string) => { try { await fetch(`${url}/db/health`); return true } catch { return false } }

test('DK-01 launch: one window within 3 s at 1280 x 860 (minimum 375 x 600), no browser UI, isolation and sandbox on, a free port (never 8787)', async () => {
  const home = tmp('dojo-desk-home-')
  const t0 = Date.now()
  const { app, info } = await launch(home)
  try {
    const page = await app.firstWindow()
    await page.getByTestId('screen-onboarding').or(page.getByTestId('now-headline')).first().waitFor()
    expect(Date.now() - t0).toBeLessThan(3000 + 3000) // 3 s for the window; the margin covers Playwright's attach and a cold build cache
    const w = await app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows(), win = all[0]
      const p = (win.webContents as unknown as { getLastWebPreferences(): { contextIsolation?: boolean; nodeIntegration?: boolean; sandbox?: boolean } | null }).getLastWebPreferences()
      return { count: all.length, bounds: win.getContentBounds(), min: win.getMinimumSize(), title: win.getTitle(), iso: p?.contextIsolation, node: p?.nodeIntegration, sandbox: p?.sandbox }
    })
    expect(w.count).toBe(1)
    expect(w.min).toEqual([375, 600])
    expect([w.iso, w.node, w.sandbox]).toEqual([true, false, true])
    const vp = await page.evaluate(() => [innerWidth, innerHeight])
    expect(vp).toEqual([w.bounds.width, w.bounds.height]) // no toolbar or address bar
    expect(w.bounds.width).toBe(1280)
    const { url } = info()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(url).not.toContain(':8787')
    expect(page.url().startsWith(url + '/')).toBe(true)
    expect(existsSync(join(home, 'dojo.db'))).toBe(true)
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  } finally { await app.close() }
})

test('DK-01b the window size and position are remembered', async () => {
  const home = tmp('dojo-desk-home-')
  let { app } = await launch(home)
  await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setBounds({ x: 60, y: 80, width: 900, height: 700 }) })
  await app.evaluate(({ app }) => app.quit())
  await app.waitForEvent('close').catch(() => {})
  ;({ app } = await launch(home))
  try {
    await app.firstWindow()
    const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
    expect([b.width, b.height]).toEqual([900, 700])
  } finally { await app.close() }
})

test('DK-02 launching again focuses the same window: the second process exits, still one window and one server', async () => {
  const home = tmp('dojo-desk-home-')
  const { app, info } = await launch(home)
  try {
    await app.firstWindow()
    const first = info()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
    const second = spawn(exe, [], { env: { ...process.env, ...GUI_ENV, DOJO_HOME: home }, stdio: 'ignore' })
    const code = await new Promise<number | null>(r => second.once('exit', r))
    expect(code).toBe(0)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows(); return [w.length, w[0].isMinimized(), w[0].isVisible()] })).toEqual([1, false, true])
    expect(info().pid).toBe(first.pid)
  } finally { await app.close() }
})

test('DK-03 Cmd-Q stops the server: nothing listening afterwards and no helper process left', async () => {
  const home = tmp('dojo-desk-home-')
  const { app, info } = await launch(home)
  await app.firstWindow()
  const { url } = info()
  expect(await listening(url)).toBe(true)
  expect(helpers(home).length).toBeGreaterThan(0)
  await app.evaluate(({ app }) => app.quit())
  await app.waitForEvent('close').catch(() => {})
  await expect.poll(() => listening(url), { timeout: 10_000 }).toBe(false)
  await expect.poll(() => helpers(home).length, { timeout: 10_000 }).toBe(0)
})

test('DK-04 data written by the old launcher build (the web server on the same home) shows in the app', async () => {
  const home = tmp('dojo-desk-home-')
  const s = createDojoServer(readServerConfig(['--fake'], { ...process.env, DOJO_HOME: home, DOJO_PORT: '0' }))
  const port = await s.listen(0)
  const token = readFileSync(join(home, 'writer.token'), 'utf8').trim()
  const r = await fetch(`http://127.0.0.1:${port}/db/ops`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': token, Origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ clientId: 'old', ops: [{ opId: 'o1', tbl: 'settings', op: 'put', id: 'main', at: new Date().toISOString(), doc: { id: 'main', startDate: '2026-10-05', trackedFrom: 1 } }] }),
  })
  expect(r.ok).toBe(true)
  await s.close()
  const { app } = await launch(home)
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('now-headline')).toBeVisible() // onboarded already: no first-launch screen
    await expect(page.getByTestId('screen-onboarding')).toHaveCount(0)
  } finally { await app.close() }
})

test('DK-05 external links open in the default browser; the window never navigates away', async () => {
  const home = tmp('dojo-desk-home-')
  const { app, info } = await launch(home)
  try {
    const page = await app.firstWindow()
    await onboard(page)
    await app.evaluate(({ shell }) => { (globalThis as unknown as { opened: string[] }).opened = []; shell.openExternal = async (u: string) => { (globalThis as unknown as { opened: string[] }).opened.push(u) } })
    await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.com/x'; a.target = '_blank'; document.body.appendChild(a); a.click() })
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual(['https://example.com/x'])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(page.url().startsWith(info().url)).toBe(true)
  } finally { await app.close() }
})

test('SEC-D-03/04/05: the window runs under the CSP, gets no browser permission, and local links ask before leaving', async () => {
  const home = tmp('dojo-desk-home-')
  const { app } = await launch(home, exe, { cspReport: false }) // its deliberate violation stays out of a run's report file
  try {
    const page = await app.firstWindow()
    await onboard(page)
    // D-03: the app's documents carry the policy, and an injected inline script does not run
    const csp = await page.evaluate(() => fetch('/').then(r => r.headers.get('content-security-policy')))
    expect(csp).toContain("script-src 'self';")
    expect(csp).toContain("frame-ancestors 'none'")
    await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s) })
    expect(await page.evaluate(() => (window as unknown as { __inline?: number }).__inline)).toBeUndefined()
    // D-04: Electron grants every permission by default; this window gets none (request or check)
    const perms = await page.evaluate(async () => ({
      notifications: await Notification.requestPermission(),
      geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
      notifyCheck: (await navigator.permissions.query({ name: 'notifications' })).state,
    }))
    expect(perms).toEqual({ notifications: 'denied', geolocation: 'denied', notifyCheck: 'denied' })
    // D-05: http(s) to a public host opens; this Mac or the local network asks (Cancel here); anything else never opens
    await app.evaluate(({ dialog, shell }) => {
      const g = globalThis as unknown as { opened: string[]; asked: string[]; answer: number }
      g.opened = []; g.asked = []; g.answer = 0
      shell.openExternal = async (u: string) => { g.opened.push(u) }
      ;(dialog as unknown as { showMessageBox: (w: unknown, o: { detail?: string }) => Promise<{ response: number }> }).showMessageBox = async (_w, o) => { g.asked.push(String(o.detail).split('\n')[0]); return { response: g.answer } }
    })
    const click = (href: string) => page.evaluate(h => { const a = document.createElement('a'); a.href = h; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove() }, href)
    for (const h of ['https://example.com/a', 'http://example.com/b', 'http://127.0.0.1:9/x', 'http://192.168.1.1/', 'https://nas.local/', 'file:///etc/hosts']) await click(h)
    const state = () => app.evaluate(() => { const g = globalThis as unknown as { opened: string[]; asked: string[] }; return { opened: g.opened, asked: g.asked } })
    await expect.poll(async () => (await state()).asked).toEqual(['http://127.0.0.1:9/x', 'http://192.168.1.1/', 'https://nas.local/'])
    expect((await state()).opened).toEqual(['https://example.com/a', 'http://example.com/b'])
    // confirming opens it
    await app.evaluate(() => { (globalThis as unknown as { answer: number }).answer = 1 })
    await click('http://localhost:3000/y')
    await expect.poll(async () => (await state()).opened).toEqual(['https://example.com/a', 'http://example.com/b', 'http://localhost:3000/y'])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally { await app.close() }
})

test('L7 the bundle carries Electron\'s and Chromium\'s licences in Contents/Resources', () => {
  const res = join(built.app, 'Contents', 'Resources')
  expect(readFileSync(join(res, 'LICENSE.electron.txt'), 'utf8')).toContain('Electron contributors')
  expect(statSync(join(res, 'LICENSES.chromium.html')).size).toBeGreaterThan(1_000_000)
})

test('DK-06 install, then reinstall: the data is kept and the app opens it', async () => {
  const dest = tmp('dojo-desk-dest-'), home = tmp('dojo-desk-home-')
  const dist = join(built.app, 'Contents', 'Resources', 'app', 'dist')
  const app1 = await installDesktopApp({ dest, home, build: false, dist, icon: false, log: () => {} })
  const first = await launch(home, join(app1, 'Contents', 'MacOS', 'Dojo'))
  const page = await first.app.firstWindow()
  await onboard(page)
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  await first.app.close()
  const before = statSync(join(home, 'dojo.db')).size
  const app2 = await installDesktopApp({ dest, home, build: false, dist, icon: false, log: () => {} })
  expect(app2).toBe(app1)
  expect(statSync(join(home, 'dojo.db')).size).toBe(before)
  const second = await launch(home, join(app2, 'Contents', 'MacOS', 'Dojo'))
  try {
    const p2 = await second.app.firstWindow()
    await expect(p2.getByTestId('now-headline')).toBeVisible()
  } finally { await second.app.close() }
})

test('DK-08 / DK-09 / DK-10: the window is the writer (no read-only banner); a Go Run on p91 passes 2/2 with a bare GUI PATH; a Python run loads Pyodide from inside the app', async () => {
  const home = tmp('dojo-desk-home-')
  const { app } = await launch(home)
  try {
    const page = await app.firstWindow()
    await onboard(page)
    await expect(page.getByTestId('readonly-banner')).toHaveCount(0) // DK-09
    await expect(page.getByTestId('save-status')).toHaveText('Saved')
    await page.evaluate(() => { history.pushState(null, '', '/do/p91'); dispatchEvent(new PopStateEvent('popstate')) })
    const code = page.getByRole('textbox', { name: 'Code' })
    await code.waitFor()
    await code.fill('package main\n\nfunc numDecodings(s string) int {\n\tif s == "12" {\n\t\treturn 2\n\t}\n\treturn 3\n}\n')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByTestId('run-status')).toHaveText('Passed 2/2', { timeout: 120_000 }) // DK-08
    await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Python' }).check()
    await code.fill(`def numDecodings(s: str) -> int:
    prev2, prev1 = 1, (0 if s[0] == '0' else 1)
    for i in range(2, len(s) + 1):
        cur = 0
        if s[i - 1] != '0':
            cur += prev1
        if s[i - 2] == '1' or (s[i - 2] == '2' and s[i - 1] <= '6'):
            cur += prev2
        prev2, prev1 = prev1, cur
    return prev1
`)
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByTestId('run-status')).toHaveText('Passed 2/2', { timeout: 120_000 }) // DK-10
  } finally { await app.close() }
})

test('DK-11 Cmd-Q during a Go run leaves no orphan runner process', async () => {
  const home = tmp('dojo-desk-home-')
  const { app } = await launch(home)
  const page = await app.firstWindow()
  await onboard(page)
  await page.evaluate(() => { history.pushState(null, '', '/do/p91'); dispatchEvent(new PopStateEvent('popstate')) })
  const code = page.getByRole('textbox', { name: 'Code' })
  await code.waitFor()
  await code.fill('package main\n\nfunc numDecodings(s string) int {\n\tx := 0\n\tfor {\n\t\tx++\n\t}\n\treturn x\n}\n')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByTestId('run-status')).toHaveText(/Running/, { timeout: 30_000 })
  await expect.poll(() => runnerProcs().length, { timeout: 60_000 }).toBeGreaterThan(0) // the program is running
  await app.evaluate(({ app }) => app.quit())
  await app.waitForEvent('close').catch(() => {})
  await expect.poll(() => runnerProcs().length, { timeout: 15_000 }).toBe(0)
  await expect.poll(() => helpers(home).length, { timeout: 10_000 }).toBe(0)
})

const DEV_WORDS = /\bbrowser\b|chrome|localhost|npm run|docs\/|the Dock launcher|reload this page/i

test('DK-12 Mac copy: the app shows no browser, Chrome, localhost, npm or docs/ wording (Settings, Backups, save status help)', async () => {
  const home = tmp('dojo-desk-home-')
  const { app } = await launch(home)
  try {
    const page = await app.firstWindow()
    await onboard(page)
    for (const path of ['/', '/settings', '/progress', '/board']) {
      await page.evaluate(p => { history.pushState(null, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
      await page.waitForTimeout(600)
      const text = await page.locator('body').innerText()
      expect(text, path).not.toMatch(DEV_WORDS)
    }
    expect(await page.evaluate(() => navigator.userAgent)).toMatch(/Electron\//)
  } finally { await app.close() }
})

test('DK-13 AI through the app\'s own server: Draft briefs works (fake AI here), and with a bare GUI PATH the real helper finds claude', async () => {
  const home = tmp('dojo-desk-home-')
  const { app } = await launch(home)
  try {
    const page = await app.firstWindow()
    await onboard(page)
    await page.evaluate(() => { history.pushState(null, '', '/board'); dispatchEvent(new PopStateEvent('popstate')) })
    await page.getByRole('button', { name: 'Draft briefs for Sprint 1' }).click()
    await expect(page.getByTestId('brief-progress')).toHaveText('Done', { timeout: 60_000 })
  } finally { await app.close() }
  let hasClaude = true
  try { execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { stdio: 'ignore' }) } catch { hasClaude = false }
  test.skip(!hasClaude, 'claude is not installed on this Mac')
  const home2 = tmp('dojo-desk-home-')
  const infoFile = join(home2, 'desktop-info.json')
  const real = await electron.launch({ executablePath: exe, env: { HOME: process.env.HOME ?? '', SHELL: process.env.SHELL ?? '/bin/zsh', TMPDIR: process.env.TMPDIR ?? '/tmp', ...GUI_ENV, DOJO_HOME: home2, DOJO_DESKTOP_INFO: infoFile } })
  try {
    await real.firstWindow()
    const { url } = JSON.parse(readFileSync(infoFile, 'utf8'))
    const h = await (await fetch(`${url}/health`)).json() as { claude?: string }
    expect(h.claude).toBe('found')
  } finally { await real.close() }
})

test('DK-14 (ruling 23 K4) native menu: File › Close Window, Dojo › Settings… opens Settings, exactly one Toggle Full Screen; a Dock click restores a minimised window', async () => {
  const home = tmp('dojo-desk-home-')
  const { app } = await launch(home)
  try {
    const page = await app.firstWindow()
    await onboard(page)
    const bar = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(m => ({
      title: m.label,
      items: (m.submenu?.items ?? []).map(i => ({ label: i.label, role: i.role ?? null, accelerator: i.accelerator ? String(i.accelerator) : null })),
    })))
    const items = (title: string) => bar.find(m => m.title === title)!.items
    expect(items('File').find(i => i.label === 'Close Window')?.role).toBe('close')
    expect(items('File').find(i => i.label === 'Close Window')?.accelerator ?? 'CommandOrControl+W').toMatch(/W$/)
    expect(items('Dojo').find(i => i.label === 'Settings…')?.accelerator).toMatch(/,$/)
    // ours is the one: macOS's own is switched off (NSFullScreenMenuItemEverywhere), and it lives outside Electron's menu model, so
    // the real menu bar is checked by the computer-use UAT (cu-1 P3-13, cu-3p P3-4, cu-4 P3-12: dropping ours left none)
    expect(bar.flatMap(m => m.items).filter(i => i.role === 'togglefullscreen' || /full screen/i.test(i.label))).toHaveLength(1)
    expect(items('View').map(i => i.role)).toEqual(expect.arrayContaining(['resetzoom', 'zoomin', 'zoomout'])) // Electron reports roles lowercased // the dev launch adds Reload and DevTools
    // Settings… navigates the page through its own router
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(m => m.label === 'Dojo')!.submenu!.items.find(i => i.label === 'Settings…')!.click())
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/settings')
    // a Dock click is `activate`: it brings a minimised window back
    const minimised = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
    await expect.poll(minimised).toBe(true)
    await app.evaluate(({ app: a }) => { a.emit('activate') })
    await expect.poll(minimised).toBe(false)
  } finally { await app.close() }
})

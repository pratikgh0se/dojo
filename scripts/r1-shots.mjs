#!/usr/bin/env node
// Screenshots every R1 screen of the running app (Playwright chromium) for the side-by-side check against the approved mockups.
//   node scripts/r1-shots.mjs --out <dir> [--fixtures <dir>] [--only today,path,...] [--tmp <dir>]
// Fixtures come from `npm run fixtures:build -- --out <dir>` (default $FIXTURES_DIR, else <repo>/fixtures). Like r1-measure.mjs it starts its
// own `scripts/dev.mjs` servers (ports 8900-8999, never 8787, a scratch DOJO_HOME each, own process group, only those groups are killed).
// Output: <out>/<width>-<name>.png (1280 = desktop 1280x800, 390 = phone 390x844; `-tall` = whole scrolling content) and <out>/metrics.jsonl with, per shot,
// horizontal overflow (scrollWidth vs clientWidth), console errors / page errors / unhandled rejections, text clipped by its box, scroll containers.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, appendFileSync, writeFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const OUT = resolve(arg('out') ?? join(ROOT, 'shots'))
const FIX = resolve(arg('fixtures') ?? process.env.FIXTURES_DIR ?? join(ROOT, 'fixtures'))
const TMP = resolve(arg('tmp') ?? process.env.R1_SHOTS_TMP ?? tmpdir())
const ONLY = (arg('only') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const VP = { 1280: { width: 1280, height: 800 }, 390: { width: 390, height: 844 } }
const CLOCK = new Date('2026-11-04T10:00:00+05:30') // Wednesday 10:00 Asia/Kolkata
const want = g => ONLY.length === 0 || ONLY.includes(g)
mkdirSync(OUT, { recursive: true })
const TAG = ONLY.length ? `-${ONLY.join('+')}` : ''
const METRICS = join(OUT, `metrics${TAG}.jsonl`)
writeFileSync(METRICS, '')

// ---------------------------------------------------------------- servers (own process groups only)
const GROUPS = new Set()
const usedPorts = new Set()
const portFree = p => new Promise(res => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))) })
async function freePair() {
  for (let p = 8900 + Math.floor(Math.random() * 40) * 2; p < 8998; p += 2) {
    if (usedPorts.has(p) || p === 8787 || p + 1 === 8787) continue
    if ((await portFree(p)) && (await portFree(p + 1))) { usedPorts.add(p); return [p, p + 1] }
  }
  throw new Error('no free port pair in 8900-8999')
}
const killGroup = (pid, sig) => { try { process.kill(-pid, sig) } catch { /* gone */ } }
const killAll = () => { for (const pid of GROUPS) killGroup(pid, 'SIGKILL') }
process.on('exit', killAll)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killAll(); process.exit(130) })

async function startApp(fxName) {
  const home = mkdtempSync(join(TMP, 'r1s-home-'))
  const db = join(FIX, fxName, 'dojo.db')
  if (!existsSync(db)) throw new Error(`fixture missing: ${db}`)
  copyFileSync(db, join(home, 'dojo.db'))
  let manifest = {}
  try { manifest = JSON.parse(readFileSync(join(FIX, fxName, 'manifest.json'), 'utf8')) } catch { /* optional */ }
  const [port, sport] = await freePair()
  const env = { ...process.env, DOJO_HOME: home, DOJO_PORT: String(port), DOJO_SERVER_PORT: String(sport) }
  delete env.DOJO_PLAN_FILE; delete env.DOJO_DEV_DISK
  const child = spawn(process.execPath, [join(ROOT, 'scripts/dev.mjs')], { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  GROUPS.add(child.pid)
  console.log(`# server ${fxName}: pid ${child.pid} ports ${port}/${sport}`)
  let log = ''
  const exited = new Promise(r => child.once('exit', r))
  child.stdout.on('data', d => { log += d }); child.stderr.on('data', d => { log += d })
  const t0 = Date.now()
  let token = null
  while (Date.now() - t0 < 90_000) {
    const m = log.match(/dev writer URL: http:\/\/127\.0\.0\.1:(\d+)\/#writer=(\S+)/)
    if (m) { token = m[2]; break }
    if (child.exitCode !== null) throw new Error(`dev.mjs exited early:\n${log}`)
    await new Promise(r => setTimeout(r, 200))
  }
  if (!token) throw new Error(`no writer URL within 90 s:\n${log}`)
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${origin}/db/health`); if (r.ok && (await r.json()).ok) break } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 200))
  }
  return {
    origin, token, ids: manifest.ids ?? {}, manifest,
    async stop() {
      killGroup(child.pid, 'SIGTERM')
      await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))])
      killGroup(child.pid, 'SIGKILL'); GROUPS.delete(child.pid)
      rmSync(home, { recursive: true, force: true })
    },
  }
}

// ---------------------------------------------------------------- browser sessions
const browser = await chromium.launch()
const NOTES = []

function pageProbe() {
  window.__rej = []
  window.addEventListener('unhandledrejection', e => { window.__rej.push(String((e.reason && (e.reason.message || e.reason)) || e.reason)) })
}

async function open(app, vp, { writer = true } = {}) {
  const ctx = await browser.newContext({ viewport: VP[vp], timezoneId: 'Asia/Kolkata', locale: 'en-US', deviceScaleFactor: 1 })
  await ctx.clock.setFixedTime(CLOCK)
  await ctx.addInitScript(`(${pageProbe.toString()})()`)
  const page = await ctx.newPage()
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(`console.error: ${m.text().slice(0, 200)}`) })
  page.on('pageerror', e => errs.push(`pageerror: ${String(e.message).slice(0, 200)}`))
  if (writer) {
    await page.goto(`${app.origin}/#writer=${app.token}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !location.hash.includes('writer'), null, { timeout: 30_000 }).catch(() => {})
    await page.waitForSelector('[data-testid^="screen-"]', { timeout: 30_000 }).catch(() => {})
  }
  return { ctx, page, errs, vp, app }
}

async function go(S, path, screen, settle = 700) {
  await S.page.goto(`${S.app.origin}${path}`, { waitUntil: 'domcontentloaded' })
  if (screen) await S.page.waitForSelector(`[data-testid="${screen}"]`, { timeout: 20_000 }).catch(() => NOTES.push(`missing ${screen} at ${path} (${S.vp})`))
  await S.page.waitForTimeout(settle)
}

const probe = () => {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility({ checkVisibilityCSS: true }) }
  const desc = el => {
    const t = el.getAttribute('data-testid'), c = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/)[0]}` : ''
    const x = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30)
    return `${el.tagName.toLowerCase()}${t ? `[${t}]` : c}${x ? ` "${x}"` : ''}`
  }
  const all = [...document.body.querySelectorAll('*')].filter(e => !e.closest('svg') && vis(e))
  const wide = all.filter(e => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).slice(0, 6).map(desc)
  const scrollers = all.filter(e => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 2 }).slice(0, 8).map(e => `${desc(e)} ${e.clientHeight}/${e.scrollHeight}`)
  const clipped = all.filter(e => {
    const cs = getComputedStyle(e)
    if (!(cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis')) return false
    return [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.scrollWidth > e.clientWidth + 1
  }).slice(0, 8).map(e => `${desc(e)} ${e.clientWidth}/${e.scrollWidth}`)
  const clippedV = all.filter(e => {
    const cs = getComputedStyle(e)
    if (!(cs.overflowY === 'hidden' || cs.overflowY === 'clip')) return false
    return [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.scrollHeight > e.clientHeight + 2
  }).slice(0, 8).map(e => `${desc(e)} h${e.clientHeight}/${e.scrollHeight}`)
  return {
    vw, vh, docSW: de.scrollWidth, docCW: de.clientWidth, docSH: de.scrollHeight, bodySW: document.body.scrollWidth,
    hOverflow: de.scrollWidth > de.clientWidth, wide, scrollers, clipped, clippedV, rej: window.__rej ?? [],
  }
}

/** Takes <vp>-<name>.png and appends one metrics line. `tall`: also <vp>-<name>-tall.png with the whole scrolling content. */
async function shot(S, name, { tall = false, clip = null } = {}) {
  const file = join(OUT, `${S.vp}-${name}.png`)
  await S.page.screenshot({ path: file, ...(clip ? { clip } : {}) })
  const m = await S.page.evaluate(probe)
  const errs = S.errs.splice(0)
  appendFileSync(METRICS, JSON.stringify({ shot: `${S.vp}-${name}`, ...m, errs: [...errs, ...m.rej.map(r => `unhandledrejection: ${r}`)] }) + '\n')
  if (tall) {
    // The shell scrolls inside <main> or the document: grow the viewport to the content height (capped) and shoot again.
    const need = await S.page.evaluate(() => {
      let h = document.documentElement.scrollHeight
      for (const e of document.querySelectorAll('main, [data-testid^="screen-"], .sh-main, .sh-col, #root > *')) h = Math.max(h, e.scrollHeight + e.getBoundingClientRect().top)
      return Math.ceil(h)
    })
    if (need > VP[S.vp].height + 40) {
      await S.page.setViewportSize({ width: VP[S.vp].width, height: Math.min(need + 20, 4200) })
      await S.page.waitForTimeout(300)
      await S.page.screenshot({ path: join(OUT, `${S.vp}-${name}-tall.png`) })
      await S.page.setViewportSize(VP[S.vp])
      await S.page.waitForTimeout(200)
    }
  }
  console.log(`shot ${S.vp}-${name}${errs.length ? `  (${errs.length} errors)` : ''}`)
}

const click = async (S, testid, { timeout = 4000, force = false } = {}) => {
  try { await S.page.locator(`[data-testid="${testid}"]`).first().click({ timeout, force }); return true } catch { NOTES.push(`could not click ${testid} (${S.vp})`); return false }
}
const press = async (S, key) => { await S.page.keyboard.press(key); await S.page.waitForTimeout(400) }
const closeSession = async S => { await S.ctx.close() }

// ---------------------------------------------------------------- groups
async function withApp(fx, fn) {
  let app
  try { app = await startApp(fx); await fn(app) } catch (e) { NOTES.push(`group ${fx}: ${e.message.split('\n')[0]}`); console.log(`ERROR ${fx}: ${e.message.split('\n')[0]}`) } finally { if (app) await app.stop() }
}

/** The core walk on FX-IDLE, at one viewport. */
async function idleWalk(app, vp) {
  const S = await open(app, vp)
  const d = vp === '1280'
  await go(S, '/', 'screen-today', 1200)
  await shot(S, 'today', { tall: true })
  if (await click(S, 'today-pick-else')) { await S.page.waitForTimeout(500); await shot(S, 'today-pick') }
  await go(S, '/', 'screen-today')
  if (await click(S, 'today-stats-toggle')) { await S.page.waitForTimeout(500); await shot(S, 'today-stats', { tall: true }) }
  await go(S, '/path', 'screen-path')
  await shot(S, 'path', { tall: true })
  if (await click(S, 'path-done-toggle')) { await S.page.waitForTimeout(500); await shot(S, 'path-done-open', { tall: true }) }
  await go(S, '/skills', 'screen-skills')
  await shot(S, 'skills-map', { tall: true })
  const area = app.manifest?.skills?.areaOfQuest ?? 'llm'
  await go(S, `/skills/area/${area}`, 'skills-area-view', 900)
  await shot(S, 'skills-area', { tall: true })
  // a second node (a locked one) selected, to see the panel with "Needs first"
  const locked = S.page.locator('[data-testid^="skills-node-"][data-state="locked"]').first()
  if (await locked.count()) { await locked.click({ force: true, timeout: 3000 }).catch(() => {}); await S.page.waitForTimeout(400); await shot(S, 'skills-area-locked', { tall: true }) }
  await go(S, '/skills/stats', null, 900)
  await shot(S, 'skills-stats', { tall: true })
  await go(S, '/review', 'screen-review')
  await shot(S, 'review-question', { tall: true })
  const ans = S.page.locator('[data-testid="review-answer"]').first()
  if (await ans.count()) await ans.fill('Decode reads every weight for each token, so memory bandwidth limits it.').catch(() => {})
  if (await click(S, 'review-reveal')) { await S.page.waitForTimeout(800); await shot(S, 'review-revealed', { tall: true }) }
  for (const [k, id] of [['watch', 'T_WATCH'], ['read', 'T_READ'], ['build', 'T_BUILD'], ['problem', 'T_PROBLEM']]) {
    if (!app.ids[id]) { NOTES.push(`manifest has no ${id}`); continue }
    await go(S, `/do/${app.ids[id]}`, 'screen-do', 1000)
    await shot(S, `ticket-${k}`, { tall: true })
  }
  await go(S, '/settings', 'screen-settings'); await shot(S, 'settings', { tall: true })
  await go(S, '/guide', 'screen-guide'); await shot(S, 'guide', { tall: true })
  // shell overlays on Today
  await go(S, '/', 'screen-today')
  if (await click(S, 'shell-search')) { await S.page.waitForTimeout(500); await shot(S, 'palette'); await S.page.keyboard.type('llm'); await S.page.waitForTimeout(500); await shot(S, 'palette-typed'); await press(S, 'Escape') }
  await go(S, '/', 'screen-today')
  if (await click(S, 'shell-gear')) { await S.page.waitForTimeout(500); await shot(S, 'gear-menu'); await press(S, 'Escape') }
  await go(S, '/', 'screen-today')
  await S.page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await S.page.keyboard.press('Shift+?'); await S.page.waitForTimeout(500)
  if (await S.page.locator('[data-testid="shell-shortcuts"]').count()) await shot(S, 'shortcuts'); else NOTES.push(`? overlay did not open (${vp})`)
  await press(S, 'Escape')
  if (d) {
    await go(S, '/', 'screen-today')
    await S.page.hover('[data-testid="shell-nav-path"]').catch(() => {}); await S.page.waitForTimeout(500)
    await shot(S, 'shell-hover')
  }
  await closeSession(S)
}

await (async () => {
  if (want('idle')) await withApp('FX-IDLE', async app => { for (const vp of ['1280', '390']) await idleWalk(app, vp) })

  if (want('day0')) await withApp('FX-DAY0', async app => {
    for (const vp of ['1280', '390']) {
      const S = await open(app, vp)
      await go(S, '/', 'screen-today', 1200); await shot(S, 'today-day0', { tall: true })
      await go(S, '/path', 'screen-path'); await shot(S, 'path-day0', { tall: true })
      await go(S, '/skills', 'screen-skills'); await shot(S, 'skills-day0')
      await closeSession(S)
    }
  })

  if (want('redo')) await withApp('FX-REDO11', async app => {
    for (const vp of ['1280', '390']) {
      const S = await open(app, vp)
      await go(S, '/', 'screen-today', 1000); await shot(S, 'today-redo11')
      await go(S, '/review', 'screen-review'); await shot(S, 'review-redo11-question', { tall: true })
      const ans = S.page.locator('[data-testid="review-answer"]').first()
      if (await ans.count()) await ans.fill('Memory bandwidth.').catch(() => {})
      if (await click(S, 'review-reveal')) { await S.page.waitForTimeout(800); await shot(S, 'review-redo11-revealed', { tall: true }) }
      await closeSession(S)
    }
  })

  // empty / waiting Today states
  for (const [fx, tag] of [['FX-NOFIT', 'nofit'], ['FX-ALLDONE', 'alldone'], ['FX-REDO0', 'redo0']]) {
    if (!want('empty')) break
    await withApp(fx, async app => {
      for (const vp of ['1280', '390']) {
        const S = await open(app, vp)
        await go(S, '/', 'screen-today', 1000); await shot(S, `today-${tag}`)
        if (tag === 'redo0') { await go(S, '/review', 'screen-review'); await shot(S, 'review-empty') }
        await closeSession(S)
      }
    })
  }

  // ticket kinds started (one fresh home per kind and viewport: a second start would open the End session dialog,
  // and a second browser context does not share the first one's running timer)
  for (const [k, id] of [['watch', 'T_WATCH'], ['read', 'T_READ'], ['build', 'T_BUILD'], ['problem', 'T_PROBLEM']]) {
    if (!want('started') && !want(`started-${k}`)) continue
    for (const vp of ['1280', '390']) {
      await withApp('FX-IDLE', async app => {
        const S = await open(app, vp)
        await go(S, `/do/${app.ids[id]}`, 'screen-do', 1000)
        if (!(await click(S, 'ticket-start'))) { await closeSession(S); return }
        await S.page.waitForSelector('[data-testid="ticket-done"], [data-testid="timer-state"]', { timeout: 8000 }).catch(() => NOTES.push(`${k}: no started marker`))
        await S.page.waitForTimeout(900)
        await shot(S, `ticket-${k}-started`, { tall: true })
        if (k === 'watch') {
          if (vp === '1280') { await S.page.keyboard.press('f'); await S.page.waitForTimeout(600); await shot(S, 'ticket-watch-focus'); await S.page.keyboard.press('Escape'); await S.page.waitForTimeout(300) }
          await go(S, '/', 'screen-today', 1000); await shot(S, 'today-resume', { tall: true })
          await go(S, '/path', 'screen-path'); await shot(S, 'path-doing', { tall: true })
        }
        await closeSession(S)
      })
    }
  }

  // design session: setup, then Start, then the live session (the AI chat dock sits at the top of the right column)
  if (want('design')) await withApp('FX-IDLE', async app => {
    const id = app.ids.T_DESIGN ?? 'd-method'
    const D = await open(app, '1280'), M = await open(app, '390')
    await go(D, `/designs/session/${id}?new=1`, 'session-setup', 1200); await shot(D, 'design-setup', { tall: true })
    await go(M, `/designs/session/${id}?new=1`, 'session-setup', 1200); await shot(M, 'design-setup', { tall: true })
    if (await click(D, 'session-start')) {
      await D.page.waitForTimeout(2500)
      await shot(D, 'design-live', { tall: true })
      await D.page.screenshot({ path: join(OUT, '1280-design-live-fold.png') })
      await design(D)
    }
    await go(M, `/designs/session/${id}`, null, 2500)
    await shot(M, 'design-live', { tall: true })
    await design(M)
    await closeSession(D); await closeSession(M)
  })
  if (want('designdone')) await withApp('FX-DESIGN-DONE', async app => {
    for (const vp of ['1280', '390']) {
      const S = await open(app, vp)
      await go(S, '/designs/session/d-ddia', null, 2500); await shot(S, 'design-done-ai', { tall: true })
      await go(S, '/designs', null, 1500); await shot(S, 'designs-list', { tall: true })
      await closeSession(S)
    }
  })
})()

/** Layout facts of the live design session: dock and canvas boxes, scrollbars. Written next to the metrics. */
async function design(S) {
  const f = await S.page.evaluate(() => {
    const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    const q = s => document.querySelector(s)
    const dock = q('[data-testid="session-ai-dock"], [data-testid="ai-dock"], [data-testid^="design-ai"], [data-testid="session-ai"]')
    const canvas = q('[data-testid="session-canvas"], .ds-canvas, canvas, [data-testid="design-canvas"]')
    const hdr = q('[data-testid="shell-header"]'), rail = q('[data-testid="shell-rail"]')
    const scr = [...document.querySelectorAll('*')].filter(e => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 2 && e.getBoundingClientRect().width > 0 }).map(e => `${e.tagName.toLowerCase()}${e.getAttribute('data-testid') ? `[${e.getAttribute('data-testid')}]` : e.className ? `.${String(e.className).split(' ')[0]}` : ''} ${e.clientHeight}/${e.scrollHeight}`)
    return { vw: innerWidth, vh: innerHeight, docSH: document.documentElement.scrollHeight, dock: r(dock), canvas: r(canvas), header: r(hdr), rail: r(rail), scrollers: scr, testids: [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).filter(t => /session|dock|canvas|ai-|chat/.test(t)))].slice(0, 40) }
  })
  appendFileSync(METRICS, JSON.stringify({ shot: `${S.vp}-design-live-layout`, design: f }) + '\n')
}

await browser.close()
if (NOTES.length) { console.log('# notes'); for (const n of NOTES) console.log(`  ${n}`) }
writeFileSync(join(OUT, `notes${TAG}.txt`), NOTES.join('\n') + '\n')

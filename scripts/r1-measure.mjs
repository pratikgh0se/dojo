#!/usr/bin/env node
// Measures the R1 contract numbers in a real browser (Playwright chromium) against fixture data.
//   node scripts/r1-measure.mjs [--fixtures <dir>] [--only FX-IDLE,FX-WEEK3,...] [--tmp <dir>]
// Fixtures come from `npm run fixtures:build -- --out <dir>` (default: $FIXTURES_DIR, else <repo>/fixtures).
// It starts and stops its own `scripts/dev.mjs` servers (ports 8900-8999, never 8787, a fresh scratch DOJO_HOME per
// server, each in its own process group; only those groups are ever signalled) and prints one line per check:
//   PASS|FAIL|SKIP <clause> [<context>] <measured vs required>
// Exit code 1 when any check FAILs. A missing fixture or manifest key gives SKIP, never FAIL (fixtures.md).
// Definitions (control, words, default state, viewports, clock) are docs/contracts/README.md "Measurement definitions".
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const FIX = resolve(arg('fixtures') ?? process.env.FIXTURES_DIR ?? join(ROOT, 'fixtures'))
const TMP = resolve(arg('tmp') ?? process.env.R1_MEASURE_TMP ?? tmpdir())
const ONLY = (arg('only') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const ACC = 'rgb(255, 138, 42)'
const OKC = 'rgb(61, 220, 132)'
const VP = { desktop: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, phone: { width: 375, height: 667 } }
const CLOCK = new Date('2026-11-04T10:00:00+05:30') // Wednesday 10:00 Asia/Kolkata (README "Clock")

// ---------------------------------------------------------------- reporting
const tally = { PASS: 0, FAIL: 0, SKIP: 0 }
function emit(status, clause, ctx, detail = '') {
  tally[status]++
  console.log(`${status} ${clause} [${ctx}] ${detail}`.trimEnd())
}
const verdict = (ok, clause, ctx, detail) => emit(ok ? 'PASS' : 'FAIL', clause, ctx, detail)
const note = text => console.log(`  ${text}`)
const clip = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s)
const group = list => {
  const m = new Map()
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m].map(([k, n]) => (n > 1 ? `${k} x${n}` : k))
}

// ---------------------------------------------------------------- fixtures
function fixture(name) {
  const dir = join(FIX, name)
  if (!existsSync(join(dir, 'dojo.db'))) return null
  let manifest = null
  try { manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch { /* handled by callers */ }
  return { name, dir, manifest }
}
const wanted = name => ONLY.length === 0 || ONLY.includes(name)

// ---------------------------------------------------------------- servers (own process groups only)
const GROUPS = new Set()
const usedPorts = new Set()
function portFree(p) {
  return new Promise(res => {
    const s = net.createServer()
    s.once('error', () => res(false))
    s.listen(p, '127.0.0.1', () => s.close(() => res(true)))
  })
}
async function freePair() {
  for (let p = 8900 + Math.floor(Math.random() * 40) * 2; p < 8998; p += 2) {
    if (usedPorts.has(p) || p === 8787 || p + 1 === 8787) continue
    if ((await portFree(p)) && (await portFree(p + 1))) { usedPorts.add(p); return [p, p + 1] }
  }
  throw new Error('no free port pair in 8900-8999')
}
function killGroup(pid, sig) { try { process.kill(-pid, sig) } catch { /* already gone */ } }
function killAll() { for (const pid of GROUPS) killGroup(pid, 'SIGKILL') }
process.on('exit', killAll)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killAll(); process.exit(130) })

async function startApp(fx) {
  const home = mkdtempSync(join(TMP, 'r1m-home-'))
  if (fx) copyFileSync(join(fx.dir, 'dojo.db'), join(home, 'dojo.db'))
  const [port, sport] = await freePair()
  const env = { ...process.env, DOJO_HOME: home, DOJO_PORT: String(port), DOJO_SERVER_PORT: String(sport) }
  delete env.DOJO_PLAN_FILE; delete env.DOJO_DEV_DISK
  const child = spawn(process.execPath, [join(ROOT, 'scripts/dev.mjs')], { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  GROUPS.add(child.pid)
  console.log(`# server ${fx ? fx.name : 'FX-FRESH'}: pid ${child.pid} ports ${port}/${sport} home ${home}`)
  let out = ''
  const exited = new Promise(r => child.once('exit', r))
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  const t0 = Date.now()
  let token = null
  while (Date.now() - t0 < 90_000) {
    const m = out.match(/dev writer URL: http:\/\/127\.0\.0\.1:(\d+)\/#writer=(\S+)/)
    if (m) { token = m[2]; if (Number(m[1]) !== port) throw new Error(`web server bound ${m[1]}, wanted ${port}`); break }
    if (child.exitCode !== null) throw new Error(`dev.mjs exited early:\n${out}`)
    await new Promise(r => setTimeout(r, 200))
  }
  if (!token) throw new Error(`no writer URL within 90 s:\n${out}`)
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${origin}/db/health`); if (r.ok && (await r.json()).ok) break } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 200))
  }
  return {
    origin, token, home,
    async stop() {
      killGroup(child.pid, 'SIGTERM')
      await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))])
      killGroup(child.pid, 'SIGKILL')
      GROUPS.delete(child.pid)
      rmSync(home, { recursive: true, force: true })
    },
  }
}

// ---------------------------------------------------------------- in-page helpers (serialised into every page)
function pageHelpers() {
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=radio], [role=treeitem], [tabindex]:not([tabindex="-1"])'
  const ACC = 'rgb(255, 138, 42)'
  window.__rej = []
  window.addEventListener('unhandledrejection', e => { window.__rej.push(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)) })
  const q = id => document.querySelector(`[data-testid="${id}"]`)
  const visible = el => {
    if (!(el instanceof Element)) return false
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) return false
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = n.getBoundingClientRect()
        if (pr.width <= 0 || pr.height <= 0) return false
      }
    }
    return true
  }
  // Playwright-style visibility (box, display, visibility): aria-hidden does not hide it. Used where a clause says "visible" about a badge.
  const shown = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && (!el.checkVisibility || el.checkVisibility({ checkVisibilityCSS: true }))
  const desc = el => {
    const t = el.getAttribute('data-testid')
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/)[0]}` : ''
    const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)
    return `${el.tagName.toLowerCase()}${t ? `[${t}]` : cls}${txt ? ` "${txt}"` : ''}`
  }
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right } }
  const hue = rgb => {
    const m = rgb.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    if (a === 0) return null
    const R = r / 255, G = g / 255, B = b / 255
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn
    const l = (mx + mn) / 2
    if (d === 0) return { h: 0, s: 0, l }
    const s = d / (1 - Math.abs(2 * l - 1))
    let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4
    h = (h * 60 + 360) % 360
    return { h, s, l }
  }
  window.__m = {
    q, visible, shown, desc, rect,
    controls(id) {
      const root = q(id)
      if (!root) return { missing: true, n: 0, items: [] }
      const items = []
      for (const el of root.querySelectorAll(SEL)) {
        if (!visible(el)) continue
        const anc = el.parentElement && el.parentElement.closest(SEL)
        if (anc && anc !== root && root.contains(anc) && visible(anc)) continue
        items.push(desc(el))
      }
      return { n: items.length, items }
    },
    words(id) {
      const root = q(id)
      if (!root) return { missing: true, n: 0 }
      return { n: (root.innerText || '').trim().split(/\s+/).filter(Boolean).length }
    },
    accent() {
      const primaries = [...document.querySelectorAll('[data-accent="primary"]')].filter(visible)
      const btns = [...document.querySelectorAll('button, a.sr-btn')].filter(visible)
      const out = { primaries: primaries.map(desc), badLabel: [], sameBg: [], follows: [], bgs: [] }
      for (const p of primaries) {
        const bg = getComputedStyle(p).backgroundColor
        out.bgs.push(bg)
        if (!/^[A-Za-z]+ · .+$/.test((p.innerText || '').trim())) out.badLabel.push(desc(p))
        for (const b of btns) if (b !== p && !p.contains(b) && !b.contains(p) && getComputedStyle(b).backgroundColor === bg) out.sameBg.push(desc(b))
        const grp = p.parentElement
        if (grp) {
          for (const x of grp.querySelectorAll(SEL)) {
            if (x === p || p.contains(x) || !visible(x)) continue
            if (p.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING) out.follows.push(desc(x))
          }
        }
      }
      if (primaries.length === 0) for (const b of btns) if (getComputedStyle(b).backgroundColor === ACC) out.sameBg.push(desc(b))
      return out
    },
    types() {
      const under = [], badSize = [], onText = [], nested = []
      let nText = 0, nSilk = 0
      for (const el of document.body.querySelectorAll('*')) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TITLE)$/.test(el.tagName)) continue
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) continue
        if (!visible(el)) continue
        const cs = getComputedStyle(el)
        const fs = parseFloat(cs.fontSize)
        nText++
        if (fs < 14) under.push(`${desc(el)} ${fs}px`)
        const fam = cs.fontFamily.replace(/["']/g, '').trim().toLowerCase()
        if (fam.startsWith('silkscreen')) {
          nSilk++
          if (![16, 24, 32, 48].includes(fs)) badSize.push(`${desc(el)} ${fs}px`)
          if (el.matches('button, label, p, li, td, th, [role=button], input, select, textarea, a.sr-btn')) onText.push(`${desc(el)} ${fs}px`)
          else if (el.closest('button, label, p, li, td, th, [role=button], a.sr-btn')) nested.push(`${desc(el)} ${fs}px in ${desc(el.closest('button, label, p, li, td, th, [role=button], a.sr-btn'))}`)
        }
      }
      return { under, badSize, onText, nested, nText, nSilk }
    },
    radii() {
      const bad = []
      for (const el of document.body.querySelectorAll('*')) {
        if (el instanceof SVGElement) continue
        if (/^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName)) continue
        if (!visible(el)) continue
        const cs = getComputedStyle(el)
        const vals = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius]
        if (vals.some(v => v.split(/\s+/).some(x => parseFloat(x) !== 0))) bad.push(`${desc(el)} ${vals[0]}`)
      }
      return bad
    },
    hscroll() { const d = document.documentElement; return { sw: d.scrollWidth, cw: d.clientWidth, bodySw: document.body.scrollWidth } },
    shell() {
      const hdr = q('shell-header'), rail = q('shell-rail'), tab = q('shell-tabbar')
      const out = { header: null, rail: null, tabbar: null }
      if (hdr && visible(hdr)) {
        const clone = hdr.cloneNode(true)
        clone.querySelectorAll('[data-testid="level"], [data-testid="xp-total"]').forEach(n => n.remove())
        out.header = { h: hdr.getBoundingClientRect().height, text: (hdr.innerText || '').trim(), rest: (clone.textContent || '').replace(/\s+/g, ' ').trim(), gear: !!(q('shell-gear') && visible(q('shell-gear'))), search: !!(q('shell-search') && visible(q('shell-search'))) }
      }
      if (rail && visible(rail)) out.rail = { w: rail.getBoundingClientRect().width }
      if (tab && visible(tab)) {
        out.tabbar = { ...rect(tab), vh: innerHeight, items: [...tab.querySelectorAll('[data-testid^="shell-nav-"]')].filter(visible).map(i => ({ id: i.getAttribute('data-testid'), text: (i.innerText || '').trim() })), badge: shown(tab.querySelector('[data-testid="shell-review-badge"]')), badgeAriaHidden: !!tab.querySelector('[data-testid="shell-review-badge"][aria-hidden="true"]') }
      }
      return out
    },
    reach(id) {
      const el = q(id)
      if (!el) return { missing: true }
      const r = rect(el)
      const tb = q('shell-tabbar'), tr = tb && visible(tb) ? rect(tb) : null
      const top = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2)
      return { r, vw: innerWidth, vh: innerHeight, scrollY, covered: !(top && (el.contains(top) || top.contains(el))), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, aboveTab: tr ? r.bottom <= tr.top + 0.5 : true, tab: tr }
    },
    hue,
    buttonHues() {
      const out = []
      for (const b of document.querySelectorAll('button')) {
        if (!visible(b)) continue
        const bg = getComputedStyle(b).backgroundColor
        const hv = hue(bg)
        if (!hv) continue
        out.push({ d: desc(b), bg, h: hv.h, s: hv.s, l: hv.l, inScreen: !!b.closest('[data-testid^="screen-"]') })
      }
      return out
    },
  }
}

// ---------------------------------------------------------------- sessions
let browser
async function openSession(app, vpName, { writer = true } = {}) {
  const ctx = await browser.newContext({ viewport: VP[vpName], timezoneId: 'Asia/Kolkata', locale: 'en-US' })
  await ctx.clock.setFixedTime(CLOCK)
  await ctx.addInitScript(`(${pageHelpers.toString()})()`)
  const page = await ctx.newPage()
  const S = { ctx, page, app, vpName, errs: { console: [], page: [] }, origin: app.origin }
  page.on('console', m => { if (m.type() === 'error') S.errs.console.push(`${m.text()} @ ${m.location().url}`) })
  page.on('pageerror', e => S.errs.page.push(String(e.stack || e.message || e)))
  if (writer) {
    await page.goto(`${app.origin}/#writer=${app.token}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !location.hash.includes('writer'), null, { timeout: 30_000 }).catch(() => {})
    await page.waitForSelector('[data-testid^="screen-"]', { timeout: 60_000 })
    await page.waitForTimeout(800)
  }
  return S
}
async function visit(S, path, ready = 'screen-today', { settle = 700 } = {}) {
  S.errs.console.length = 0; S.errs.page.length = 0
  await S.page.goto(`${S.origin}${path}`, { waitUntil: 'domcontentloaded' })
  try { await S.page.waitForSelector(`[data-testid="${ready}"]`, { state: 'visible', timeout: 25_000 }) } catch { note(`(timeout waiting for ${ready} on ${path})`) }
  await S.page.waitForTimeout(settle)
}
// R1_SHOTS=<dir> (or --shots <dir>) saves a screenshot at the points that call shot(): a debugging aid, not a check.
const SHOTS = arg('shots') ?? process.env.R1_SHOTS
async function shot(S, name) { if (SHOTS) await S.page.screenshot({ path: join(SHOTS, `${name.replace(/[^a-z0-9._-]+/gi, '_')}.png`) }).catch(() => {}) }
const ev = (S, fn, a) => S.page.evaluate(fn, a)
const m = (S, name, a) => S.page.evaluate(([n, x]) => window.__m[n](x), [name, a])
const has = (S, id) => S.page.evaluate(i => { const e = window.__m.q(i); return !!e && window.__m.visible(e) }, id)

// ---------------------------------------------------------------- generic per-screen checks
async function globals(S, label, { expectPrimary } = {}) {
  const ctx = `${label}`
  const [acc, types, radii, hs, sh] = [await m(S, 'accent'), await m(S, 'types'), await m(S, 'radii'), await m(S, 'hscroll'), await m(S, 'shell')]
  const rej = (await ev(S, () => window.__rej.slice())).map(r => `unhandledrejection: ${r}`)
  // GLOBAL-03
  const g3 = []
  if (acc.primaries.length > 1) g3.push(`${acc.primaries.length} data-accent=primary visible (${acc.primaries.join(' | ')})`)
  if (expectPrimary === 1 && acc.primaries.length !== 1) g3.push(`expected exactly one data-accent=primary, found ${acc.primaries.length}`)
  if (expectPrimary === 0 && acc.primaries.length !== 0) g3.push(`expected none, found ${acc.primaries.join(' | ')}`)
  if (acc.badLabel.length) g3.push(`label not VERB · OBJECT: ${acc.badLabel.join(' | ')}`)
  if (acc.sameBg.length) g3.push(`other buttons with the accent's background: ${acc.sameBg.join(' | ')}`)
  if (acc.follows.length) g3.push(`focusable after the accent in its group: ${acc.follows.join(' | ')}`)
  verdict(g3.length === 0, 'GLOBAL-03', ctx, g3.length ? clip(g3.join('; '), 400) : `accent ${acc.primaries.length ? acc.primaries[0] : 'none'}`)
  // GLOBAL-04
  const g4 = []
  if (types.under.length) g4.push(`<14px x${types.under.length}: ${group(types.under).slice(0, 6).join(' | ')}`)
  if (types.badSize.length) g4.push(`Silkscreen off 16/24/32/48 x${types.badSize.length}: ${group(types.badSize).slice(0, 5).join(' | ')}`)
  if (types.onText.length) g4.push(`Silkscreen on a button/label/text element x${types.onText.length}: ${group(types.onText).slice(0, 5).join(' | ')}`)
  if (types.nested.length) {
    verdict(false, 'GLOBAL-04(in-button)', ctx, `Silkscreen text nested inside a button/label/body element x${types.nested.length}: ${clip(group(types.nested.map(x => x.replace(/ in .*/, ''))).slice(0, 5).join(' | '), 300)} in ${group(types.nested.map(x => x.replace(/^.* in /, ''))).slice(0, 2).join(' | ')}`)
  }
  verdict(g4.length === 0, 'GLOBAL-04', ctx, g4.length ? clip(g4.join('; '), 700) : `${types.nText} text elements >= 14px; ${types.nSilk} Silkscreen elements, all at 16/24/32/48 and none on buttons/labels/text`)
  // GLOBAL-05
  verdict(radii.length === 0, 'GLOBAL-05', ctx, radii.length ? `non-zero border-radius x${radii.length}: ${clip(group(radii).slice(0, 6).join(' | '), 500)}` : 'all border-radius 0')
  // GLOBAL-07
  const errs = [...S.errs.console, ...S.errs.page, ...rej]
  verdict(errs.length === 0, 'GLOBAL-07', ctx, errs.length ? `${errs.length} error(s): ${clip(errs.slice(0, 3).join(' || '), 500)}` : 'no console errors, page errors or rejections')
  // layout
  if (S.vpName === 'phone') {
    verdict(hs.sw <= hs.cw && hs.bodySw <= hs.cw + 0, 'GLOBAL-06', ctx, `scrollWidth ${hs.sw} (body ${hs.bodySw}) vs clientWidth ${hs.cw}`)
    const tb = sh.tabbar
    if (!tb) verdict(false, 'SHELL-12', ctx, 'shell-tabbar not visible')
    else {
      const bad = []
      if (Math.abs(tb.h - 68) > 4) bad.push(`height ${tb.h.toFixed(1)} vs 68 +/- 4`)
      if (Math.abs(tb.bottom - tb.vh) > 1) bad.push(`bottom ${tb.bottom.toFixed(1)} vs viewport ${tb.vh}`)
      if (tb.items.length !== 4) bad.push(`${tb.items.length} items vs 4`)
      if (tb.items.some(i => !i.text)) bad.push('an item has no visible label')
      if (sh.rail) bad.push('shell-rail present on phone')
      if (!sh.header || !sh.header.gear || !sh.header.search) bad.push('gear/search missing from header')
      verdict(bad.length === 0, 'SHELL-12', ctx, bad.length ? bad.join('; ') : `tab bar ${tb.h.toFixed(1)} px high, 4 labelled items, rail absent`)
    }
  } else if (S.vpName === 'desktop') {
    const h = sh.header
    if (!h) verdict(false, 'SHELL-07', ctx, 'shell-header not visible')
    else {
      const bad = []
      if (Math.abs(h.h - 48) > 1) bad.push(`height ${h.h.toFixed(1)} vs 48 +/- 1`)
      if (/\d{1,2}:\d{2}/.test(h.text)) bad.push(`mm:ss text in header: "${h.text}"`)
      if (/\d/.test(h.rest)) bad.push(`other numbers in header: "${h.rest}"`)
      if (/streak/i.test(h.text)) bad.push('streak in header')
      if (!h.gear || !h.search) bad.push('gear/search missing')
      verdict(bad.length === 0, 'SHELL-07', ctx, bad.length ? bad.join('; ') : `header ${h.h.toFixed(1)} px, text "${clip(h.text.replace(/\s+/g, ' / '), 70)}"`)
    }
  } else if (S.vpName === 'tablet') {
    verdict(!!sh.rail && !sh.tabbar, 'SHELL-12(tablet)', ctx, `768 px is above the phone switch: rail ${sh.rail ? `${sh.rail.w.toFixed(0)} px` : 'absent'}, tabbar ${sh.tabbar ? 'present' : 'absent'}`)
    verdict(hs.sw <= hs.cw, 'TABLET-hscroll', ctx, `scrollWidth ${hs.sw} vs clientWidth ${hs.cw}`)
  }
  return { acc, sh }
}

async function budget(S, clause, ctx, screen, maxControls, maxWords) {
  const c = await m(S, 'controls', screen)
  if (c.missing) return verdict(false, clause, ctx, `${screen} not found`)
  verdict(c.n <= maxControls, clause, ctx, `${c.n} controls vs at most ${maxControls}`)
  if (c.n > maxControls) note(`controls: ${c.items.join(' | ')}`)
  if (maxWords) {
    const w = await m(S, 'words', screen)
    verdict(w.n <= maxWords, clause.replace(/-27$/, '-28'), ctx, `${w.n} words vs at most ${maxWords}`)
  }
}

async function reach(S, clause, ctx, id, { scroll = true, needAbove = false } = {}) {
  const loc = S.page.locator(`[data-testid="${id}"]`).first()
  if (!(await loc.count())) return verdict(false, clause, ctx, `${id} missing`)
  if (scroll) await S.page.evaluate(i => { const e = window.__m.q(i); if (e) e.scrollIntoView({ block: 'center', inline: 'nearest' }) }, id)
  if (scroll) await S.page.waitForTimeout(150)
  const r = await m(S, 'reach', id)
  const bad = []
  if (r.covered) bad.push('covered by another element')
  if (!r.inView) bad.push(`outside the viewport (top ${r.r.top.toFixed(0)}, bottom ${r.r.bottom.toFixed(0)}, right ${r.r.right.toFixed(0)}, ${r.vw}x${r.vh})`)
  if (!r.aboveTab) bad.push(`below the tab bar top (${r.r.bottom.toFixed(0)} > ${r.tab.top.toFixed(0)})`)
  verdict(bad.length === 0, clause, ctx, bad.length ? `${id} ${bad.join('; ')}` : `${id} reachable`)
  return r
}

// ---------------------------------------------------------------- the clause groups
// settings.<key> from the data API (GET /db/state), polled up to 4 s until it equals `want` (the app writes through a debounce).
async function settingNow(S, key, want) {
  let v = null
  for (let i = 0; i < 16; i++) {
    v = await S.page.evaluate(async k => { try { const t = (await (await fetch('/db/state')).json()).tables; const d = (t.settings || []).find(x => x.id === 'main') || (t.settings || [])[0]; return d ? (d[k] ?? null) : null } catch { return 'ERR' } }, key)
    if (v === want) break
    await S.page.waitForTimeout(250)
  }
  return v
}

async function shellFresh() {
  if (!wanted('FX-FRESH')) return
  const app = await startApp(null)
  try {
    const S = await openSession(app, 'desktop', { writer: true })
    const ctx = 'FX-FRESH desktop'
    await S.page.waitForSelector('[data-testid="screen-onboarding"]', { timeout: 20_000 }).catch(() => {})
    if (!(await has(S, 'onboarding-submit'))) { verdict(false, 'SHELL-08', ctx, 'onboarding-submit not shown on a fresh home'); return }
    await S.page.click('[data-testid="onboarding-submit"]')
    await S.page.waitForSelector('[data-testid="screen-today"]', { timeout: 20_000 })
    await S.page.waitForTimeout(900)
    const w1 = (await m(S, 'shell')).rail
    verdict(!!w1 && Math.abs(w1.w - 148) <= 2, 'SHELL-08', ctx, `rail ${w1 ? w1.w.toFixed(1) : 'absent'} px vs 148 +/- 2 on the first load`)
    const lab = await ev(S, () => [...document.querySelectorAll('[data-testid^="shell-nav-"]')].filter(e => window.__m.visible(e)).map(e => (e.innerText || '').trim()))
    verdict(lab.length === 4 && lab.every(Boolean), 'SHELL-08', ctx, `rail labels visible: ${JSON.stringify(lab)}`)
    await visit(S, '/', 'screen-today', { settle: 1200 }) // reload
    const w2 = (await m(S, 'shell')).rail
    verdict(!!w2 && Math.abs(w2.w - 56) <= 2, 'SHELL-09', ctx, `rail ${w2 ? w2.w.toFixed(1) : 'absent'} px vs 56 +/- 2 after a reload`)
    const navLabels = await settingNow(S, 'navLabels', 'hover')
    verdict(navLabels === 'hover', 'SHELL-09', ctx, `settings.navLabels = ${JSON.stringify(navLabels)} vs "hover"`)
    // SHELL-10: hover and focus labels, accessible names
    const names = await ev(S, () => [...document.querySelectorAll('[data-testid^="shell-nav-"]')].map(e => e.getAttribute('aria-label') || (e.innerText || '').trim() || e.getAttribute('title') || ''))
    verdict(names.length === 4 && names.every(Boolean), 'SHELL-10', ctx, `accessible names with the 56 px rail: ${JSON.stringify(names)}`)
    const labelSize = async () => ev(S, () => {
      const out = []
      for (const e of document.querySelectorAll('body *')) {
        if (![...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim() === 'Path')) continue
        if (!window.__m.visible(e)) continue
        out.push(parseFloat(getComputedStyle(e).fontSize))
      }
      return out
    })
    await S.page.hover('[data-testid="shell-nav-path"]')
    await S.page.waitForTimeout(500)
    const hov = await labelSize()
    verdict(hov.length > 0 && Math.min(...hov) >= 14, 'SHELL-10', ctx, hov.length ? `hover label font-size ${Math.min(...hov)} px vs >= 14` : 'no visible "Path" label on hover')
    await S.page.mouse.move(700, 500)
    await S.page.waitForTimeout(300)
    await S.page.focus('[data-testid="shell-nav-path"]')
    await S.page.keyboard.press('Tab'); await S.page.keyboard.press('Shift+Tab')
    await S.page.waitForTimeout(400)
    const foc = await labelSize()
    verdict(foc.length > 0 && Math.min(...foc) >= 14, 'SHELL-10', ctx, foc.length ? `focus label font-size ${Math.min(...foc)} px vs >= 14` : 'no visible "Path" label on focus')
    // SHELL-11: the labels switch
    await visit(S, '/settings', 'screen-settings')
    const sw = S.page.locator('[data-testid="settings-nav-labels"]').first()
    if (!(await sw.count())) verdict(false, 'SHELL-11', ctx, 'settings-nav-labels missing')
    else {
      await sw.scrollIntoViewIfNeeded()
      await sw.click()
      await S.page.waitForTimeout(700)
      const on = (await m(S, 'shell')).rail
      const st = await settingNow(S, 'navLabels', 'always')
      verdict(!!on && Math.abs(on.w - 148) <= 2 && st === 'always', 'SHELL-11', ctx, `switch on: rail ${on ? on.w.toFixed(1) : 'absent'} px vs 148, navLabels ${JSON.stringify(st)} vs "always"`)
      await sw.click()
      await S.page.waitForTimeout(700)
      const off = (await m(S, 'shell')).rail
      const st2 = await settingNow(S, 'navLabels', 'hover')
      verdict(!!off && Math.abs(off.w - 56) <= 2 && st2 === 'hover', 'SHELL-11', ctx, `switch off: rail ${off ? off.w.toFixed(1) : 'absent'} px vs 56, navLabels ${JSON.stringify(st2)} vs "hover"`)
    }
    await S.ctx.close()
  } finally { await app.stop() }
}

async function todayOn(S) {
  await visit(S, '/', 'screen-today')
  await S.page.waitForSelector('[data-testid="start-button"]', { state: 'visible', timeout: 8000 }).catch(() => {})
}

async function todayFixtures() {
  for (const name of ['FX-IDLE', 'FX-WEEK3', 'FX-RITUAL', 'FX-RITUAL-DONE', 'FX-REDO11', 'FX-PHASE2', 'FX-DAY0']) {
    if (!wanted(name)) continue
    const fx = fixture(name)
    if (!fx) {
      for (const c of name === 'FX-DAY0' ? ['TODAY-22'] : name === 'FX-REDO11' || name === 'FX-PHASE2' ? ['TODAY-31'] : ['TODAY-27', 'TODAY-28', 'TODAY-31']) emit('SKIP', c, name, `fixture ${name} missing`)
      continue
    }
    const app = await startApp(fx)
    try {
      const S = await openSession(app, 'desktop')
      const ctx = `${name} desktop`
      await todayOn(S)
      if (name === 'FX-IDLE' || name === 'FX-WEEK3' || name === 'FX-RITUAL' || name === 'FX-RITUAL-DONE') await budget(S, 'TODAY-27', ctx, 'screen-today', 16, 210)
      if (name !== 'FX-DAY0') {
        const hues = await m(S, 'buttonHues')
        const blue = hues.filter(b => b.h >= 200 && b.h <= 260)
        verdict(blue.length === 0, 'TODAY-31', ctx, blue.length ? `buttons with background hue 200..260: ${blue.map(b => `${b.d} ${b.bg} hue ${b.h.toFixed(1)} sat ${(b.s * 100).toFixed(0)}% (${b.inScreen ? 'screen' : 'shell'})`).join(' | ')}` : `no button background hue in 200..260 (${hues.length} buttons with a non-transparent background checked: ${hues.map(b => `${b.d} ${b.bg} hue ${b.h.toFixed(0)}`).join(' | ')})`)
        const accentLabel = await ev(S, () => { const b = window.__m.q('start-button'); return b ? { acc: b.getAttribute('data-accent'), text: (b.innerText || '').trim(), bg: getComputedStyle(b).backgroundColor } : null })
        const a = await globals(S, `${name} desktop today`, { expectPrimary: 1 })
        verdict(!!accentLabel && accentLabel.acc === 'primary', 'TODAY-31', ctx, accentLabel ? `start-button data-accent=${accentLabel.acc} "${accentLabel.text}" ${accentLabel.bg}` : 'start-button missing')
        if (name === 'FX-IDLE') {
          // GLOBAL-03 tab order: pick-else before start, nothing after start in its group
          await ev(S, () => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0) })
          const seq = []
          let startAt = -1
          for (let i = 0; i < 80 && startAt < 0; i++) {
            await S.page.keyboard.press('Tab')
            const id = await ev(S, () => { const e = document.activeElement; return e ? (e.getAttribute('data-testid') || e.tagName.toLowerCase()) : null })
            seq.push(id)
            if (id === 'start-button') startAt = i
          }
          let after = null
          if (startAt >= 0) {
            await S.page.keyboard.press('Tab')
            after = await ev(S, () => { const e = document.activeElement; const s = window.__m.q('start-button'); return { id: e ? (e.getAttribute('data-testid') || e.tagName.toLowerCase()) : null, inGroup: !!(e && s && s.parentElement && s.parentElement.contains(e) && e !== s) } })
          }
          const pe = seq.indexOf('today-pick-else')
          verdict(startAt >= 0 && pe >= 0 && pe < startAt && !!after && !after.inGroup, 'GLOBAL-03', `${name} desktop today tab order`, startAt < 0 ? `start-button never focused in ${seq.length} tabs` : `pick-else at tab ${pe}, start-button at tab ${startAt}, next focus ${after.id}${after.inGroup ? ' (inside the action group)' : ''}`)
        }
      } else {
        const txt = await ev(S, () => { const r = window.__m.q('screen-today'); return r ? r.innerText : '' })
        const second = await has(S, 'today-second'), chip = await has(S, 'today-review-chip')
        const badTxt = [/streak/i, /debt/i, /\d+\s*due/i].filter(re => re.test(txt)).map(String)
        verdict(!second && !chip && badTxt.length === 0, 'TODAY-22', ctx, `today-second ${second ? 'present' : 'absent'}, today-review-chip ${chip ? 'present' : 'absent'}, matching text: ${badTxt.join(' ') || 'none'}`)
      }
      await S.ctx.close()
    } finally { await app.stop() }
  }
}

async function idleWalk() {
  if (!wanted('FX-IDLE')) return
  const fx = fixture('FX-IDLE')
  const need = ['TODAY-29', 'TODAY-30', 'PATH-26', 'REVIEW-20', 'REVIEW-21', 'SKILLS-02', 'SKILLS-07', 'SKILLS-12', 'SKILLS-18', 'SKILLS-19', 'SKILLS-20', 'TICKET-31', 'TICKET-29']
  if (!fx || !fx.manifest) { for (const c of need) emit('SKIP', c, 'FX-IDLE', fx ? 'manifest of FX-IDLE missing' : 'fixture FX-IDLE missing'); return }
  const mf = fx.manifest
  const app = await startApp(fx)
  try {
    const area = mf.skills?.areaOfQuest ?? null
    const watch = mf.ids?.T_WATCH ?? null
    // ---------- desktop
    const D = await openSession(app, 'desktop')
    const screens = [
      ['today', '/', 'screen-today'], ['path', '/path', 'screen-path'], ['skills', '/skills', 'screen-skills'],
      ...(area ? [['skills-area', `/skills/area/${area}`, 'skills-area-view']] : []),
      ['skills-stats', '/skills/stats', 'skills-stats'], ['review', '/review', 'screen-review'],
      ['settings', '/settings', 'screen-settings'], ['guide', '/guide', 'screen-guide'],
      ...(watch ? [['ticket', `/do/${watch}`, 'screen-do']] : []),
    ]
    for (const [name, path, ready] of screens) {
      await visit(D, path, ready)
      await globals(D, `FX-IDLE desktop ${name}`, { expectPrimary: name === 'today' ? 1 : undefined })
      if (name === 'path') await budget(D, 'PATH-26', 'FX-IDLE desktop', 'screen-path', 60)
    }
    // other states: pick list, stats drawer, Done list
    await visit(D, '/', 'screen-today')
    await D.page.click('[data-testid="today-pick-else"]').catch(() => {})
    await D.page.waitForTimeout(400)
    await globals(D, 'FX-IDLE desktop today pick-list-open', { expectPrimary: 1 })
    await visit(D, '/', 'screen-today')
    await D.page.click('[data-testid="today-stats-toggle"]').catch(() => {})
    await D.page.waitForTimeout(400)
    await globals(D, 'FX-IDLE desktop today stats-open', { expectPrimary: 1 })
    await visit(D, '/path', 'screen-path')
    await D.page.click('[data-testid="path-done-toggle"]').catch(() => {})
    await D.page.waitForTimeout(400)
    await globals(D, 'FX-IDLE desktop path done-open')
    // palette and gear menu open
    await visit(D, '/', 'screen-today')
    await D.page.click('[data-testid="shell-search"]').catch(() => {})
    await D.page.waitForTimeout(400)
    await globals(D, 'FX-IDLE desktop palette-open')
    await D.page.keyboard.press('Escape')
    await D.page.click('[data-testid="shell-gear"]').catch(() => {})
    await D.page.waitForTimeout(400)
    await globals(D, 'FX-IDLE desktop gear-menu-open')
    // Review: budgets and accent count before/after reveal
    await visit(D, '/review', 'screen-review')
    await budget(D, 'REVIEW-20', 'FX-IDLE desktop before reveal', 'screen-review', 15)
    let acc = await m(D, 'accent')
    verdict(acc.primaries.length === 1, 'REVIEW-20', 'FX-IDLE desktop before reveal', `accent count ${acc.primaries.length} vs exactly 1 ${acc.primaries.join(' | ')}`)
    const ans = D.page.locator('[data-testid="review-answer"]').first()
    if (await ans.count()) await ans.fill('measure').catch(() => {})
    const rv = D.page.locator('[data-testid="review-reveal"]').first()
    if (await rv.count()) {
      await rv.click()
      await D.page.waitForTimeout(700)
      acc = await m(D, 'accent')
      verdict(acc.primaries.length === 0, 'REVIEW-20', 'FX-IDLE desktop after reveal', `accent count ${acc.primaries.length} vs 0 ${acc.primaries.join(' | ')}`)
      await globals(D, 'FX-IDLE desktop review-revealed')
    } else verdict(false, 'REVIEW-20', 'FX-IDLE desktop', 'review-reveal missing')

    // Skills
    await visit(D, '/skills', 'screen-skills')
    const sc = await ev(D, () => ({ sh: document.documentElement.scrollHeight, vh: innerHeight, bsh: document.body.scrollHeight, ssh: (document.scrollingElement || document.documentElement).scrollHeight }))
    verdict(sc.sh <= sc.vh, 'SKILLS-07', 'FX-IDLE desktop', `scrollHeight ${sc.sh} (body ${sc.bsh}) vs viewport ${sc.vh}`)
    const stripes = await ev(D, () => [...document.querySelectorAll('[data-testid^="skills-area-stripe-"]')].map(e => ({ id: e.getAttribute('data-testid'), w: getComputedStyle(e).width })))
    const badStripe = stripes.filter(s => s.w !== '4px')
    verdict(stripes.length > 0 && badStripe.length === 0, 'SKILLS-02', 'FX-IDLE desktop', stripes.length ? `${stripes.length} stripes, width != 4px: ${badStripe.map(s => `${s.id}=${s.w}`).join(' ') || 'none'}` : 'no skills-area-stripe-* found')
    const areaIds = await ev(D, () => [...document.querySelectorAll('[data-testid^="skills-area-"][data-state]')].map(e => e.getAttribute('data-testid').replace('skills-area-', '')))
    const nodes = []
    const nextNodes = []
    let accentNodes = []
    for (const id of areaIds) {
      await visit(D, `/skills/area/${id}`, 'skills-area-view', { settle: 400 })
      const got = await ev(D, ([ACC, OKC]) => {
        const out = []
        for (const e of document.querySelectorAll('[data-testid^="skills-node-"][data-state]')) {
          const tid = e.getAttribute('data-testid')
          if (/^skills-node-(glyph|meter|note|edge|panel|start|legend|needs|unlocks)/.test(tid)) continue
          const cs = getComputedStyle(e)
          const box = e.querySelector('.sk-nbox')
          const cb = box ? getComputedStyle(box) : null
          const side = c => ['Top', 'Right', 'Bottom', 'Left'].map(s => ({ w: c[`border${s}Width`], c: c[`border${s}Color`], st: c[`border${s}Style`] }))
          out.push({ id: tid.replace('skills-node-', ''), state: e.getAttribute('data-state'), bg: cs.backgroundColor, sides: side(cs), boxBg: cb && cb.backgroundColor, boxSides: cb && side(cb), glyph: e.querySelector('[data-glyph]') ? e.querySelector('[data-glyph]').getAttribute('data-glyph') : null })
        }
        return out
      }, [ACC, OKC])
      for (const n of got) nodes.push({ area: id, ...n })
    }
    const by = st => nodes.filter(n => n.state === st)
    const nx = by('next')
    const nxBad = nx.filter(n => n.bg !== ACC)
    const othersAccent = nodes.filter(n => n.state !== 'next' && n.bg === ACC)
    verdict(nx.length === 1 && nxBad.length === 0 && othersAccent.length === 0, 'SKILLS-12', 'FX-IDLE desktop next', `next nodes ${nx.length} (${nx.map(n => `${n.id} bg ${n.bg}`).join(', ')}), other nodes with the accent background: ${othersAccent.map(n => n.id).join(' ') || 'none'}`)
    const nxBox = nx.filter(n => n.boxBg !== ACC)
    verdict(nxBox.length === 0, 'SKILLS-12', 'FX-IDLE desktop next visual box', nxBox.length ? `inner .sk-nbox background ${nxBox.map(n => n.boxBg).join(' ')} vs ${ACC}` : 'inner .sk-nbox is accent-filled too')
    const dn = by('done')
    if (dn.length === 0) emit('SKIP', 'SKILLS-12', 'FX-IDLE desktop done', 'no done node in the fixture')
    else {
      const bad = dn.filter(n => !(n.sides[0].w === '3px' && n.sides[0].c === OKC) || n.bg === OKC || n.glyph !== 'check')
      verdict(bad.length === 0, 'SKILLS-12', 'FX-IDLE desktop done', `${dn.length} done nodes; bad: ${bad.map(n => `${n.id} top ${n.sides[0].w} ${n.sides[0].c} bg ${n.bg} glyph ${n.glyph}`).slice(0, 4).join(' | ') || 'none'} (need top 3px ${OKC}, check glyph)`)
      const badBox = dn.filter(n => n.boxSides && !(n.boxSides[0].w === '3px' && n.boxSides[0].c === OKC))
      verdict(badBox.length === 0, 'SKILLS-12', 'FX-IDLE desktop done visual box', badBox.length ? `inner .sk-nbox top border ${badBox.map(n => `${n.id} ${n.boxSides[0].w} ${n.boxSides[0].c}`).slice(0, 3).join(' | ')}` : 'inner box has the 3px green top rule')
    }
    const ip = by('inprog')
    if (ip.length === 0) emit('SKIP', 'SKILLS-12', 'FX-IDLE desktop inprog', 'no inprog node in the fixture')
    else {
      const bad = ip.filter(n => !n.sides.every(s => s.w === '2px' && s.c === ACC) || n.bg === ACC)
      verdict(bad.length === 0, 'SKILLS-12', 'FX-IDLE desktop inprog', `${ip.length} inprog nodes; bad: ${bad.map(n => `${n.id} ${n.sides.map(s => `${s.w} ${s.c}`).join('/')} bg ${n.bg}`).slice(0, 3).join(' | ') || 'none'} (need 2px ${ACC} on all sides)`)
      const badBox = ip.filter(n => n.boxSides && !n.boxSides.every(s => s.w === '2px' && s.c === ACC))
      verdict(badBox.length === 0, 'SKILLS-12', 'FX-IDLE desktop inprog visual box', badBox.length ? `inner .sk-nbox ${badBox.map(n => `${n.id} ${n.boxSides.map(s => `${s.w} ${s.c}`).join('/')}`).slice(0, 3).join(' | ')}` : 'inner box has 2px accent border on all sides')
    }
    const lk = by('locked')
    if (lk.length === 0) emit('SKIP', 'SKILLS-12', 'FX-IDLE desktop locked', 'no locked node in the fixture')
    else {
      const bad = lk.filter(n => !n.sides.every(s => s.st === 'dashed') || n.glyph !== 'lock')
      verdict(bad.length === 0, 'SKILLS-12', 'FX-IDLE desktop locked', `${lk.length} locked nodes; bad: ${bad.map(n => `${n.id} ${n.sides.map(s => s.st).join('/')} glyph ${n.glyph}`).slice(0, 3).join(' | ') || 'none'} (need dashed on all four sides, lock glyph)`)
      const badBox = lk.filter(n => n.boxSides && !n.boxSides.every(s => s.st === 'dashed'))
      verdict(badBox.length === 0, 'SKILLS-12', 'FX-IDLE desktop locked visual box', badBox.length ? `inner .sk-nbox ${badBox.map(n => `${n.id} ${n.boxSides.map(s => s.st).join('/')}`).slice(0, 3).join(' | ')}` : 'inner box dashed on all four sides')
    }
    // SKILLS-18 on the quest area: select the next node
    if (nx[0]) {
      await visit(D, `/skills/area/${nx[0].area}`, 'skills-area-view')
      await D.page.locator(`[data-testid="skills-node-${nx[0].id}"]`).first().click({ force: true }).catch(() => {})
      await D.page.waitForTimeout(500)
      const a18 = await m(D, 'accent')
      const accNodes = await ev(D, ACC => [...document.querySelectorAll('[data-testid^="skills-node-"][data-state]')].filter(e => !/^skills-node-(glyph|meter|note|edge|panel|start|legend|needs|unlocks)/.test(e.getAttribute('data-testid')) && getComputedStyle(e).backgroundColor === ACC).map(e => e.getAttribute('data-testid')), ACC)
      verdict(a18.primaries.length <= 1 && accNodes.length <= 1, 'SKILLS-18', 'FX-IDLE desktop area view, next node selected', `data-accent=primary ${a18.primaries.length} (${a18.primaries.join(' | ')}), accent-filled nodes ${accNodes.length}`)
      await globals(D, 'FX-IDLE desktop skills-area node-selected')
    } else emit('SKIP', 'SKILLS-18', 'FX-IDLE desktop', 'no next node found')
    await D.ctx.close()

    // ---------- tablet
    const T = await openSession(app, 'tablet')
    for (const [name, path, ready] of screens.filter(s => ['today', 'path', 'skills', 'review'].includes(s[0]))) {
      await visit(T, path, ready)
      await globals(T, `FX-IDLE tablet ${name}`)
    }
    await T.ctx.close()

    // ---------- phone
    const P = await openSession(app, 'phone')
    for (const [name, path, ready] of screens) {
      await visit(P, path, ready)
      await globals(P, `FX-IDLE phone ${name}`, { expectPrimary: name === 'today' ? 1 : undefined })
      if (name === 'today') {
        const r = await m(P, 'reach', 'start-button')
        const pe = await m(P, 'reach', 'today-pick-else')
        if (r.missing) { verdict(false, 'TODAY-29', 'FX-IDLE phone', 'start-button missing'); continue }
        const bad29 = []
        if (r.scrollY !== 0) bad29.push(`scrollY ${r.scrollY}`)
        if (!r.inView) bad29.push(`not inside 375x667 (left ${r.r.left.toFixed(0)}, top ${r.r.top.toFixed(0)}, right ${r.r.right.toFixed(0)}, bottom ${r.r.bottom.toFixed(0)})`)
        if (!r.aboveTab) bad29.push(`bottom ${r.r.bottom.toFixed(0)} below tab bar top ${r.tab.top.toFixed(0)}`)
        if (r.covered) bad29.push('covered')
        verdict(bad29.length === 0, 'TODAY-29', 'FX-IDLE phone', bad29.length ? bad29.join('; ') : `start-button box ${r.r.left.toFixed(0)},${r.r.top.toFixed(0)} to ${r.r.right.toFixed(0)},${r.r.bottom.toFixed(0)}; tab bar top ${r.tab ? r.tab.top.toFixed(0) : 'n/a'}`)
        const bad30 = []
        if (r.r.w < 337.5) bad30.push(`width ${r.r.w.toFixed(1)} vs >= 337.5`)
        if (r.r.h < 44) bad30.push(`height ${r.r.h.toFixed(1)} vs >= 44`)
        if (pe.missing) bad30.push('today-pick-else missing')
        else if (pe.r.top < r.r.bottom - 0.5) bad30.push(`today-pick-else top ${pe.r.top.toFixed(0)} is not under start bottom ${r.r.bottom.toFixed(0)}`)
        verdict(bad30.length === 0, 'TODAY-30', 'FX-IDLE phone', bad30.length ? bad30.join('; ') : `start-button ${r.r.w.toFixed(1)} x ${r.r.h.toFixed(1)} px, pick-else top ${pe.r.top.toFixed(0)} >= start bottom ${r.r.bottom.toFixed(0)}`)
      }
      if (name === 'review') {
        await shot(P, 'phone-review')
        await reach(P, 'REVIEW-21', 'FX-IDLE phone', 'review-answer')
        await reach(P, 'REVIEW-21', 'FX-IDLE phone', 'review-reveal')
        const sh = await m(P, 'shell')
        verdict(!!sh.tabbar && sh.tabbar.badge, 'REVIEW-21', 'FX-IDLE phone', `tab bar review badge ${sh.tabbar && sh.tabbar.badge ? 'visible' : 'not visible'}${sh.tabbar && sh.tabbar.badgeAriaHidden ? ' (aria-hidden=true)' : ''}`)
      }
    }
    await visit(P, '/', 'screen-today')
    await P.page.click('[data-testid="today-pick-else"]').catch(() => {})
    await P.page.waitForTimeout(400)
    await globals(P, 'FX-IDLE phone today pick-list-open')
    // Skills area on the phone: list indentation and the next panel
    const rowArea = []
    for (const id of areaIds) {
      await visit(P, `/skills/area/${id}`, 'skills-area-view', { settle: 400 })
      const rows = await ev(P, () => [...document.querySelectorAll('[data-testid^="skills-row-"]')].map(e => ({ id: e.getAttribute('data-testid'), layer: Number(e.getAttribute('data-layer')), pl: parseFloat(getComputedStyle(e).paddingLeft), role: e.getAttribute('role') })))
      rowArea.push({ id, rows })
    }
    const multi = rowArea.filter(a => new Set(a.rows.map(r => r.layer)).size > 1)
    if (multi.length === 0) emit('SKIP', 'SKILLS-19', 'FX-IDLE phone', 'no area view with two layers (or no skills-row-* found)')
    else {
      const bads = []
      let checked = 0
      for (const a of multi) {
        const layers = [...new Set(a.rows.map(r => r.layer))].sort((x, y) => x - y)
        const padOf = l => a.rows.filter(r => r.layer === l).map(r => r.pl)
        for (const l of layers) {
          if (!layers.includes(l - 1)) continue
          const d = Math.min(...padOf(l)) - Math.max(...padOf(l - 1))
          const dmax = Math.max(...padOf(l)) - Math.min(...padOf(l - 1))
          checked++
          if (Math.min(d, dmax) < 16 || Math.max(d, dmax) > 20 || padOf(l).some(p => new Set(padOf(l)).size > 1)) bads.push(`${a.id} layer ${l} vs ${l - 1}: ${d}..${dmax}px`)
        }
      }
      verdict(bads.length === 0, 'SKILLS-19', 'FX-IDLE phone', bads.length ? `padding-left step outside 16..20 px: ${bads.slice(0, 4).join(' | ')}` : `${checked} layer steps across ${multi.length} areas all 16..20 px`)
    }
    if (nx[0]) {
      await visit(P, `/skills/area/${nx[0].area}`, 'skills-area-view')
      const np = await m(P, 'reach', 'skills-next-panel')
      if (np.missing) verdict(false, 'SKILLS-20', 'FX-IDLE phone', 'skills-next-panel missing')
      else {
        const gap = np.tab ? np.tab.top - np.r.bottom : null
        verdict(np.tab && gap >= -0.5 && gap <= 16, 'SKILLS-20', 'FX-IDLE phone', `next panel bottom ${np.r.bottom.toFixed(1)} vs tab bar top ${np.tab ? np.tab.top.toFixed(1) : 'n/a'} (gap ${gap === null ? 'n/a' : gap.toFixed(1)} px; the contract gives no number, 16 px is the tolerance used for "directly above")`)
      }
      const ns = await m(P, 'reach', 'skills-next-start')
      if (ns.missing) verdict(false, 'SKILLS-20', 'FX-IDLE phone start', 'skills-next-start missing')
      else verdict(!ns.covered && ns.inView && ns.aboveTab, 'SKILLS-20', 'FX-IDLE phone start', `skills-next-start inView ${ns.inView}, covered ${ns.covered}, above tab bar ${ns.aboveTab} (box ${ns.r.top.toFixed(0)}..${ns.r.bottom.toFixed(0)})`)
      // expand a row; no skills-node-start inside it may carry data-accent
      const row = P.page.locator('[data-testid^="skills-row-"]').first()
      if (await row.count()) {
        await row.focus()
        await P.page.keyboard.press('ArrowRight')
        await P.page.waitForTimeout(400)
        const starts = await ev(P, () => [...document.querySelectorAll('[data-testid="skills-node-start"]')].filter(e => window.__m.visible(e)).map(e => ({ acc: e.getAttribute('data-accent') })))
        const a20 = await m(P, 'accent')
        verdict(starts.every(s => !s.acc) && a20.primaries.length <= 1, 'SKILLS-20', 'FX-IDLE phone expanded row', `expanded skills-node-start buttons ${starts.length}, with data-accent ${starts.filter(s => s.acc).length}; total accents ${a20.primaries.length}`)
        await globals(P, 'FX-IDLE phone skills-area row-expanded')
      }
    }
    await P.ctx.close()

  } finally { await app.stop() }
  await ticketKinds(fx)
}

// TICKET-31 / TICKET-29: one ticket per kind, started. Dojo allows one running session, so each kind gets its own fresh home.
async function ticketKinds(fx) {
  const kinds = ['T_WATCH', 'T_READ', 'T_BUILD', 'T_RITUAL', 'T_TASK', 'T_PROBLEM']
  for (const k of kinds) {
    const id = fx.manifest.ids?.[k]
    if (!id) { emit('SKIP', 'TICKET-31', `FX-IDLE desktop ${k}`, `manifest of FX-IDLE lacks "${k}"`); continue }
    const app = await startApp(fx)
    try {
      const K = await openSession(app, 'desktop')
      await visit(K, `/do/${id}`, 'screen-do')
      const start = K.page.locator('[data-testid="ticket-start"]').first()
      if (!(await start.count())) { verdict(false, 'TICKET-31', `FX-IDLE desktop ${k}`, `no ticket-start on /do/${id}`); await K.ctx.close(); continue }
      const pre = await m(K, 'accent')
      if (k !== 'T_PROBLEM') verdict(pre.primaries.length === 1 && pre.primaries[0].startsWith('button[ticket-start]'), 'TICKET-32', `FX-IDLE desktop ${k} not started`, `accent ${pre.primaries.join(' | ') || 'none'} vs ticket-start`)
      else verdict(pre.primaries.length <= 1, 'TICKET-32', `FX-IDLE desktop ${k} not started`, `accent count ${pre.primaries.length} vs at most 1 (${pre.primaries.join(' | ') || 'none'})`)
      await start.click()
      await K.page.waitForSelector('[data-testid="ticket-done"], [data-testid="timer-state"]', { timeout: 8000 }).catch(() => {})
      await K.page.waitForTimeout(800)
      await shot(K, `ticket-${k}-started`)
      const sd = await ev(K, () => { const e = window.__m.q('ticket-done'); const t = window.__m.q('timer-state'); return { done: !!e, timer: t ? (t.innerText || '').trim() : null } })
      await budget(K, 'TICKET-31', `FX-IDLE desktop ${k} (${id}) started`, 'screen-do', 15)
      const a = await m(K, 'accent')
      note(`${k}: ticket-done ${sd.done ? 'shown' : 'absent'}, timer-state ${JSON.stringify(sd.timer)}, accent ${a.primaries.join(' | ') || 'none'}`)
      if (k !== 'T_PROBLEM') verdict(a.primaries.length === 1 && a.primaries[0].startsWith('button[ticket-done]'), 'TICKET-32', `FX-IDLE desktop ${k} running`, `accent ${a.primaries.join(' | ') || 'none'} vs ticket-done`)
      else verdict(a.primaries.length <= 1, 'TICKET-32', `FX-IDLE desktop ${k} running`, `accent count ${a.primaries.length} vs at most 1`)
      if (k !== 'T_WATCH') await globals(K, `FX-IDLE desktop ticket ${k} started`)
      if (k === 'T_WATCH') {
        await globals(K, 'FX-IDLE desktop ticket T_WATCH started', { expectPrimary: 1 })
        await ev(K, () => { document.activeElement && document.activeElement.blur() })
        await K.page.keyboard.press('f')
        await K.page.waitForTimeout(600)
        const ft = await ev(K, () => { const e = window.__m.q('focus-timer'); return e && window.__m.visible(e) ? { fs: getComputedStyle(e).fontSize, text: (e.innerText || '').trim() } : null })
        verdict(!!ft && ft.fs === '48px' && /^\d{1,2}:\d{2}$/.test(ft.text), 'TICKET-29', 'FX-IDLE desktop T_WATCH', ft ? `focus-timer font-size ${ft.fs} vs 48px, reading "${ft.text}"` : 'focus-timer not visible after F')
        await K.page.keyboard.press('Escape')
        await K.page.waitForTimeout(400)
        verdict(!(await has(K, 'focus-screen')), 'TICKET-29', 'FX-IDLE desktop T_WATCH', 'Esc closes focus-screen')
      }
      await K.ctx.close()
    } finally { await app.stop() }
  }
}

async function week3Walk() {
  if (!wanted('FX-WEEK3')) return
  const fx = fixture('FX-WEEK3')
  if (!fx || !fx.manifest) { for (const c of ['PATH-26', 'PATH-27', 'TICKET-35']) emit('SKIP', c, 'FX-WEEK3', fx ? 'manifest of FX-WEEK3 missing' : 'fixture FX-WEEK3 missing'); return }
  const app = await startApp(fx)
  try {
    const D = await openSession(app, 'desktop')
    await visit(D, '/path', 'screen-path')
    await budget(D, 'PATH-26', 'FX-WEEK3 desktop', 'screen-path', 60)
    await globals(D, 'FX-WEEK3 desktop path')
    await D.ctx.close()
    const P = await openSession(app, 'phone')
    await visit(P, '/path', 'screen-path')
    const hs = await m(P, 'hscroll')
    verdict(hs.sw <= hs.cw, 'PATH-27', 'FX-WEEK3 phone', `scrollWidth ${hs.sw} vs clientWidth ${hs.cw}`)
    const dacc = await ev(P, () => { const d = window.__m.q('path-doing'); const b = d && d.querySelector('[data-accent="primary"]'); return b ? b.getAttribute('data-testid') : null })
    if (!dacc) verdict(false, 'PATH-27', 'FX-WEEK3 phone', 'no accent button inside path-doing')
    else await reach(P, 'PATH-27', 'FX-WEEK3 phone', dacc)
    await globals(P, 'FX-WEEK3 phone path')
    const watch = fx.manifest.ids?.T_WATCH
    if (!watch) emit('SKIP', 'TICKET-35', 'FX-WEEK3 phone', 'manifest of FX-WEEK3 lacks "T_WATCH"')
    else {
      await visit(P, `/do/${watch}`, 'screen-do')
      const h1 = await m(P, 'hscroll')
      verdict(h1.sw <= h1.cw, 'TICKET-35', 'FX-WEEK3 phone T_WATCH', `scrollWidth ${h1.sw} vs clientWidth ${h1.cw} (not started)`)
      await globals(P, 'FX-WEEK3 phone ticket T_WATCH')
      await reach(P, 'TICKET-35', 'FX-WEEK3 phone T_WATCH', 'ticket-start')
      await P.page.locator('[data-testid="ticket-start"]').first().click().catch(() => {})
      await P.page.waitForSelector('[data-testid="ticket-done"], [data-testid="timer-state"]', { timeout: 8000 }).catch(() => {})
      await P.page.waitForTimeout(800)
      const h2 = await m(P, 'hscroll')
      verdict(h2.sw <= h2.cw, 'TICKET-35', 'FX-WEEK3 phone T_WATCH started', `scrollWidth ${h2.sw} vs clientWidth ${h2.cw}`)
      await reach(P, 'TICKET-35', 'FX-WEEK3 phone T_WATCH started', 'timer-readout')
      const accId = await ev(P, () => { const b = [...document.querySelectorAll('[data-accent="primary"]')].find(window.__m.visible); return b ? b.getAttribute('data-testid') : null })
      if (accId) await reach(P, 'TICKET-35', 'FX-WEEK3 phone T_WATCH started', accId)
      else verdict(false, 'TICKET-35', 'FX-WEEK3 phone T_WATCH started', 'no accent button visible')
      await globals(P, 'FX-WEEK3 phone ticket T_WATCH started')
    }
    await P.ctx.close()
  } finally { await app.stop() }
}

// GLOBAL-06 with a RUNNING session on the phone: the Focus strip rides on Today and Path (and the dock on the ticket view); none of them may
// scroll sideways (an auto-margin strip once made the page 659 px wide at 375), the strip must not cover the tab bar, and PAUSE stays reachable.
async function runningWalk() {
  if (!wanted('FX-IDLE')) return
  const fx = fixture('FX-IDLE')
  if (!fx || !fx.manifest) { emit('SKIP', 'GLOBAL-06', 'FX-IDLE phone running', fx ? 'manifest of FX-IDLE missing' : 'fixture FX-IDLE missing'); return }
  for (const k of ['T_WATCH', 'T_PROBLEM']) {
    const id = fx.manifest.ids?.[k]
    if (!id) { emit('SKIP', 'GLOBAL-06', `FX-IDLE phone running ${k}`, `manifest of FX-IDLE lacks "${k}"`); continue }
    const app = await startApp(fx)
    try {
      const P = await openSession(app, 'phone')
      await visit(P, `/do/${id}`, 'screen-do')
      const start = P.page.locator('[data-testid="ticket-start"]').first()
      if (!(await start.count())) { verdict(false, 'GLOBAL-06', `FX-IDLE phone running ${k}`, `no ticket-start on /do/${id}`); await P.ctx.close(); continue }
      await start.click()
      await P.page.waitForSelector('[data-testid="ticket-done"], [data-testid="timer-state"]', { timeout: 8000 }).catch(() => {})
      await P.page.waitForTimeout(800)
      for (const [name, path, ready] of [['ticket', `/do/${id}`, 'screen-do'], ['today', '/', 'screen-today'], ['path', '/path', 'screen-path']]) {
        await visit(P, path, ready, { settle: 1000 })
        const ctx = `FX-IDLE phone running ${k} ${name}`
        const hs = await m(P, 'hscroll')
        verdict(hs.sw <= hs.cw && hs.bodySw <= hs.cw, 'GLOBAL-06', ctx, `scrollWidth ${hs.sw} (body ${hs.bodySw}) vs clientWidth ${hs.cw}`)
        const strip = await ev(P, () => {
          const e = document.querySelector('[data-testid="session-strip"],[data-testid="session-dock"]')
          const pause = document.querySelector('[data-testid="session-pill-pause"]')
          const tab = window.__m.q('shell-tabbar')
          const r = e && e.getBoundingClientRect(), pr = pause && pause.getBoundingClientRect(), tr = tab && tab.getBoundingClientRect()
          return { has: !!e, r: r && { l: r.left, r: r.right, t: r.top, b: r.bottom }, pause: pr && { l: pr.left, r: pr.right }, tabTop: tr ? tr.top : null, vw: innerWidth }
        })
        if (name === 'ticket') {
          const t = await ev(P, () => document.querySelectorAll('[data-testid="timer-readout"]').length)
          verdict(t === 1, 'TICKET-08', ctx, `${t} timer-readout element(s) vs exactly 1`)
        }
        if (!strip.has) { if (name !== 'ticket') verdict(false, 'GLOBAL-06', `${ctx} focus strip`, 'no session strip on this screen while a session runs'); continue }
        const bad = []
        if (strip.r.l < -0.5 || strip.r.r > strip.vw + 0.5) bad.push(`strip x ${strip.r.l.toFixed(0)}..${strip.r.r.toFixed(0)} outside 0..${strip.vw}`)
        if (strip.tabTop !== null && strip.r.b > strip.tabTop + 0.5) bad.push(`strip bottom ${strip.r.b.toFixed(0)} covers tab bar top ${strip.tabTop.toFixed(0)}`)
        if (!strip.pause) bad.push('PAUSE (session-pill-pause) not present')
        else if (strip.pause.l < 0 || strip.pause.r > strip.vw + 0.5) bad.push(`PAUSE x ${strip.pause.l.toFixed(0)}..${strip.pause.r.toFixed(0)} off-screen`)
        verdict(bad.length === 0, 'GLOBAL-06', `${ctx} focus strip`, bad.length ? bad.join('; ') : `strip x ${strip.r.l.toFixed(0)}..${strip.r.r.toFixed(0)}, bottom ${strip.r.b.toFixed(0)} <= tab bar ${strip.tabTop === null ? 'n/a' : strip.tabTop.toFixed(0)}, PAUSE reachable`)
        if (name !== 'ticket') await globals(P, ctx)
      }
      await P.ctx.close()
    } finally { await app.stop() }
  }
}

// ---------------------------------------------------------------- main
console.log(`# r1-measure: fixtures ${FIX}; tmp ${TMP}; clock 2026-11-04 10:00 Asia/Kolkata; desktop 1280x800, tablet 768x1024, phone 375x667`)
browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const steps = [shellFresh, todayFixtures, week3Walk, idleWalk, runningWalk]
for (const step of steps) {
  try { await step() } catch (e) {
    emit('FAIL', 'HARNESS', step.name, clip(String(e && e.stack ? e.stack : e), 600))
  }
}
await browser.close()
console.log(`SUMMARY PASS ${tally.PASS} FAIL ${tally.FAIL} SKIP ${tally.SKIP}`)
killAll()
process.exit(tally.FAIL > 0 ? 1 : 0)

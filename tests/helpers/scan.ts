import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// GLOBAL-01 and GLOBAL-02 (docs/contracts/README.md), verbatim.
export const BANNED = /\binterview|\bSpar\b|\bRetreat\b|Dig in|Load check|Slid in|Shift plan/i
export const GUILT = /overdue|\bmissed (a )?(day|days|session)|\bbehind\b|streak (lost|broken)|you didn'?t|days? (since|without)/i

/** Every attribute whose value a reader can meet (a tooltip, a spoken description) counts as text. */
const TEXT_ATTRS = ['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'data-tip'] as const

/**
 * The text a reader meets, minus plan and learner text. Text nodes are joined with a space the way innerText separates adjacent runs, and
 * the words in aria-label, aria-description, title, placeholder, alt and data-tip count, on the root and on every element below it.
 *
 * The exemption rule: an element marked `data-content` is skipped whole (text and its own attributes). An attribute on an element that is
 * NOT marked is scanned, except that any stretch of it equal to the text of a `data-content` descendant is removed first, because an
 * accessible name such as "<plan title>, In progress" is built from plan text plus an app word and only the app word is ours.
 */
export function appText(root: Element): string {
  const clone = root.cloneNode(true) as Element
  const attrs: string[] = []
  for (const e of [clone, ...clone.querySelectorAll('*')]) {
    if (e.closest('[data-content]')) continue
    const plan = [...e.querySelectorAll('[data-content]')].map(c => (c.textContent ?? '').trim()).filter(t => t.length > 2).sort((x, y) => y.length - x.length)
    for (const a of TEXT_ATTRS) {
      let v = e.getAttribute(a)
      if (v === null) continue
      for (const t of plan) v = v.split(t).join(' ')
      attrs.push(v)
    }
  }
  clone.querySelectorAll('[data-content], script, style, [hidden]').forEach(e => e.remove())
  const runs: string[] = []
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) runs.push(n.nodeValue ?? '')
  return [runs.join(' '), ...attrs].join(' \n ')
}

/** GLOBAL-08 lists button, link, input, select, textarea and rail item; the role selectors are the custom widgets (tabs, menu items, options, tree items, switches, SVG nodes). */
export const CONTROLS = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="menuitem"], [role="tab"], [role="option"], [role="treeitem"], [role="switch"], [role="button"], [role="link"]'

const FIELD = 'input, select, textarea'

/** The accessible name of a control, the way a test can compute it without a browser. A field is named by a label or aria only (a placeholder or title is weaker than the browser's own rule). */
export function nameOf(el: Element): string {
  const aria = el.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const t = by.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim()
    if (t) return t
  }
  if (el.matches(FIELD)) {
    if (el.id) {
      const l = el.ownerDocument.querySelector(`label[for="${el.id}"]`)
      if (l?.textContent?.trim()) return l.textContent.trim()
    }
    return el.closest('label')?.textContent?.trim() ?? ''
  }
  const text = (el.textContent ?? '').trim()
  if (text) return text
  const alt = el.querySelector('img[alt]')?.getAttribute('alt')?.trim()
  if (alt) return alt
  const svgTitle = el.querySelector('svg > title')?.textContent?.trim()
  return svgTitle || el.getAttribute('title')?.trim() || ''
}

/** Not hidden by the markup: no `hidden`, `aria-hidden="true"` or inline display:none / visibility:hidden up the tree. (jsdom has no layout, so a stylesheet cannot hide anything here.) */
export function visible(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return false
    const s = (e as HTMLElement).style
    if (s && (s.display === 'none' || s.visibility === 'hidden')) return false
  }
  return true
}

// ---------------------------------------------------------------- stylesheet text (jsdom does not load CSS)

export interface CssRule { file: string; selectors: string[]; decls: Array<[string, string]> }

const SRC = join(process.cwd(), 'src')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

function parseBlocks(text: string, file: string, out: CssRule[]): void {
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) return
    const head = text.slice(i, open).trim()
    let depth = 0
    let j = open
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}' && --depth === 0) break
    }
    const body = text.slice(open + 1, j)
    i = j + 1
    if (head.startsWith('@media') || head.startsWith('@supports')) { parseBlocks(body, file, out); continue }
    if (head.startsWith('@')) continue // keyframes, font-face
    const decls: Array<[string, string]> = body.split(';').flatMap(d => {
      const k = d.indexOf(':')
      return k < 0 ? [] : [[d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()] as [string, string]]
    })
    out.push({ file, selectors: head.split(',').map(s => s.trim()).filter(Boolean), decls })
  }
}

let cache: { rules: CssRule[]; tokens: Map<string, string> } | null = null
export function stylesheets() {
  if (cache) return cache
  const rules: CssRule[] = []
  for (const f of walk(SRC).filter(f => f.endsWith('.css'))) parseBlocks(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), f, rules)
  const tokens = new Map<string, string>()
  for (const r of rules) if (r.selectors.includes(':root')) for (const [k, v] of r.decls) if (k.startsWith('--')) tokens.set(k, v)
  cache = { rules, tokens }
  return cache
}

export type Rgb = [number, number, number]

/** A colour from a declaration value: `#rgb`, `#rrggbb`, `rgb(...)`, or a `var(--token)` that resolves to one. null for anything else (transparent, gradients, currentColor). */
export function colorOf(value: string, depth = 0): Rgb | null {
  const v = value.trim().replace(/\s*!important$/, '')
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)) as Rgb
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v)
  if (ref && depth < 6) {
    const t = stylesheets().tokens.get(ref[1])
    return colorOf(t ?? ref[2] ?? '', depth + 1)
  }
  return null
}

export const ACCENT: Rgb = [255, 138, 42]
export const sameColor = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

export function hsl([r, g, b]: Rgb): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

/** Every background colour a stylesheet rule can give this element (no cascade: any matching rule counts, so this over-reports rather than misses). */
export function backgroundsOf(el: Element): Rgb[] {
  const out: Rgb[] = []
  for (const r of stylesheets().rules) {
    const bg = r.decls.filter(([k]) => k === 'background' || k === 'background-color')
    if (bg.length === 0) continue
    let hit = false
    for (const sel of r.selectors) {
      if (sel.includes('::') || sel === ':root') continue
      try { if (el.matches(sel)) { hit = true; break } } catch { /* a selector jsdom cannot parse never matches here */ }
    }
    if (!hit) continue
    for (const [, v] of bg) {
      const first = v.split(/\s+(?![^(]*\))/)[0]
      const c = colorOf(first)
      if (c) out.push(c)
    }
  }
  // an inline style beats every rule above, so it counts too
  for (const m of (el.getAttribute('style') ?? '').matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gi)) {
    const c = colorOf(m[1].trim().split(/\s+(?![^(]*\))/)[0])
    if (c) out.push(c)
  }
  return out
}

export const BUTTONLIKE = 'button, [role="button"], a[class*="sr-btn"], input[type="button"], input[type="submit"]'
/** A visible button in the contract's sense: not an SVG node (ruling R9: Skills nodes are SVG groups, exempt from the accent scan). */
export const buttonsIn = (root: ParentNode): Element[] => [...root.querySelectorAll(BUTTONLIKE)].filter(b => visible(b) && !b.closest('svg'))

// ---------------------------------------------------------------- checks

const FOCUSABLE = 'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
const GROUP = '[data-action-group], .qc-actions, .rv-actions, .dk-actions'

/** GLOBAL-03, last clause: the next focusable control after the accent must not sit in the accent's own action group. */
export function tabOrderViolation(accent: Element): string | null {
  const group = accent.closest(GROUP)
  if (!group || (accent as HTMLButtonElement).disabled) return null // a disabled accent (no answer typed yet, read-only) is not in the tab order at all
  const all = [...accent.ownerDocument.querySelectorAll(FOCUSABLE)].filter(visible)
  const at = all.indexOf(accent)
  if (at < 0) return 'the accent button is not focusable'
  const next = all[at + 1]
  return next && group.contains(next) ? `${next.getAttribute('data-testid') ?? next.tagName} follows the accent inside its action group` : null
}

const trim = (el: Element) => el.outerHTML.slice(0, 90).replace(/\s+/g, ' ')

/** Words the app itself writes (destinations, buttons, captions). If one is the whole text of a data-content element, app copy is hiding in the exemption. */
export const APP_WORDS = ['needs', 'open the video', 'open the reading', 'today', 'path', 'skills', 'review', 'settings', 'guide', 'start', 'done', 'next ticket', 'reference']

/** App phrases that must never sit inside an exemption, even next to plan text (the label of a resource link, the lock caption of a locked area). */
const APP_PHRASES = /\bopen the (video|reading)|^needs\b/

/**
 * The exemption must wrap plan or learner text only (README: "Text produced by the app itself ... is not exempt"). Structural reading of that rule:
 * a data-content element is never a button, tab, tree item or role=button (a control's label is the app's), has no descendant control
 * (button, role=button, a link that is not itself a plan carrier) and no descendant with an aria-label that is not a plan carrier, and carries
 * an aria-label itself only when it is a plan link (a) or a field that holds learner text (textarea, input). Its whole text is never an app word.
 */
export function dataContentViolations(root: ParentNode): string[] {
  const out: string[] = []
  for (const dc of root.querySelectorAll('[data-content]')) {
    const where = trim(dc)
    if (dc.matches('button, [role="button"], [role="tab"], [role="treeitem"], [role="option"], [role="menuitem"]')) out.push(`data-content on a control: ${where}`)
    if (dc.hasAttribute('aria-label') && !dc.matches('a, textarea, input')) out.push(`data-content hides an aria-label: ${where}`)
    for (const inner of dc.querySelectorAll('button, [role="button"], a, [aria-label]')) {
      if (inner.hasAttribute('data-content')) continue
      out.push(`data-content wraps an app control or label (${inner.tagName.toLowerCase()}): ${where}`)
      break
    }
    const whole = (dc.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (APP_WORDS.includes(whole)) out.push(`data-content wraps the app word "${whole}": ${where}`)
    if (APP_PHRASES.test(whole)) out.push(`data-content wraps app copy ("${whole.slice(0, 40)}"): ${where}`)
  }
  return out
}


/** GLOBAL-09: an element marked data-empty is one sentence, at most one action, nothing else. */
export function emptyViolations(el: Element): string[] {
  const out: string[] = []
  const id = el.getAttribute('data-testid') ?? el.tagName
  const actions = el.matches('a, button') ? [el] : [...el.querySelectorAll('a, button')]
  if (actions.length > 1) out.push(`${id}: more than one action`)
  if (el.querySelector('svg, img, h1, h2, h3, h4, h5, h6, ul, ol, table, input, textarea')) out.push(`${id}: holds more than a sentence and an action`)
  const rest = el.cloneNode(true) as Element
  rest.querySelectorAll('a, button').forEach(x => x.remove())
  const own = (rest.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (own === '') out.push(`${id}: no sentence`)
  if ((own.match(/[.!?](\s|$)/g) ?? []).length > 1) out.push(`${id}: more than one sentence: "${own}"`)
  return out
}

/** Inline styles are the only styling jsdom can see on a rendered node. */
export function inlineStyleViolations(root: ParentNode): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
    const px = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(el.getAttribute('style') ?? '')
    if (px && Number(px[1]) < 14) out.push(`font-size ${px[1]}px: ${trim(el)}`)
    if (/border-radius:\s*(?!0(px)?\s*(;|$))/.test(el.getAttribute('style') ?? '')) out.push(`border-radius: ${trim(el)}`)
    if (/silkscreen|--sr-font-pixel/i.test(el.getAttribute('style') ?? '') && el.matches(BUTTONLIKE)) out.push(`Silkscreen on a button: ${trim(el)}`)
  }
  return out
}

export interface ScanOptions {
  /** the screen has no accent, by clause (palette, overlays, a read ticket that is done) */
  noAccent?: boolean
  /** an exact accent count the clause demands ("Where a clause says the screen offers an action") */
  accent?: number
  /**
   * Banks, DSA, Designs and Atlas are not in the contract's "every screen" list (README, Global clauses): GLOBAL-01, 02 and 08 apply to them
   * (ruling R16), but their accent colouring and empty states are the old screens' own (existing tests and e2e lock them), and Banks puts
   * data-empty on "no value" chips.
   */
  legacy?: boolean
}

/** Every structural rule of GLOBAL-01, 02, 03, 08, 09 on what is rendered right now; returns the violations, each naming the element. */
export function scanDom(root: ParentNode = document.body, opt: ScanOptions = {}): string[] {
  const out: string[] = []
  const text = appText(root as Element)
  const banned = text.match(new RegExp(BANNED.source, 'gi'))
  if (banned) out.push(`GLOBAL-01 banned word(s): ${[...new Set(banned.map(s => s.toLowerCase()))].join(', ')}`)
  const guilt = text.match(new RegExp(GUILT.source, 'gi'))
  if (guilt) out.push(`GLOBAL-02 guilt wording: ${[...new Set(guilt.map(s => s.toLowerCase()))].join(', ')}`)

  const marked = [...root.querySelectorAll('[data-accent="primary"]')].filter(visible)
  if (marked.length > 1) out.push(`GLOBAL-03 ${marked.length} data-accent elements: ${marked.map(e => e.getAttribute('data-testid') ?? e.tagName).join(', ')}`)
  if (opt.noAccent && marked.length > 0) out.push('GLOBAL-03 an accent where the clause has none')
  if (opt.accent !== undefined && marked.length !== opt.accent) out.push(`GLOBAL-03 expected exactly ${opt.accent} accent, found ${marked.length}`)
  for (const a of marked) {
    if (!/^[A-Za-z]+ · .+$/.test((a.textContent ?? '').trim())) out.push(`GLOBAL-03 accent label "${(a.textContent ?? '').trim()}" is not VERB · OBJECT`)
    const tab = tabOrderViolation(a)
    if (tab) out.push(`GLOBAL-03 tab order: ${tab}`)
    if (!backgroundsOf(a).some(c => sameColor(c, ACCENT))) out.push(`GLOBAL-03 ${a.getAttribute('data-testid')} is marked accent but no stylesheet rule paints it orange`)
  }
  // the computed colour: every visible button a stylesheet rule paints orange must be the marked one
  for (const b of buttonsIn(root)) {
    const bgs = backgroundsOf(b)
    if (!opt.legacy && bgs.some(c => sameColor(c, ACCENT)) && b.getAttribute('data-accent') !== 'primary') out.push(`GLOBAL-03 orange button without data-accent: ${trim(b)}`)
    // TODAY-31 is ambiguous (the default control fill #3a4162 is hue ~229 but only ~0.26 saturated): flag a clearly blue fill, saturation above 0.5
    const blue = bgs.find(c => { const k = hsl(c); return k.h >= 200 && k.h <= 260 && k.s > 0.5 })
    if (blue) out.push(`TODAY-31 saturated blue button fill rgb(${blue.join(',')}): ${trim(b)}`)
  }

  for (const c of root.querySelectorAll(CONTROLS)) {
    if (!visible(c)) continue
    if (nameOf(c) === '') out.push(`GLOBAL-08 unnamed control: ${trim(c)}`)
  }

  if (!opt.legacy) for (const e of root.querySelectorAll('[data-empty="true"]')) if (visible(e)) out.push(...emptyViolations(e))
  if (!opt.legacy) for (const e of root.querySelectorAll('[data-testid$="-empty"], [data-testid$="-no-match"]')) {
    if (visible(e) && e.getAttribute('data-empty') !== 'true') out.push(`GLOBAL-09 ${e.getAttribute('data-testid')} lacks data-empty="true"`)
  }
  out.push(...inlineStyleViolations(root).map(s => `GLOBAL-04/05 ${s}`))
  out.push(...dataContentViolations(root).map(s => `GLOBAL-01/02 exemption: ${s}`))
  return out
}

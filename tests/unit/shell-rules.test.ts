// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DESTINATIONS, currentDestination, labelsDecision, titleFor } from '../../src/rules/nav'
import { globalKeyBlocked, isPaletteKey } from '../../src/rules/keyScope'
import { rank, skillItems, STATIC_ITEMS, ticketItems, type PaletteItem } from '../../src/rules/palette'
import { mkPlanV2, mkTicket } from '../helpers/planV2'

describe('nav', () => {
  it('lists the six keyed destinations first, with keys 1 to 6 (the rest of the rail: s2-w3-rules.test.ts)', () => {
    expect(DESTINATIONS.slice(0, 6).map(d => [d.id, d.to, d.key])).toEqual([['today', '/', '1'], ['path', '/path', '2'], ['board', '/board', '3'], ['journal', '/journal', '4'], ['skills', '/skills', '5'], ['review', '/review', '6']])
  })
  it('names the destination of a route, and none for tickets and sessions', () => {
    expect(currentDestination('/')).toBe('today')
    expect(currentDestination('/path')).toBe('path')
    expect(currentDestination('/review')).toBe('review')
    expect(currentDestination('/skills/area/llm')).toBe('skills')
    expect(currentDestination('/skills/stats')).toBe('skills')
    for (const p of ['/do/t1', '/designs/session/d1', '/settings']) expect(currentDestination(p), p).toBeNull()
    for (const [p, id] of [['/guide', 'guide'], ['/dsa', 'dsa'], ['/designs', 'designs'], ['/atlas', 'atlas'], ['/portfolio', 'portfolio'], ['/banks', 'banks']] as const) expect(currentDestination(p), p).toBe(id)
    expect(titleFor('/do/t1')).toBe('Ticket')
    expect(titleFor('/settings')).toBe('Settings')
    expect(titleFor('/skills/stats')).toBe('Skills')
  })
  it('decides the labels once per page load and stores hover at once (SHELL-08, SHELL-09)', () => {
    expect(labelsDecision(undefined)).toEqual({ show: true, write: 'hover' })
    expect(labelsDecision('intro')).toEqual({ show: true, write: 'hover' })
    expect(labelsDecision('hover')).toEqual({ show: false, write: null })
    expect(labelsDecision('always')).toEqual({ show: true, write: null })
  })
})

describe('keyScope', () => {
  const press = (target: Element, over: Partial<KeyboardEventInit> = {}) => {
    const e = new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true, ...over })
    Object.defineProperty(e, 'target', { value: target })
    return e
  }
  const el = (tag: string, attrs: Record<string, string> = {}) => {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    return n
  }
  it('lets a plain key through on the page body and on an ordinary element', () => {
    expect(globalKeyBlocked(press(document.body))).toBe(false)
    expect(globalKeyBlocked(press(el('button')))).toBe(false)
  })
  it('blocks text fields, editors, the canvas and modified presses', () => {
    const canvas = el('div', { 'data-testid': 'kit-canvas' })
    const inner = el('span'); canvas.appendChild(inner)
    const ce = el('div', { contenteditable: 'true' })
    Object.defineProperty(ce, 'isContentEditable', { value: true })
    const scoped = el('div', { 'data-no-global-keys': '' })
    for (const e of [el('textarea'), el('input'), el('select'), inner, canvas, ce, scoped]) expect(globalKeyBlocked(press(e))).toBe(true)
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(globalKeyBlocked(press(document.body, mod))).toBe(true)
  })
  it('blocks anything inside a [data-no-global-keys] zone, and an SVG node inside the canvas', () => {
    const zone = el('section', { 'data-no-global-keys': '' })
    const deep = el('p'); const leaf = el('b'); deep.appendChild(leaf); zone.appendChild(deep)
    expect(globalKeyBlocked(press(leaf))).toBe(true)
    const canvas = el('div', { 'data-testid': 'kit-canvas' })
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    canvas.appendChild(node)
    expect(globalKeyBlocked(press(node))).toBe(true)
  })
  it('blocks a CodeMirror editor, role=textbox and role=combobox (and anything inside them)', () => {
    const cm = el('div', { class: 'cm-editor' }); const line = el('div', { class: 'cm-line' }); cm.appendChild(line)
    const tb = el('div', { role: 'textbox' }); const tbInner = el('span'); tb.appendChild(tbInner)
    const cb = el('div', { role: 'combobox' })
    for (const e of [cm, line, tb, tbInner, cb]) expect(globalKeyBlocked(press(e))).toBe(true)
  })
  it('blocks a key that something already handled, and one inside an IME composition', () => {
    const handled = press(document.body); handled.preventDefault()
    expect(handled.defaultPrevented).toBe(true)
    expect(globalKeyBlocked(handled)).toBe(true)
    expect(globalKeyBlocked(press(document.body, { isComposing: true }))).toBe(true)
  })
  it('opens the palette on Ctrl+K and Cmd+K only', () => {
    expect(isPaletteKey({ key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true)
    expect(isPaletteKey({ key: 'K', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true)
    expect(isPaletteKey({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false)
    expect(isPaletteKey({ key: 'k', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false })).toBe(false)
    expect(isPaletteKey({ key: 'j', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(false)
  })
})

describe('palette', () => {
  const plan = mkPlanV2()
  const tickets = [
    mkTicket({ id: 't1', title: 'Watch: Karpathy deep dive', estMin: 62 }),
    mkTicket({ id: 't2', title: 'Old', archived: true }),
    mkTicket({ id: 't3', title: 'Notes on such things in the hash ring' }),
    mkTicket({ id: 't4', title: 'Atlas of caches' }),
  ]
  const all: PaletteItem[] = [...STATIC_ITEMS, ...skillItems(plan), ...ticketItems(tickets)]
  const first = (q: string) => rank(all, q)[0]
  it('lists the six keyed destinations with their keys under an empty query', () => {
    const r = rank(all, '')
    expect(r.slice(0, 6).map(i => [i.label, i.key])).toEqual([['Today', '1'], ['Path', '2'], ['Board', '3'], ['Journal', '4'], ['Skills', '5'], ['Review', '6']])
    expect(r.every(i => i.kind === 'destination' || i.kind === 'page')).toBe(true)
  })
  it('reaches every kind of target (SHELL-17)', () => {
    expect(first('karpathy').target).toBe('/do/t1')
    expect(rank(all, 'How LLMs').some(i => i.target === '/skills/area/llm')).toBe(true)
    expect(first('review').target).toBe('/review')
    expect(first('settings').target).toBe('/settings')
    expect(first('guide').target).toBe('/guide')
    expect(first('path').target).toBe('/path')
    expect(first('banks').target).toBe('/banks')
    expect(first('dsa').target).toBe('/dsa')
    expect(first('designs').target).toBe('/designs')
    expect(rank(all, 'atlas').map(i => i.target)).toEqual(expect.arrayContaining(['/atlas', '/do/t4']))
  })
  it('reaches every AI area by its name', () => {
    for (const a of plan.areas) expect(rank(all, a.name).some(i => i.target === `/skills/area/${a.id}`), a.name).toBe(true)
  })
  it('labels a ticket by its title verbatim and tags a bank ticket as DSA', () => {
    const t = ticketItems([mkTicket({ id: 'b1', title: '200 · Number of Islands', lane: 'bank', origin: 'bank' as never })])[0]
    expect(t.label).toBe('200 · Number of Islands')
    expect(t.hint.startsWith('DSA')).toBe(true)
  })
  it('skips archived tickets, and finds nothing for nonsense', () => {
    expect(rank(all, 'Old').some(i => i.target === '/do/t2')).toBe(false)
    expect(rank(all, 'zzqq')).toEqual([])
  })
  it('does not match a query that is only a letter subsequence of a title (SHELL-18 empty state)', () => {
    expect(all.some(i => i.label.includes('Notes on such things'))).toBe(true)
    expect(rank(all, 'no-such-thing')).toEqual([])
    expect(rank(all, 'asdf')).toEqual([])
  })
  it('lists every ticket that shares a word with the query (no cap: the 600th of 600 is still there)', () => {
    const many = Array.from({ length: 600 }, (_, i) => mkTicket({ id: `w${i + 1}`, title: `Watch video ${i + 1}` }))
    const items = [...STATIC_ITEMS, ...ticketItems(many)]
    const r = rank(items, 'watch')
    expect(r.some(i => i.target === '/do/w600')).toBe(true)
    expect(r).toHaveLength(600)
    expect(r.some(i => i.target === '/do/w1')).toBe(true)
  })
  it('puts whole-word matches before prefix matches of the same score, then destinations before tickets', () => {
    const items: PaletteItem[] = [
      { id: 'a', kind: 'ticket', label: 'Pathology notes', hint: '', target: '/do/a', words: '' },
      { id: 'b', kind: 'ticket', label: 'Path notes', hint: '', target: '/do/b', words: '' },
      { id: 'c', kind: 'page', label: 'Path report', hint: '', target: '/c', words: '' },
    ]
    expect(rank(items, 'path').map(i => i.id)).toEqual(['c', 'b', 'a'])
  })
  it('caps the list at the given maximum', () => {
    const many = ticketItems(Array.from({ length: 30 }, (_, i) => mkTicket({ id: `m${i}`, title: `Build ${i}` })))
    expect(rank(many, 'build', 5)).toHaveLength(5)
  })
})

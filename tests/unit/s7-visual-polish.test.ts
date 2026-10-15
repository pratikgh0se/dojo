import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Cheap CSS assertions for the spot-check polish (s7): the layouts that broke visually in a real browser.
const css = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const rule = (text: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? ''
}

describe('s7 visual polish (CSS)', () => {
  it('Settings > Pace: the min suffix stays on one line and the input is 160 wide, shrinking only in a narrower cell', () => {
    const c = css('src/screens/settings.css')
    expect(rule(c, '.ps-field .settings-meta')).toMatch(/white-space:\s*nowrap/)
    expect(rule(c, '.settings .ps-field input')).toMatch(/flex:\s*0 1 160px;\s*width:\s*160px/)
    expect(rule(c, '.ps-grid')).toMatch(/minmax\(1[7-9]\dpx/)
  })
  it('dimmed backdrop uses the scrim token, which is an rgba (no new hex)', () => {
    expect(css('src/styles/tokens.css')).toMatch(/--sr-scrim:\s*rgba\(/)
    expect(rule(css('src/app/shell/shell.css'), '.pal-back')).toMatch(/background:\s*var\(--sr-scrim\)/)
  })
  it('the palette is top-aligned (the input row stays put as the list shrinks) and its focus mark causes no layout shift', () => {
    const shell = css('src/app/shell/shell.css')
    const back = rule(shell, '.pal-back')
    expect(back).toMatch(/align-items:\s*flex-start/)
    expect(back).not.toMatch(/align-items:\s*center/)
    expect(back).toMatch(/padding:\s*12vh /)
    const row = rule(shell, '.pal-row')
    const focus = rule(shell, '.pal-row:focus-within')
    expect(focus).toMatch(/box-shadow:\s*inset[^;]*var\(--sr-energy-accent\)/)
    expect(focus).not.toMatch(/border/)
    expect(row).toMatch(/border-bottom:\s*2px solid/)
  })
  it('the shortcuts dialog container draws no focus ring of its own', () => {
    expect(css('src/app/shell/shell.css')).toMatch(/\.sh-sc:focus,\s*\.sh-sc:focus-visible\s*\{\s*outline:\s*0/)
  })
  it('Today phone: the card gives up its side padding so the Start button is as wide as the card', () => {
    const c = css('src/screens/quest.css')
    expect(c).toMatch(/\.qc\.sr-panel\s*\{[^}]*padding-inline:\s*0/)
    expect(c).toMatch(/\.qc-actions\s*\{[^}]*margin:\s*0;/)
  })
  it('Ticket view: narrow layouts keep the ticket before the timer (no order reversal)', () => {
    expect(css('src/screens/do/ticket.css')).not.toMatch(/\.dk-col:last-child\s*\{\s*order:\s*-1/)
  })
  it('Skills stats on a phone: the minutes text never wraps and the meter takes its own row', () => {
    const c = css('src/screens/skills.css')
    expect(c).toMatch(/\.sk-lanes \.mono\s*\{[^}]*white-space:\s*nowrap/)
    expect(c).toMatch(/\.sk-lanes li \.sk-meter\s*\{[^}]*grid-column:\s*1 \/ -1/)
  })
})

describe('s7 GLOBAL-04 on the Skills area map (CSS)', () => {
  const c = css('src/screens/skills.css')
  it('the tile count never falls back to the 13.33 px button/monospace default', () => {
    expect(rule(c, '.sk-count')).toMatch(/font-size:\s*var\(--type-(meta|small|body-s)\)/)
    expect(rule(c, '.sk-area')).toMatch(/font-size:\s*var\(--type-(meta|small|body-s)\)/)
  })
  it('the two-letter area tag inside the tile button is body-font bold uppercase, not Silkscreen, and >= 14 px', () => {
    const tag = rule(c, '.sk-tag')
    expect(tag).toMatch(/font-family:\s*var\(--sr-font-body\)/)
    expect(tag).not.toMatch(/pixel|Silkscreen/)
    expect(tag).toMatch(/font-weight:\s*700/)
    expect(tag).toMatch(/text-transform:\s*uppercase/)
    expect(tag).toMatch(/font-size:\s*var\(--type-(small|meta)\)/)
    expect(rule(c, '.sk-bigtag')).toMatch(/var\(--sr-font-pixel\)/)
  })
  it('GLOBAL-04: an Atlas walkthrough caption (a span, not a heading) is body text, never Silkscreen', () => {
    const r = rule(css('src/screens/atlas.css'), '.aw-title')
    expect(r).not.toMatch(/font-pixel/)
    expect(r).toMatch(/font-family:\s*var\(--sr-font-body\)/)
    expect(r).toMatch(/font-size:\s*var\(--type-(small|body|meta)\)/)
  })
  it('tablet with the expanded rail: the header search may shrink below its text, so the gear stays inside 768 px', () => {
    expect(rule(css('src/app/shell/shell.css'), '.sh-search')).toMatch(/min-width:\s*0/)
  })
})

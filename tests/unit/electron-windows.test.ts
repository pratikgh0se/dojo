// @vitest-environment node
// A2 / Task 23: which window.open the Mac app allows. Only the partner card of the app's own origin gets a window.
import { describe, expect, it } from 'vitest'
import { isPartnerCardUrl, windowOpenDecision } from '../../electron/windows.mjs'

const APP = 'http://127.0.0.1:51234'

describe('isPartnerCardUrl', () => {
  it.each([
    `${APP}/#/partner/ds-none`, `${APP}/#/partner/ds-1760000000000-ab12`, `${APP}/index.html#/partner/x`,
  ])('%s is allowed', u => expect(isPartnerCardUrl(u, APP)).toBe(true))

  it.each([
    `HTTP://127.0.0.1:51234/#/partner/x`, `http://127.0.0.1:51234/#/partner/X`,
  ])('%s: scheme and host are case-insensitive, the id is kept', u => expect(isPartnerCardUrl(u, APP)).toBe(true))

  it.each([
    ['another origin', 'https://example.com/#/partner/ds-none'],
    ['another port', 'http://127.0.0.1:9999/#/partner/ds-none'],
    ['another host, same port', 'http://localhost:51234/#/partner/ds-none'],
    ['credentials trick', 'http://127.0.0.1:51234@evil.example/#/partner/ds-none'],
    ['literal prefix trick', 'http://127.0.0.1:51234.evil.com/#/partner/x'],
    ['userinfo on the app host', 'http://user@127.0.0.1:51234/#/partner/x'],
    ['userinfo with password on the app host', 'http://user:pw@127.0.0.1:51234/#/partner/x'],
    ['empty userinfo password', 'http://:pw@127.0.0.1:51234/#/partner/x'],
    ['javascript:', 'javascript:alert(1)//#/partner/x'],
    ['file:', 'file:///etc/passwd#/partner/x'],
    ['data:', 'data:text/html,<p>x</p>#/partner/x'],
    ['same origin, no hash', `${APP}/`],
    ['same origin, another route', `${APP}/#/session/ds-1`],
    ['same origin, partner prefix lookalike', `${APP}/#/partnerx/ds-1`],
    ['same origin, hash on the path only', `${APP}/partner/ds-1`],
    ['same origin, partner with no id', `${APP}/#/partner/`],
    ['empty', ''],
    ['malformed', 'http://'],
    ['not a URL', 'not a url'],
  ])('%s is denied', (_n, u) => expect(isPartnerCardUrl(u, APP)).toBe(false))

  it('a malformed app url denies everything', () => expect(isPartnerCardUrl(`${APP}/#/partner/x`, 'nope')).toBe(false))
})

describe('windowOpenDecision', () => {
  it('opens the partner card as a window', () => expect(windowOpenDecision(`${APP}/#/partner/ds-none`, APP)).toBe('card'))
  it('keeps other own-origin windows denied and does not hand them to the browser', () => {
    expect(windowOpenDecision(`${APP}/`, APP)).toBe('deny')
    expect(windowOpenDecision(`${APP}/#/settings`, APP)).toBe('deny')
  })
  it('a card window (allowCard false) denies the partner card, so a card cannot open further cards', () => {
    expect(windowOpenDecision(`${APP}/#/partner/ds-none`, APP, { allowCard: false })).toBe('deny')
    expect(windowOpenDecision(`${APP}/#/partner/other`, APP, { allowCard: false })).toBe('deny')
  })
  it('a card window still sends foreign urls to the link policy and denies other own-origin opens', () => {
    expect(windowOpenDecision('https://example.com/', APP, { allowCard: false })).toBe('outside')
    expect(windowOpenDecision(`${APP}/#/settings`, APP, { allowCard: false })).toBe('deny')
  })
  it('allowCard defaults to true', () => expect(windowOpenDecision(`${APP}/#/partner/ds-none`, APP, {})).toBe('card'))
  it('hands foreign urls to the link policy', () => {
    expect(windowOpenDecision('https://example.com/', APP)).toBe('outside')
    expect(windowOpenDecision('javascript:alert(1)', APP)).toBe('outside')
    expect(windowOpenDecision('file:///etc/passwd', APP)).toBe('outside')
    expect(windowOpenDecision('http://', APP)).toBe('outside')
  })
})

// Which window.open the Mac app allows (A2, Task 23), kept apart from main.mjs so it can be unit tested without Electron.
// The partner card (#/partner/<sessionId>) of the app's own origin opens as a second Dojo window of the same session;
// every other window.open stays denied, and a foreign URL goes through the link policy (links.mjs) as before.

/** The app's own address, as main.mjs always compared it: the origin itself, or a path or hash under it. */
export function isOwnUrl(u, appUrl) {
  return u === appUrl || u.startsWith(appUrl + '/') || u.startsWith(appUrl + '#')
}

/** True only for `<app origin>/...#/partner/<id>`: same origin (a URL parse, so credentials or look-alike hosts fail), a non-empty id. */
export function isPartnerCardUrl(u, appUrl) {
  try {
    const target = new URL(String(u))
    const app = new URL(String(appUrl))
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
    if (target.origin !== app.origin) return false
    if (target.username || target.password) return false
    return target.hash.startsWith('#/partner/') && target.hash.length > '#/partner/'.length
  } catch { return false }
}

/**
 * 'card' (open a window), 'deny' (own origin, nothing to open) or 'outside' (hand it to the link policy).
 * Only the app window may open a card: a card window passes allowCard false, so its partner-card opens are denied.
 */
export function windowOpenDecision(u, appUrl, { allowCard = true } = {}) {
  if (allowCard && isPartnerCardUrl(u, appUrl)) return 'card'
  return isOwnUrl(String(u), appUrl) ? 'deny' : 'outside'
}

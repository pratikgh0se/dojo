// What the Mac app's window may hand to the outside world (G6 security review), kept apart from main.mjs so it can
// be unit tested without Electron.
//   SEC-D-05: a link leaves the window for the default browser only when it is http(s) to a public host. A link to
//             this Mac or the local network (an AI-written brief can carry one: a GET to a router or another local
//             app, with the browser's cookies) is opened only after the learner confirms it. Nothing else opens.
//   SEC-D-04: the window gets no browser permission (camera, microphone, location, notifications, clipboard read,
//             screen capture, ...). Dojo uses none; the allow-list stays empty until a feature needs one.
import { isIP } from 'node:net'
import { isBlockedAddress } from '../server/linkcheck.mjs'

/** Names that only ever mean this Mac or the local network. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.internal', '.intranet', '.corp', '.home.arpa']

/** True when a URL's hostname is this Mac or the local network: loopback, private, link-local, a single label, .local, ... */
export function isLocalHost(hostname) {
  let h = String(hostname).toLowerCase().replace(/\.$/, '')
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === '') return true
  if (isIP(h) !== 0) return isBlockedAddress(h)
  if (h === 'localhost' || LOCAL_SUFFIXES.some(s => h.endsWith(s))) return true
  return !h.includes('.') // "router", "nas": an intranet name
}

/** 'open' (http(s), a public host), 'confirm' (http(s) to this Mac or the local network) or 'refuse' (anything else). */
export function linkVerdict(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return 'refuse' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'refuse'
  if (u.username || u.password) return 'refuse'
  return isLocalHost(u.hostname) ? 'confirm' : 'open'
}

/** SEC-D-04: the permissions the window may have. Empty: Dojo needs none. */
export const ALLOWED_PERMISSIONS = new Set()

/** Whether `permission`, asked for by `requestingUrl` (a page or frame URL, or an origin), is granted. */
export function permissionAllowed(permission, requestingUrl, appOrigin) {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false
  try { return new URL(String(requestingUrl)).origin === appOrigin } catch { return false }
}

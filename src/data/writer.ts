// Addendum 3: only the Dojo app's own browser may write to disk. The launcher opens
// /#writer=<token>; this module (evaluated before the database is created) moves the token into
// localStorage and strips it from the URL at once, so it never lingers in history or a copied link.
const KEY = 'dojo.writer'

function capture(): void {
  try {
    const m = /(?:^#|&)writer=([^&]+)/.exec(window.location.hash)
    if (!m) return
    // G4 #6: out of the address bar first, so even a fragment that fails to decode never lingers.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    localStorage.setItem(KEY, decodeURIComponent(m[1]))
  } catch { /* no window or storage (node): no token */ }
}
capture()

export function writerToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export const READ_ONLY_MESSAGE = 'Read-only: open Dojo from the Dojo app to make changes'

/** Thrown for any change a read-only browser attempts (its name makes it recognisable after Dexie wraps it). */
export class ReadOnlyError extends Error {
  constructor() {
    super(READ_ONLY_MESSAGE)
    this.name = 'ReadOnlyError'
  }
}

export function isReadOnlyError(e: unknown): boolean {
  let cur: unknown = e
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    if ((cur as { name?: unknown }).name === 'ReadOnlyError') return true
    cur = (cur as { inner?: unknown }).inner
  }
  return false
}

/** Disk sync is on (not the Dexie-only e2e / preview build) and this browser has no writer token. */
export function isReadOnly(): boolean {
  return import.meta.env.VITE_DOJO_DISK !== 'off' && !writerToken()
}

/** The header every write request carries (none without a token: the server then answers 403). */
export function writerHeaders(): Record<string, string> {
  const t = writerToken()
  return t ? { 'X-Dojo-Writer': t } : {}
}

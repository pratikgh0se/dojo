/** BrowserRouter ignores the hash, so the card route is read here: `#/partner/<sessionId>` (A2). Ids are `designSessions.id` values, so any text without a slash, query, hash or space is accepted. */
export function parsePartnerHash(hash: string): string | null {
  const m = /^#\/partner\/([^/?#\s]+)$/.exec(hash)
  if (!m) return null
  let id: string
  try { id = decodeURIComponent(m[1]) } catch { return null }
  return id && !/[/?#\s]/.test(id) ? id : null
}

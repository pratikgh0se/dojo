// Tiny id helpers shared by the outbox middleware (entry chunk) and the sync code (lazy chunk).
export function keyToId(key: unknown): string {
  // A compound key (the `code` table's [ticketId, lang]) is its parts joined by ':'.
  if (Array.isArray(key)) return key.map(keyToId).join(':')
  return typeof key === 'string' ? key : typeof key === 'number' ? String(key) : JSON.stringify(key)
}

export function newOpId(): string {
  const c = globalThis.crypto as Crypto | undefined
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** The primary key a disk id stands for (the inverse of keyToId): a `code` row's id is `<ticketId>:<lang>`. */
export function idToKey(tbl: string, id: string): unknown {
  if (tbl !== 'code') return id
  const i = id.lastIndexOf(':')
  return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)] // a 4a id (the ticketId alone) names no row now
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function localStore(s?: StorageLike): StorageLike | undefined {
  return s ?? globalThis.localStorage
}

export function readJson<T>(key: string, s: StorageLike | undefined, guard: (v: unknown) => v is T): T | null {
  try {
    const raw = localStore(s)?.getItem(key)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    return guard(v) ? v : null
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown, s?: StorageLike): void {
  try {
    localStore(s)?.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: the caller keeps working from in-memory state
  }
}

export function removeKey(key: string, s?: StorageLike): void {
  try {
    localStore(s)?.removeItem(key)
  } catch {
    // nothing to clear
  }
}

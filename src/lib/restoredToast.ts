/**
 * The line a restore leaves for the page that comes back (UAT cu-8 P3-4). A restore wipes this browser's copy, which makes the screen
 * remount before the reload lands (the start gate drops the app while settings are gone); a remounted Backups that took the line then
 * raised it in the page that was about to unload. So the line is tagged with the page that left it, and only another page takes it.
 */
export const RESTORED_KEY = 'dojo.restoredToast'

/** One id per page load: this module is evaluated again in the page that comes back. */
export const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/** Leaves `text` for the next page load. Storage that refuses it just loses the line: the reload says enough. */
export function leaveRestoredToast(text: string, page: string = PAGE_ID): void {
  try { sessionStorage.setItem(RESTORED_KEY, JSON.stringify({ text, page })) } catch { /* no storage: no toast */ }
}

/** The line left by an earlier page, once; null when there is none or this very page left it (it is still on its way to the reload). */
export function takeRestoredToast(page: string = PAGE_ID): string | null {
  try {
    const raw = sessionStorage.getItem(RESTORED_KEY)
    if (!raw) return null
    const left = JSON.parse(raw) as { text?: unknown; page?: unknown }
    if (left.page === page) return null
    sessionStorage.removeItem(RESTORED_KEY)
    return typeof left.text === 'string' ? left.text : null
  } catch {
    return null
  }
}

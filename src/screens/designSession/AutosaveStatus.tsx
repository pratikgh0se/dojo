import { useNow } from '../../lib/useNow'

export function relativeSaved(savedAt: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - savedAt) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60)
  return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`
}

/** "Autosaved just now": every change is written as it is made; this shows when the last write landed. */
export function AutosaveStatus({ savedAt }: { savedAt: number | null }) {
  const t = useNow(1000)
  return (
    <p className="nt-autosave" role="status" data-testid="session-autosave">
      {savedAt === null ? 'Autosave on' : `Autosaved ${relativeSaved(savedAt, t)}`}
    </p>
  )
}

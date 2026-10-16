import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../data/hooks'
import { safeWrite } from '../data/safeWrite'
import { saveNavLabels } from '../data/settingsActions'
import { isReadOnly } from '../data/writer'
import { labelsDecision } from '../rules/nav'
import { useDb } from './providers'

/** Written synchronously by the toggle and cleared when its Dexie write settles: a reload inside that window finds it and finishes the write (NAV-42). */
export const RAIL_PENDING_KEY = 'dojo.rail.pending'
type Pending = 'always' | 'hover'
/** What an earlier page load left unfinished. A read-only browser never owns a marker: it neither reads nor clears one. */
function readPending(): Pending | null {
  if (isReadOnly()) return null
  try {
    const v = window.localStorage.getItem(RAIL_PENDING_KEY)
    return v === 'always' || v === 'hover' ? v : null
  } catch { return null }
}
function writePending(v: Pending | null): void {
  try { if (v) window.localStorage.setItem(RAIL_PENDING_KEY, v); else window.localStorage.removeItem(RAIL_PENDING_KEY) } catch { /* storage blocked: the write itself still happens */ }
}

export interface RailState {
  /** the rail is 200 px with labels (true) or 56 px, icons only (false) */
  expanded: boolean
  /** `shell-rail-toggle`: flips the rail at once and stores `always` or `hover` (never `intro`); a read-only browser writes nothing (NAV-08) */
  toggle: () => void
  /** The Settings switch changed the rail: show it at once (the switch writes the setting itself). */
  set: (expanded: boolean) => void
}

/**
 * Whether the rail shows a text label beside each icon. The intro rule is decided once per page load, after setup
 * (a start date exists): a fresh or `intro` install shows the labels for this whole page load and stores `hover` at once
 * (SHELL-09), so the in-memory flag, not the stored value, keeps them up until the next load. `always` (Settings) wins
 * and ends the intro; switching it off gives the collapsed rail (SHELL-11). The rail's own toggle shows its result at once
 * and then stores it (NAV-05); a read-only browser never writes, so its toggle holds for that page load only (NAV-08).
 */
export function useRailLabels(): RailState {
  const d = useDb()
  const settings = useSettings()
  const [intro, setIntro] = useState<boolean | null>(null)
  const [pending] = useState(readPending) // read once, at mount
  const settling = useRef(pending !== null)
  const [override, setOverride] = useState<boolean | null>(() => (pending === null ? null : pending === 'always'))
  const stored = settings?.navLabels
  const ready = !!settings && !!settings.startDate
  useEffect(() => {
    if (!ready || intro !== null) return
    const dec = labelsDecision(stored)
    setIntro(dec.show && stored !== 'always')
    if (dec.write && !isReadOnly()) safeWrite(() => saveNavLabels(d, dec.write!), () => {}).catch(e => console.warn('Dojo: could not store the rail-label setting', e)) // a failed write must not become an unhandled rejection
  }, [ready, stored, intro, d])
  useEffect(() => { if (stored === 'always' && intro) setIntro(false) }, [stored, intro])
  // a stored change (the Settings switch, or the toggle's own write landing) hands the rail back to the data
  useEffect(() => { if (!settling.current) setOverride(null) }, [stored])
  // finish a toggle whose write a reload cut short; the rail already shows it (the override above), and the stored value catches up
  useEffect(() => {
    if (!ready || pending === null) return
    safeWrite(() => saveNavLabels(d, pending), () => {})
      .then(() => { if (readPending() === pending) writePending(null) })
      .catch(e => console.warn('Dojo: could not store the rail-label setting', e))
      .finally(() => { settling.current = false })
  }, [ready, pending, d])
  const base = !ready ? false : stored === 'always' ? true : intro === null ? labelsDecision(stored).show : intro
  const expanded = override ?? base
  const toggle = useCallback(() => {
    const next = !expanded
    setOverride(next)
    if (isReadOnly()) return
    const v: Pending = next ? 'always' : 'hover'
    writePending(v) // synchronous: survives a reload that comes before the write below commits
    safeWrite(() => saveNavLabels(d, v), () => {})
      .then(() => { if (readPending() === v) writePending(null) })
      .catch(e => console.warn('Dojo: could not store the rail-label setting', e))
  }, [expanded, d])
  return { expanded, toggle, set: setOverride }
}

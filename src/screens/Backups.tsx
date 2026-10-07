import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { syncGate } from '../data/db'
import { READ_ONLY_MESSAGE, writerHeaders } from '../data/writer'
import { getRejectedCount, rejectedLabel, syncControls } from '../data/sync/status'
import { Button, Panel, useToast } from '../ui/primitives'
import { Dialog } from './ai/Dialog'
import { fetchDataHome, shownDataFile, type DataHome } from '../data/dataHome'
import { copy, DESKTOP } from '../lib/platform'

interface BackupInfo { file: string; bytes: number; at: string }

const pad = (n: number) => String(n).padStart(2, '0')
/** ST1 #3: "2026-10-03 22:30" in local time, never a locale format. */
export function isoMinute(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * UAT cu-8 P3-2: the pre-restore copy is named for the UTC instant it was made (`pre-restore-2026-10-06T13-56-43-830Z.db`), next to a
 * local time that then disagrees with it by the UTC offset. It reads as what it is, with the same local time the other rows carry; the
 * file name stays in its tooltip.
 */
export function backupLabel(b: BackupInfo): string {
  return b.file.startsWith('pre-restore-') ? 'Before restore' : b.file
}

/** The restore reloads the page, which would take a toast with it: the line waits here for the page that comes back. */
export const RESTORED_KEY = 'dojo.restoredToast'

/** Settings "Backups": list, Back up now, and Restore behind a confirm dialog. Talks to /db/*. */
/** `dataHome`: the data directory from the page's own /db/health read (Settings); when omitted, Backups reads it itself. */
export function Backups({ fetcher, reload = () => window.location.reload(), dataHome }: { fetcher?: typeof fetch; reload?: () => void; dataHome?: DataHome | null }) {
  // perf diagnostic P1: a fetch rebuilt on every render made `load` new on every render, and the effect below then
  // fetched /db/backups in a loop (~1,900 times a second). The fetch is stable now, and the list loads once on
  // mount; Back up now and Restore reload it explicitly.
  const f = useMemo<typeof fetch>(() => fetcher ?? ((i, n) => globalThis.fetch(i, n)), [fetcher])
  const toast = useToast()
  const [items, setItems] = useState<BackupInfo[] | null>(null)
  const [down, setDown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<BackupInfo | null>(null)
  const [own, setOwn] = useState<DataHome | null>(null)
  const where = dataHome !== undefined ? dataHome : own
  const ownHome = dataHome === undefined

  const load = useCallback(async () => {
    if (!fetcher && import.meta.env.VITE_DOJO_DISK === 'off') { setDown(true); return } // no server to ask
    try {
      const res = await f('/db/backups')
      if (!res.ok) throw new Error(String(res.status))
      setItems(((await res.json()) as { backups: BackupInfo[] }).backups)
      setDown(false)
      if (ownHome) setOwn(await fetchDataHome(f))
    } catch {
      setDown(true)
    }
  }, [f, ownHome])
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => { void loadRef.current() }, [])
  // UAT cu-8 P3-4: after a restore the page reloads; say what happened once it is back
  useEffect(() => {
    try {
      const said = sessionStorage.getItem(RESTORED_KEY)
      if (said) { sessionStorage.removeItem(RESTORED_KEY); toast(said) }
    } catch { /* no storage: no toast */ }
  }, [toast])

  async function backupNow() {
    if (syncGate.readOnly) return toast(READ_ONLY_MESSAGE, 'danger') // Addendum 3: only the writer changes data
    setBusy(true)
    try {
      await syncControls.flush()
      const res = await f('/db/backup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...writerHeaders() }, body: '{}' })
      if (!res.ok) throw new Error(String(res.status))
      toast('Backup saved')
      await load()
    } catch {
      toast('Backup failed: is the Dojo server running?', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function restore(b: BackupInfo) {
    const file = b.file
    setConfirming(null)
    if (syncGate.readOnly) return toast(READ_ONLY_MESSAGE, 'danger')
    const parked = getRejectedCount()
    if (parked > 0) {
      // I2: a restore replaces this browser's data, and the refused changes live only here.
      toast(`Restore blocked: ${rejectedLabel(parked)}. Retry them in Settings first.`, 'danger')
      return
    }
    setBusy(true)
    try {
      // I-c + G4 #3: every Dojo tab stops syncing and refuses writes; pending changes land first (they
      // would otherwise go to the old database). The restored database gets a new id, and no tab may
      // merge its pre-restore copy into it. After the swap this copy is wiped and every tab reloads.
      const cancel = await syncControls.beginRestore()
      if (!cancel) {
        toast('Restore cancelled: some changes are not saved to disk yet. Try again when the status reads Saved.', 'danger')
        setBusy(false)
        return
      }
      const res = await f('/db/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', ...writerHeaders() }, body: JSON.stringify({ file }) }).catch(() => null)
      if (!res) {
        // Minor 2: no answer. The restore may or may not have happened: keep every tab paused and the
        // flag set; after a reload, the database id tells (finish the restore, or drop a stale flag).
        toast('Restore status unknown: the server did not answer. Reload Dojo to finish.', 'danger')
        return
      }
      if (!res.ok) {
        await cancel() // the server refused: nothing was restored
        throw new Error(String(res.status))
      }
      try {
        await syncControls.wipeLocal() // the next boot re-hydrates from the restored database
      } catch {
        // Restored on disk, but this copy is still the old one: stay paused (the flag makes the next
        // boot finish the restore without merging anything back) and ask for the reload.
        toast('Backup restored. Reload to finish restore.', 'danger')
        return
      }
      try { sessionStorage.setItem(RESTORED_KEY, `Restored ${backupLabel(b)} · ${isoMinute(b.at)}. Your earlier data is saved as Before restore.`) } catch { /* the reload itself says enough */ }
      reload()
    } catch {
      toast('Restore failed', 'danger')
      setBusy(false)
    }
  }

  return (
    <Panel title="Backups" aria-label="Backups" id="disk">
      {down ? (
        <p className="settings-note" data-testid="backups-down">
          {DESKTOP ? copy('backupsDown') : <>Backups need the Dojo server. Open Dojo from the Dock (Dojo.app), or run <code>npm run dev</code>.</>}
        </p>
      ) : (
        <>
          <p className="settings-note" data-testid="data-home">Your progress lives in <code>{where ? shownDataFile(where) : 'the Dojo data directory'}</code>. A snapshot is taken daily; the newest 30 are kept.</p>
          <div className="bk-actions">
            <Button onClick={() => void backupNow()} disabled={busy}>Back up now</Button>
          </div>
          {items && items.length === 0 && <p className="settings-note">No snapshots yet.</p>}
          <ul className="bk-list" data-testid="backup-list">
            {(items ?? []).map(b => (
              <li key={b.file} className="bk-item">
                <code className="bk-name" title={b.file}>{backupLabel(b)}</code>
                <span className="settings-meta">{Math.max(1, Math.round(b.bytes / 1024))} KB · {isoMinute(b.at)}</span>
                <Button className="sr-btn-sm" onClick={() => (syncGate.readOnly ? toast(READ_ONLY_MESSAGE, 'danger') : setConfirming(b))} disabled={busy}>Restore</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirming && <RestoreDialog backup={confirming} onConfirm={() => void restore(confirming)} onCancel={() => setConfirming(null)} />}
    </Panel>
  )
}

function RestoreDialog({ backup, onConfirm, onCancel }: { backup: BackupInfo; onConfirm: () => void; onCancel: () => void }) {
  const safe = useRef<HTMLButtonElement>(null)
  // DL12: the shared house dialog (F6.6: named by its h2, focus trapped, Esc cancels, focus returns).
  return (
    <Dialog title="Restore this backup?" testId="bk-dialog" onClose={onCancel} initialFocus={() => safe.current}>
      <p className="dl-text">{backupLabel(backup)}{backup.file.startsWith('pre-restore-') ? ` · ${isoMinute(backup.at)}` : ''}. Your current data is saved first as a pre-restore backup, then replaced.</p>
      <div className="p-actions">
        <Button variant="danger" onClick={onConfirm}>Restore</Button>
        <Button ref={safe} variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </Dialog>
  )
}

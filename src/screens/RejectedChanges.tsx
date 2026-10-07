import { useCallback, useEffect, useState } from 'react'
import { rejectedLabel, syncControls, useRejectedCount, type RejectedOp } from '../data/sync/status'
import { Button, Panel, useToast } from '../ui/primitives'
import { copy } from '../lib/platform'

/** Settings: the changes the disk server refused (I2), with a Retry. Renders nothing when there are none. */
export function RejectedChanges() {
  const toast = useToast()
  const count = useRejectedCount()
  const [rows, setRows] = useState<RejectedOp[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setRows(await syncControls.listRejected()), [])
  useEffect(() => { void load() }, [load, count])

  async function retry() {
    setBusy(true)
    try {
      const ok = await syncControls.retryRejected()
      toast(ok ? 'Retried: all changes are saved' : 'Some changes still could not be saved', ok ? undefined : 'danger')
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (rows.length === 0) return null
  return (
    <Panel title="Changes that couldn't be saved" aria-label="Changes that couldn't be saved" id="unsaved">
      <p className="settings-note">
        {rejectedLabel(rows.length)} to disk. {copy('rejectedKept')} Restoring a backup is blocked until they are saved.
      </p>
      <ul className="bk-list">
        {rows.map(r => (
          <li key={r.opId} className="bk-item">
            <code className="bk-name">{r.tbl} · {r.op}{r.id ? ` · ${r.id}` : ''}</code>
            <span className="settings-note">{r.error ?? 'refused'} · {new Date(r.at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <div className="bk-actions">
        <Button onClick={() => void retry()} disabled={busy}>Retry</Button>
      </div>
    </Panel>
  )
}

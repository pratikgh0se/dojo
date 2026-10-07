import { Link } from 'react-router-dom'
import { syncGate } from '../data/db'
import { READ_ONLY_MESSAGE } from '../data/writer'
import { NOT_WRITER_MESSAGE, rejectedLabel, SAVE_LABEL, useRejectedCount, useSaveReason, useSaveState } from '../data/sync/status'
import { copy } from '../lib/platform'

const HELP = copy('saveHelp')

/** Header indicator for disk storage, plus how many changes the server refused (I2). */
export function SaveStatus() {
  const rejected = useRejectedCount()
  const state = useSaveState()
  if (state === 'off' && rejected === 0) return null
  // UAT J2: one slot, wide enough on the desktop header for the longest label, so "Saving…" never moves the nav
  return (
    <span className="save-slot">
      <SaveState />
      {rejected > 0 && (
        <Link to="/settings#unsaved" className={`save-status save-status-offline${syncGate.readOnly ? ' save-status-readonly' : ''}`} data-testid="save-rejected">
          {rejectedLabel(rejected)}
        </Link>
      )}
    </span>
  )
}

/** Renders nothing when disk sync is not running. */
function SaveState() {
  const state = useSaveState()
  const reason = useSaveReason()
  if (state === 'off') return null
  // ruling 18 F7: an idle read-only browser has saved nothing and failed nothing: the status reads "Read-only" (warn)
  if (state === 'offline' && syncGate.readOnly && reason === READ_ONLY_MESSAGE) {
    return <Link to="/settings#disk" className="save-status save-status-readonly" data-testid="save-status" title={READ_ONLY_MESSAGE}>Read-only</Link>
  }
  if (state === 'offline') {
    return (
      <>
      <Link
        to="/settings#disk" className={`save-status save-status-offline${syncGate.readOnly ? ' save-status-readonly' : ''}`} data-testid="save-status"
        title={reason ? `${reason} ${HELP}` : HELP}
      >
        {SAVE_LABEL.offline}
      </Link>
      {reason === NOT_WRITER_MESSAGE && <span className={`save-status save-status-offline${syncGate.readOnly ? ' save-status-readonly' : ''}`} data-testid="save-hint">{NOT_WRITER_MESSAGE}</span>}
      </>
    )
  }
  // Q18: in read-only every save-status text is the warn tone
  return <span className={`save-status save-status-${state}${syncGate.readOnly ? ' save-status-readonly' : ''}`} data-testid="save-status" role="status">{SAVE_LABEL[state]}</span>
}

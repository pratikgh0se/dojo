import { useState, type FormEvent } from 'react'
import { useDb } from '../app/providers'
import { useSettings, useTickets } from '../data/hooks'
import { STORAGE_STATUS_LABEL, useStorageStatus } from '../data/persist'
import { useSaveState } from '../data/sync/status'
import { shownDataFile, useDataHome } from '../data/dataHome'
import { saveStartDate } from '../data/settingsActions'
import { isIsoDate } from '../lib/dates'
import { safeWrite } from '../data/safeWrite'
import { CORE_MINUTES_ERROR, saveCoreMinutes } from '../data/workloadActions'
import { coreMinutesOf, MAX_CORE_MINUTES, MIN_CORE_MINUTES } from '../rules/workload'
import { startDateWarning } from '../rules/onboarding'
import type { Ticket } from '../data/types'
import { useNow } from '../lib/useNow'
import { effectiveLastSprint, planPosition, unfinishedCount } from '../rules/sprint'
import { Button, Panel, useToast } from '../ui/primitives'
import { Backups } from './Backups'
import { RejectedChanges } from './RejectedChanges'
import './settings.css'
import { Loading } from '../ui/Loading'

export function Settings() {
  const settings = useSettings()
  const tickets = useTickets()
  if (!settings || !tickets) return <Loading />
  const archived = tickets.filter(t => t.archived).sort((a, b) => a.order - b.order)
  return (
    <SettingsBody
      key={settings.startDate}
      startDate={settings.startDate}
      planVersion={settings.planVersion}
      coreMinutes={coreMinutesOf(settings)}
      archived={archived}
      tickets={tickets}
    />
  )
}

function SettingsBody({
  startDate, planVersion, coreMinutes, archived, tickets,
}: { startDate: string; planVersion: string; coreMinutes: number; archived: Ticket[]; tickets: Ticket[] }) {
  const d = useDb()
  const toast = useToast()
  const t = useNow(60_000)
  const storageStatus = useStorageStatus()
  // ST1 #4: with disk sync on, the store is the SQLite file, not the browser's best-effort storage.
  const diskOn = useSaveState() !== 'off'
  // One /db/health read for the page: Storage uses it and Backups gets it as a prop (G4 review 7).
  const dataHome = useDataHome(import.meta.env.VITE_DOJO_DISK !== 'off')
  const [draft, setDraft] = useState(startDate)
  const [error, setError] = useState<string | null>(null)
  const [core, setCore] = useState(String(coreMinutes))
  const [coreError, setCoreError] = useState<string | null>(null)
  // ruling 21: a non-Monday start date gets a warn note, live as the field changes; it never blocks Save
  const warning = startDateWarning(draft)
  const lastSprint = effectiveLastSprint(tickets)
  const pos = planPosition(t, startDate, lastSprint)
  const where =
    pos.phase === 'active'
      ? `Today is sprint ${pos.sprint}, day ${pos.dayInSprint} of 14.`
      : pos.phase === 'before'
        ? `Sprint 1 starts in ${pos.daysUntil} ${pos.daysUntil === 1 ? 'day' : 'days'}.`
        : (() => {
            const unfinished = unfinishedCount(tickets)
            return unfinished > 0
              ? `All 72 sprints are complete. ${unfinished} ${unfinished === 1 ? 'ticket is' : 'tickets are'} still unfinished.`
              : 'All 72 sprints are complete.'
          })()

  async function saveStart(e: FormEvent) {
    e.preventDefault()
    const ok = await saveStartDate(d, draft, m => setError(m))
    if (ok) {
      setError(null)
      toast(`Start date set to ${draft}`)
    }
  }

  // "Core minutes per sprint" saves as soon as the value is a valid one; a half-typed number waits.
  async function changeCore(raw: string) {
    setCore(raw)
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isInteger(n) || n < MIN_CORE_MINUTES || n > MAX_CORE_MINUTES) return
    setCoreError(null)
    const r = await safeWrite(() => saveCoreMinutes(d, n), m => toast(m, 'danger'))
    if (r && !r.ok) setCoreError(r.message)
  }

  return (
    <div className="settings">
      <h1 className="screen-title">Settings</h1>
      <Panel title="Plan start">
        <form className="start-form field-row" onSubmit={saveStart} noValidate>
          {/* ST1 #1: the date reads ISO (2026-10-05) on every locale, so it is a text field with the ISO pattern. */}
          <label>
            Start date
            <input
              type="text" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="YYYY-MM-DD" autoComplete="off"
              className="date-iso" value={draft} onChange={e => { setDraft(e.target.value); if (isIsoDate(e.target.value)) setError(null) }} aria-invalid={error ? true : undefined}
              aria-describedby={warning ? 'start-date-warn' : undefined}
            />
          </label>
          <Button type="submit">Save start date</Button>
        </form>
        {error && <p role="alert" className="form-error">{error}</p>}
        {warning && <p className="form-warn" id="start-date-warn" data-testid="start-date-warn">{warning}</p>}
        <p className="settings-meta" data-testid="plan-position">{where}</p>
      </Panel>
      <Panel title="Workload">
        <label>
          Core minutes per sprint
          <input
            className="num-160" aria-invalid={coreError ? true : undefined}
            type="number" min={MIN_CORE_MINUTES} max={MAX_CORE_MINUTES} value={core}
            onChange={e => void changeCore(e.target.value)}
            onBlur={() => { const n = Number(core); if (!Number.isInteger(n) || n < MIN_CORE_MINUTES || n > MAX_CORE_MINUTES) setCoreError(CORE_MINUTES_ERROR) }}
          />
        </label>
        {coreError && <p role="alert" className="form-error">{coreError}</p>}
        <p className="settings-note">Planned minutes are held against this on Today and the Board (1440 is 24 hours).</p>
      </Panel>
      <RejectedChanges />
      <Backups dataHome={dataHome} />
      <Panel title="Plan data">
        <p className="settings-meta" data-testid="plan-version">Plan version {planVersion}</p>
        <p className="settings-meta" data-testid="storage-status">
          Storage · {diskOn ? (dataHome ? shownDataFile(dataHome) : 'on this computer') : storageStatus ? STORAGE_STATUS_LABEL[storageStatus] : 'checking…'}
        </p>
        {/* G6: the grader's local repo is a setting (DOJO_PROJECT_REPO, or projectRepo in DOJO_HOME/profile.json), unset by default */}
        {diskOn && dataHome && (
          <p className="settings-meta" data-testid="project-repo">
            Project repo · {dataHome.projectRepo ?? 'not set (DOJO_PROJECT_REPO, or "projectRepo" in profile.json in the data folder)'}
          </p>
        )}
        <h3 className="sub">Archived (plan changed) · {archived.length}</h3>
        {archived.length === 0 ? (
          <p className="settings-note">None.</p>
        ) : (
          <ul data-testid="archived-list" className="archived">
            {archived.map(a => (
              <li key={a.id}>
                <code>{a.id}</code> {a.title}{a.xp > 0 ? ` · ${a.xp} xp kept` : ''}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

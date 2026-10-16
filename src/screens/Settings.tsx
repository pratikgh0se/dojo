import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useDb, usePlanV2 } from '../app/providers'
import { useRailState } from '../app/shellActions'
import type { SettingsRow } from '../data/db'
import { shownDataFile, useDataHome } from '../data/dataHome'
import { useSettings, useTickets } from '../data/hooks'
import { STORAGE_STATUS_LABEL, useStorageStatus } from '../data/persist'
import { safeWrite } from '../data/safeWrite'
import { saveLabsRoot } from '../data/labActions'
import { saveCareerLane, saveLaneBudgets, saveNavLabels, saveSessionMinutes, saveStartDate } from '../data/settingsActions'
import { useSaveState } from '../data/sync/status'
import type { Ticket } from '../data/types'
import { isReadOnly } from '../data/writer'
import { isIsoDate } from '../lib/dates'
import { useNow } from '../lib/useNow'
import { startDateWarning } from '../rules/onboarding'
import { paceLine, projectedEnd } from '../rules/pace'
import { DAY_NAMES, parseBudget, planPositionLine } from '../rules/paceView'
import { budgetsOf, careerLaneOf, MAX_SESSION_MINUTES, MIN_SESSION_MINUTES, sessionMinutesOf, weeklyTotal } from '../rules/prefs'
import { Loading } from '../ui/Loading'
import { Button, Panel, useToast } from '../ui/primitives'
import { Backups } from './Backups'
import { DebugPom } from './DebugPom'
import { RejectedChanges } from './RejectedChanges'
import './settings.css'

export function Settings() {
  const settings = useSettings()
  const tickets = useTickets()
  if (!settings || !tickets) return <Loading />
  return <SettingsBody key={settings.startDate} settings={settings} tickets={tickets} />
}

function SettingsBody({ settings, tickets }: { settings: SettingsRow; tickets: Ticket[] }) {
  const d = useDb()
  const toast = useToast()
  const t = useNow(60_000)
  const readOnly = isReadOnly()
  const storageStatus = useStorageStatus()
  // ST1 #4: with disk sync on, the store is the SQLite file, not the browser's best-effort storage.
  const diskOn = useSaveState() !== 'off'
  // One /db/health read for the page: Storage uses it and Backups gets it as a prop (G4 review 7).
  const dataHome = useDataHome(import.meta.env.VITE_DOJO_DISK !== 'off')
  const [draft, setDraft] = useState(settings.startDate)
  const [error, setError] = useState<string | null>(null)
  // SHELL-27: the warn note shows "when it applies"; with no weekday roles it never does (rules/onboarding.ts)
  const warning = startDateWarning(draft)
  const archived = tickets.filter(x => x.archived).sort((a, b) => a.order - b.order)

  async function saveStart(e: FormEvent) {
    e.preventDefault()
    if (readOnly) return
    try {
      const ok = await saveStartDate(d, draft, m => setError(m))
      if (ok) {
        setError(null)
        toast(`Start date set to ${draft}`)
      }
    } catch {
      toast('Could not save the start date. Try again.', 'danger')
    }
  }

  return (
    <div className="settings">
      <h2 className="vh">Settings</h2>
      <Panel title="Plan start">
        <form className="start-form field-row" onSubmit={saveStart} noValidate>
          {/* ST1 #1: the date reads ISO (2026-10-05) on every locale, so it is a text field with the ISO pattern. */}
          <label>
            Start date
            <input
              type="text" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="YYYY-MM-DD" autoComplete="off"
              className="date-iso" value={draft} onChange={e => { setDraft(e.target.value); if (isIsoDate(e.target.value)) setError(null) }} aria-invalid={error ? true : undefined}
              aria-describedby={warning ? 'start-date-warn' : undefined} disabled={readOnly}
            />
          </label>
          <Button type="submit" disabled={readOnly}>Save start date</Button>
        </form>
        {error && <p role="alert" className="form-error">{error}</p>}
        {warning && <p className="form-warn" id="start-date-warn" data-testid="start-date-warn">{warning}</p>}
        <p className="settings-meta" data-testid="plan-position">{planPositionLine(settings.startDate, t)}</p>
      </Panel>
      <PaceSection settings={settings} tickets={tickets} readOnly={readOnly} />
      <PreferencesSection settings={settings} readOnly={readOnly} />
      <RejectedChanges />
      <Backups dataHome={dataHome} />
      <Panel title="Plan data">
        <p className="settings-meta" data-testid="plan-version">Plan version {settings.planVersion}</p>
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
              <li key={a.id}><code data-content="plan">{a.id}</code> <span data-content="plan">{a.title}</span>{a.xp > 0 ? ` · ${a.xp} xp kept` : ''}</li>
            ))}
          </ul>
        )}
      </Panel>
      <DebugPom />
    </div>
  )
}

/** How long typing in a budget field has to pause before it is saved (SET-03 wants the stored value within 2 s). */
const BUDGET_SAVE_MS = 500

function PaceSection({ settings, tickets, readOnly }: { settings: SettingsRow; tickets: Ticket[]; readOnly: boolean }) {
  const d = useDb()
  const toast = useToast()
  const plan = usePlanV2()
  const t = useNow(60_000)
  const stored = budgetsOf(settings, plan?.mix)
  const [fields, setFields] = useState<string[]>(() => stored.map(String))
  const [errors, setErrors] = useState<(string | null)[]>(() => stored.map(() => null))
  // the line follows what is typed, valid values only, before anything is saved
  const live = fields.map((f, i) => { const p = parseBudget(f); return p.ok ? p.value : stored[i] })
  // SET-08: one sentence for the first refused field, inside the section, gone once every field is valid
  const firstError = errors.find(Boolean) ?? null

  // SET-08: a number typed key by key passes through values that are valid on the way ("6", "60" on the way to "601"), and
  // each save writes all seven days. So the line moves at once but the save waits until the typing stops, and an invalid
  // field cancels the wait: nothing partial is ever stored.
  const pending = useRef<{ i: number; next: number[]; timer: number } | null>(null)
  const save = useRef<(next: number[], i: number) => Promise<void>>(async () => {})
  save.current = async (next, i) => {
    try {
      const r = await safeWrite(() => saveLaneBudgets(d, next), m => toast(m, 'danger'))
      if (r && !r.ok) setErrors(e => e.map((x, j) => (j === i ? r.message : x)))
    } catch {
      toast('Could not save that pace. Try again.', 'danger')
    }
  }
  const flush = () => {
    const p = pending.current
    if (!p) return
    window.clearTimeout(p.timer)
    pending.current = null
    void save.current(p.next, p.i)
  }
  const drop = () => {
    if (pending.current) window.clearTimeout(pending.current.timer)
    pending.current = null
  }
  useEffect(() => flush, []) // eslint-disable-line react-hooks/exhaustive-deps -- leaving the screen saves a typed value that is still waiting

  function change(i: number, raw: string) {
    if (readOnly) return
    setFields(f => f.map((x, j) => (j === i ? raw : x)))
    const p = parseBudget(raw)
    setErrors(e => e.map((x, j) => (j === i ? (p.ok ? null : p.message) : x)))
    if (!p.ok) { drop(); return }
    const next = live.slice()
    next[i] = p.value
    drop()
    pending.current = { i, next, timer: window.setTimeout(flush, BUDGET_SAVE_MS) }
  }

  const line = paceLine(projectedEnd({ tickets, nodes: plan?.nodes, phases: plan?.phases, budgets: live, careerLane: careerLaneOf(settings), now: t }))
  const total = weeklyTotal(live)
  return (
    <Panel title="Pace" data-testid="settings-pace">
      <div className="ps-grid">
        {DAY_NAMES.map((name, i) => (
          <label key={name} className="ps-day">
            {name}
            <span className="ps-field">
              <input
                type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" className="num-160" data-testid={`settings-budget-${i}`}
                value={fields[i]} disabled={readOnly} aria-invalid={errors[i] ? true : undefined}
                aria-describedby={errors[i] ? 'settings-pace-error' : undefined} onChange={e => change(i, e.target.value)} onBlur={flush}
              />
              <span className="settings-meta">min</span>
            </span>
          </label>
        ))}
      </div>
      {firstError && <p role="alert" className="form-error" id="settings-pace-error" data-testid="settings-pace-error">{firstError}</p>}
      <p className="settings-meta">{total} minutes a week, about {Math.round(total / 6) / 10} hours.</p>
      <p className="settings-note" data-testid="settings-pace-projection">{line}</p>
    </Panel>
  )
}

function PreferencesSection({ settings, readOnly }: { settings: SettingsRow; readOnly: boolean }) {
  const d = useDb()
  const toast = useToast()
  const rail = useRailState() // the switch shows what the rail shows, also on a first launch (labels up, `hover` stored) and after the rail's own toggle
  const [mins, setMins] = useState(String(sessionMinutesOf(settings)))
  const [minsError, setMinsError] = useState<string | null>(null)
  const [labsRoot, setLabsRoot] = useState(settings.labsRoot ?? '')
  // never rejects: safeWrite rethrows what it does not absorb, and every caller here is a fire-and-forget handler
  const run = async (f: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    if (readOnly) return undefined
    try { return await safeWrite(f, m => toast(m, 'danger')) } catch {
      toast('Could not save that setting. Try again.', 'danger')
      return undefined
    }
  }

  async function changeMins(raw: string) {
    if (readOnly) return
    setMins(raw)
    const s = raw.trim()
    const n = Number(s)
    if (!/^\d+$/.test(s) || n < MIN_SESSION_MINUTES || n > MAX_SESSION_MINUTES) {
      setMinsError(`Use a whole number from ${MIN_SESSION_MINUTES} to ${MAX_SESSION_MINUTES}.`)
      return
    }
    const r = await run(() => saveSessionMinutes(d, n))
    setMinsError(r && !r.ok ? r.message : null)
  }

  return (
    <Panel title="Preferences">
      <label className="ps-switch">
        <input type="checkbox" role="switch" data-testid="settings-nav-labels" disabled={readOnly} checked={rail ? rail.expanded : settings.navLabels === 'always'} onChange={e => { rail?.set(e.target.checked); void run(() => saveNavLabels(d, e.target.checked ? 'always' : 'hover')) }} />
        Show labels beside the navigation icons
      </label>
      <label className="ps-switch">
        <input type="checkbox" role="switch" data-testid="settings-career-lane" disabled={readOnly} checked={!!settings.careerLane} onChange={e => void run(() => saveCareerLane(d, e.target.checked))} />
        Include the Career lane
      </label>
      <label className="ps-day">
        Session length (minutes)
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" className="num-160" data-testid="settings-session-minutes"
          value={mins} disabled={readOnly} aria-invalid={minsError ? true : undefined} onChange={e => void changeMins(e.target.value)}
        />
        {minsError && <span role="alert" className="form-error">{minsError}</span>}
      </label>
      <p className="settings-note">Start on a ticket runs one timer of this length. It stops at zero and waits for you.</p>
      {/* R2: where Set up lab creates lab folders. Stored as typed; the server judges it when a lab is set up (bad_root). */}
      <label className="ps-day">
        Labs folder
        <input
          type="text" autoComplete="off" spellCheck={false} data-testid="settings-labs-root" placeholder="~/labs"
          value={labsRoot} disabled={readOnly} onChange={e => setLabsRoot(e.target.value)}
          onBlur={() => { if (!readOnly && labsRoot.trim() !== (settings.labsRoot ?? '')) void run(async () => { await saveLabsRoot(d, labsRoot); return { ok: true } }) }}
        />
      </label>
      <p className="settings-note" data-testid="settings-labs-root-help">Set up lab creates each lab's folder inside this folder in your home folder, or in ~/labs when this is empty.</p>
    </Panel>
  )
}

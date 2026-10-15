import { lazy, Suspense, useEffect, useState } from 'react'
import { db as defaultDb, syncGate, type DojoDB } from '../data/db'
import { ensurePersistence } from '../data/persist'
import { bootPlan } from '../data/flatMigration'
import { applyModelGate, isNewerModel, MODEL_GATE_MESSAGE } from '../data/modelGate'
import { loadPlan } from '../data/seed'
import type { PlanJson } from '../data/types'
import type { PlanV2 } from '../data/planV2'
import { now } from '../lib/clock'
import { PlanDataError } from '../rules/planTickets'
import { ReadOnlyBanner } from '../ui/ReadOnlyBanner'
import { Loading } from '../ui/Loading'
import { parsePartnerHash } from '../screens/designSession/partner/partnerRoute'
import type { DiskBoot } from '../data/sync/entry'
import { AppProviders } from './providers'
import { Shell } from './Shell'
import { StartGate } from './StartGate'
import { copy } from '../lib/platform'

const PartnerWindow = lazy(() => import('../screens/designSession/partner/PartnerWindow').then(m => ({ default: m.PartnerWindow })))

type Boot =
  | { status: 'loading' }
  | { status: 'error'; kind: 'plan'; error: string }
  | { status: 'error'; kind: 'storage'; error: string }
  | { status: 'error'; kind: 'disk'; error: string }
  | { status: 'ready'; plan: PlanJson; v2: PlanV2 }

/** Addendum 7: a browser without the writer token shows readonly-banner on every screen. */
export interface AppProps {
  database?: DojoDB
  fetcher?: typeof fetch
  /** Ruling 9: the pending first disk sync; the plan reconcile always runs after it. */
  disk?: Promise<DiskBoot>
  /** Ruling 9: this browser already holds a working copy, so it renders at once while `disk` is pending. */
  localCopy?: boolean
  /** Called when the stored data is from a newer model than this build knows (the window is then read-only). */
  onGated?: () => void
}

export function App(props: AppProps) {
  const [gated, setGated] = useState(false)
  return (
    <>
      <ReadOnlyBanner readOnly={!!syncGate.readOnly || gated} message={gated ? MODEL_GATE_MESSAGE : undefined} />
      <AppBody {...props} onGated={() => setGated(true)} />
    </>
  )
}

/** Ruling 8 S1 / 9: the Loading line appears only after 300 ms, so a quick boot never flashes it. */
function BootLoading() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 300)
    return () => clearTimeout(t)
  }, [])
  return shown ? <p className="loading" role="status">Loading…</p> : null
}

function AppBody({ database = defaultDb, fetcher, disk, localCopy = false, onGated }: AppProps) {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' })
  // DESIGN-114: a page already open on Dojo that is sent to `#/partner/<id>` (a hash-only change reloads nothing) must show the card, finished session or not
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    void ensurePersistence()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // N2/N5: a local copy renders the shell before bootPlan / the disk settle, on data that may be from a NEWER model.
      // The local settings read is cheap and local, so decide the gate here, before that first render and without
      // waiting for the disk: a newer copy is read-only and model-locked from its first frame. (The same check runs
      // again after the disk settles to catch a newer server copy.) A read failure is left for the main path to report.
      if (localCopy) {
        try {
          const newer = syncGate.readOnly ? await isNewerModel(database) : await applyModelGate(database, syncGate)
          if (newer && !cancelled) onGated?.()
        } catch { /* the main path below reads again and reports a storage problem */ }
      }
      const res = await loadPlan(fetcher ?? fetch)
      if (!res.ok) {
        if (!cancelled) setBoot({ status: 'error', kind: 'plan', error: res.error })
        return
      }
      if (disk) {
        // Ruling 9: a local copy shows at once; the reconcile below still waits for the disk sync.
        if (localCopy && !cancelled) setBoot({ status: 'ready', plan: res.plan, v2: res.v2 })
        const r = await disk
        if (cancelled) return
        // R7 / ruling 11 Q10: with no local copy, a server whose state could not be read is the error card, never
        // first-launch onboarding (which only an empty server state may show)
        if (!localCopy && !r.ok) return setBoot({ status: 'error', kind: 'disk', error: r.reason ?? 'The saved data could not be read.' })
      }
      try {
        // A read-only browser (no writer token) shows the disk's state as the writer left it. It still reads the model
        // version so the banner says why when the data is newer; it never writes and leaves the gate as it is.
        if (syncGate.readOnly) { if (await isNewerModel(database)) onGated?.() }
        else if (await applyModelGate(database, syncGate)) onGated?.()
        if (!syncGate.readOnly) await bootPlan(database, res, { gate: syncGate, now: now() })
      } catch (e) {
        if (!cancelled) {
          // A PlanDataError means plan.json itself is malformed — keep that message as-is.
          // Anything else surfacing from the Dexie transaction is a storage/IndexedDB
          // problem (private mode, blocked storage, quota) and gets its own message.
          if (e instanceof PlanDataError) setBoot({ status: 'error', kind: 'plan', error: e.message })
          else setBoot({ status: 'error', kind: 'storage', error: e instanceof Error ? e.message : String(e) })
        }
        return
      }
      if (!cancelled) setBoot({ status: 'ready', plan: res.plan, v2: res.v2 })
    })()
    return () => {
      cancelled = true
    }
  }, [database, fetcher, disk, localCopy])

  if (boot.status === 'loading') return <BootLoading />
  if (boot.status === 'error' && boot.kind === 'storage') {
    return (
      <main className="fatal" role="alert" data-testid="fatal">
        <div data-testid="screen-error">
          <h1>Storage problem</h1>
          <p className="fatal-msg">{copy('storageTitle')}{boot.error}</p>
          <p>{copy('storageHelp')}</p>
        </div>
      </main>
    )
  }
  if (boot.status === 'error' && boot.kind === 'disk') {
    return (
      <main className="fatal" role="alert" data-testid="fatal">
        <div data-testid="screen-error">
          <h1>Dojo couldn&apos;t start</h1>
          <p className="fatal-msg">{boot.error}</p>
          <ol className="fatal-steps">
            <li>{copy('startStep1')}</li>
            <li>{copy('startStep2')}</li>
            <li>{copy('startStep3')}</li>
          </ol>
        </div>
      </main>
    )
  }
  if (boot.status === 'error') {
    return (
      <main className="fatal" role="alert" data-testid="fatal">
        <div data-testid="screen-error">
          <h1>Plan data problem</h1>
          <p className="fatal-msg">{boot.error}</p>
          <p>Dojo will not seed a partial or empty plan. Fix <code>app/public/data/plan.json</code> and reload.</p>
        </div>
      </main>
    )
  }
  // A2: the partner card route sits before the shell, so it has no rail, tab bar, palette or number keys
  const partnerId = parsePartnerHash(hash)
  return (
    <AppProviders db={database} plan={boot.plan} planV2={boot.v2}>
      {partnerId
        ? <Suspense fallback={<Loading />}><PartnerWindow sessionId={partnerId} /></Suspense>
        : (
          <StartGate>
            <Shell />
          </StartGate>
        )}
    </AppProviders>
  )
}

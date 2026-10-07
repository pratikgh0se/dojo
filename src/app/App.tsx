import { useEffect, useState } from 'react'
import { db as defaultDb, syncGate, type DojoDB } from '../data/db'
import { ensurePersistence } from '../data/persist'
import { ensureSeedArtifacts } from '../data/projectActions'
import { loadPlan, runReconcile } from '../data/seed'
import type { PlanJson } from '../data/types'
import { now } from '../lib/clock'
import { PlanDataError } from '../rules/planTickets'
import { ReadOnlyBanner } from '../ui/ReadOnlyBanner'
import type { DiskBoot } from '../data/sync/entry'
import { AppProviders } from './providers'
import { Shell } from './Shell'
import { StartGate } from './StartGate'
import { copy } from '../lib/platform'

type Boot =
  | { status: 'loading' }
  | { status: 'error'; kind: 'plan'; error: string }
  | { status: 'error'; kind: 'storage'; error: string }
  | { status: 'error'; kind: 'disk'; error: string }
  | { status: 'ready'; plan: PlanJson }

/** Addendum 7: a browser without the writer token shows readonly-banner on every screen. */
export interface AppProps {
  database?: DojoDB
  fetcher?: typeof fetch
  /** Ruling 9: the pending first disk sync; the plan reconcile always runs after it. */
  disk?: Promise<DiskBoot>
  /** Ruling 9: this browser already holds a working copy, so it renders at once while `disk` is pending. */
  localCopy?: boolean
}

export function App(props: AppProps) {
  return (
    <>
      <ReadOnlyBanner readOnly={!!syncGate.readOnly} />
      <AppBody {...props} />
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

function AppBody({ database = defaultDb, fetcher, disk, localCopy = false }: AppProps) {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' })

  useEffect(() => {
    void ensurePersistence()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await loadPlan(fetcher ?? fetch)
      if (!res.ok) {
        if (!cancelled) setBoot({ status: 'error', kind: 'plan', error: res.error })
        return
      }
      if (disk) {
        // Ruling 9: a local copy shows at once; the reconcile below still waits for the disk sync.
        if (localCopy && !cancelled) setBoot({ status: 'ready', plan: res.plan })
        const r = await disk
        if (cancelled) return
        // R7 / ruling 11 Q10: with no local copy, a server whose state could not be read is the error card, never
        // first-launch onboarding (which only an empty server state may show)
        if (!localCopy && !r.ok) return setBoot({ status: 'error', kind: 'disk', error: r.reason ?? 'The saved data could not be read.' })
      }
      try {
        // A read-only browser (no writer token) shows the disk's state as the writer left it.
        if (!syncGate.readOnly) await runReconcile(database, res.plan)
        try {
          if (!syncGate.readOnly) await ensureSeedArtifacts(database, now())
        } catch (seedError) {
          // The AI lab artifacts are a nice-to-have seed, not core plan data — a failure here
          // (e.g. a quota-limited or otherwise unhappy IndexedDB) must not block boot.
          console.warn('ensureSeedArtifacts failed; continuing boot without seeded AI artifacts', seedError)
        }
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
      if (!cancelled) setBoot({ status: 'ready', plan: res.plan })
    })()
    return () => {
      cancelled = true
    }
  }, [database, fetcher, disk, localCopy])

  if (boot.status === 'loading') return <BootLoading />
  if (boot.status === 'error' && boot.kind === 'storage') {
    return (
      <main className="fatal" role="alert">
        <h1>Storage problem</h1>
        <p className="fatal-msg">{copy('storageTitle')}{boot.error}</p>
        <p>{copy('storageHelp')}</p>
      </main>
    )
  }
  if (boot.status === 'error' && boot.kind === 'disk') {
    return (
      <main className="fatal" role="alert" data-testid="fatal">
        <h1>Dojo couldn&apos;t start</h1>
        <p className="fatal-msg">{boot.error}</p>
        <ol className="fatal-steps">
          <li>{copy('startStep1')}</li>
          <li>{copy('startStep2')}</li>
          <li>{copy('startStep3')}</li>
        </ol>
      </main>
    )
  }
  if (boot.status === 'error') {
    return (
      <main className="fatal" role="alert">
        <h1>Plan data problem</h1>
        <p className="fatal-msg">{boot.error}</p>
        <p>Dojo will not seed a partial or empty plan. Fix <code>app/public/data/plan.json</code> and reload.</p>
      </main>
    )
  }
  return (
    <AppProviders db={database} plan={boot.plan}>
      <StartGate>
        <Shell />
      </StartGate>
    </AppProviders>
  )
}

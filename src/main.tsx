import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { db } from './data/db'
import { startDisk } from './data/sync/entry'
import { installViewportFix } from './lib/viewportFix'
import { installScrollbarGutter } from './lib/scrollbarGutter'
import './styles/tokens.css'
import './styles/app.css'
import './styles/content.css'

/** Ruling 9: a browser that already holds a working copy renders it at once, without waiting for the server. */
async function hasLocalCopy(): Promise<boolean> {
  try {
    return (await db.settings.get('main'))?.startDate ? true : false
  } catch {
    return false
  }
}

installViewportFix()
installScrollbarGutter()

async function boot() {
  // R2 v12: back up, then let the database drop the three legacy tables. Loaded on demand so it is not in the entry chunk; a failure
  // keeps the database on v11 and the app running (the step retries on the next launch). Nothing opens the database before this.
  try {
    const { prepareLegacyDrop } = await import('./data/legacyDrop')
    const r = await prepareLegacyDrop(db)
    if (r.status === 'held' && r.reason !== 'read-only browser') console.warn('dojo: the old tables stay for this launch:', r.reason)
  } catch (e) {
    console.warn('dojo: the table cleanup was skipped', e)
  }
  // Disk sync (Dojo v2 storage) reconciles with the server. startDisk lazy-loads the sync code (its own
  // chunk) and never throws. Ruling 9 (no blank screen while the first server read is pending): with a
  // local copy the app renders it at once and the plan reconcile waits for the sync; with none the app
  // shows "Loading…" (after 300 ms) until the sync is done. VITE_DOJO_DISK=off (the e2e suite's dev
  // server) runs on Dexie alone, exactly as before v2.
  const disk = import.meta.env.VITE_DOJO_DISK !== 'off' ? startDisk() : undefined
  const localCopy = disk ? await hasLocalCopy() : false
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ErrorBoundary><App disk={disk} localCopy={localCopy} /></ErrorBoundary>
      </BrowserRouter>
    </StrictMode>,
  )
}
void boot()

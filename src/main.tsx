import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app/App'
import { db } from './data/db'
import { startDisk } from './data/sync/entry'
import { setDiskSettling } from './data/diskSettled'
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
  // Disk sync (Dojo v2 storage) reconciles with the server. startDisk lazy-loads the sync code (its own
  // chunk) and never throws. Ruling 9 (no blank screen while the first server read is pending): with a
  // local copy the app renders it at once and the plan reconcile waits for the sync; with none the app
  // shows "Loading…" (after 300 ms) until the sync is done. VITE_DOJO_DISK=off (the e2e suite's dev
  // server) runs on Dexie alone, exactly as before v2.
  const disk = import.meta.env.VITE_DOJO_DISK !== 'off' ? startDisk() : undefined
  if (disk) setDiskSettling(disk)
  const localCopy = disk ? await hasLocalCopy() : false
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App disk={disk} localCopy={localCopy} />
      </BrowserRouter>
    </StrictMode>,
  )
}
void boot()

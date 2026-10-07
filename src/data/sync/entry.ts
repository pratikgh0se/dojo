// Entry-chunk side of disk sync: loads the lazy sync chunk and runs it. Tiny on purpose; on any
// failure (the chunk did not load, sync threw) the app still renders, on Dexie alone, with the
// header reading "Not saved to disk".
import { db } from '../db'
import { setSaveState } from './status'

type Loader = () => Promise<{ startDiskSync: (d: typeof db) => Promise<{ result: string } | unknown> }>

/** How the first disk sync went. `ok` false: the server's state could not be read (R7, ruling 11 Q10). */
export interface DiskBoot { ok: boolean; reason?: string }

const GOOD = new Set(['restored', 'fresh', 'kept', 'paused', 'readonly'])
const REASON: Record<string, string> = {
  unreachable: 'The Dojo server is not reachable.',
  failed: 'Reading the saved data from the Dojo server failed.',
  error: 'The disk sync stopped with an error.',
  late: 'The Dojo server is slow to answer.',
  load: 'The disk sync code failed to load.',
}
const bad = (k: string): DiskBoot => ({ ok: false, reason: REASON[k] ?? REASON.error })

/** I10: however slow the server is, the app renders after this long (sync carries on in the background). */
export const BOOT_BUDGET_MS = 10_000

export async function startDisk(load: Loader = () => import('./boot'), budgetMs = BOOT_BUDGET_MS): Promise<DiskBoot> {
  let mod: Awaited<ReturnType<Loader>>
  try {
    mod = await load()
  } catch (e) {
    console.warn('dojo: disk sync failed to load', e)
    setSaveState('offline', 'The disk sync code failed to load; reload the page.')
    return bad('load')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>(resolve => { timer = setTimeout(() => resolve('late'), budgetMs) })
  // startDiskSync never throws and reports its own status; past the budget, render anyway.
  const r = await Promise.race([mod.startDiskSync(db).then(x => String((x as { result?: unknown } | undefined)?.result ?? 'restored')), late])
  clearTimeout(timer)
  if (r === 'late') {
    setSaveState('offline', 'The Dojo server is slow to answer; still trying.')
    return bad('late')
  }
  return GOOD.has(r) ? { ok: true } : bad(r)
}

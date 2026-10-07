import { useSyncExternalStore } from 'react'
import type { AiFailure } from '../ui/ai/AiStates'

/**
 * UAT J7: "Draft briefs for Sprint N" keeps running when you leave the Board, so its progress lives
 * here, not in the Board's component state. The Board shows it inline; anywhere else the Shell shows
 * a small global indicator (ui/DraftIndicator), which ends with a completion line.
 */
export interface DraftJob {
  sprint: number
  busy: boolean
  /** The Board's inline line: "Drafting 3 of 14: <title>", then "Done". */
  text: string
  /** The indicator's line once the run has ended. */
  summary: string | null
  /** count failed of `total` cards, `drafted` drafted (UAT r3 P2: "None of the 15…" vs "n of m drafted…"). */
  failure: { error: AiFailure; count: number; total: number; drafted: number } | null
  /** The ended run was shown on the Board, or dismissed: the indicator stays away. */
  seen: boolean
  /** UAT cu-3 P3-1: a run with nothing to draft. Its line is a plain note, not a result: no Dismiss, and it is never saved. */
  noop?: boolean
}

interface DraftStore { job: DraftJob | null; inline: ReadonlyMap<number, number> }

/**
 * UAT r3 P2: how the last run ended stays until it is dismissed or a new run starts, across a reload or an
 * app relaunch too (the desktop app keeps its origin). A run still going is never saved: it dies with the page.
 */
export const DRAFT_OUTCOME_KEY = 'dojo.draftOutcome'

function loadOutcome(): DraftJob | null {
  try {
    const j = JSON.parse(localStorage.getItem(DRAFT_OUTCOME_KEY) ?? 'null') as DraftJob | null
    return j && typeof j.sprint === 'number' && typeof j.text === 'string' ? { ...j, busy: false } : null
  } catch {
    return null
  }
}

function saveOutcome(job: DraftJob | null): void {
  try {
    if (job && !job.busy && !job.noop) localStorage.setItem(DRAFT_OUTCOME_KEY, JSON.stringify(job))
    else localStorage.removeItem(DRAFT_OUTCOME_KEY)
  } catch { /* storage off: the outcome lasts for this page only */ }
}

let store: DraftStore = { job: loadOutcome(), inline: new Map() }
const subs = new Set<() => void>()

function emit(next: DraftStore): void {
  if (next.job !== store.job) saveOutcome(next.job)
  store = next
  for (const f of subs) f()
}

export function subscribeDraftJob(f: () => void): () => void {
  subs.add(f)
  return () => void subs.delete(f)
}

export function getDraftStore(): DraftStore {
  return store
}

export function useDraftStore(): DraftStore {
  return useSyncExternalStore(subscribeDraftJob, getDraftStore, getDraftStore)
}

export function setDraftJob(job: DraftJob | null): void {
  emit({ ...store, job })
}

export function patchDraftJob(patch: Partial<DraftJob>): void {
  if (store.job) emit({ ...store, job: { ...store.job, ...patch } })
}

/** The Board shows this sprint's drafting inline (registered while its DraftBriefs is mounted). */
export function isShownInline(sprint: number): boolean {
  return (store.inline.get(sprint) ?? 0) > 0
}

export function registerInline(sprint: number): () => void {
  const add = (n: number) => {
    const inline = new Map(store.inline)
    const v = (inline.get(sprint) ?? 0) + n
    if (v > 0) inline.set(sprint, v)
    else inline.delete(sprint)
    const job = store.job
    // an ended run that the Board now shows ("Done") needs no completion line elsewhere
    const seen = job && n > 0 && job.sprint === sprint && !job.busy ? { ...job, seen: true } : job
    emit({ job: seen, inline })
  }
  add(1)
  return () => add(-1)
}

export function dismissDraftJob(): void {
  patchDraftJob({ seen: true })
}

/** The Board's Dismiss: the ended run's outcome goes away everywhere. */
export function clearDraftJob(): void {
  if (store.job && !store.job.busy) setDraftJob(null)
}

/** Test hook: a fresh store per test (and the saved outcome re-read, as on a page load). */
export function resetDraftJob(): void {
  emit({ job: null, inline: new Map() })
}

/** Test hook: what a fresh page load would start with. */
export function reloadDraftJob(): void {
  emit({ job: loadOutcome(), inline: new Map() })
}

/**
 * Ruling 20 S7: why the last Draft briefs run failed (its first error code), kept across reloads and after the Board's
 * result is dismissed, until a run drafts something. Do screens without a brief say "Drafting needs Claude Code signed
 * in." while it is claude_signed_out.
 */
export const DRAFT_LAST_FAILURE_KEY = 'dojo.draftLastFailure'

export function lastDraftFailure(): string | null {
  try {
    return localStorage.getItem(DRAFT_LAST_FAILURE_KEY)
  } catch {
    return null
  }
}

export function setLastDraftFailure(code: string | null): void {
  try {
    if (code) localStorage.setItem(DRAFT_LAST_FAILURE_KEY, code)
    else localStorage.removeItem(DRAFT_LAST_FAILURE_KEY)
  } catch { /* storage off: the hint lasts for this page only */ }
}

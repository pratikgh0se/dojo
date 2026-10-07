import { readJson, removeKey, writeJson, type StorageLike } from './storage'

/**
 * What he typed on a card's Do page and has not closed yet. `notes` (DSA, design) and `repo` / `note` (AI: Repo / commit URL, Proof)
 * are the Attempt log. `sessionNotes` is the study session's Notes pad: its own field (ui-do D3.6 and D3.9 list two controls; UAT
 * cu-4 P3-10 found them sharing one), kept with the card until the attempt closes.
 */
export interface Draft { notes: string; repo: string; note: string; sessionNotes: string }
export const EMPTY_DRAFT: Draft = { notes: '', repo: '', note: '', sessionNotes: '' }

const key = (id: string) => `dojo-draft:${id}`
const str = (v: unknown) => (typeof v === 'string' ? v : '')

function isDraftLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function loadDraft(id: string, s?: StorageLike): Draft {
  const v = readJson(key(id), s, isDraftLike)
  return v ? { notes: str(v.notes), repo: str(v.repo), note: str(v.note), sessionNotes: str(v.sessionNotes) } : { ...EMPTY_DRAFT }
}

export function saveDraft(id: string, draft: Draft, s?: StorageLike): void {
  writeJson(key(id), draft, s)
}

export function clearDraft(id: string, s?: StorageLike): void {
  removeKey(key(id), s)
}

/**
 * A study session's Notes belong to that session (UAT cu-2p P3-4): once it ends they are in its row (closingNotes) and the next
 * session's box starts empty. The Attempt log and an AI card's Proof stay with the card until the attempt closes.
 */
export function dropSessionNotes(id: string, s?: StorageLike): void {
  const d = loadDraft(id, s)
  if (!d.sessionNotes) return
  const next = { ...d, sessionNotes: '' }
  if (isEmptyDraft(next)) clearDraft(id, s)
  else saveDraft(id, next, s)
}

export const isEmptyDraft = (d: Draft): boolean => d.notes === '' && d.repo === '' && d.note === '' && d.sessionNotes === ''

/**
 * The text a closed attempt keeps as the session's notes: the Attempt log (the invariant, or an AI card's Proof), then the study
 * session's Notes under their own heading when there are any. The two fields stay two on screen; they meet only here.
 */
export function closingNotes(d: Draft, isAi: boolean): string {
  const log = (isAi ? d.note : d.notes).trim()
  const pad = d.sessionNotes.trim()
  if (!pad) return log
  return log ? `${log}\n\nStudy session notes:\n${pad}` : pad
}

import { CAPSTONE_STAGES } from '../content/capstoneStages'
import type { Artifact, ArtifactStatus, Measure } from '../data/types'
import { pad2 } from '../lib/dates'
import { stageLabel } from './capstone'
import { blockOf } from './sprint'

export interface StatusStep { status: ArtifactStatus; at: number }

/**
 * An artifact row as chain P writes it. The three extra properties are optional and
 * unindexed, so Dexie stores them with no version change (spec "Data").
 */
export type ArtifactRecord = Artifact & { statusLog?: StatusStep[]; createdAt?: number; commitSummary?: string }

export const STATUS_ORDER: readonly ArtifactStatus[] = ['not started', 'building', 'runs', 'measured', 'written up']
export const STATUS_LABEL: Record<ArtifactStatus, string> = {
  'not started': 'Not started', building: 'Building', runs: 'Runs', measured: 'Measured', 'written up': 'Written up',
}
export const STATUS_SLUG: Record<ArtifactStatus, string> = {
  'not started': 'not-started', building: 'building', runs: 'runs', measured: 'measured', 'written up': 'written-up',
}

export const PASS_SCORE = 3
export const GRADE_MAX = 5
export const TITLE_MAX = 80

export const FIELD_ERRORS = {
  title: 'Title is required.',
  titleLong: 'Title is 80 characters at most.',
  repo: 'Enter an http(s) URL.',
  commit: 'A commit is 7–40 hex characters.',
  writeup: 'Use an obsidian:// link, a URL, or a .md path.',
} as const

export const GATE_MESSAGES = {
  runs: 'Runs needs a repo URL and a commit.',
  measured: 'Measured needs at least one measure.',
  writtenUp: 'Written up needs a write-up link.',
} as const

export function seedArtifactId(stage: number): string {
  return `art-stage-${pad2(stage)}`
}

export function stageName(stage: number): string {
  const s = CAPSTONE_STAGES[stage]
  return s ? `${stageLabel(stage)} · ${s.title}` : stageLabel(stage)
}

export function stageBlock(stage: number): number {
  return blockOf(CAPSTONE_STAGES[stage]?.from ?? 1)
}

export function isHttpUrl(v: string | undefined): boolean {
  if (!v) return false
  const s = v.trim()
  if (!/^https?:\/\//i.test(s)) return false
  try {
    return new URL(s).host.length > 0
  } catch {
    return false
  }
}

export function isValidCommit(v: string | undefined): boolean {
  return !!v && /^[0-9a-f]{7,40}$/i.test(v.trim())
}

/** obsidian:// link, an http(s) URL, or a vault-relative path (no scheme, not absolute) ending .md. */
export function isWriteupLink(v: string | undefined): boolean {
  if (!v) return false
  const s = v.trim()
  if (/^obsidian:\/\/\S+$/i.test(s)) return true
  if (isHttpUrl(s)) return true
  return /\.md$/i.test(s) && !s.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(s)
}

export interface ArtifactForm {
  title: string
  stage: number
  repo: string
  commit: string
  writeup: string
  note: string
  status: ArtifactStatus
}
export type FormField = 'title' | 'repo' | 'commit' | 'writeup'
export type FieldErrors = Partial<Record<FormField, string>>

export function validateForm(f: ArtifactForm): FieldErrors {
  const e: FieldErrors = {}
  const title = f.title.trim()
  if (!title) e.title = FIELD_ERRORS.title
  else if (title.length > TITLE_MAX) e.title = FIELD_ERRORS.titleLong
  if (f.repo.trim() && !isHttpUrl(f.repo)) e.repo = FIELD_ERRORS.repo
  if (f.commit.trim() && !isValidCommit(f.commit)) e.commit = FIELD_ERRORS.commit
  if (f.writeup.trim() && !isWriteupLink(f.writeup)) e.writeup = FIELD_ERRORS.writeup
  return e
}

export function formOf(a?: ArtifactRecord | null): ArtifactForm {
  return {
    title: a?.title ?? '',
    stage: a?.stage ?? 0,
    repo: a?.repo ?? '',
    commit: a?.commit ?? '',
    writeup: a?.writeup ?? '',
    note: a?.note ?? '',
    status: a?.status ?? 'not started',
  }
}

export interface Evidence { repo?: string; commit?: string; writeup?: string; measures: readonly Measure[] }

export function formEvidence(f: ArtifactForm, measures: readonly Measure[]): Evidence {
  return { repo: f.repo, commit: f.commit, writeup: f.writeup, measures }
}

const rank = (s: ArtifactStatus): number => STATUS_ORDER.indexOf(s)

/** Every gate up to and including `to`; the first failing gate's message, else null. */
export function gateFailure(ev: Evidence, to: ArtifactStatus): string | null {
  const r = rank(to)
  if (r >= rank('runs') && !(isHttpUrl(ev.repo) && isValidCommit(ev.commit))) return GATE_MESSAGES.runs
  if (r >= rank('measured') && ev.measures.length === 0) return GATE_MESSAGES.measured
  if (r >= rank('written up') && !isWriteupLink(ev.writeup)) return GATE_MESSAGES.writtenUp
  return null
}

/** Backward and same-status moves are always allowed; forward moves pass every gate up to the target. */
export function moveBlocked(ev: Evidence, from: ArtifactStatus, to: ArtifactStatus): string | null {
  return rank(to) <= rank(from) ? null : gateFailure(ev, to)
}

export function stepTarget(from: ArtifactStatus, dir: 1 | -1): ArtifactStatus | null {
  return STATUS_ORDER[rank(from) + dir] ?? null
}

export function statusLogOf(a: ArtifactRecord): StatusStep[] {
  if (a.statusLog) return a.statusLog
  return (Object.entries(a.statusAt) as [ArtifactStatus, number | undefined][])
    .filter((e): e is [ArtifactStatus, number] => typeof e[1] === 'number')
    .map(([status, at]) => ({ status, at }))
    .sort((x, y) => x.at - y.at || rank(x.status) - rank(y.status))
}

function stamp(m: Artifact['statusAt'], s: ArtifactStatus, at: number): Artifact['statusAt'] {
  const out = { ...m }
  out[s] = at
  return out
}

export function withStatus(a: ArtifactRecord, to: ArtifactStatus, nowMs: number): ArtifactRecord {
  if (a.status === to) return a
  return { ...a, status: to, statusAt: stamp(a.statusAt, to, nowMs), statusLog: [...statusLogOf(a), { status: to, at: nowMs }] }
}

export function seedArtifacts(nowMs: number): ArtifactRecord[] {
  return CAPSTONE_STAGES.map(s => ({
    id: seedArtifactId(s.stage),
    title: stageName(s.stage),
    block: stageBlock(s.stage),
    stage: s.stage,
    status: 'not started' as const,
    statusAt: stamp({}, 'not started', nowMs),
    statusLog: [{ status: 'not started' as const, at: nowMs }],
    measures: [],
    createdAt: nowMs,
  }))
}

function withFields(a: ArtifactRecord, f: ArtifactForm): ArtifactRecord {
  const next: ArtifactRecord = { ...a, title: f.title.trim(), stage: f.stage, block: stageBlock(f.stage) }
  for (const k of ['repo', 'commit', 'writeup', 'note'] as const) {
    const v = f[k].trim()
    if (v) next[k] = v
    else delete next[k]
  }
  return next
}

export function newArtifact(id: string, f: ArtifactForm, nowMs: number): ArtifactRecord {
  const base: ArtifactRecord = {
    id,
    title: f.title.trim(),
    block: stageBlock(f.stage),
    stage: f.stage,
    status: f.status,
    statusAt: stamp({}, f.status, nowMs),
    statusLog: [{ status: f.status, at: nowMs }],
    measures: [],
    userAdded: true,
    createdAt: nowMs,
  }
  return withFields(base, f)
}

/** Applies a saved dialog form. A changed repo or commit clears commitFound (Review Focus #1). */
export function applyForm(a: ArtifactRecord, f: ArtifactForm, nowMs: number): ArtifactRecord {
  const next = withFields(a, f)
  const repoChanged = (next.repo ?? '') !== (a.repo ?? '')
  const commitChanged = (next.commit ?? '').toLowerCase() !== (a.commit ?? '').toLowerCase()
  if (repoChanged || commitChanged) delete next.commitFound
  return withStatus(next, f.status, nowMs)
}

export function createdAtOf(a: ArtifactRecord): number {
  if (typeof a.createdAt === 'number') return a.createdAt
  const ts = Object.values(a.statusAt).filter((x): x is number => typeof x === 'number')
  return ts.length ? Math.min(...ts) : 0
}

export function sortArtifacts(list: readonly ArtifactRecord[]): ArtifactRecord[] {
  return [...list].sort(
    (x, y) =>
      (x.stage ?? 99) - (y.stage ?? 99) ||
      createdAtOf(x) - createdAtOf(y) ||
      Number(!!x.userAdded) - Number(!!y.userAdded) ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  )
}

export function boardColumns(list: readonly ArtifactRecord[]): Record<ArtifactStatus, ArtifactRecord[]> {
  const out = {} as Record<ArtifactStatus, ArtifactRecord[]>
  for (const s of STATUS_ORDER) out[s] = []
  for (const a of sortArtifacts(list)) out[a.status].push(a)
  return out
}

export function latestMeasure(a: ArtifactRecord): Measure | null {
  return a.measures.length ? a.measures[a.measures.length - 1] : null
}

export function gradePassed(score: number): boolean {
  return score >= PASS_SCORE
}

/** README done rule: repo + checked commit + passing stored grade. Independent of status. */
export function isDone(a: ArtifactRecord): boolean {
  return isHttpUrl(a.repo) && isValidCommit(a.commit) && a.commitFound === true && typeof a.grade === 'number' && gradePassed(a.grade)
}

export function isMeasuredStatus(s: ArtifactStatus): boolean {
  return s === 'measured' || s === 'written up'
}

export function rungMeasured(list: readonly ArtifactRecord[], stage: number): boolean {
  const a = list.find(x => x.id === seedArtifactId(stage))
  return !!a && isMeasuredStatus(a.status)
}

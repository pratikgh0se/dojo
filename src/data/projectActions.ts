import { newId } from '../lib/id'
import {
  applyForm, formEvidence, gateFailure, moveBlocked, newArtifact, seedArtifacts, validateForm, withStatus,
  type ArtifactForm, type ArtifactRecord,
} from '../rules/artifacts'
import { makeMeasure, validateMeasure, type MeasureInput } from '../rules/measures'
import { blankMinutes } from '../rules/stageCubes'
import type { DojoDB } from './db'
import type { ArtifactStatus, BlankTest } from './types'

export const ARTIFACT_MISSING = 'That artifact no longer exists.'
export const MEASURE_MISSING = 'That measure no longer exists.'

export type ArtifactResult = { ok: true; artifact: ArtifactRecord } | { ok: false; message: string }

const fail = (message: string): ArtifactResult => ({ ok: false, message })
const firstError = (e: Partial<Record<string, string>>): string | null =>
  Object.values(e).find((x): x is string => typeof x === 'string') ?? null

async function getRecord(d: DojoDB, id: string): Promise<ArtifactRecord | undefined> {
  return (await d.artifacts.get(id)) as ArtifactRecord | undefined
}

/** Adds whichever of art-stage-00…11 are missing. Idempotent; safe to call on every boot. */
export async function ensureSeedArtifacts(d: DojoDB, nowMs: number): Promise<number> {
  return d.transaction('rw', d.artifacts, async () => {
    const have = new Set(await d.artifacts.toCollection().primaryKeys())
    const missing = seedArtifacts(nowMs).filter(a => !have.has(a.id))
    if (missing.length) await d.artifacts.bulkAdd(missing)
    return missing.length
  })
}

export async function createArtifact(d: DojoDB, form: ArtifactForm, nowMs: number): Promise<ArtifactResult> {
  const err = firstError(validateForm(form))
  if (err) return fail(err)
  const gate = gateFailure(formEvidence(form, []), form.status)
  if (gate) return fail(gate)
  const a = newArtifact(newId('art', nowMs), form, nowMs)
  await d.artifacts.add(a)
  return { ok: true, artifact: a }
}

export async function updateArtifact(d: DojoDB, id: string, form: ArtifactForm, nowMs: number): Promise<ArtifactResult> {
  return d.transaction('rw', d.artifacts, async (): Promise<ArtifactResult> => {
    const a = await getRecord(d, id)
    if (!a) return fail(ARTIFACT_MISSING)
    const err = firstError(validateForm(form))
    if (err) return fail(err)
    const gate = moveBlocked(formEvidence(form, a.measures), a.status, form.status)
    if (gate) return fail(gate)
    const next = applyForm(a, form, nowMs)
    await d.artifacts.put(next)
    return { ok: true, artifact: next }
  })
}

export async function moveArtifact(d: DojoDB, id: string, to: ArtifactStatus, nowMs: number): Promise<ArtifactResult> {
  return d.transaction('rw', d.artifacts, async (): Promise<ArtifactResult> => {
    const a = await getRecord(d, id)
    if (!a) return fail(ARTIFACT_MISSING)
    const gate = moveBlocked(a, a.status, to)
    if (gate) return fail(gate)
    const next = withStatus(a, to, nowMs)
    if (next !== a) await d.artifacts.put(next)
    return { ok: true, artifact: next }
  })
}

/** Seeded artifacts cannot be deleted (C-PROJECTS §2.4). */
export async function deleteArtifact(d: DojoDB, id: string): Promise<boolean> {
  return d.transaction('rw', d.artifacts, async () => {
    const a = await getRecord(d, id)
    if (!a || !a.userAdded) return false
    await d.artifacts.delete(id)
    return true
  })
}

export async function addMeasure(
  d: DojoDB, id: string, input: MeasureInput, nowMs: number, startDate: string,
): Promise<ArtifactResult> {
  const err = firstError(validateMeasure(input))
  if (err) return fail(err)
  return d.transaction('rw', d.artifacts, async (): Promise<ArtifactResult> => {
    const a = await getRecord(d, id)
    if (!a) return fail(ARTIFACT_MISSING)
    const next: ArtifactRecord = { ...a, measures: [...a.measures, makeMeasure(input, nowMs, startDate)] }
    await d.artifacts.put(next)
    return { ok: true, artifact: next }
  })
}

/** Removing evidence never moves the card: gates guard moves, not history (C-PROJECTS scenario 20). */
export async function removeMeasure(d: DojoDB, id: string, index: number): Promise<ArtifactResult> {
  return d.transaction('rw', d.artifacts, async (): Promise<ArtifactResult> => {
    const a = await getRecord(d, id)
    if (!a) return fail(ARTIFACT_MISSING)
    if (index < 0 || index >= a.measures.length) return fail(MEASURE_MISSING)
    const next: ArtifactRecord = { ...a, measures: a.measures.filter((_, i) => i !== index) }
    await d.artifacts.put(next)
    return { ok: true, artifact: next }
  })
}

export interface BlankTestInput { stage: number; piece: string; startedAt: number; outcome: BlankTest['outcome'] }

export async function recordBlankTest(d: DojoDB, input: BlankTestInput, nowMs: number): Promise<BlankTest> {
  const b: BlankTest = {
    id: newId('blank', nowMs),
    stage: input.stage,
    piece: input.piece.trim(),
    at: input.startedAt,
    minutes: blankMinutes(input.startedAt, nowMs),
    outcome: input.outcome,
  }
  await d.blankTests.add(b)
  return b
}

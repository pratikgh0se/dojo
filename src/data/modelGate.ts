import { getSettings, type DojoDB } from './db'
import type { SyncGate } from './sync/middleware'

/** The document model this build understands (1 = split containers and sprint buckets, 2 = the flat queue). */
export const APP_MODEL_VERSION = 2
export const MODEL_GATE_MESSAGE = 'This data was upgraded by a newer Dojo, so this window is read-only. Update Dojo to make changes.'

export const modelVersionOf = (s: { modelVersion?: number }): number => s.modelVersion ?? 1

/** True when the stored data is from a model newer than this build knows. Reads only. */
export async function isNewerModel(d: DojoDB): Promise<boolean> {
  return modelVersionOf(await getSettings(d)) > APP_MODEL_VERSION
}

/** True (and the gate goes read-only) when the stored data is from a model newer than this build knows. */
export async function applyModelGate(d: DojoDB, gate: SyncGate): Promise<boolean> {
  if (!(await isNewerModel(d))) return false
  gate.readOnly = true
  gate.modelLocked = true
  return true
}

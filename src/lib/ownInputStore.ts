// Own input is remembered per walkthrough until Reset to default (labs contract §4.6, §8). It is a per-browser
// convenience like the Do draft, so it lives in localStorage (no schema change).
import { readJson, removeKey, writeJson } from './storage'

const KEY = (walk: string) => `dojo-lab-input:${walk}`
const isRaw = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every(x => typeof x === 'string')

export function loadOwnRaw(walk: string): Record<string, string> | null {
  return readJson(KEY(walk), undefined, isRaw)
}

export function saveOwnRaw(walk: string, raw: Record<string, string>): void {
  writeJson(KEY(walk), raw)
}

export function clearOwnRaw(walk: string): void {
  removeKey(KEY(walk))
}

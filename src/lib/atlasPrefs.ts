// The Atlas "Sort by problems left" toggle survives reload (labs contract §5.3, §8): a per-browser view preference.
import { readJson, writeJson } from './storage'

const KEY = 'dojo-atlas-sort-left'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

export function loadSortLeft(): boolean {
  return readJson(KEY, undefined, isBool) ?? false
}

export function saveSortLeft(on: boolean): void {
  writeJson(KEY, on)
}

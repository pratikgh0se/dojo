import { useLiveQuery } from 'dexie-react-hooks'
import type { ArtifactRecord } from '../rules/artifacts'
import { useDb } from './dbContext'
import type { BlankTest } from './types'

export function useArtifacts(): ArtifactRecord[] | undefined {
  const d = useDb()
  return useLiveQuery(async () => (await d.artifacts.toArray()) as ArtifactRecord[], [d])
}

export function useBlankTests(): BlankTest[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.blankTests.toArray(), [d])
}

import { describe, expect, it } from 'vitest'
import { snapshotFileName, wrapCaption } from '../../src/lib/snapshot'

describe('snapshot helpers (labs contract §4.7, D-11)', () => {
  it('names the file dojo-<key-in-kebab>-step-<k>-of-<n>.png', () => {
    expect(snapshotFileName('binarySearch', 13, 13)).toBe('dojo-binary-search-step-13-of-13.png')
    expect(snapshotFileName('dijkstra', 3, 51)).toBe('dojo-dijkstra-step-3-of-51.png')
    expect(snapshotFileName('bellmanFord', 0, 54)).toBe('dojo-bellman-ford-step-0-of-54.png')
  })
  it('wraps the caption by words', () => {
    expect(wrapCaption('Compare 5 with 1 and swap them now', 12)).toEqual(['Compare 5', 'with 1 and', 'swap them', 'now'])
    expect(wrapCaption('', 10)).toEqual([])
    expect(wrapCaption('supercalifragilistic word', 5)).toEqual(['supercalifragilistic', 'word'])
  })
})

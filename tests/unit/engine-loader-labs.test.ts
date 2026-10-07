import { beforeEach, describe, expect, it } from 'vitest'
import { loadAlgoEngines, resetEnginesForTest } from '../../src/lib/engines'
import { installAlgoEngines } from '../helpers/engines'

const scripts = () => [...document.head.querySelectorAll('script[data-engine]')].map(s => s.getAttribute('src'))

describe('loadAlgoEngines', () => {
  beforeEach(() => {
    resetEnginesForTest()
    document.head.querySelectorAll('script[data-engine]').forEach(s => s.remove())
  })

  it('asks for algo.js, algo2.js and atlas-pieces.js once each', () => {
    void loadAlgoEngines()
    void loadAlgoEngines()
    expect(scripts()).toEqual(['/engines/algo.js', '/engines/algo2.js', '/engines/atlas-pieces.js'])
  })

  it('resolves without a request once the engines have run', async () => {
    installAlgoEngines()
    await expect(loadAlgoEngines()).resolves.toBeUndefined()
    expect(scripts()).toEqual([])
  })
})

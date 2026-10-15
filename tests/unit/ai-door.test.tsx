import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setNow } from '../../src/lib/clock'
import { AtlasSearch } from '../../src/screens/atlas/AtlasSearch'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const SRC = join(process.cwd(), 'src')
const ALLOWED = new Set(['ai/client.ts', 'data/aiActions.ts'])
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}
const T = new Date('2026-10-06T21:10:00+05:30').getTime()

describe('one AI door', () => {
  it('only ai/client.ts and data/aiActions.ts import runJob', () => {
    const importsRunJob = /import\s*\{[^}]*\brunJob\b[^}]*\}\s*from\s*['"][^'"]*ai\/client['"]/
    const offenders = walk(SRC).map(f => relative(SRC, f)).filter(f => !ALLOWED.has(f) && importsRunJob.test(readFileSync(join(SRC, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('Atlas classify search writes one aiLog row', async () => {
    setNow(() => T)
    const d = await seededDb()
    renderWithApp(<AtlasSearch query="zzzz" onQuery={() => {}} visible={[]} onPick={() => {}} />, { db: d, plan: flatPlanV2 })
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search patterns or problems' }), { key: 'Enter' })
    await waitFor(async () => expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['classify']))
  })
})

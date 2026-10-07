import { screen } from '@testing-library/react'
import type { DojoDB } from '../../src/data/db'
import { createArtifact, ensureSeedArtifacts } from '../../src/data/projectActions'
import { setNow } from '../../src/lib/clock'
import { formOf, type ArtifactForm } from '../../src/rules/artifacts'
import { Ai } from '../../src/screens/Ai'
import { seededDb } from './db'
import { realPlan } from './plan'
import { renderWithApp } from './render'

export const ist = (s: string) => new Date(`${s}+05:30`).getTime()
export const OCT14 = ist('2026-10-14T10:00:00')
export const PLAN = realPlan()
export const REPO = 'https://github.com/example-user/forge'

/** Live plan, start 2026-10-05, the 12 artifacts seeded at `at`. */
export async function projectDb(at = OCT14): Promise<DojoDB> {
  const d = await seededDb(PLAN, '2026-10-05')
  await ensureSeedArtifacts(d, at)
  return d
}

export async function renderAi(opts: { at?: number; route?: string; db?: DojoDB } = {}): Promise<DojoDB> {
  const at = opts.at ?? OCT14
  setNow(() => at)
  const d = opts.db ?? (await projectDb(at))
  renderWithApp(<Ai />, { db: d, plan: PLAN, route: opts.route ?? '/ai', path: '/ai' })
  await screen.findByRole('region', { name: 'Evidence' })
  return d
}

export async function addUserArtifact(d: DojoDB, p: Partial<ArtifactForm> & { title: string }, at = OCT14): Promise<string> {
  const res = await createArtifact(d, { ...formOf(null), ...p }, at)
  if (!res.ok) throw new Error(res.message)
  return res.artifact.id
}

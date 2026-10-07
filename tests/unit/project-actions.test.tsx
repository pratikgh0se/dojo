// app/tests/unit/project-actions.test.tsx
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/app/App'
import {
  addMeasure, ARTIFACT_MISSING, createArtifact, deleteArtifact, ensureSeedArtifacts, moveArtifact, recordBlankTest,
  removeMeasure, updateArtifact,
} from '../../src/data/projectActions'
import { setNow } from '../../src/lib/clock'
import { formOf, GATE_MESSAGES, type ArtifactForm, type ArtifactRecord } from '../../src/rules/artifacts'
import { freshDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T0 = ist('2026-10-14T10:00:00')
const REPO = 'https://github.com/example-user/forge'
const form = (p: Partial<ArtifactForm> = {}): ArtifactForm => ({ ...formOf(null), title: 'micrograd engine', stage: 1, ...p })
const serve = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response)
const get = async (d: ReturnType<typeof freshDb>, id: string) => (await d.artifacts.get(id)) as ArtifactRecord

async function created(d: ReturnType<typeof freshDb>, p: Partial<ArtifactForm> = {}): Promise<string> {
  const res = await createArtifact(d, form(p), T0)
  if (!res.ok) throw new Error(res.message)
  return res.artifact.id
}

describe('ensureSeedArtifacts', () => {
  it('adds the 12 seeded artifacts once', async () => {
    const d = freshDb()
    expect(await ensureSeedArtifacts(d, T0)).toBe(12)
    expect(await ensureSeedArtifacts(d, T0 + 5)).toBe(0)
    expect(await d.artifacts.count()).toBe(12)
    expect((await get(d, 'art-stage-03')).title).toBe('Stage 03 · GPT')
  })

  it('re-adds only a missing seed and leaves edited ones alone', async () => {
    const d = freshDb()
    await ensureSeedArtifacts(d, T0)
    await d.artifacts.update('art-stage-00', { repo: REPO })
    await d.artifacts.delete('art-stage-05')
    expect(await ensureSeedArtifacts(d, T0 + 9)).toBe(1)
    expect((await get(d, 'art-stage-00')).repo).toBe(REPO)
  })

  it('App boot seeds the artifacts after the plan loads', async () => {
    setNow(() => T0)
    const d = freshDb()
    render(<MemoryRouter><App database={d} fetcher={serve(smallPlan)} /></MemoryRouter>)
    await waitFor(async () => expect(await d.artifacts.count()).toBe(12))
  })
})

describe('create, update, move, delete', () => {
  it('creates a user artifact; invalid fields or a failed gate write nothing', async () => {
    const d = freshDb()
    expect(await createArtifact(d, form({ title: '' }), T0)).toEqual({ ok: false, message: 'Title is required.' })
    expect(await createArtifact(d, form({ repo: 'github.com/x' }), T0)).toEqual({ ok: false, message: 'Enter an http(s) URL.' })
    expect(await createArtifact(d, form({ status: 'runs' }), T0)).toEqual({ ok: false, message: GATE_MESSAGES.runs })
    expect(await d.artifacts.count()).toBe(0)
    const id = await created(d, { repo: REPO, commit: 'a1b2c3d' })
    expect(id).toMatch(/^art-/)
    expect(await get(d, id)).toMatchObject({ title: 'micrograd engine', stage: 1, userAdded: true, status: 'not started', repo: REPO, commit: 'a1b2c3d' })
  })

  it('moves forward through gates, backward freely, and keeps evidence', async () => {
    const d = freshDb()
    await ensureSeedArtifacts(d, T0)
    expect(await moveArtifact(d, 'art-stage-00', 'runs', T0)).toEqual({ ok: false, message: 'Runs needs a repo URL and a commit.' })
    expect((await get(d, 'art-stage-00')).status).toBe('not started')
    const id = await created(d, { repo: REPO, commit: 'a1b2c3d' })
    expect((await moveArtifact(d, id, 'building', T0 + 1)).ok).toBe(true)
    expect((await moveArtifact(d, id, 'runs', T0 + 2)).ok).toBe(true)
    expect(await moveArtifact(d, id, 'measured', T0 + 3)).toEqual({ ok: false, message: 'Measured needs at least one measure.' })
    expect((await moveArtifact(d, id, 'not started', T0 + 4)).ok).toBe(true)
    const a = await get(d, id)
    expect(a).toMatchObject({ status: 'not started', repo: REPO, commit: 'a1b2c3d' })
    expect(a.statusLog?.map(s => s.status)).toEqual(['not started', 'building', 'runs', 'not started'])
    expect(await moveArtifact(d, 'nope', 'building', T0)).toEqual({ ok: false, message: ARTIFACT_MISSING })
  })

  it('updates through the dialog form with the same gates, from the saved status', async () => {
    const d = freshDb()
    const id = await created(d)
    expect(await updateArtifact(d, id, form({ status: 'runs' }), T0)).toEqual({ ok: false, message: GATE_MESSAGES.runs })
    const res = await updateArtifact(d, id, form({ status: 'runs', repo: REPO, commit: 'a1b2c3d', note: 'runs on 3 nodes' }), T0 + 1)
    expect(res.ok).toBe(true)
    expect(await get(d, id)).toMatchObject({ status: 'runs', note: 'runs on 3 nodes' })
  })

  it('deletes only user-added artifacts', async () => {
    const d = freshDb()
    await ensureSeedArtifacts(d, T0)
    expect(await deleteArtifact(d, 'art-stage-00')).toBe(false)
    const id = await created(d)
    expect(await deleteArtifact(d, id)).toBe(true)
    expect(await d.artifacts.count()).toBe(12)
    expect(await deleteArtifact(d, id)).toBe(false)
  })
})

describe('measures and blank tests', () => {
  it('adds measures with the sprint at the time; removes by index', async () => {
    const d = freshDb()
    const id = await created(d)
    expect(await addMeasure(d, id, { choice: 'loss', name: '', value: '', unit: '' }, T0, '2026-10-05'))
      .toEqual({ ok: false, message: 'Enter a number.' })
    await addMeasure(d, id, { choice: 'loss', name: '', value: '1.98', unit: '' }, T0, '2026-10-05')
    await addMeasure(d, id, { choice: 'tokens/sec', name: '', value: '412', unit: 'tok/s' }, ist('2026-10-20T10:00:00'), '2026-10-05')
    expect((await get(d, id)).measures).toEqual([
      { name: 'loss', value: 1.98, unit: '', at: T0, sprint: 1 },
      { name: 'tokens/sec', value: 412, unit: 'tok/s', at: ist('2026-10-20T10:00:00'), sprint: 2 },
    ])
    await removeMeasure(d, id, 0)
    expect((await get(d, id)).measures.map(m => m.name)).toEqual(['tokens/sec'])
    expect((await removeMeasure(d, id, 5)).ok).toBe(false)
  })

  it('records a blank test with its start time and whole minutes', async () => {
    const d = freshDb()
    const b = await recordBlankTest(d, { stage: 1, piece: '  micrograd backward pass ', startedAt: T0, outcome: 'not_yet' }, T0 + 61_000)
    expect(b).toMatchObject({ stage: 1, piece: 'micrograd backward pass', at: T0, minutes: 1, outcome: 'not_yet' })
    expect(b.id).toMatch(/^blank-/)
    expect(await d.blankTests.toArray()).toEqual([b])
  })
})

import type { BlankTest, StageSession, Ticket } from '../data/types'
import { addLocalDays, pad2 } from '../lib/dates'
import { gradePassed, isMeasuredStatus, isValidCommit, type ArtifactRecord } from './artifacts'
import { STAGE_COUNT } from './capstone'

export type Cell = 'learn' | 'build' | 'prove'
export type CubeState = 'empty' | 'partial' | 'full'
export interface Cube { cell: Cell; state: CubeState; done: number; total: number; needs: string | null }
export interface StageCubes { stage: number; learn: Cube; build: Cube; prove: Cube; complete: boolean }
export type LearnColumn = 'queued' | 'watched' | 'built' | 'proven'

export const CELLS: readonly Cell[] = ['learn', 'build', 'prove']
/** Accessible names of the stage-detail session cubes (C-PROJECTS §2.7). */
export const SESSION_NAMES: Record<StageSession, string> = { watch: 'Watch', rebuild: 'Rebuild', build: 'Build', teachback: 'Teachback' }
export const NEEDS = { build: '— needs a commit', prove: '— needs a grade or blank test' } as const
export const LEARN_COLUMNS: readonly LearnColumn[] = ['queued', 'watched', 'built', 'proven']
export const LEARN_LABEL: Record<LearnColumn, string> = { queued: 'Queued', watched: 'Watched', built: 'Built', proven: 'Proven' }
export const BLANK_TEST_MINUTES = 25
export const BLANK_REDO_DAYS = 10

function tally(tickets: readonly Ticket[], stage: number, session: StageSession): { done: number; total: number } {
  const mine = tickets.filter(t => !t.archived && t.childOf === undefined && t.kind === 'stage' && t.stage === stage && t.session === session)
  return { done: mine.filter(t => t.status === 'done').length, total: mine.length }
}

/** proof === null: Learn (tickets only). Otherwise the extra evidence part of Build / Prove. */
function cube(cell: Cell, t: { done: number; total: number }, proof: boolean | null): Cube {
  const allDone = t.total > 0 && t.done === t.total
  if (proof === null) {
    return { cell, ...t, needs: null, state: allDone ? 'full' : t.done > 0 ? 'partial' : 'empty' }
  }
  const state: CubeState = allDone && proof ? 'full' : t.done > 0 || proof ? 'partial' : 'empty'
  const needs = allDone && !proof ? (cell === 'build' ? NEEDS.build : NEEDS.prove) : null
  return { cell, ...t, state, needs }
}

export function stageCubes(
  stage: number, tickets: readonly Ticket[], artifacts: readonly ArtifactRecord[], blankTests: readonly BlankTest[],
): StageCubes {
  const mine = artifacts.filter(a => a.stage === stage)
  const hasCommit = mine.some(a => isValidCommit(a.commit))
  const proven =
    mine.some(a => typeof a.grade === 'number' && gradePassed(a.grade)) ||
    blankTests.some(b => b.stage === stage && b.outcome === 'solved')
  const learn = cube('learn', tally(tickets, stage, 'watch'), null)
  const build = cube('build', tally(tickets, stage, 'build'), hasCommit)
  const prove = cube('prove', tally(tickets, stage, 'teachback'), proven)
  return { stage, learn, build, prove, complete: learn.state === 'full' && build.state === 'full' && prove.state === 'full' }
}

export function allStageCubes(
  tickets: readonly Ticket[], artifacts: readonly ArtifactRecord[], blankTests: readonly BlankTest[],
): StageCubes[] {
  return Array.from({ length: STAGE_COUNT }, (_, s) => stageCubes(s, tickets, artifacts, blankTests))
}

export function cubeName(stage: number, c: Cube): string {
  return `Stage ${pad2(stage)} ${c.cell}: ${c.state} (${c.done}/${c.total})${c.needs ? ` ${c.needs}` : ''}`
}

export function learnColumn(c: StageCubes): LearnColumn {
  if (c.learn.state !== 'full') return 'queued'
  if (c.build.state !== 'full') return 'watched'
  if (c.prove.state !== 'full') return 'built'
  return 'proven'
}

export function learnBoard(cubes: readonly StageCubes[]): Record<LearnColumn, StageCubes[]> {
  const out = {} as Record<LearnColumn, StageCubes[]>
  for (const k of LEARN_COLUMNS) out[k] = []
  for (const c of cubes) out[learnColumn(c)].push(c)
  return out
}

export interface EvidenceCounts { stages: number; measured: number; artifacts: number; blank: number }

export function evidenceCounts(
  cubes: readonly StageCubes[], artifacts: readonly ArtifactRecord[], blankTests: readonly BlankTest[],
): EvidenceCounts {
  return {
    stages: cubes.filter(c => c.complete).length,
    measured: artifacts.filter(a => isMeasuredStatus(a.status)).length,
    artifacts: artifacts.length,
    blank: blankTests.filter(b => b.outcome === 'solved').length,
  }
}

export function latestBlankTest(tests: readonly BlankTest[], stage: number): BlankTest | null {
  const mine = tests.filter(b => b.stage === stage).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1))
  return mine.length ? mine[mine.length - 1] : null
}

export function blankRedoDue(b: BlankTest): number {
  return addLocalDays(b.at, BLANK_REDO_DAYS)
}

export function countdown(startedAt: number, nowMs: number): { text: string; over: boolean } {
  const total = BLANK_TEST_MINUTES * 60
  const left = Math.max(0, total - Math.floor(Math.max(0, nowMs - startedAt) / 1000))
  return { text: `${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`, over: left === 0 }
}

export function blankMinutes(startedAt: number, nowMs: number): number {
  return Math.min(BLANK_TEST_MINUTES, Math.max(0, Math.round((nowMs - startedAt) / 60_000)))
}

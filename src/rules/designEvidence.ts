import { LENSES, type Lens, type Score012 } from '../ai/types'
import { KIT_KINDS } from '../content/diagramKit'
import type { DesignSession } from '../data/types'
import { localDayKey } from '../lib/dates'
import type { PlanDesignRef } from './designs'
import { LENS_LABELS } from './designSession'

/** TRACKING §1: lens strength is the mean of the last 6 sessions. */
export const LAST_N = 6
export const WALL_ROWS = 4

export function doneSessions(all: DesignSession[]): DesignSession[] {
  return all
    .filter(s => s.phase === 'done')
    .sort((a, b) => (a.endedAt ?? a.at) - (b.endedAt ?? b.at) || a.at - b.at)
}

export type LensValues = Record<Lens, number | null>
const round2 = (v: number) => Math.round(v * 100) / 100

function meanOf(sessions: DesignSession[], lens: Lens): number | null {
  const vals = sessions.map(s => s.lenses[lens]).filter((v): v is Score012 => v !== undefined)
  return vals.length ? round2(vals.reduce<number>((a, b) => a + b, 0) / vals.length) : null
}

const valuesOf = (sessions: DesignSession[]): LensValues =>
  Object.fromEntries(LENSES.map(l => [l, meanOf(sessions, l)])) as LensValues

export function lensStats(done: DesignSession[]): { last6: LensValues; mean: LensValues } {
  return { last6: valuesOf(done.slice(-LAST_N)), mean: valuesOf(done) }
}

const one = (v: number | null) => (v === null ? '–' : v.toFixed(1))
const lensList = (vals: LensValues) => LENSES.map(l => `${LENS_LABELS[l]} ${one(vals[l])}`).join(', ')

export function radarLabel(stats: { last6: LensValues; mean: LensValues }, count: number): string {
  if (count === 0) return 'Lens radar · No sessions yet'
  return `Lens radar · last 6: ${lensList(stats.last6)} · all-time: ${lensList(stats.mean)}`
}

export function radarJson(vals: LensValues, count: number): Partial<Record<Lens, number>> {
  if (count === 0) return {}
  return Object.fromEntries(LENSES.map(l => [l, vals[l] ?? 0])) as Record<Lens, number>
}

/** charts.js `radial` reads 0–100; series order [all-time mean, last 6] so the accent polygon draws on top. */
export function radarData(stats: { last6: LensValues; mean: LensValues }, count: number): { axes: string[]; series: number[][] } {
  const scaled = (v: LensValues) => LENSES.map(l => (v[l] ?? 0) * 50)
  return { axes: LENSES.map(l => LENS_LABELS[l]), series: count === 0 ? [] : [scaled(stats.mean), scaled(stats.last6)] }
}

export type WallState = 'none' | 'glow' | 'ok'
const WALL_WORDS: Record<WallState, string> = { none: 'not answered', glow: 'hand-wave', ok: 'answered' }
export interface WallCell { designId: string; title: string; dive: number; state: WallState; name: string; sessionId: string | null }

/** 4 rows (deep dive 1–4) × one column per design in plan order; each cell keeps the best score ever. */
export function wallRows(designs: PlanDesignRef[], done: DesignSession[]): WallCell[][] {
  const best = new Map<string, number>()
  const latest = new Map<string, string>()
  for (const s of done) {
    latest.set(s.designId, s.id)
    s.deepDives.forEach((d, i) => {
      if (d.answered === null) return
      const key = `${s.designId}:${i + 1}`
      best.set(key, Math.max(best.get(key) ?? 0, d.answered))
    })
  }
  return Array.from({ length: WALL_ROWS }, (_, r) => r + 1).map(dive =>
    designs.map(ds => {
      const b = best.get(`${ds.id}:${dive}`) ?? 0
      const state: WallState = b === 2 ? 'ok' : b === 1 ? 'glow' : 'none'
      return { designId: ds.id, title: ds.title, dive, state, name: `${ds.title} · deep dive ${dive} · ${WALL_WORDS[state]}`, sessionId: latest.get(ds.id) ?? null }
    }),
  )
}

export function wallAnswered(rows: WallCell[][]): number {
  return rows.flat().filter(c => c.state === 'ok').length
}

export function lensSeries(done: DesignSession[]): Record<Lens, number[]> {
  return Object.fromEntries(
    LENSES.map(l => [l, done.map(s => s.lenses[l]).filter((v): v is Score012 => v !== undefined)]),
  ) as Record<Lens, number[]>
}

export function sparkLabel(lens: Lens, values: number[]): string {
  return `${LENS_LABELS[lens]} trend: ${values.length ? values.join(', ') : 'No sessions yet'}`
}

export interface ShelfThumb { sessionId: string; designId: string; title: string; date: string; nodes: number; canvas: DesignSession['canvas']; name: string }
export interface ShelfTier { tier: number; label: string; thumbs: ShelfThumb[] }

export function shelfTiers(designs: PlanDesignRef[], done: DesignSession[]): ShelfTier[] {
  const byId = new Map(designs.map(d => [d.id, d]))
  const tiers = new Map<number, ShelfTier>()
  for (const s of done) {
    const ds = byId.get(s.designId)
    if (!ds) continue
    const nodes = Array.isArray(s.canvas?.nodes) ? s.canvas.nodes.length : 0
    const date = localDayKey(s.at)
    const tier = tiers.get(ds.tier) ?? { tier: ds.tier, label: ds.tierLabel, thumbs: [] }
    tier.thumbs.push({ sessionId: s.id, designId: ds.id, title: ds.title, date, nodes, canvas: s.canvas, name: `${ds.title} · ${date} · ${nodes} nodes` })
    tiers.set(ds.tier, tier)
  }
  return [...tiers.values()].sort((a, b) => a.tier - b.tier)
}

export function vocabCount(done: DesignSession[]): number {
  const kinds = new Set<string>()
  for (const s of done) for (const n of s.canvas?.nodes ?? []) if (KIT_KINDS.includes(n.kind)) kinds.add(n.kind)
  return kinds.size
}

export const vocabText = (n: number): string => `Vocabulary · ${n} of ${KIT_KINDS.length} kinds used`

export interface RedesignRow {
  designId: string; title: string; sessionId: string; due: number; dueText: string
  state: 'queued' | 'due'; readNext: string; previousRubric: number
}

/** Completed sessions whose redesign is not yet consumed by a later session's `redesignOf`. */
export function outstandingRedesigns(all: DesignSession[]): DesignSession[] {
  const done = doneSessions(all)
  const consumed = new Set(done.map(s => s.redesignOf).filter((x): x is string => !!x))
  return done.filter(s => s.redesignDue != null && !consumed.has(s.id))
}

export function outstandingFor(all: DesignSession[], designId: string): DesignSession | null {
  return outstandingRedesigns(all).filter(s => s.designId === designId).pop() ?? null
}

export function redesignQueue(designs: PlanDesignRef[], all: DesignSession[], nowMs: number): RedesignRow[] {
  const byId = new Map(designs.map(d => [d.id, d]))
  return outstandingRedesigns(all)
    .map(s => ({
      designId: s.designId, title: byId.get(s.designId)?.title ?? s.designId, sessionId: s.id,
      due: s.redesignDue as number, dueText: localDayKey(s.redesignDue as number),
      state: (nowMs >= (s.redesignDue as number) ? 'due' : 'queued') as RedesignRow['state'],
      readNext: s.close?.readNext ?? '', previousRubric: s.rubric ?? 0,
    }))
    .sort((a, b) => a.due - b.due)
}

/** TRACKING §1: a redesign passes when it scores higher than the session it redoes. */
export function redesignPassRate(all: DesignSession[]): { passed: number; total: number } {
  const done = doneSessions(all)
  const byId = new Map(done.map(s => [s.id, s]))
  let passed = 0
  let total = 0
  for (const s of done) {
    const orig = s.redesignOf ? byId.get(s.redesignOf) : undefined
    if (!orig) continue
    total++
    if ((s.rubric ?? 0) > (orig.rubric ?? 0)) passed++
  }
  return { passed, total }
}

export const passRateText = (r: { passed: number; total: number }): string => `Redesign pass rate · ${r.passed} / ${r.total}`

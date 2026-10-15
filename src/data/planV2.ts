import type { Kind, LabRef, Lane, PlanDesignTier, PlanDsaSprint, PlanLearner, PlanQuestion } from './types'

/** Plan v2 shape (R1 master plan, "Shared interfaces"). Where the v1 `PlanPhase` clashes, import this one as `PlanPhaseV2` (D5). */
export interface PlanArea { id: string; name: string; tag: string /* 2 letters */; why: string; pre: string[] }
export interface PlanPhase { p: number; name: string; months: string; idea: string; authored: boolean }
export interface PlanNode {
  id: string; area: string; phase: number; kind: 'topic' | 'real' | 'lit' | 'build' | 'band'
  title: string; short?: string; oneLiner: string; why: string; pre: string[]; demandPct?: number; explain: string[]; hours?: number
}
export interface PlanBuild { id: string; name: string; lang: 'python' | 'go'; repo: string; lab: string; gpu: LabRef['gpu'] }
export interface PlanTicketV2 {
  id: string; kind: Kind; lane: Lane; track: 'ai' | 'interview'; node?: string; area?: string; phase?: number
  title: string; text: string; links: { label: string; url: string }[]; estMin: number; order: number
  explain?: string[]
  /** D10: reference answers, parallel to `explain` */
  explainAnswers?: string[]
  lab?: LabRef; asOf?: string; skill?: string
}
export interface PlanMix { shares: { path: number; dsa: number; design: number }; budgets: number[] /* 7, Sunday first */ }
export interface PlanV2 {
  planFormat: 2; planVersion: string; areas: PlanArea[]; phases: PlanPhase[]; nodes: PlanNode[]
  builds: PlanBuild[]; tickets: PlanTicketV2[]; dsa_bank: PlanDsaSprint[]; design_bank: PlanDesignTier[]
  /** R1 W6: the shipped Design and AI questions (BANK-02); absent on a plan older than the question banks */
  qbank?: PlanQuestion[]
  tasks: PlanTicketV2[]
  mix: PlanMix; rituals: { id: string; title: string; cadence: 'daily' | 'weekly' | 'monthly'; minutes: number; /** weekly rituals: the due day, 0 = Sunday ... 6 = Saturday */ dueWeekday?: number }[]
  idMap: Record<string, string>; learner?: PlanLearner
}

export function isPlanV2(p: unknown): p is PlanV2 {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  return (
    o.planFormat === 2 && typeof o.planVersion === 'string' &&
    Array.isArray(o.areas) && Array.isArray(o.phases) && Array.isArray(o.nodes) && Array.isArray(o.tickets) &&
    typeof o.mix === 'object' && o.mix !== null
  )
}

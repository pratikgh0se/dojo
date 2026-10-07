import type { PlanJson, PlanSprint, PlanTask, StageSession } from '../../src/data/types'
import { smallPlan } from './plan'

const SESSIONS: StageSession[] = ['watch', 'rebuild', 'build', 'teachback']

const task = (stage: number, sprint: number, session: StageSession): PlanTask => ({
  id: `st${stage}-s${sprint}-${session}`,
  skill: 'nn',
  text: `Stage ${stage} ${session}, sprint ${sprint}`,
  links: [{ label: `Ref ${stage}`, url: `https://example.com/ref${stage}` }],
  kind: 'stage',
  stage,
  session,
})

const sprint = (n: number, focus: string, stage: number): PlanSprint => ({
  sprint: n, block: 1, block_title: 'B1', block_theme: 'T1', focus_ai: focus, focus_interview: `fi${n}`,
  ai: SESSIONS.map(s => task(stage, n, s)), interview: [], proof: n === 2 ? 'Repo alpha' : null,
})

/** A tiny forge-style plan: Stage 05 over S1–S2, Stage 06 in S3 (ranges deliberately unlike the live plan). */
export function stagePlan(): PlanJson {
  return {
    ...smallPlan,
    planVersion: 'stage-fixture',
    sprints: [sprint(1, 'Stage 05: Alpha', 5), sprint(2, 'Stage 05: Alpha', 5), sprint(3, 'Stage 06: Beta', 6)],
    dsa_bank: [],
    design_bank: [],
    skills: [{ id: 'nn', label: 'Neural nets', tier: 2, needs: [], what: 'w', why: 'y' }],
    ai_shelf: [
      { skill: 'nn', text: 'Read the UDL chapter on backprop', links: [{ label: 'UDL', url: 'https://example.com/udl' }], from: 'x1' },
      { skill: 'papers', text: 'Read the attention paper', links: [], from: 'x2' },
    ],
  }
}

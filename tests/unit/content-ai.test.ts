import { describe, expect, it } from 'vitest'
import { AGENT_BUCKETS, GPU_BUDGET, TUTOR_PROMPTS } from '../../src/content/workingWithAi'

describe('Working with AI content', () => {
  it('has the three agent buckets', () => {
    expect(AGENT_BUCKETS.head).toEqual(['Bucket', 'What is in it', 'Who writes it'])
    expect(AGENT_BUCKETS.rows.map(r => r[0])).toEqual([
      'Core mechanisms (about 30% of hours)', 'Scaffolding (about 50%)', 'Frameworks and APIs (about 20%)',
    ])
    expect(AGENT_BUCKETS.rows.every(r => r.length === 3)).toBe(true)
  })
  it('the Scaffolding row never lets the agent write forge code (capstone rule)', () => {
    const scaffolding = AGENT_BUCKETS.rows.find(r => r[0].startsWith('Scaffolding'))!
    expect(scaffolding.join(' ')).toContain('forge')
    expect(scaffolding.join(' ')).toContain('typed by hand')
    expect(scaffolding.some(cell => /data loaders|benchmark harnesses|kubernetes manifests|\btests\b/i.test(cell))).toBe(false)
  })
  it('has the five tutor prompts', () => {
    expect(TUTOR_PROMPTS.map(p => p.title)).toEqual([
      'For a paper or chapter', 'For a concept that did not land', 'For code I typed along',
      'After a failed timed problem', 'For a design deep dive',
    ])
    expect(TUTOR_PROMPTS[0].body).toContain('Summarize it in 10 bullets a platform engineer would')
  })
  it('has the GPU budget matching the capstone spec, not the old A100/10B-token plan', () => {
    expect(GPU_BUDGET.rows).toHaveLength(5)
    expect(GPU_BUDGET.rows.every(r => !/\(sprints? \d/.test(r[0]))).toBe(true)
    const flat = GPU_BUDGET.rows.flat().join(' ') + ' ' + (GPU_BUDGET.note ?? '')
    // Old-plan-only claims this table must never reintroduce: the spec has no FSDP
    // stage, and Stage 5's reduced-scale repro is never an A100/10B-token run.
    expect(flat).not.toMatch(/FSDP/i)
    expect(flat).not.toMatch(/A100/i)
    expect(flat).not.toMatch(/10B[- ]token/i)
    // What the spec does say: only Stage 7's two rented sessions cost money, capped ~$20.
    expect(flat).toMatch(/rented[- ]GPU sessions/i)
    expect(flat).toMatch(/\$20/)
    expect(GPU_BUDGET.note).toContain('only Stage 7’s two rented-GPU sessions (~$20 total) ever cost money')
  })
})

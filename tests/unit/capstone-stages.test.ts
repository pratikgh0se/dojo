// app/tests/unit/capstone-stages.test.ts
import { describe, expect, it } from 'vitest'
import { CAPSTONE_STAGES } from '../../src/content/capstoneStages'
import { parseLocalDate } from '../../src/lib/dates'
import { fmtDayMonYear } from '../../src/lib/fmtDate'
import { checkpointAfterStage } from '../../src/rules/capstone'
import { CHECKPOINT_SPRINT } from '../../src/rules/overview'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

describe('CAPSTONE_STAGES (C-PROJECTS §0)', () => {
  it('lists stages 00–11 with the contract titles, indexed by stage number', () => {
    expect(CAPSTONE_STAGES.map(s => s.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(CAPSTONE_STAGES.map(s => s.title)).toEqual([
      'Setup + math by picture', 'micrograd', 'makemore', 'GPT', 'Tokenizer (BPE)', 'Training at scale',
      'Inference server', 'AI infra on Kubernetes', 'Evals harness', 'Fine-tuning', 'Agents', 'Research',
    ])
    CAPSTONE_STAGES.forEach((s, i) => expect(s.stage).toBe(i))
  })

  it('covers S1–S72 with contiguous sprint ranges', () => {
    expect(CAPSTONE_STAGES[0].from).toBe(1)
    expect(CAPSTONE_STAGES[11].to).toBe(72)
    for (let i = 1; i < CAPSTONE_STAGES.length; i++) expect(CAPSTONE_STAGES[i].from).toBe(CAPSTONE_STAGES[i - 1].to + 1)
    expect(CAPSTONE_STAGES[1]).toMatchObject({ from: 2, to: 4 })
    expect(CAPSTONE_STAGES[7]).toMatchObject({ from: 31, to: 38 })
  })

  it('puts the S38 checkpoint after Stage 07', () => {
    expect(checkpointAfterStage([...CAPSTONE_STAGES], CHECKPOINT_SPRINT)).toBe(7)
  })
})

describe('fmtDayMonYear', () => {
  it('formats a local day as "d Mon yyyy" with no leading zero', () => {
    expect(fmtDayMonYear(ist('2026-10-14T10:00:00'))).toBe('14 Oct 2026')
    expect(fmtDayMonYear(parseLocalDate('2026-10-05'))).toBe('5 Oct 2026')
    expect(fmtDayMonYear(ist('2026-12-31T23:59:00'))).toBe('31 Dec 2026')
    expect(fmtDayMonYear(ist('2027-01-01T00:10:00'))).toBe('1 Jan 2027')
  })
})

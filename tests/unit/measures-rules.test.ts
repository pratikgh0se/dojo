// app/tests/unit/measures-rules.test.ts
import { describe, expect, it } from 'vitest'
import type { Measure } from '../../src/data/types'
import { formOf, newArtifact, seedArtifacts, type ArtifactRecord } from '../../src/rules/artifacts'
import {
  firstOf, makeMeasure, measureRows, measuresMarkdown, measureSprint, measureText, MEASURE_ERRORS, validateMeasure,
  type MeasureInput,
} from '../../src/rules/measures'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const OCT14 = ist('2026-10-14T10:00:00')
const OCT20 = ist('2026-10-20T10:00:00')
const input = (p: Partial<MeasureInput> = {}): MeasureInput => ({ choice: 'loss', name: '', value: '1.98', unit: '', ...p })
const A = (measures: Measure[], p: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  ...newArtifact('art-a', { ...formOf(null), title: 'micrograd engine', stage: 1 }, OCT14 - 1000), measures, ...p,
})

describe('validateMeasure', () => {
  it('needs a finite number; accepts 0 and negatives (Review Focus #5)', () => {
    expect(validateMeasure(input({ value: '' })).value).toBe('Enter a number.')
    expect(validateMeasure(input({ value: 'abc' })).value).toBe(MEASURE_ERRORS.value)
    expect(validateMeasure(input({ value: 'Infinity' })).value).toBe(MEASURE_ERRORS.value)
    expect(validateMeasure(input({ value: '0' }))).toEqual({})
    expect(validateMeasure(input({ value: '-3.5' }))).toEqual({})
  })

  it('other needs a name', () => {
    expect(validateMeasure(input({ choice: 'other', name: '  ' })).name).toBe('Name the measure.')
    expect(validateMeasure(input({ choice: 'other', name: 'perplexity' }))).toEqual({})
  })
})

describe('makeMeasure and text', () => {
  it('records the sprint at the moment it is added', () => {
    expect(measureSprint(OCT14, '2026-10-05')).toBe(1)
    expect(measureSprint(OCT20, '2026-10-05')).toBe(2)
    expect(measureSprint(ist('2026-10-01T10:00:00'), '2026-10-05')).toBe(1)
    expect(measureSprint(OCT14, '')).toBe(1)
    expect(makeMeasure(input({ unit: ' ' }), OCT14, '2026-10-05')).toEqual({ name: 'loss', value: 1.98, unit: '', at: OCT14, sprint: 1 })
    expect(makeMeasure(input({ choice: 'other', name: ' perplexity ', value: '12' }), OCT20, '2026-10-05'))
      .toEqual({ name: 'perplexity', value: 12, unit: '', at: OCT20, sprint: 2 })
  })

  it('writes <name> <value>[ <unit>] with the default number-to-string', () => {
    expect(measureText({ name: 'loss', value: 1.98, unit: '', at: 0, sprint: 1 })).toBe('loss 1.98')
    expect(measureText({ name: 'tokens/sec', value: 412, unit: 'tok/s', at: 0, sprint: 1 })).toBe('tokens/sec 412 tok/s')
    expect(measureText({ name: 'loss', value: 0, unit: '', at: 0, sprint: 1 })).toBe('loss 0')
  })
})

describe('measureRows and firsts (C-PROJECTS §2.10)', () => {
  const ms: Measure[] = [
    { name: 'loss', value: 1.98, unit: '', at: OCT14, sprint: 1 },
    { name: 'tokens/sec', value: 412, unit: 'tok/s', at: OCT14, sprint: 1 },
    { name: 'eval score', value: 0.82, unit: '', at: OCT14, sprint: 1 },
    { name: 'loss', value: 1.41, unit: '', at: OCT20, sprint: 2 },
  ]

  it('sorts by recorded time; same-time rows keep insertion order', () => {
    const rows = measureRows([A(ms), ...seedArtifacts(OCT14 - 5000)])
    expect(rows.map(r => `${r.sprint}|${r.stage}|${r.artifact}|${r.name}|${r.value}|${r.unit}`)).toEqual([
      '1|1|micrograd engine|loss|1.98|', '1|1|micrograd engine|tokens/sec|412|tok/s',
      '1|1|micrograd engine|eval score|0.82|', '2|1|micrograd engine|loss|1.41|',
    ])
  })

  it('firsts are the earliest recorded, not the latest', () => {
    const rows = measureRows([A(ms)])
    expect(firstOf(rows, 'loss')).toMatchObject({ value: 1.98, sprint: 1, artifact: 'micrograd engine' })
    expect(firstOf(rows, 'tokens/sec')).toMatchObject({ value: 412, unit: 'tok/s' })
    expect(firstOf(rows, 'recall@5')).toBeNull()
  })

  it('exports the exact Markdown of C-PROJECTS §2.10', () => {
    const rows = measureRows([A(ms.slice(0, 1))])
    expect(measuresMarkdown(rows)).toBe(
      '# Measures\n\n| Sprint | Stage | Artifact | Measure | Value | Unit |\n|---|---|---|---|---|---|\n| S1 | 01 | micrograd engine | loss | 1.98 |  |\n',
    )
    expect(measuresMarkdown([])).toBe('# Measures\n\n| Sprint | Stage | Artifact | Measure | Value | Unit |\n|---|---|---|---|---|---|\n')
  })

  it('escapes | in cells so the table survives (Review Focus #5)', () => {
    const rows = measureRows([A([{ name: 'loss', value: -0.5, unit: 'a|b', at: OCT14, sprint: 1 }], { title: 'x | y' })])
    expect(measuresMarkdown(rows).split('\n')[4]).toBe('| S1 | 01 | x \\| y | loss | -0.5 | a\\|b |')
  })
})

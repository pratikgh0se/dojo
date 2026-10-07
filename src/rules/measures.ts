import type { Measure } from '../data/types'
import { pad2 } from '../lib/dates'
import { sortArtifacts, type ArtifactRecord } from './artifacts'
import { sprintOf } from './sprint'

export const MEASURE_CHOICES = ['loss', 'tokens/sec', 'eval score', 'p95 latency', 'recall@5', 'other'] as const
export type MeasureChoice = (typeof MEASURE_CHOICES)[number]
export const MEASURE_ERRORS = { value: 'Enter a number.', name: 'Name the measure.' } as const
export const MEASURES_FILE = 'dojo-measures.md'

export interface MeasureInput { choice: MeasureChoice; name: string; value: string; unit: string }
export type MeasureErrors = Partial<Record<'value' | 'name', string>>
export const EMPTY_MEASURE: MeasureInput = { choice: 'loss', name: '', value: '', unit: '' }

export function validateMeasure(i: MeasureInput): MeasureErrors {
  const e: MeasureErrors = {}
  const v = i.value.trim()
  if (v === '' || !Number.isFinite(Number(v))) e.value = MEASURE_ERRORS.value
  if (i.choice === 'other' && !i.name.trim()) e.name = MEASURE_ERRORS.name
  return e
}

/** Sprint at the moment the measure is recorded (C-PROJECTS D-15); S1 before the start date. */
export function measureSprint(atMs: number, startDate: string): number {
  return startDate ? Math.max(1, sprintOf(atMs, startDate)) : 1
}

export function makeMeasure(i: MeasureInput, atMs: number, startDate: string): Measure {
  return {
    name: i.choice === 'other' ? i.name.trim() : i.choice,
    value: Number(i.value.trim()),
    unit: i.unit.trim(),
    at: atMs,
    sprint: measureSprint(atMs, startDate),
  }
}

export function measureValueText(m: Measure): string {
  return m.unit ? `${m.value} ${m.unit}` : `${m.value}`
}

export function measureText(m: Measure): string {
  return `${m.name} ${measureValueText(m)}`
}

export interface MeasureRow {
  sprint: number
  stage: number | null
  artifactId: string
  artifact: string
  name: string
  value: number
  unit: string
  at: number
}

/** Every measure of every artifact, by recorded time; ties keep board order, then insertion order (stable sort). */
export function measureRows(list: readonly ArtifactRecord[]): MeasureRow[] {
  const rows = sortArtifacts(list).flatMap(a =>
    a.measures.map(m => ({
      sprint: m.sprint, stage: a.stage ?? null, artifactId: a.id, artifact: a.title,
      name: m.name, value: m.value, unit: m.unit, at: m.at,
    })),
  )
  return rows.sort((x, y) => x.at - y.at)
}

export function firstOf(rows: readonly MeasureRow[], name: string): MeasureRow | null {
  return rows.find(r => r.name === name) ?? null
}

const cell = (s: string): string => s.replace(/\|/g, '\\|')

export function measuresMarkdown(rows: readonly MeasureRow[]): string {
  const lines = [
    '# Measures',
    '',
    '| Sprint | Stage | Artifact | Measure | Value | Unit |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      r => `| ${[`S${r.sprint}`, r.stage === null ? '' : pad2(r.stage), cell(r.artifact), cell(r.name), String(r.value), cell(r.unit)].join(' | ')} |`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

export type ChartTone = 'accent' | 'rival' | 'ok' | 'warn' | 'danger' | 'boss' | 'muted'

export interface ChartSeries {
  key: string
  label: string
  tone: ChartTone
}

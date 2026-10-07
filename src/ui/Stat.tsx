import type { ReactNode } from 'react'

export function Stat({ value, label, testId }: { value: ReactNode; label: string; testId?: string }) {
  return (
    <div className="stat">
      <b className="stat-value" data-testid={testId}>{value}</b>
      <span className="stat-label">{label}</span>
    </div>
  )
}
